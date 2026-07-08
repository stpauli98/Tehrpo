import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { drySend } from "@/lib/email/resend"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { podsjetniciAktivni, lokalniSatIDatum, trebaSlatiSada } from "@/lib/reminders/gating"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// Throttlovan run (grupe + pauze) može trajati ~50s pri punom cap-u → podigni limit funkcije.
export const maxDuration = 60

async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let dryRun = false
  try {
    const body = (await req.json()) as { dryRun?: boolean } | null
    dryRun = body?.dryRun === true
  } catch {
    // prazno telo (Vercel Cron šalje GET bez tijela) je OK → dryRun = false
  }

  const supabase = createAdminSupabaseClient()

  // Prekidač + vrijeme važe SAMO za automatski (cron) GET; POST (ručno/test) uvijek radi.
  let datumZaMarker: string | null = null
  if (req.method === "GET") {
    const { data: post } = await supabase
      .from("postavke")
      .select("podsjetnici_aktivni, vrijeme_slanja_sat, zadnje_slanje_datum")
      .eq("id", 1)
      .maybeSingle()
    if (!podsjetniciAktivni(post)) {
      return NextResponse.json({ ok: true, skipped: "podsjetnici_iskljuceni" })
    }
    const vrijemeSat = post?.vrijeme_slanja_sat ?? 8
    const { sat, datum } = lokalniSatIDatum(new Date())
    if (sat < vrijemeSat) {
      return NextResponse.json({ ok: true, skipped: "izvan_sata" })
    }
    if (!trebaSlatiSada(vrijemeSat, post?.zadnje_slanje_datum ?? null, new Date())) {
      return NextResponse.json({ ok: true, skipped: "vec_slato_danas" })
    }
    datumZaMarker = datum
  }

  try {
    const result = await runReminders(supabase, dryRun ? { send: drySend } : {})
    // Uspješan auto-run: obilježi da je danas (lokalni datum) slato → spriječi ponovni run istog dana.
    if (datumZaMarker) {
      await supabase.from("postavke").update({ zadnje_slanje_datum: datumZaMarker }).eq("id", 1)
    }
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Greška"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel Cron poziva GET (uz Authorization: Bearer $CRON_SECRET); POST ostaje za ručno/test.
export const GET = handle
export const POST = handle
