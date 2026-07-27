"use client"

import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import { Skeleton } from "@/components/ui/skeleton"
import { MonthCalendar, type DayTermin } from "@/components/domain/MonthCalendar"
import { PlanNav } from "@/components/domain/PlanNav"
import { TerminSheet } from "@/components/domain/TerminSheet"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { buildMonthGrid } from "@/lib/calendar"
import { todayIso, formatDatum } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { PlanLegenda } from "@/components/domain/PlanLegenda"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { getTerminiKalendar, getTerminDetail, porukaGreske } from "@/lib/queries/plan-aktivnosti"
import { href } from "@/i18n/routes"
import type { Database } from "@/db/types"

export function KalendarView({
  godine,
  zaduzeniPrijedlozi,
}: {
  godine: number[]
  zaduzeniPrijedlozi: string[]
}) {
  const searchParams = useSearchParams()
  const t = useTranslations("plan.kalendar")

  const today = todayIso()
  const godina =
    Number(searchParams.get("godina")) || Number(today.slice(0, 4))
  const mjesecRaw =
    Number(searchParams.get("mjesec")) || Number(today.slice(5, 7))
  const mjesec = Math.min(12, Math.max(1, mjesecRaw))
  const selectedId = searchParams.get("selected")
  const selectedDan = searchParams.get("dan")

  const danas = {
    godina: Number(today.slice(0, 4)),
    mjesec: Number(today.slice(5, 7)),
  }

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["termini-kalendar", godina, mjesec],
    queryFn: () => getTerminiKalendar(godina, mjesec),
    staleTime: 60_000,
    // Promjena mjeseca ne ruši kalendar na skeleton — skeleton je samo za prvo učitavanje.
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

  const termini = (data?.termini ?? []) as TerminRow[]
  const grid = buildMonthGrid(godina, mjesec)

  const terminiByDan = new Map<string, DayTermin[]>()
  for (const termin of termini) {
    if (!termin.id || !termin.datum_prikaza) continue
    const dan = termin.datum_prikaza.slice(0, 10)
    const arr = terminiByDan.get(dan) ?? []
    arr.push({
      id: termin.id,
      klijentNaziv: termin.klijent_naziv ?? "—",
      lokacijaNaziv: termin.lokacija_naziv,
      status: toDerivedStatus(termin.status_izvedeni),
    })
    terminiByDan.set(dan, arr)
  }

  const currentSearch = searchParams.toString()

  // ?dan sidebar
  const danTermini = selectedDan
    ? termini.filter((termin) => (termin.datum_prikaza ?? "").slice(0, 10) === selectedDan)
    : []

  // ?selected TerminSheet
  const selectedTermin = selectedId
    ? ((detailData?.termin ?? null) as TerminRow | null)
    : null
  const istorija = (detailData?.istorija ?? []) as TerminRow[]
  const dokumenti = (detailData?.dokumenti ?? []) as Database["public"]["Tables"]["dokumenti"]["Row"][]

  const closeParams = new URLSearchParams(currentSearch)
  closeParams.delete("selected")
  const closeHref = href(`/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}`)

  const detailHref = (id: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("selected", id)
    return href(`/plan-aktivnosti?${p.toString()}`)
  }

  // S1: pad upita NIJE prazan mjesec.
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
        <div className="flex items-center justify-end gap-4">
          <Skeleton className="h-10 w-80" />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 42 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-end gap-4">
        <PlanNav godina={godina} mjesec={mjesec} godine={godine} danas={danas} />
      </div>
      <div
        className={
          selectedDan
            ? "grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]"
            : "flex min-h-0 flex-1"
        }
      >
        <MonthCalendar
          grid={grid}
          terminiByDan={terminiByDan}
          today={today}
          selectedDan={selectedDan}
          currentSearch={currentSearch}
        />
        {selectedDan && (
          <aside data-testid="plan-sidebar" className="h-fit rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <p className="font-medium" data-testid="plan-sidebar-datum">
              {formatDatum(selectedDan)}
            </p>
            {danTermini.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t("nemaTerminaZaDan")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {danTermini.map((termin) => (
                  <li
                    key={termin.id ?? ""}
                    data-testid="sidebar-termin"
                    className="text-sm border-b border-border pb-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground truncate">
                        {termin.klijent_naziv ?? "—"}
                        {termin.lokacija_naziv ? (
                          <span className="text-muted-foreground"> · {termin.lokacija_naziv}</span>
                        ) : null}
                      </span>
                      <StatusBadge status={termin.status_izvedeni} />
                    </div>
                    <p className="text-muted-foreground">{termin.vrsta_naziv ?? "—"}</p>
                    {termin.id && (
                      <Link
                        href={detailHref(termin.id)}
                        className="text-brand hover:underline text-xs"
                        data-testid="sidebar-detalji"
                      >
                        {t("detalji")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
      <PlanLegenda />
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
          zaduzeniPrijedlozi={zaduzeniPrijedlozi}
        />
      )}
    </div>
  )
}
