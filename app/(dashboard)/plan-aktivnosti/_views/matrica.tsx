"use client"

import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Skeleton } from "@/components/ui/skeleton"
import { PrikazToolbar } from "@/components/domain/PrikazToolbar"
import { MatrixGrid } from "@/components/domain/MatrixGrid"
import { MatrixLegenda } from "@/components/domain/MatrixLegenda"
import type { MatrixColumn } from "@/lib/matrix"
import { TerminSheet } from "@/components/domain/TerminSheet"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { currentYear, todayIso, monthName } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { buildMatrix, type MatrixInput, type MatrixRow } from "@/lib/matrix"
import { getTerminiMatrica, getTerminDetail } from "@/lib/queries/plan-aktivnosti"
import { href } from "@/i18n/routes"
import type { Database } from "@/db/types"

export function MatricaView() {
  const searchParams = useSearchParams()
  const t = useTranslations("plan.matrica")

  const today = todayIso()
  const godina = Number(searchParams.get("godina")) || currentYear()
  const klijentId = searchParams.get("klijent") ?? ""
  const mode = searchParams.get("mode") ?? "klijent"
  const mjesec = Math.min(
    12,
    Math.max(1, Number(searchParams.get("mjesec")) || Number(today.slice(5, 7))),
  )
  const selectedId = searchParams.get("selected")

  const filters = { mode, klijent: klijentId, godina, mjesec }

  const { data, isPending } = useQuery({
    queryKey: ["termini-matrica", filters],
    queryFn: () => getTerminiMatrica(filters),
    staleTime: 60_000,
  })

  const { data: detailData } = useQuery({
    queryKey: ["termin-detail", selectedId],
    queryFn: () => getTerminDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  const klijenti = ((data?.klijenti ?? []) as { id: string; naziv: string }[]).map((k) => ({
    id: k.id,
    naziv: k.naziv,
  }))
  const termini = (data?.termini ?? []) as TerminRow[]
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  let matrixRows: MatrixRow[] = []
  let kolone: MatrixColumn[] = []
  let emptyMessage = t("izaberiteKlijenta")

  if (mode === "mjesec") {
    const inputs: MatrixInput[] = termini
      .filter((termin) => termin.id && termin.vrsta_provjere_id && termin.klijent_id && termin.rok_dospijeca)
      .map((termin) => ({
        id: termin.id!,
        vrstaId: termin.vrsta_provjere_id!,
        vrstaNaziv: termin.vrsta_naziv ?? "—",
        columnKey: termin.klijent_id!,
        dan: Number(termin.rok_dospijeca!.slice(8, 10)),
        status: toDerivedStatus(termin.status_izvedeni),
      }))
    matrixRows = buildMatrix(inputs)
    kolone = klijenti.map((k) => ({ id: k.id, label: k.naziv }))
    emptyMessage = t("nemaTerminaMjesec")
  } else if (klijentId) {
    const inputs: MatrixInput[] = termini
      .filter((termin) => termin.id && termin.vrsta_provjere_id && termin.rok_dospijeca)
      .map((termin) => ({
        id: termin.id!,
        vrstaId: termin.vrsta_provjere_id!,
        vrstaNaziv: termin.vrsta_naziv ?? "—",
        columnKey: String(Number(termin.rok_dospijeca!.slice(5, 7))),
        dan: Number(termin.rok_dospijeca!.slice(8, 10)),
        status: toDerivedStatus(termin.status_izvedeni),
      }))
    matrixRows = buildMatrix(inputs)
    const currentMonthNum = Number(today.slice(5, 7))
    const currentYearNum = currentYear()
    kolone = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      label: monthName(i + 1).slice(0, 3),
      isCurrent: godina === currentYearNum && i + 1 === currentMonthNum,
    }))
    emptyMessage = t("nemaTerminaGodina")
  }

  // multiHref: za ćelije sa više termina (brojUCeliji > 1) → /plan-aktivnosti lista filtriran
  const multiHref = (vrstaId: string, colId: string): string =>
    mode === "mjesec"
      ? href(`/plan-aktivnosti?view=lista&klijent_id=${colId}&vrsta_id=${vrstaId}&mjesec=${mjesec}&godina=${godina}`)
      : href(`/plan-aktivnosti?view=lista&klijent_id=${klijentId}&vrsta_id=${vrstaId}&mjesec=${colId}&godina=${godina}`)

  const currentSearch = searchParams.toString()

  const selectedTermin = selectedId
    ? ((detailData?.termin ?? null) as TerminRow | null)
    : null
  const istorija = (detailData?.istorija ?? []) as TerminRow[]
  const dokumenti = (detailData?.dokumenti ?? []) as Database["public"]["Tables"]["dokumenti"]["Row"][]

  // closeHref = trenutni URL bez "selected", čuva klijent/godina
  const closeParams = new URLSearchParams(currentSearch)
  closeParams.delete("selected")
  const closeHref = href(`/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}`)

  const showMatrix = mode === "mjesec" || (mode === "klijent" && !!klijentId)

  if (isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PrikazToolbar klijenti={klijenti} godine={godine} godina={godina} />

      {showMatrix ? (
        <div className="space-y-2">
          <MatrixGrid
            columns={kolone}
            rows={matrixRows}
            currentSearch={currentSearch}
            emptyMessage={emptyMessage}
            multiHref={multiHref}
            fillWidth={mode === "klijent"}
          />
          <MatrixLegenda />
        </div>
      ) : (
        <div
          data-testid="prikaz-empty"
          className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground"
        >
          {emptyMessage}
        </div>
      )}

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
