import { ClipboardList, AlertTriangle, CheckCircle2, Bell } from "lucide-react"
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { StatCard } from "@/components/domain/StatCard"
import { TerminiTable, type TerminRow } from "@/components/domain/TerminiTable"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

  const supabase = await createServerSupabaseClient()

  const [{ data: statsRows }, listRes] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    supabase
      .from("termini_view")
      .select("*", { count: "exact" })
      .order("rok_dospijeca", { ascending: true })
      .range(from, to),
  ])

  const stats = statsRows?.[0] ?? { ukupno: 0, ovog_mjeseca: 0, kasni: 0, izvrseno_ovog_mjeseca: 0 }
  const rows = (listRes.data ?? []) as TerminRow[]
  const total = listRes.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  // currentSearch string (preserves all current params for detail link base)
  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : []
    )
  ).toString()

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
    </div>
  )
}
