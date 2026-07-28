import { Resend } from "resend"
import { env } from "@/lib/env"
import { APP_NAME } from "@/lib/brand"
import { DEMO_MODE } from "@/lib/demo"

/** `demo: true` razlikuje "namjerno nije poslato jer je demo" od običnog dry-runa. */
export type SendResult = { id: string; dryRun: boolean; demo?: boolean }

export type SendArgs = {
  to: string[]
  subject: string
  html: string
  attachments?: { filename: string; content: Buffer }[]
  bcc?: string[]
}

const FROM = () => env.EMAIL_FROM ?? `${APP_NAME} <onboarding@resend.dev>`

/** Dry-run: bez mreže; koristi se u testu i kad nema ključa. */
export async function drySend(_args: SendArgs): Promise<SendResult> {
  return { id: "dry-run", dryRun: true }
}

/** Stvarno slanje preko Resend-a; ako nema RESEND_API_KEY → dry-run. */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  // NAMJERNO ISPRED provjere ključa: u demo režimu ni važeći RESEND_API_KEY ne smije
  // poslati mejl. Blokada stoji baš ovdje, a ne u pojedinim enginima, jer SVI putevi
  // (podsjetnici, digest, post-due, zakazano-nakon-roka, test mejl iz Postavki) prolaze
  // kroz `sendEmail` — pa je i svaki budući pozivalac pokriven bez dodatnog rada.
  if (DEMO_MODE) return { id: "demo", dryRun: true, demo: true }

  const key = env.RESEND_API_KEY
  if (!key) return drySend(args)
  const resend = new Resend(key)
  const { data, error } = await resend.emails.send({
    from: FROM(),
    to: args.to,
    bcc: args.bcc,
    subject: args.subject,
    html: args.html,
    attachments: args.attachments,
  })
  if (error) throw new Error(error.message)
  return { id: data?.id ?? "unknown", dryRun: false }
}
