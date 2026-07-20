import type { SupabaseClient } from "@supabase/supabase-js"
import { createTranslator } from "next-intl"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { posaljiIzabiljezi } from "@/lib/email/posaljiIzabiljezi"
import { buildTerminIcs } from "@/lib/email/ics"
import { reminderSubject, reminderHtml, rokIstekaoFirmaSubject, rokIstekaoFirmaHtml } from "@/lib/email/templates"
import { loadRecipientIndex, recipientsForKlijent, firmaRecipientsForKlijent } from "@/lib/reminders/recipients"
import { firmBrand } from "@/lib/email/firmBrand"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "email.podsjetnik" })

export type Kanal = "interni" | "firma"
export type SentItem = { terminId: string; kanal: Kanal; to: string[]; resendId: string; dryRun: boolean }
export type SkipItem = { terminId: string; kanal: Kanal; razlog: string }
export type ErrItem = { terminId: string; kanal: Kanal; message: string }
export type PostDueRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

type PostDueObavijestiUpdate = Database["public"]["Tables"]["post_due_obavijesti"]["Update"]

/**
 * Post-due obavijesti: tačno jedna po ciklusu i kanalu.
 *
 * Redoslijed je claim-first (upiši → pošalji → označi ishod), jer postoje dva
 * schedulera (vercel.json crons i GH Actions na 0 * * * *) koji rutu pale skoro
 * istovremeno. Send-first bi značio da oba nađu prazan ledger i oba pošalju.
 * Pad slanja NE briše claim — red ostaje 'u_toku' i get_post_due_termine ga
 * ponovo otvori poslije 15 minuta.
 */
export async function runPostDue(
  supabase: SupabaseClient<Database>,
  deps: {
    send?: (a: SendArgs) => Promise<SendResult>
    batchSize?: number
    delayMs?: number
  } = {},
): Promise<PostDueRunResult> {
  const send = deps.send ?? sendEmail
  const brand = firmBrand()
  const fromAddr = env.EMAIL_FROM ?? "no-reply@tehpro"
  const batchSize = Math.max(1, deps.batchSize ?? (Number(env.REMINDER_BATCH_SIZE) || 2))
  const delayMs = deps.delayMs ?? (Number(env.REMINDER_BATCH_DELAY_MS) || 1100)

  const { data: due, error } = await supabase.rpc("get_post_due_termine")
  if (error) throw new Error(error.message)
  const rows = due ?? []
  if (rows.length === 0) return { sent: [], skipped: [], errors: [] }

  // Baca ako se postavke/primaoci ne mogu pročitati. Namjerno: tiho tretiranje
  // transientnog kvara kao "prekidač je isključen" trajno bi progutalo firmin kanal,
  // jer bi upisalo 'preskoceno' claim za tekući ciklus.
  const { index, base } = await loadRecipientIndex(supabase)

  const oznaci = async (claimId: string, patch: PostDueObavijestiUpdate): Promise<void> => {
    const { error: updErr } = await supabase.from("post_due_obavijesti").update(patch).eq("id", claimId)
    if (updErr) console.error("[post-due] označavanje ishoda nije uspjelo:", updErr.message)
  }

  const obradiKanal = async (r: (typeof rows)[number], kanal: Kanal): Promise<Outcome> => {
    const terminId = r.termin_id!
    const { data, error: claimErr } = await supabase.rpc("claim_post_due", {
      p_termin: terminId, p_ciklus: r.ciklus_rok!, p_kanal: kanal,
    })
    // Generisani tip laže: claim_post_due je tipiziran kao `Returns: string`, ali
    // stvarno vraća null kad claim drži neko drugi (potvrđeno izvršavanjem u recenziji
    // prethodnog taska). Provjera ispod mora ostati — bez nje bi "claim nije dobijen"
    // tiho prošlo kao uspjeh i poslalo duplikat.
    const claimId = data as string | null
    if (claimErr) return { kind: "err", terminId, kanal, message: claimErr.message }
    if (!claimId) return { kind: "skip", terminId, kanal, razlog: "claim drži neko drugi" }

    const primaoci = kanal === "interni"
      ? recipientsForKlijent(index, r.klijent_id!, base)
      : firmaRecipientsForKlijent(index, r.klijent_id!)
    if (primaoci.length === 0) {
      await oznaci(claimId, { stanje: "preskoceno", razlog: "nema_primalaca" })
      return { kind: "skip", terminId, kanal, razlog: "nema primalaca" }
    }

    // Ciklus dolazi iz datum_zakazan samo kad se razlikuje od roka; tada mejl mora
    // prikazati oba datuma, da se ne laže o roku.
    const zakazanoZa = r.datum_zakazan && r.datum_zakazan !== r.rok_dospijeca ? r.datum_zakazan : null

    const args: SendArgs = kanal === "interni"
      ? {
          to: primaoci,
          subject: reminderSubject({ vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv!, danaDoRoka: r.dana_do_ciklusa! }),
          html: reminderHtml({
            klijent: r.klijent_naziv!, vrsta: r.vrsta_naziv!, rok: r.rok_dospijeca!,
            danaDoRoka: r.dana_do_ciklusa!, lokacija: r.lokacija_naziv, zakazanoZa,
            terminId, klijentId: r.klijent_id!, baseUrl: env.NEXT_PUBLIC_APP_URL,
          }),
          attachments: [{
            filename: t("prilogNaziv"),
            content: Buffer.from(buildTerminIcs({
              vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv!, rok: r.rok_dospijeca!,
              terminId, lokacija: r.lokacija_naziv, baseUrl: env.NEXT_PUBLIC_APP_URL,
            }), "utf-8"),
          }],
        }
      : {
          to: [fromAddr],
          bcc: primaoci,
          subject: rokIstekaoFirmaSubject({ vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv! }),
          html: rokIstekaoFirmaHtml({
            klijent: r.klijent_naziv!, vrsta: r.vrsta_naziv!, rok: r.rok_dospijeca!,
            zakazanoZa, lokacija: r.lokacija_naziv, brand,
          }),
        }

    try {
      const res = await posaljiIzabiljezi(
        supabase,
        {
          ...args,
          tip: kanal === "interni" ? "podsjetnik_rok_istekao_interni" : "podsjetnik_rok_istekao_firma",
          terminId, klijentId: r.klijent_id,
        },
        send,
      )
      const svi = [...(args.to ?? []), ...(args.bcc ?? [])]
      if (!res.dryRun) {
        const { error: updErr } = await supabase
          .from("post_due_obavijesti")
          .update({ stanje: "poslato", poslat_at: new Date().toISOString(), poslat_na: svi, resend_id: res.id })
          .eq("id", claimId)
        if (updErr) {
          // Mejl je STVARNO poslat, ali trag u ledgeru nije upisan: red ostaje 'u_toku' i
          // get_post_due_termine ga ponovo otvori za 15 minuta → realan rizik duplikata.
          // Vraćamo "err" (ne "sent") da bi pozivalac (cron) ovo vidio kao grešku koju treba
          // istražiti — samo console.error bi ovo progutao bez traga za nadzor.
          console.error("[post-due] mejl poslat ali označavanje ishoda nije uspjelo:", updErr.message)
          return {
            kind: "err", terminId, kanal,
            message: `mejl poslat (resend_id=${res.id}) ali označavanje ishoda nije uspjelo (${updErr.message}) — red ostaje u_toku, mogući duplikat`,
          }
        }
      }
      return { kind: "sent", terminId, kanal, to: svi, resendId: res.id, dryRun: res.dryRun }
    } catch (e) {
      // Claim se NE briše: red ostaje 'u_toku' i RPC ga otvori za 15 minuta.
      return { kind: "err", terminId, kanal, message: e instanceof Error ? e.message : String(e) }
    }
  }

  const zadaci: Array<() => Promise<Outcome>> = []
  for (const r of rows) {
    if (r.treba_interni) zadaci.push(() => obradiKanal(r, "interni"))
    if (r.treba_firma) zadaci.push(() => obradiKanal(r, "firma"))
  }

  const outcomes: Outcome[] = []
  for (let i = 0; i < zadaci.length; i += batchSize) {
    const grupa = zadaci.slice(i, i + batchSize)
    // eslint-disable-next-line no-await-in-loop -- throttling: namjerno sekvencijalne grupe radi Resend rate-limita
    outcomes.push(...(await Promise.all(grupa.map((f) => f()))))
    if (delayMs > 0 && i + batchSize < zadaci.length) {
      // eslint-disable-next-line no-await-in-loop -- pauza između grupa (rate-limit)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  const sent: SentItem[] = []
  const skipped: SkipItem[] = []
  const errors: ErrItem[] = []
  for (const o of outcomes) {
    if (o.kind === "sent") sent.push({ terminId: o.terminId, kanal: o.kanal, to: o.to, resendId: o.resendId, dryRun: o.dryRun })
    else if (o.kind === "skip") skipped.push({ terminId: o.terminId, kanal: o.kanal, razlog: o.razlog })
    else errors.push({ terminId: o.terminId, kanal: o.kanal, message: o.message })
  }
  return { sent, skipped, errors }
}
