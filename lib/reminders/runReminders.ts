import type { SupabaseClient } from "@supabase/supabase-js"
import { createTranslator } from "next-intl"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { posaljiIzabiljezi } from "@/lib/email/posaljiIzabiljezi"
import { buildTerminIcs } from "@/lib/email/ics"
import { reminderSubject, reminderHtml, reminderHtmlFirma } from "@/lib/email/templates"
import { recipientsForKlijent, firmaRecipientsZa, loadRecipientIndex } from "@/lib/reminders/recipients"
import { firmBrand } from "@/lib/email/firmBrand"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "email.podsjetnik" })

export type SentItem = { terminId: string; danaPrije: number; to: string[]; resendId: string; dryRun: boolean }
export type SkipItem = { terminId: string; danaPrije: number; razlog: string }
export type ErrItem = { terminId: string; danaPrije: number; message: string }
export type ReminderRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[]; deferred: number }

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

export async function runReminders(
  supabase: SupabaseClient<Database>,
  deps: {
    send?: (a: SendArgs) => Promise<SendResult>
    maxPerRun?: number
    batchSize?: number
    delayMs?: number
  } = {},
): Promise<ReminderRunResult> {
  const send = deps.send ?? sendEmail
  const brand = firmBrand()
  const fromAddr = env.EMAIL_FROM ?? "no-reply@tehpro"
  // Throttling (env-konfigurabilno; defaulti za Resend free: 100/dan, ~2 req/s).
  const maxPerRun = deps.maxPerRun ?? (Number(env.REMINDER_MAX_PER_RUN) || 90)
  const batchSize = Math.max(1, deps.batchSize ?? (Number(env.REMINDER_BATCH_SIZE) || 2))
  const delayMs = deps.delayMs ?? (Number(env.REMINDER_BATCH_DELAY_MS) || 1100)

  // Indeks primalaca (jednom po run-u): admini + mapa klijent_id → dodijeljeni; eligibilnost = aktivan & prima_podsjetnike.
  const { index: recipientIndex, base, danaPrije } = await loadRecipientIndex(supabase)

  const { data: due, error } = await supabase.rpc("get_due_podsjetnici", { dana_prije_arr: danaPrije })
  if (error) throw new Error(error.message)
  const rows = due ?? []

  if (
    recipientIndex.adminEmails.length === 0 &&
    recipientIndex.assignedByKlijent.size === 0 &&
    base.length === 0 &&
    rows.length > 0
  ) {
    console.warn("[reminders] nema eligibilnih primalaca (admini/dodjele s prima_podsjetnike) ni REMINDER_TO — sve se preskača")
  }

  // Per-row obrada izdvojena radi throttlinga (grupe + pauza između njih).
  const processRow = async (r: (typeof rows)[number]): Promise<Outcome[]> => {
    if (r.termin_id == null || r.klijent_id == null || r.dana_prije == null || r.dana_do_roka == null ||
        r.rok_dospijeca == null || r.klijent_naziv == null || r.vrsta_naziv == null) {
      return [{ kind: "skip", terminId: r.termin_id ?? "", danaPrije: r.dana_prije ?? -9999, razlog: "nepotpun red" }]
    }
    const icsInterni = buildTerminIcs({
      vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, rok: r.rok_dospijeca, terminId: r.termin_id,
      lokacija: r.lokacija_naziv, baseUrl: env.NEXT_PUBLIC_APP_URL,
    })
    // Firma: ICS BEZ baseUrl → opis priloga nema interni /plan-aktivnosti link (login-zid za firmu).
    const icsFirma = buildTerminIcs({
      vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, rok: r.rok_dospijeca, terminId: r.termin_id,
      lokacija: r.lokacija_naziv,
    })
    const subject = reminderSubject({ vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, danaDoRoka: r.dana_do_roka })
    const prilogInterni = [{ filename: t("prilogNaziv"), content: Buffer.from(icsInterni, "utf-8") }]
    const prilogFirma = [{ filename: t("prilogNaziv"), content: Buffer.from(icsFirma, "utf-8") }]
    const out: Outcome[] = []

    // Pomoćna: pošalji jedan kanal + audit po kanalu.
    const posalji = async (kanal: "interni" | "firma", args: SendArgs): Promise<Outcome> => {
      try {
        const res = await posaljiIzabiljezi(
          supabase,
          {
            ...args,
            tip: kanal === "interni" ? "podsjetnik_interni" : "podsjetnik_firma",
            terminId: r.termin_id!,
            klijentId: r.klijent_id,
          },
          send,
        )
        const primaoci = [...(args.to ?? []), ...(args.bcc ?? [])]
        if (res.dryRun) return { kind: "sent", terminId: r.termin_id!, danaPrije: r.dana_prije!, to: primaoci, resendId: res.id, dryRun: true }
        const { error: insErr } = await supabase.from("podsjetnici").insert({
          termin_id: r.termin_id!, dana_prije: r.dana_prije!, kanal, poslat_na: primaoci, resend_id: res.id,
        })
        if (insErr) {
          if (/duplicate|unique/i.test(insErr.message)) return { kind: "skip", terminId: r.termin_id!, danaPrije: r.dana_prije!, razlog: `vec poslat (${kanal})` }
          return { kind: "err", terminId: r.termin_id!, danaPrije: r.dana_prije!, message: insErr.message }
        }
        return { kind: "sent", terminId: r.termin_id!, danaPrije: r.dana_prije!, to: primaoci, resendId: res.id, dryRun: false }
      } catch (e) {
        return { kind: "err", terminId: r.termin_id!, danaPrije: r.dana_prije!, message: e instanceof Error ? e.message : String(e) }
      }
    }

    // Kanal 1: interni (radnici/admini/base) — mejl sa dugmadima.
    const interni = recipientsForKlijent(recipientIndex, r.klijent_id, base)
    if (interni.length > 0) {
      out.push(await posalji("interni", {
        to: interni, subject, attachments: prilogInterni,
        html: reminderHtml({ klijent: r.klijent_naziv, vrsta: r.vrsta_naziv, rok: r.rok_dospijeca, danaDoRoka: r.dana_do_roka, lokacija: r.lokacija_naziv, terminId: r.termin_id, klijentId: r.klijent_id, baseUrl: env.NEXT_PUBLIC_APP_URL }),
      }))
    }
    // Kanal 2: firma (Krug 2) — mejl bez dugmadi, TEHPRO brend, adrese u BCC.
    const firma = firmaRecipientsZa(recipientIndex, r.klijent_id, r.lokacija_id ?? null)
    if (firma.length > 0) {
      out.push(await posalji("firma", {
        to: [fromAddr], bcc: firma, subject, attachments: prilogFirma,
        html: reminderHtmlFirma({ klijent: r.klijent_naziv, vrsta: r.vrsta_naziv, rok: r.rok_dospijeca, danaDoRoka: r.dana_do_roka, lokacija: r.lokacija_naziv, brand }),
      }))
    }
    if (out.length === 0) return [{ kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "nema primalaca" }]
    return out
  }

  // Throttling: cap po run-u (RPC sortira najhitnije prvo) + slanje u grupama radi Resend rate-limita.
  const toProcess = rows.slice(0, maxPerRun)
  const deferred = Math.max(0, rows.length - toProcess.length)
  if (deferred > 0) {
    console.warn(`[reminders] cap ${maxPerRun}/run — odgođeno ${deferred} podsjetnika za sljedeći run`)
  }
  const outcomes: Outcome[] = []
  for (let i = 0; i < toProcess.length; i += batchSize) {
    const batch = toProcess.slice(i, i + batchSize)
    // eslint-disable-next-line no-await-in-loop -- throttling: namjerno sekvencijalne grupe radi Resend rate-limita
    const batchOut = (await Promise.all(batch.map(processRow))).flat()
    outcomes.push(...batchOut)
    if (delayMs > 0 && i + batchSize < toProcess.length) {
      // eslint-disable-next-line no-await-in-loop -- pauza između grupa (rate-limit)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  const sent: SentItem[] = []
  const skipped: SkipItem[] = []
  const errors: ErrItem[] = []
  for (const o of outcomes) {
    if (o.kind === "sent") sent.push({ terminId: o.terminId, danaPrije: o.danaPrije, to: o.to, resendId: o.resendId, dryRun: o.dryRun })
    else if (o.kind === "skip") skipped.push({ terminId: o.terminId, danaPrije: o.danaPrije, razlog: o.razlog })
    else errors.push({ terminId: o.terminId, danaPrije: o.danaPrije, message: o.message })
  }
  return { sent, skipped, errors, deferred }
}
