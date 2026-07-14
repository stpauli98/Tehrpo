import { Resend } from "resend"
import { env } from "@/lib/env"
import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { mapirajDostavu } from "@/lib/email/webhookDostava"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  if (!env.RESEND_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const rawBody = await req.text() // SIROVO tijelo prije JSON.parse (HMAC ulaz)

  const id        = req.headers.get("svix-id")        ?? req.headers.get("webhook-id")
  const timestamp = req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp")
  const signature = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature")
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "Missing headers" }, { status: 401 })
  }

  let event: { type: string; data?: { email_id?: string; created_at?: string }; created_at?: string }
  try {
    event = new Resend(env.RESEND_API_KEY ?? "re_placeholder").webhooks.verify({
      payload: rawBody,
      headers: { id, timestamp, signature }, // Resend lokalni Headers interfejs (NE WHATWG)
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const status = mapirajDostavu(event.type)
  if (status && event.data?.email_id) {
    const supabase = createAdminSupabaseClient() // service-role: ruta NIJE app request-path
    const { error } = await supabase.rpc("azuriraj_mejl_dostavu", {
      p_resend_id: event.data.email_id,
      p_status: status,
      p_at: event.data.created_at ?? event.created_at ?? new Date().toISOString(),
    })
    if (error) {
      console.error("[resend-webhook] azuriraj_mejl_dostavu:", error.message)
    }
  }
  return NextResponse.json({ ok: true }) // uvijek 200 za validan potpis
}
