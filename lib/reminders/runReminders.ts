import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { reminderSubject, reminderHtml } from "@/lib/email/templates"
import { assembleRecipients, parseEmailList } from "@/lib/reminders/recipients"

export type SentItem = { terminId: string; danaPrije: number; to: string[]; resendId: string; dryRun: boolean }
export type SkipItem = { terminId: string; danaPrije: number; razlog: string }
export type ErrItem = { terminId: string; danaPrije: number; message: string }
export type ReminderRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[]; deferred: number }

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

const DEFAULT_DANA = [60, 30, 15, 7]

/** Interni primaoci (Krug 1): svi aktivni admini + REMINDER_TO. Klijent se nikad ne kontaktira. */
async function internalRecipients(supabase: SupabaseClient<Database>): Promise<string[]> {
  const base = parseEmailList(env.REMINDER_TO)
  const { data: admins, error: adminErr } = await supabase
    .from("korisnici")
    .select("email")
    .eq("uloga", "admin")
    .eq("aktivan", true)
  if (adminErr) throw new Error(`Greška pri čitanju primalaca (korisnici): ${adminErr.message}`)
  const adminEmails = (admins ?? []).map((a) => a.email)
  return assembleRecipients({ base, adminEmails })
}

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

  // Primaoci se računaju JEDNOM po pokretanju (Krug 1: isti za sve termine).
  const to = await internalRecipients(supabase)
  if (to.length === 0 && rows.length > 0) {
    console.warn("[reminders] nema internih primalaca (admini/REMINDER_TO) — preskačem sva slanja")
  }

  // Per-row obrada izdvojena radi throttlinga (grupe + pauza između njih).
  const processRow = async (r: (typeof rows)[number]): Promise<Outcome> => {
      if (
        r.termin_id == null ||
        r.dana_prije == null ||
        r.dana_do_roka == null ||
        r.rok_dospijeca == null ||
        r.klijent_naziv == null ||
        r.vrsta_naziv == null
      ) {
        return { kind: "skip", terminId: r.termin_id ?? "", danaPrije: r.dana_prije ?? -9999, razlog: "nepotpun red" }
      }
      if (to.length === 0) {
        return { kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "nema primalaca" }
      }
      try {
        const res = await send({
          to,
          subject: reminderSubject({ vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, danaDoRoka: r.dana_do_roka }),
          html: reminderHtml({
            klijent: r.klijent_naziv,
            vrsta: r.vrsta_naziv,
            rok: r.rok_dospijeca,
            danaDoRoka: r.dana_do_roka,
            lokacija: r.lokacija_naziv,
          }),
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
