import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, applyPlanFilteri, TERMINI_PER_PAGE } from "@/lib/plan-filteri"

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams

  const pageNum = Math.max(1, Number(sp.get("page") ?? "1") || 1)
  const from = (pageNum - 1) * TERMINI_PER_PAGE
  const to = from + TERMINI_PER_PAGE - 1

  const f = parsePlanFilteri(sp)

  let listQuery = supabase
    .from("termini_view")
    .select("*", { count: "exact" })
    .order("rok_dospijeca", { ascending: true })

  listQuery = applyPlanFilteri(listQuery, f)

  listQuery = listQuery.range(from, to)

  const [statsRes, listRes, klijentiRes, vrsteRes, lokacijeRes] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    listQuery,
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
    supabase.from("lokacije").select("id, naziv, klijent_id").order("naziv"),
  ])

  const meta = { statsRes, klijentiRes, vrsteRes, lokacijeRes }
  const prviErr = listRes.error
    ?? Object.values(meta).map((r) => r.error).find(Boolean)
  if (prviErr) {
    return NextResponse.json({ error: prviErr.message ?? "Greška pri učitavanju" }, { status: 400 })
  }

  return NextResponse.json({
    rows: listRes.data ?? [],
    total: listRes.count ?? 0,
    stats: statsRes.data?.[0] ?? null,
    klijenti: klijentiRes.data ?? [],
    vrste: vrsteRes.data ?? [],
    lokacije: lokacijeRes.data ?? [],
  })
}
