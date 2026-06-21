import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { KlijentCard, type KlijentRow } from "@/components/domain/KlijentCard"
import { KlijentiSearch } from "@/components/domain/KlijentiSearch"
import { NoviKlijentButton } from "@/components/domain/NoviKlijentButton"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const PER_PAGE = 24

export default async function KlijentiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = typeof sp.q === "string" ? sp.q.trim() : ""
  const pageNum = Math.max(1, Number(typeof sp.page === "string" ? sp.page : "1") || 1)
  const from = (pageNum - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  const supabase = await createServerSupabaseClient()

  let query = supabase
    .from("klijenti_view")
    .select("*", { count: "exact" })
    .order("naziv", { ascending: true })
  if (q) {
    const safe = q.replace(/[%_,()]/g, " ") // escape LIKE wildcards (% _) + or() meta
    query = query.ilike("naziv", `%${safe}%`)
  }
  query = query.range(from, to)

  const { data, count } = await query
  const rows = (data ?? []) as KlijentRow[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : []
    )
  ).toString()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("page", String(p))
    return `/klijenti?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Klijenti</h1>
        <div className="flex items-center gap-3">
          <KlijentiSearch />
          <NoviKlijentButton />
        </div>
      </div>

      {rows.length === 0 ? (
        <div data-testid="klijenti-empty" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          Nema klijenata za zadanu pretragu.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="klijenti-grid">
          {rows.map((k) => <KlijentCard key={k.id ?? ""} klijent={k} />)}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-slate-600" data-testid="klijenti-pagination">
        <span data-testid="klijenti-total">Ukupno klijenata: {total}</span>
        <div className="flex items-center gap-2">
          {pageNum <= 1 ? (
            <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Prethodna</span>
          ) : (
            <Link href={pageHref(pageNum - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Prethodna</Link>
          )}
          <span data-testid="klijenti-page">Strana {pageNum} / {totalPages}</span>
          {pageNum >= totalPages ? (
            <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Sljedeća</span>
          ) : (
            <Link href={pageHref(pageNum + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Sljedeća</Link>
          )}
        </div>
      </div>
    </div>
  )
}
