import Link from "next/link"
import type { CalDay } from "@/lib/calendar"
import type { DerivedStatus } from "@/lib/termini"
import { cn } from "@/lib/utils"

export type DayTermin = { id: string; klijentNaziv: string; status: DerivedStatus }

const DOTS: Record<DerivedStatus, string> = {
  izvrseno: "bg-green-500",
  planirano: "bg-blue-500",
  zakazano: "bg-cyan-500",
  kasni: "bg-red-500",
  otkazano: "bg-slate-400",
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
            <Link
              key={c.date}
              href={dayHref(c.date)}
              data-testid="plan-day-cell"
              data-date={c.date}
              data-selected={isSelected}
              className={cn(
                "min-h-[84px] border-t border-l border-slate-100 p-1.5 text-left align-top transition",
                !c.inMonth && "bg-slate-50/50 text-slate-300",
                isSelected
                  ? "ring-2 ring-inset ring-brand bg-brand-light/30"
                  : "hover:bg-slate-50",
              )}
            >
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
                {termini.length > 0 && (
                  <span className="text-[10px] text-slate-400">
                    {termini.length}
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-0.5">
                {termini.slice(0, 3).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-1 truncate text-[11px] text-slate-600"
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        DOTS[t.status],
                      )}
                    />
                    <span className="truncate">{t.klijentNaziv}</span>
                  </div>
                ))}
                {/* "još N" — parent cell is <Link> to ?dan=; text-brand signals clickability */}
                {termini.length > 3 && (
                  <div className="text-[10px] text-brand font-medium">
                    još {termini.length - 3}
                  </div>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
