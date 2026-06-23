import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { MonthCalendar, type DayTermin } from "@/components/domain/MonthCalendar"
import { PlanNav } from "@/components/domain/PlanNav"
import { TerminSheet } from "@/components/domain/TerminSheet"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { buildMonthGrid } from "@/lib/calendar"
import { monthRange, todayIso, currentYear, formatDatum } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { PlanLegenda } from "@/components/domain/PlanLegenda"
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
    .select("*")
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
      lokacijaNaziv: t.lokacija_naziv,
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

  // ?dan sidebar
  const selectedDan = typeof sp.dan === "string" ? sp.dan : null
  const danTermini = selectedDan
    ? termini.filter((t) => (t.rok_dospijeca ?? "").slice(0, 10) === selectedDan)
    : []

  // ?selected TerminSheet
  const selectedId = typeof sp.selected === "string" ? sp.selected : null
  let selectedTermin: TerminRow | null = selectedId
    ? (termini.find((t) => t.id === selectedId) ?? null)
    : null
  let istorija: TerminRow[] = []

  if (selectedId && !selectedTermin) {
    const { data: one } = await supabase
      .from("termini_view")
      .select("*")
      .eq("id", selectedId)
      .maybeSingle()
    selectedTermin = (one as TerminRow | null) ?? null
  }

  if (selectedTermin?.klijent_id && selectedTermin?.vrsta_provjere_id) {
    const { data: h } = await supabase
      .from("termini_view")
      .select("*")
      .eq("klijent_id", selectedTermin.klijent_id)
      .eq("vrsta_provjere_id", selectedTermin.vrsta_provjere_id)
      .eq("status", "izvrseno")
      .neq("id", selectedTermin.id ?? "")
      .order("datum_izvrsenja", { ascending: false })
      .limit(5)
    istorija = (h ?? []) as TerminRow[]
  }

  const dokumenti = selectedTermin?.id
    ? ((await supabase
        .from("dokumenti")
        .select("*")
        .eq("termin_id", selectedTermin.id)
        .order("uploaded_at", { ascending: false })).data ?? [])
    : []

  const closeParams = new URLSearchParams(currentSearch)
  closeParams.delete("selected")
  const closeHref = `/plan${closeParams.toString() ? `?${closeParams.toString()}` : ""}`

  const detailHref = (id: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("selected", id)
    return `/plan?${p.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Mjesečni plan</h1>
        <PlanNav godina={godina} mjesec={mjesec} godine={godine} danas={danas} />
      </div>
      <div className={selectedDan ? "grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4" : ""}>
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
              <p className="mt-2 text-sm text-slate-500">Nema termina za ovaj dan.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {danTermini.map((t) => (
                  <li
                    key={t.id ?? ""}
                    data-testid="sidebar-termin"
                    className="text-sm border-b border-slate-100 pb-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 truncate">
                        {t.klijent_naziv ?? "—"}
                        {t.lokacija_naziv ? <span className="text-slate-400"> · {t.lokacija_naziv}</span> : null}
                      </span>
                      <StatusBadge status={t.status_izvedeni} />
                    </div>
                    <p className="text-slate-500">{t.vrsta_naziv ?? "—"}</p>
                    {t.id && (
                      <Link
                        href={detailHref(t.id)}
                        className="text-brand hover:underline text-xs"
                        data-testid="sidebar-detalji"
                      >
                        Detalji
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
        <TerminSheet termin={selectedTermin} istorija={istorija} dokumenti={dokumenti} closeHref={closeHref} />
      )}
    </div>
  )
}
