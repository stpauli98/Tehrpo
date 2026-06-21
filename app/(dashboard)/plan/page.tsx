import { createServerSupabaseClient } from "@/lib/supabase/server"
import { MonthCalendar, type DayTermin } from "@/components/domain/MonthCalendar"
import { PlanNav } from "@/components/domain/PlanNav"
import { buildMonthGrid } from "@/lib/calendar"
import { monthRange, todayIso, currentYear } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import type { TerminRow } from "@/components/domain/TerminiTable"

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const today = todayIso()

  const godina =
    Number(typeof sp.godina === "string" ? sp.godina : "") ||
    Number(today.slice(0, 4))
  const mjesecRaw =
    Number(typeof sp.mjesec === "string" ? sp.mjesec : "") ||
    Number(today.slice(5, 7))
  const mjesec = Math.min(12, Math.max(1, mjesecRaw))

  const danas = {
    godina: Number(today.slice(0, 4)),
    mjesec: Number(today.slice(5, 7)),
  }

  const supabase = await createServerSupabaseClient()
  const { from, to } = monthRange(godina, mjesec)

  const { data } = await supabase
    .from("termini_view")
    .select("id, rok_dospijeca, klijent_naziv, status_izvedeni")
    .gte("rok_dospijeca", from)
    .lte("rok_dospijeca", to)
    .order("rok_dospijeca")

  const termini = (data ?? []) as TerminRow[]

  const terminiByDan = new Map<string, DayTermin[]>()
  for (const t of termini) {
    if (!t.id || !t.rok_dospijeca) continue
    const dan = t.rok_dospijeca.slice(0, 10)
    const arr = terminiByDan.get(dan) ?? []
    arr.push({
      id: t.id,
      klijentNaziv: t.klijent_naziv ?? "—",
      status: toDerivedStatus(t.status_izvedeni),
    })
    terminiByDan.set(dan, arr)
  }

  const grid = buildMonthGrid(godina, mjesec)
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? ([[k, v]] as [string, string][]) : [],
    ),
  ).toString()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Mjesečni plan</h1>
        <PlanNav godina={godina} mjesec={mjesec} godine={godine} danas={danas} />
      </div>
      <MonthCalendar
        grid={grid}
        terminiByDan={terminiByDan}
        today={today}
        selectedDan={null}
        currentSearch={currentSearch}
      />
    </div>
  )
}
