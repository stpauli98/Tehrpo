import { ClipboardList, AlertTriangle, CheckCircle2, Bell } from "lucide-react"
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { StatCard } from "@/components/domain/StatCard"
import { TerminiTable, type TerminRow } from "@/components/domain/TerminiTable"
import { TerminiFilters } from "@/components/domain/TerminiFilters"
import { TerminSheet } from "@/components/domain/TerminSheet"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { monthRange, currentYear } from "@/lib/date"

const PER_PAGE = 50

export default async function TerminiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const pageNum = Math.max(1, Number(typeof sp.page === "string" ? sp.page : "1") || 1)
  const from = (pageNum - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  const statusFilter = typeof sp.status === "string" ? sp.status : "svi"
  const qFilter = typeof sp.q === "string" ? sp.q.trim() : ""
  const klijentFilter = typeof sp.klijent_id === "string" ? sp.klijent_id : ""
  const vrstaFilter = typeof sp.vrsta_id === "string" ? sp.vrsta_id : ""
  const mjesecFilter = typeof sp.mjesec === "string" ? sp.mjesec : ""

  const supabase = await createServerSupabaseClient()

  // Build list query sa filterima
  let listQuery = supabase
    .from("termini_view")
    .select("*", { count: "exact" })
    .order("rok_dospijeca", { ascending: true })

  if (statusFilter && statusFilter !== "svi") {
    listQuery = listQuery.eq("status_izvedeni", statusFilter)
  }
  if (qFilter) {
    // Pretraga po klijentu ILI lokaciji — escape PostgREST or() meta-znakove
    const safe = qFilter.replace(/[(),]/g, " ")
    listQuery = listQuery.or(`klijent_naziv.ilike.%${safe}%,lokacija_naziv.ilike.%${safe}%`)
  }
  if (klijentFilter) {
    listQuery = listQuery.eq("klijent_id", klijentFilter)
  }
  if (vrstaFilter) {
    listQuery = listQuery.eq("vrsta_provjere_id", vrstaFilter)
  }
  if (mjesecFilter) {
    const mn = Number(mjesecFilter)
    if (mn >= 1 && mn <= 12) {
      // miesec se odnosi na rok_dospijeca u tekućoj godini (dinamički)
      const { from: mFrom, to: mTo } = monthRange(currentYear(), mn)
      listQuery = listQuery.gte("rok_dospijeca", mFrom).lte("rok_dospijeca", mTo)
    }
  }
  listQuery = listQuery.range(from, to)

  // Paralelno: stats RPC + filtirana lista + klijenti + vrste (dropdown opcije)
  const [{ data: statsRows }, listRes, klijentiRes, vrsteRes] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    listQuery,
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
  ])

  const stats = statsRows?.[0] ?? { ukupno: 0, ovog_mjeseca: 0, kasni: 0, izvrseno_ovog_mjeseca: 0 }
  const rows = (listRes.data ?? []) as TerminRow[]
  const total = listRes.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const klijenti = (klijentiRes.data ?? []).map((k) => ({ id: k.id, naziv: k.naziv }))
  const vrste = (vrsteRes.data ?? []).map((v) => ({ id: v.id, naziv: v.naziv }))

  // currentSearch string (preserves all current params for detail link base)
  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : []
    )
  ).toString()

  // TerminSheet — otvara se kad ?selected=<id>
  const selectedId = typeof sp.selected === "string" ? sp.selected : null
  let selectedTermin: TerminRow | null =
    selectedId ? rows.find((r) => r.id === selectedId) ?? null : null

  // Fallback fetch ako selected nije na trenutnoj stranici/filteru
  if (selectedId && !selectedTermin) {
    const { data } = await supabase
      .from("termini_view")
      .select("*")
      .eq("id", selectedId)
      .maybeSingle()
    selectedTermin = (data as TerminRow | null) ?? null
  }

  // Istorija — prethodni izvršeni ciklusi istog klijenta + vrste (samo kad je sheet otvoren)
  let istorija: TerminRow[] = []
  if (selectedTermin?.klijent_id && selectedTermin?.vrsta_provjere_id) {
    const { data } = await supabase
      .from("termini_view")
      .select("*")
      .eq("klijent_id", selectedTermin.klijent_id)
      .eq("vrsta_provjere_id", selectedTermin.vrsta_provjere_id)
      .eq("status", "izvrseno")
      .neq("id", selectedTermin.id ?? "")
      .order("datum_izvrsenja", { ascending: false })
      .limit(5)
    istorija = (data ?? []) as TerminRow[]
  }

  // closeHref = trenutni URL bez "selected"
  const closeParams = new URLSearchParams(currentSearch)
  closeParams.delete("selected")
  const closeHref = `/termini${closeParams.toString() ? `?${closeParams.toString()}` : ""}`

  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("page", String(p))
    return `/termini?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Termini</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" data-testid="termini-stats">
        <StatCard testId="stat-ukupno" label="Ukupno termina" value={stats.ukupno} icon={ClipboardList} />
        <StatCard testId="stat-ovog-mjeseca" label="Ovog mjeseca" value={stats.ovog_mjeseca} sub="rok dospijeća" icon={Bell} tone="warning" />
        <StatCard testId="stat-kasni" label="Kasni rokovi" value={stats.kasni} sub="zahtijevaju akciju" icon={AlertTriangle} tone="danger" />
        <StatCard testId="stat-izvrseno" label="Izvršeni ovog mjeseca" value={stats.izvrseno_ovog_mjeseca} sub="završeno" icon={CheckCircle2} tone="success" />
      </div>

      <TerminiFilters klijenti={klijenti} vrste={vrste} />

      <TerminiTable rows={rows} currentSearch={currentSearch} />

      <div className="flex items-center justify-between text-sm text-slate-600" data-testid="termini-pagination">
        <span data-testid="termini-total">Ukupno rezultata: {total}</span>
        <div className="flex items-center gap-2">
          {pageNum <= 1 ? (
            <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
              Prethodna
            </span>
          ) : (
            <Link href={pageHref(pageNum - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Prethodna
            </Link>
          )}
          <span data-testid="termini-page">Strana {pageNum} / {totalPages}</span>
          {pageNum >= totalPages ? (
            <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
              Sljedeća
            </span>
          ) : (
            <Link href={pageHref(pageNum + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Sljedeća
            </Link>
          )}
        </div>
      </div>

      {selectedTermin && (
        <TerminSheet termin={selectedTermin} istorija={istorija} closeHref={closeHref} />
      )}
    </div>
  )
}
