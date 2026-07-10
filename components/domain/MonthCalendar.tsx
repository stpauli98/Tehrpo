"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import type { CalDay } from "@/lib/calendar"
import { STATUS_DOT_CLASS, type DerivedStatus } from "@/lib/termini"
import { APP_LOCALE } from "@/lib/locale"
import { href } from "@/i18n/routes"
import { cn, FOCUS_RING } from "@/lib/utils"

export type DayTermin = {
  id: string
  klijentNaziv: string
  lokacijaNaziv?: string | null
  status: DerivedStatus
}

// Nazivi dana u sedmici (pon-prva sedmica), za header kalendara.
// sr: zadržan postojeći bosanski/ijekavski oblik verbatim ("Sri" za srijedu) —
// CLDR "sr-Latn" preko Intl.DateTimeFormat vraća drugačiji (ekavski, malim slovom)
// oblik "sre", što bi promijenilo postojeći, testovima provjeravan tekst.
// en/de: generisano preko Intl.DateTimeFormat (§procedura-i18n Step 1), prvo
// slovo kapitalizovano radi vizuelne dosljednosti sa sr prikazom.
const DANI_SR = ["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"] as const
const REF_MONDAY_UTC = Date.UTC(2024, 0, 1) // 2024-01-01 = ponedjeljak (referentna sedmica za Intl)

function weekdayShortLabels(): string[] {
  if (APP_LOCALE === "sr") return [...DANI_SR]
  const fmt = new Intl.DateTimeFormat(APP_LOCALE, { weekday: "short", timeZone: "UTC" })
  return Array.from({ length: 7 }, (_, i) => {
    const label = fmt.format(new Date(REF_MONDAY_UTC + i * 86_400_000))
    return label.charAt(0).toUpperCase() + label.slice(1)
  })
}

const DANI = weekdayShortLabels()

export function MonthCalendar({
  grid,
  terminiByDan,
  today,
  selectedDan,
  currentSearch,
}: {
  grid: CalDay[]
  terminiByDan: Map<string, DayTermin[]>
  today: string
  selectedDan: string | null
  currentSearch: string
}) {
  const t = useTranslations("plan.monthCalendar")
  const dayHref = (date: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("dan", date)
    p.delete("selected")
    return href(`/plan-aktivnosti?${p.toString()}`)
  }

  const terminHref = (id: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("selected", id)
    p.delete("dan")
    return href(`/plan-aktivnosti?${p.toString()}`)
  }

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200"
      data-testid="plan-grid"
    >
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 bg-slate-50 text-xs font-medium text-slate-500">
        {DANI.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar cells — grid-rows-6 + flex-1 da 6 sedmica ispuni visinu prozora */}
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {grid.map((c) => {
          const termini = terminiByDan.get(c.date) ?? []
          const isToday = c.date === today
          const isSelected = c.date === selectedDan

          return (
            <div
              key={c.date}
              className={cn(
                "relative min-h-[84px] border-t border-l border-slate-100 transition",
                !c.inMonth && "bg-slate-50/50 text-slate-300",
                isSelected
                  ? "ring-2 ring-inset ring-brand bg-brand-light/30"
                  : "hover:bg-slate-50",
              )}
            >
              {/* Pozadinski sloj: klik na cijeli dan → ?dan sidebar */}
              <Link
                href={dayHref(c.date)}
                data-testid="plan-day-cell"
                data-date={c.date}
                data-selected={isSelected}
                aria-label={t("danAriaLabel", { broj: c.day })}
                className={cn("absolute inset-0", FOCUS_RING)}
              />
              {/* Sloj sadržaja: broj dana + termini (klikovi prolaze do pozadine osim na linkovima) */}
              <div className="relative pointer-events-none p-1.5 text-left align-top">
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-xs",
                      isToday &&
                        "inline-grid place-items-center w-5 h-5 rounded-full bg-brand text-white font-semibold",
                    )}
                  >
                    {c.day}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {termini.slice(0, 3).map((termin) => (
                    <Link
                      key={termin.id}
                      href={terminHref(termin.id)}
                      data-testid="cell-termin"
                      data-status={termin.status}
                      className={cn(
                        "pointer-events-auto flex items-center gap-1 truncate rounded px-0.5 text-[11px] text-slate-600 hover:bg-slate-100",
                        FOCUS_RING,
                      )}
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          STATUS_DOT_CLASS[termin.status],
                        )}
                      />
                      <span className="truncate">
                        {termin.klijentNaziv}
                        {termin.lokacijaNaziv ? ` · ${termin.lokacijaNaziv}` : ""}
                      </span>
                    </Link>
                  ))}
                  {termini.length > 3 && (
                    <Link
                      href={dayHref(c.date)}
                      data-testid="cell-vise"
                      className={cn(
                        "pointer-events-auto block rounded-sm text-[10px] text-brand font-medium hover:underline",
                        FOCUS_RING,
                      )}
                    >
                      {t("jos", { count: termini.length - 3 })}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
