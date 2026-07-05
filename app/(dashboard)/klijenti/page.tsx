import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { KlijentCard, type KlijentRow } from "@/components/domain/KlijentCard"
import { KlijentiSearch } from "@/components/domain/KlijentiSearch"
import { NoviKlijentButton } from "@/components/domain/NoviKlijentButton"
import { Pagination } from "@/components/domain/Pagination"
import { href } from "@/i18n/routes"

const PER_PAGE = 24

export default async function KlijentiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("klijenti.lista")
  const tPag = await getTranslations("common.pagination")
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
    return href(`/klijenti?${params.toString()}`)
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <div className="flex items-center gap-3">
          <KlijentiSearch />
          <NoviKlijentButton />
        </div>
      </div>

      <div className="flex-1">
        {rows.length === 0 ? (
          <div data-testid="klijenti-empty" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
            {t("prazno")}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="klijenti-grid">
            {rows.map((k) => <KlijentCard key={k.id ?? ""} klijent={k} />)}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-600" data-testid="klijenti-pagination">
        <span data-testid="klijenti-total">{t("ukupno", { count: total })}</span>
        <Pagination
          pageNum={pageNum}
          totalPages={totalPages}
          hrefFor={pageHref}
          pageTestId="klijenti-page"
          prethodnaLabel={tPag("prethodna")}
          sljedecaLabel={tPag("sljedeca")}
          stranaText={tPag("strana", { pageNum, totalPages })}
        />
      </div>
    </div>
  )
}
