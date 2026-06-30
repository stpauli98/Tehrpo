import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, mjesecRange } from "@/lib/plan-filteri"

const PER_PAGE = 50

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams

  const pageNum = Math.max(1, Number(sp.get("page") ?? "1") || 1)
  const from = (pageNum - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  const f = parsePlanFilteri(sp)

  let listQuery = supabase
    .from("termini_view")
    .select("*", { count: "exact" })
    .order("rok_dospijeca", { ascending: true })

  if (f.status && f.status !== "svi") listQuery = listQuery.eq("status_izvedeni", f.status)
  if (f.q) {
    const safe = f.q.replace(/[(),]/g, " ")
    listQuery = listQuery.or(`klijent_naziv.ilike.%${safe}%,lokacija_naziv.ilike.%${safe}%`)
  }
  if (f.klijentId) listQuery = listQuery.eq("klijent_id", f.klijentId)
  if (f.lokacijaId) listQuery = listQuery.eq("lokacija_id", f.lokacijaId)
  if (f.vrstaId) listQuery = listQuery.eq("vrsta_provjere_id", f.vrstaId)
  const r = mjesecRange(f)
  if (r) listQuery = listQuery.gte("rok_dospijeca", r.from).lte("rok_dospijeca", r.to)

  listQuery = listQuery.range(from, to)

  const [statsRes, listRes, klijentiRes, vrsteRes, lokacijeRes] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    listQuery,
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
    supabase.from("lokacije").select("id, naziv, klijent_id").order("naziv"),
  ])

  if (listRes.error) {
    return NextResponse.json({ error: listRes.error }, { status: 400 })
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
