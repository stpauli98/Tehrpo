import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { monthRange, currentYear } from "@/lib/date"

const PER_PAGE = 50

/**
 * GET /api/plan-aktivnosti/lista
 *
 * Query params (mirror _views/lista.tsx searchParams):
 *   page       – page number (default 1, 50 rows per page)
 *   status     – "svi" | "kasni" | "izvrseno" | ... (default "svi" = no filter)
 *   q          – free-text search on klijent_naziv / lokacija_naziv
 *   klijent_id – UUID filter on klijent_id
 *   lokacija   – UUID filter on lokacija_id
 *   vrsta_id   – UUID filter on vrsta_provjere_id
 *   mjesec     – "1".."12" month filter on rok_dospijeca
 *   godina     – year for the month filter (default current year)
 *
 * Returns:
 *   {
 *     rows:     TerminRow[]   – paginated rows from termini_view (all columns)
 *     total:    number        – total count matching filters
 *     stats:    { ukupno, ovog_mjeseca, kasni, izvrseno_ovog_mjeseca } | null
 *     klijenti: { id: string, naziv: string }[]
 *     vrste:    { id: string, naziv: string }[]
 *     lokacije: { id: string, naziv: string, klijent_id: string }[]
 *   }
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams

  const pageNum = Math.max(1, Number(sp.get("page") ?? "1") || 1)
  const from = (pageNum - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  const statusFilter = sp.get("status") ?? "svi"
  const qFilter = (sp.get("q") ?? "").trim()
  const klijentFilter = sp.get("klijent_id") ?? ""
  const lokacijaFilter = sp.get("lokacija") ?? ""
  const vrstaFilter = sp.get("vrsta_id") ?? ""
  const mjesecFilter = sp.get("mjesec") ?? ""
  const godinaFilter = Number(sp.get("godina")) || currentYear()

  // Build list query — identical filters to _views/lista.tsx
  let listQuery = supabase
    .from("termini_view")
    .select("*", { count: "exact" })
    .order("rok_dospijeca", { ascending: true })

  if (statusFilter && statusFilter !== "svi") {
    listQuery = listQuery.eq("status_izvedeni", statusFilter)
  }
  if (qFilter) {
    // Escape PostgREST or() meta-chars (same as view)
    const safe = qFilter.replace(/[(),]/g, " ")
    listQuery = listQuery.or(`klijent_naziv.ilike.%${safe}%,lokacija_naziv.ilike.%${safe}%`)
  }
  if (klijentFilter) {
    listQuery = listQuery.eq("klijent_id", klijentFilter)
  }
  if (lokacijaFilter) {
    listQuery = listQuery.eq("lokacija_id", lokacijaFilter)
  }
  if (vrstaFilter) {
    listQuery = listQuery.eq("vrsta_provjere_id", vrstaFilter)
  }
  if (mjesecFilter) {
    const mn = Number(mjesecFilter)
    if (mn >= 1 && mn <= 12) {
      const { from: mFrom, to: mTo } = monthRange(godinaFilter, mn)
      listQuery = listQuery.gte("rok_dospijeca", mFrom).lte("rok_dospijeca", mTo)
    }
  }
  listQuery = listQuery.range(from, to)

  // Parallel fetch — mirrors the Promise.all in _views/lista.tsx
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
