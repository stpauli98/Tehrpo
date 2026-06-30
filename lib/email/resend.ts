import { Resend } from "resend"
import { env } from "@/lib/env"
import { APP_NAME } from "@/lib/brand"

export type SendResult = { id: string; dryRun: boolean }

export type SendArgs = { to: string[]; subject: string; html: string }

const FROM = () => env.EMAIL_FROM ?? `${APP_NAME} <onboarding@resend.dev>`

/** Dry-run: bez mreže; koristi se u testu i kad nema ključa. */
export async function drySend(_args: SendArgs): Promise<SendResult> {
  return { id: "dry-run", dryRun: true }
}

/** Stvarno slanje preko Resend-a; ako nema RESEND_API_KEY → dry-run. */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const key = env.RESEND_API_KEY
  if (!key) return drySend(args)
  const resend = new Resend(key)
  const { data, error } = await resend.emails.send({
    from: FROM(),
    to: args.to,
    subject: args.subject,
    html: args.html,
  })
  if (error) throw new Error(error.message)
  return { id: data?.id ?? "unknown", dryRun: false }
}
