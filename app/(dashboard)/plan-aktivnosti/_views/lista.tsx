"use client"

import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { TerminiTable, type TerminRow } from "@/components/domain/TerminiTable"
import { TerminiFilters } from "@/components/domain/TerminiFilters"
import { TerminSheet } from "@/components/domain/TerminSheet"
import { NoviTerminButton } from "@/components/domain/NoviTerminButton"
import { Pagination } from "@/components/domain/Pagination"
import { Skeleton } from "@/components/ui/skeleton"
import { currentYear } from "@/lib/date"
import { getTerminiLista, getTerminDetail } from "@/lib/queries/plan-aktivnosti"
import { TERMINI_PER_PAGE } from "@/lib/plan-filteri"
import { href } from "@/i18n/routes"
import type { Database } from "@/db/types"

export function ListaView() {
  const searchParams = useSearchParams()
  const t = useTranslations("plan.lista")
  const tPag = useTranslations("common.pagination")

  const pageNum = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
  const statusFilter = searchParams.get("status") ?? "svi"
  const qFilter = (searchParams.get("q") ?? "").trim()
  const klijentFilter = searchParams.get("klijent_id") ?? ""
  const lokacijaFilter = searchParams.get("lokacija") ?? ""
  const vrstaFilter = searchParams.get("vrsta_id") ?? ""
  const mjesecFilter = searchParams.get("mjesec") ?? ""
  const godinaFilter = Number(searchParams.get("godina")) || currentYear()
  const nacinFilter = searchParams.get("nacin") ?? "svi"
  const selectedId = searchParams.get("selected")

  const filters = {
    page: pageNum,
    status: statusFilter,
    q: qFilter,
    klijent_id: klijentFilter,
    lokacija: lokacijaFilter,
    vrsta_id: vrstaFilter,
    mjesec: mjesecFilter,
    godina: godinaFilter,
    nacin: nacinFilter,
  }

  const { data, isPending } = useQuery({
    queryKey: ["termini-lista", filters],
    queryFn: () => getTerminiLista(filters),
    staleTime: 60_000,
  })

  const { data: detailData } = useQuery({
    queryKey: ["termin-detail", selectedId],
    queryFn: () => getTerminDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  const rows = (data?.rows ?? []) as TerminRow[]
  const total = data?.total ?? 0
  const klijenti = (data?.klijenti ?? []) as { id: string; naziv: string }[]
  const vrste = (data?.vrste ?? []) as { id: string; naziv: string }[]
  const lokacije = (data?.lokacije ?? []) as {
    id: string
    naziv: string
    klijent_id: string
  }[]

  const lokacijeByFirma: Record<string, { id: string; naziv: string }[]> = {}
  for (const l of lokacije) {
    ;(lokacijeByFirma[l.klijent_id] ??= []).push({ id: l.id, naziv: l.naziv })
  }

  const totalPages = Math.max(1, Math.ceil(total / TERMINI_PER_PAGE))
  const currentSearch = searchParams.toString()

  const selectedTermin = selectedId
    ? ((detailData?.termin ?? null) as TerminRow | null)
    : null
  const istorija = (detailData?.istorija ?? []) as TerminRow[]
  const dokumenti = (detailData?.dokumenti ?? []) as Database["public"]["Tables"]["dokumenti"]["Row"][]

  const closeParams = new URLSearchParams(currentSearch)
  closeParams.delete("selected")
  const closeHref = href(`/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}`)

  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("page", String(p))
    return href(`/plan-aktivnosti?${params.toString()}`)
  }

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-end">
        <NoviTerminButton klijenti={klijenti} vrste={vrste} lokacijeByFirma={lokacijeByFirma} />
      </div>

      <TerminiFilters klijenti={klijenti} vrste={vrste} lokacijeByFirma={lokacijeByFirma} />

      <TerminiTable rows={rows} currentSearch={currentSearch} />

      <div
        className="mt-auto flex items-center justify-between border-t border-border pt-4 text-sm text-muted-foreground"
        data-testid="termini-pagination"
      >
        <span data-testid="termini-total">{t("ukupnoRezultata", { count: total })}</span>
        <Pagination
          pageNum={pageNum}
          totalPages={totalPages}
          hrefFor={pageHref}
          pageTestId="termini-page"
          prethodnaLabel={tPag("prethodna")}
          sljedecaLabel={tPag("sljedeca")}
          stranaText={tPag("strana", { pageNum, totalPages })}
        />
      </div>

      {selectedTermin && (
        <TerminSheet
          termin={selectedTermin}
          istorija={istorija}
          dokumenti={dokumenti}
          closeHref={closeHref}
        />
      )}
    </div>
  )
}
