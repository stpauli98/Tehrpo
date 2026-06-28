import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { monthRange, todayIso } from "@/lib/date"

/**
 * GET /api/plan-aktivnosti/kalendar
 *
 * Query params (mirror _views/kalendar.tsx searchParams):
 *   godina – year (default current year derived from today UTC)
 *   mjesec – "1".."12" (default current month; clamped 1–12)
 *
 * Returns:
 *   {
 *     termini: TerminRow[]  – all columns from termini_view for the month,
 *                             ordered by rok_dospijeca ascending
 *   }
 *
 * termini element fields (full termini_view select *):
 *   id, rok_dospijeca, klijent_id, klijent_naziv, lokacija_id, lokacija_naziv,
 *   vrsta_provjere_id, vrsta_naziv, status_izvedeni, datum_izvrsenja, …
 *   (all columns exposed by the termini_view DB view)
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams

  const today = todayIso()
  const godina = Number(sp.get("godina")) || Number(today.slice(0, 4))
  const mjesecRaw = Number(sp.get("mjesec")) || Number(today.slice(5, 7))
  const mjesec = Math.min(12, Math.max(1, mjesecRaw))

  const { from, to } = monthRange(godina, mjesec)

  const { data, error } = await supabase
    .from("termini_view")
    .select("*")
    .gte("rok_dospijeca", from)
    .lte("rok_dospijeca", to)
    .order("rok_dospijeca")

  if (error) {
    return NextResponse.json({ error }, { status: 400 })
  }

  return NextResponse.json({ termini: data ?? [] })
}
