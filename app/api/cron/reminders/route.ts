import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { drySend } from "@/lib/email/resend"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: Request) {
  const secret = env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let dryRun = false
  try {
    const body = (await req.json()) as { dryRun?: boolean } | null
    dryRun = body?.dryRun === true
  } catch {
    // prazno telo je OK
  }

  try {
    const supabase = createAdminSupabaseClient()
    const result = await runReminders(supabase, dryRun ? { send: drySend } : {})
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Greška"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
