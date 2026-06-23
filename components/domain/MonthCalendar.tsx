import Link from "next/link"
import type { CalDay } from "@/lib/calendar"
import { STATUS_DOT_CLASS, type DerivedStatus } from "@/lib/termini"
import { cn } from "@/lib/utils"

export type DayTermin = {
  id: string
  klijentNaziv: string
  lokacijaNaziv?: string | null
  status: DerivedStatus
}

const DANI = ["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"]

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
  const dayHref = (date: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("dan", date)
    p.delete("selected")
    return `/plan?${p.toString()}`
  }

  const terminHref = (id: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("selected", id)
    p.delete("dan")
    return `/plan?${p.toString()}`
  }

  return (
    <div
      className="rounded-xl border border-slate-200 overflow-hidden"
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

      {/* Calendar cells */}
      <div className="grid grid-cols-7">
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
                aria-label={`Dan ${c.day}`}
                className="absolute inset-0"
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
                  {termini.slice(0, 3).map((t) => (
                    <Link
                      key={t.id}
                      href={terminHref(t.id)}
                      data-testid="cell-termin"
                      data-status={t.status}
                      className="pointer-events-auto flex items-center gap-1 truncate rounded px-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          STATUS_DOT_CLASS[t.status],
                        )}
                      />
                      <span className="truncate">
                        {t.klijentNaziv}
                        {t.lokacijaNaziv ? ` · ${t.lokacijaNaziv}` : ""}
                      </span>
                    </Link>
                  ))}
                  {termini.length > 3 && (
                    <Link
                      href={dayHref(c.date)}
                      data-testid="cell-vise"
                      className="pointer-events-auto block text-[10px] text-brand font-medium hover:underline"
                    >
                      još {termini.length - 3}
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
