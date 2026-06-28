"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type { Database } from "@/db/types"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { formatDatum } from "@/lib/date"
import { cn } from "@/lib/utils"

export type TerminRow = Database["public"]["Views"]["termini_view"]["Row"]

const COLS = [
  "Datum roka", "Klijent", "Lokacija", "Vrsta", "Status", "Zaduženi", "Akcije",
] as const

/** Gradi href za "Detalji" — čuva postojeće search parametre, dodaje selected. */
function detailHref(id: string, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch)
  params.set("selected", id)
  return `/plan-aktivnosti?${params.toString()}`
}

export function TerminiTable({
  rows, currentSearch,
}: {
  rows: TerminRow[]
  currentSearch: string
}) {
  const router = useRouter()

  if (rows.length === 0) {
    return (
      <div
        data-testid="termini-empty"
        className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
      >
        Nema termina za zadane filtere.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm" data-testid="termini-table">
        <thead className="bg-slate-50">
          <tr>
            {COLS.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.id ?? `row-${idx}`}
              data-testid="termin-row"
              onClick={r.id ? () => router.push(detailHref(r.id!, currentSearch)) : undefined}
              className={cn(
                "border-t border-slate-100 hover:bg-slate-50",
                r.id && "cursor-pointer",
              )}
            >
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDatum(r.rok_dospijeca)}</td>
              <td className="px-3 py-2 font-medium text-slate-900">{r.klijent_naziv ?? "—"}</td>
              <td className="px-3 py-2 text-slate-600">{r.lokacija_naziv ?? "—"}</td>
              <td className="px-3 py-2 text-slate-600">{r.vrsta_naziv ?? "—"}</td>
              <td className="px-3 py-2"><StatusBadge status={r.status_izvedeni} /></td>
              <td className="px-3 py-2 text-slate-600">{r.zaduzeni ?? "—"}</td>
              <td className="px-3 py-2">
                {r.id && (
                  <Link
                    href={detailHref(r.id, currentSearch)}
                    onClick={(e) => e.stopPropagation()}
                    className="text-brand hover:underline font-medium"
                    data-testid="termin-detalji"
                  >
                    Detalji
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
