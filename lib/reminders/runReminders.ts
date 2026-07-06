import type { SupabaseClient } from "@supabase/supabase-js"
import { createTranslator } from "next-intl"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { buildTerminIcs } from "@/lib/email/ics"
import { reminderSubject, reminderHtml } from "@/lib/email/templates"
import { recipientsForKlijent, buildRecipientIndex, parseEmailList } from "@/lib/reminders/recipients"
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

const DEFAULT_DANA = [60, 30, 15, 7]

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
  // Throttling (env-konfigurabilno; defaulti za Resend free: 100/dan, ~2 req/s).
  const maxPerRun = deps.maxPerRun ?? (Number(env.REMINDER_MAX_PER_RUN) || 90)
  const batchSize = Math.max(1, deps.batchSize ?? (Number(env.REMINDER_BATCH_SIZE) || 2))
  const delayMs = deps.delayMs ?? (Number(env.REMINDER_BATCH_DELAY_MS) || 1100)

  const { data: post } = await supabase
    .from("postavke")
    .select("dana_prije")
    .eq("id", 1)
    .maybeSingle()
  const danaPrije = post?.dana_prije && post.dana_prije.length > 0 ? post.dana_prije : DEFAULT_DANA

  const { data: due, error } = await supabase.rpc("get_due_podsjetnici", { dana_prije_arr: danaPrije })
  if (error) throw new Error(error.message)
  const rows = due ?? []

  // Indeks primalaca (jednom po run-u): admini + mapa klijent_id → dodijeljeni; eligibilnost = aktivan & prima_podsjetnike.
  const base = parseEmailList(env.REMINDER_TO)
  const { data: korisnici, error: korErr } = await supabase
    .from("korisnici")
    .select("id, email, uloga, aktivan, prima_podsjetnike")
  if (korErr) throw new Error(`Greška pri čitanju primalaca (korisnici): ${korErr.message}`)
  // PostgREST implicitno limitira na ~1000 redova: sigurno na trenutnoj skali, ali ako dodjele narastu
  // dodaj eksplicitan .range()/count provjeru — tiha trunkacija bi inače ispustila nekog primaoca.
  const { data: dodjele, error: kkErr } = await supabase
    .from("korisnik_klijent")
    .select("korisnik_id, klijent_id")
  if (kkErr) throw new Error(`Greška pri čitanju dodjela (korisnik_klijent): ${kkErr.message}`)
  const recipientIndex = buildRecipientIndex(korisnici ?? [], dodjele ?? [])
  if (
    recipientIndex.adminEmails.length === 0 &&
    recipientIndex.assignedByKlijent.size === 0 &&
    base.length === 0 &&
    rows.length > 0
  ) {
    console.warn("[reminders] nema eligibilnih primalaca (admini/dodjele s prima_podsjetnike) ni REMINDER_TO — sve se preskača")
  }

  // Per-row obrada izdvojena radi throttlinga (grupe + pauza između njih).
  const processRow = async (r: (typeof rows)[number]): Promise<Outcome> => {
      if (
        r.termin_id == null ||
        r.klijent_id == null ||
        r.dana_prije == null ||
        r.dana_do_roka == null ||
        r.rok_dospijeca == null ||
        r.klijent_naziv == null ||
        r.vrsta_naziv == null
      ) {
        return { kind: "skip", terminId: r.termin_id ?? "", danaPrije: r.dana_prije ?? -9999, razlog: "nepotpun red" }
      }
      const to = recipientsForKlijent(recipientIndex, r.klijent_id, base)
      if (to.length === 0) {
        return { kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "nema primalaca" }
      }
      try {
        const ics = buildTerminIcs({
          vrsta: r.vrsta_naziv,
          klijent: r.klijent_naziv,
          rok: r.rok_dospijeca,
          terminId: r.termin_id,
          lokacija: r.lokacija_naziv,
          baseUrl: env.NEXT_PUBLIC_APP_URL,
        })
        const res = await send({
          to,
          subject: reminderSubject({ vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, danaDoRoka: r.dana_do_roka }),
          html: reminderHtml({
            klijent: r.klijent_naziv,
            vrsta: r.vrsta_naziv,
            rok: r.rok_dospijeca,
            danaDoRoka: r.dana_do_roka,
            lokacija: r.lokacija_naziv,
            terminId: r.termin_id,
            klijentId: r.klijent_id,
            baseUrl: env.NEXT_PUBLIC_APP_URL,
          }),
          attachments: [{ filename: t("prilogNaziv"), content: Buffer.from(ics, "utf-8") }],
        })
        // Dry-run ILI produkcija bez RESEND_API_KEY (sendEmail tad vrati dryRun): NE upisuj audit.
        // Inače bi „lažno poslat" red kasnije blokirao stvarno slanje (idempotencija) čim se ključ doda.
        if (res.dryRun) {
          return { kind: "sent", terminId: r.termin_id, danaPrije: r.dana_prije, to, resendId: res.id, dryRun: true }
        }
        const { error: insErr } = await supabase.from("podsjetnici").insert({
          termin_id: r.termin_id,
          dana_prije: r.dana_prije,
          poslat_na: to,
          resend_id: res.id,
        })
        if (insErr) {
          if (/duplicate|unique/i.test(insErr.message)) {
            return { kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "vec poslat" }
          }
          // send je uspio ali audit nije → at-least-once (moguć duplikat u sljedećem run-u).
          return { kind: "err", terminId: r.termin_id, danaPrije: r.dana_prije, message: insErr.message }
        }
        return { kind: "sent", terminId: r.termin_id, danaPrije: r.dana_prije, to, resendId: res.id, dryRun: false }
      } catch (e) {
        return {
          kind: "err",
          terminId: r.termin_id,
          danaPrije: r.dana_prije,
          message: e instanceof Error ? e.message : String(e),
        }
      }
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
    const batchOut = await Promise.all(batch.map(processRow))
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
