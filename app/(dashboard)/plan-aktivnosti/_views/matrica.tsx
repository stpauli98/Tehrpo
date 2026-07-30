"use client"

import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
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
import { getTerminiMatrica, getTerminDetail, porukaGreske } from "@/lib/queries/plan-aktivnosti"
import { href } from "@/i18n/routes"
import type { Database } from "@/db/types"

export function MatricaView({
  godine,
  zaduzeniPrijedloziByFirma,
  sviRadnici,
}: {
  godine: number[]
  zaduzeniPrijedloziByFirma: Record<string, string[]>
  /** Prazno za ne-admine; admin dobija sva imena (v. plan-aktivnosti/page.tsx). */
  sviRadnici: string[]
}) {
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

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["termini-matrica", filters],
    queryFn: () => getTerminiMatrica(filters),
    staleTime: 60_000,
    // Promjena filtera ne ruši matricu na skeleton — skeleton je samo za prvo učitavanje.
    placeholderData: keepPreviousData,
  })

  const {
    data: detailData,
    isError: detailIsError,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery({
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

  let matrixRows: MatrixRow[] = []
  let kolone: MatrixColumn[] = []
  let emptyMessage = t("izaberiteKlijenta")

  if (mode === "mjesec") {
    const inputs: MatrixInput[] = termini
      .filter((termin) => termin.id && termin.vrsta_provjere_id && termin.klijent_id && termin.datum_prikaza)
      .map((termin) => ({
        id: termin.id!,
        vrstaId: termin.vrsta_provjere_id!,
        vrstaNaziv: termin.vrsta_naziv ?? "—",
        columnKey: termin.klijent_id!,
        dan: Number(termin.datum_prikaza!.slice(8, 10)),
        status: toDerivedStatus(termin.status_izvedeni),
      }))
    matrixRows = buildMatrix(inputs)
    kolone = klijenti.map((k) => ({ id: k.id, label: k.naziv }))
    emptyMessage = t("nemaTerminaMjesec")
  } else if (klijentId) {
    const inputs: MatrixInput[] = termini
      .filter((termin) => termin.id && termin.vrsta_provjere_id && termin.datum_prikaza)
      .map((termin) => ({
        id: termin.id!,
        vrstaId: termin.vrsta_provjere_id!,
        vrstaNaziv: termin.vrsta_naziv ?? "—",
        columnKey: String(Number(termin.datum_prikaza!.slice(5, 7))),
        dan: Number(termin.datum_prikaza!.slice(8, 10)),
        status: toDerivedStatus(termin.status_izvedeni),
      }))
    matrixRows = buildMatrix(inputs)
    const currentMonthNum = Number(today.slice(5, 7))
    const currentYearNum = Number(today.slice(0, 4)) // isti todayIso snapshot kao mjesec — bez ponoćnog racea
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

  // S1: pad upita NIJE prazna matrica.
  if (isError) {
    return (
      <GreskaUcitavanja
        poruka={porukaGreske(error)}
        onRetry={() => void refetch()}
        testId="plan-greska"
      />
    )
  }

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
          className="rounded-xl bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10"
        >
          {emptyMessage}
        </div>
      )}

      {/* Detalj upit ima vlastitu grešku — sheet se inače tiho ne otvori. */}
      {selectedId && detailIsError && (
        <GreskaUcitavanja
          poruka={porukaGreske(detailError)}
          onRetry={() => void refetchDetail()}
          testId="termin-detail-greska"
        />
      )}

      {selectedTermin && (
        <TerminSheet
          termin={selectedTermin}
          istorija={istorija}
          dokumenti={dokumenti}
          closeHref={closeHref}
          zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma}
          sviRadnici={sviRadnici}
        />
      )}
    </div>
  )
}
