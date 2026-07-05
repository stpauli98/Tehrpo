"use client"

import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import { MonthCalendar, type DayTermin } from "@/components/domain/MonthCalendar"
import { PlanNav } from "@/components/domain/PlanNav"
import { TerminSheet } from "@/components/domain/TerminSheet"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { buildMonthGrid } from "@/lib/calendar"
import { todayIso, currentYear, formatDatum } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { PlanLegenda } from "@/components/domain/PlanLegenda"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { getTerminiKalendar, getTerminDetail } from "@/lib/queries/plan-aktivnosti"
import type { Database } from "@/db/types"

export function KalendarView() {
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

  const { data, isPending } = useQuery({
    queryKey: ["termini-kalendar", godina, mjesec],
    queryFn: () => getTerminiKalendar(godina, mjesec),
    staleTime: 60_000,
  })

  const { data: detailData } = useQuery({
    queryKey: ["termin-detail", selectedId],
    queryFn: () => getTerminDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  const termini = (data?.termini ?? []) as TerminRow[]
  const grid = buildMonthGrid(godina, mjesec)
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  const terminiByDan = new Map<string, DayTermin[]>()
  for (const termin of termini) {
    if (!termin.id || !termin.rok_dospijeca) continue
    const dan = termin.rok_dospijeca.slice(0, 10)
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
    ? termini.filter((termin) => (termin.rok_dospijeca ?? "").slice(0, 10) === selectedDan)
    : []

  // ?selected TerminSheet
  const selectedTermin = selectedId
    ? ((detailData?.termin ?? null) as TerminRow | null)
    : null
  const istorija = (detailData?.istorija ?? []) as TerminRow[]
  const dokumenti = (detailData?.dokumenti ?? []) as Database["public"]["Tables"]["dokumenti"]["Row"][]

  const closeParams = new URLSearchParams(currentSearch)
  closeParams.delete("selected")
  const closeHref = `/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}`

  const detailHref = (id: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("selected", id)
    return `/plan-aktivnosti?${p.toString()}`
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
          <aside data-testid="plan-sidebar" className="rounded-xl border border-slate-200 p-4 h-fit">
            <p className="font-medium" data-testid="plan-sidebar-datum">
              {formatDatum(selectedDan)}
            </p>
            {danTermini.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{t("nemaTerminaZaDan")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {danTermini.map((termin) => (
                  <li
                    key={termin.id ?? ""}
                    data-testid="sidebar-termin"
                    className="text-sm border-b border-slate-100 pb-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 truncate">
                        {termin.klijent_naziv ?? "—"}
                        {termin.lokacija_naziv ? (
                          <span className="text-slate-400"> · {termin.lokacija_naziv}</span>
                        ) : null}
                      </span>
                      <StatusBadge status={termin.status_izvedeni} />
                    </div>
                    <p className="text-slate-500">{termin.vrsta_naziv ?? "—"}</p>
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
