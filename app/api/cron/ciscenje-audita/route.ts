import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { zabiljeziOtkucaj } from "@/lib/reminders/otkucaj"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase.rpc("obrisi_stare_dogadjaje")
  // O1 — otkucaj: bez njega se ne vidi razlika između „posao je odradio, nije imao šta da
  // briše" i „posao se nije ni pokrenuo". Upis nikad ne baca (lib/reminders/otkucaj.ts).
  if (error) {
    await zabiljeziOtkucaj(supabase, "ciscenje-audita", "greska", {}, error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  await zabiljeziOtkucaj(supabase, "ciscenje-audita", "ok", { obrisano: data ?? 0 })
  return NextResponse.json({ ok: true, obrisano: data })
}

export const GET = handle
export const POST = handle
