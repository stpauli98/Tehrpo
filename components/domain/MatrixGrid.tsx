import Link from "next/link"
import { MONTHS_BS } from "@/lib/date"
import type { DerivedStatus } from "@/lib/termini"
import { cn } from "@/lib/utils"

function withParam(search: string, key: string, value: string): string {
  const p = new URLSearchParams(search)
  p.set(key, value)
  return p.toString()
}

export type MatrixCell = {
  terminId: string
  dan: number // dan u mjesecu (za prikaz DD.)
  status: DerivedStatus
  brojUCeliji: number
}
export type MatrixRow = {
  vrstaId: string
  vrstaNaziv: string
  // index 1..12 → ćelija ili null
  mjeseci: Record<number, MatrixCell | null>
}

// boja ćelije po izvedenom statusu (mockup cell-done/plan/late)
const CELL_CLASS: Record<DerivedStatus, string> = {
  izvrseno: "bg-green-100 text-green-800 hover:bg-green-200",
  planirano: "bg-blue-50 text-blue-800 hover:bg-blue-100",
  zakazano: "bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
  kasni: "bg-red-100 text-red-800 hover:bg-red-200",
  otkazano: "bg-slate-100 text-slate-500 hover:bg-slate-200",
}

// Sadržaj ćelije po statusu (§7.2 C: ✓ za izvršeno, ! za kasni).
function cellLabel(cell: MatrixCell): string {
  const dan = String(cell.dan).padStart(2, "0") + "."
  const prefix = cell.status === "izvrseno" ? "✓ " : ""
  const kasni = cell.status === "kasni" ? "!" : ""
  const vise = cell.brojUCeliji > 1 ? ` (+${cell.brojUCeliji - 1})` : ""
  return `${prefix}${dan}${kasni}${vise}`
}

export function MatrixGrid({ rows, currentSearch }: { rows: MatrixRow[]; currentSearch: string }) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="matrix-empty"
        className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
      >
        Ovaj klijent nema termina u izabranoj godini.
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200 overflow-x-auto">
      <table className="text-xs border-collapse" data-testid="prikaz-matrix">
        <thead className="bg-slate-50">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 border-r border-slate-200 min-w-[220px]">
              Vrsta pregleda / ispitivanja
            </th>
            {MONTHS_BS.map((m) => (
              <th
                key={m}
                className="px-2 py-2 text-center font-medium text-slate-500 whitespace-nowrap min-w-[56px]"
              >
                {m.slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vrstaId} data-testid="matrix-row" className="border-t border-slate-100">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700 border-r border-slate-100 min-w-[220px]">
                {r.vrstaNaziv}
              </td>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mj) => {
                const cell = r.mjeseci[mj] ?? null
                return (
                  <td
                    key={mj}
                    className="p-1 text-center align-middle"
                    data-testid="matrix-cell"
                    data-mjesec={mj}
                  >
                    {cell ? (
                      <Link
                        href={`/prikaz?${withParam(currentSearch, "selected", cell.terminId)}`}
                        data-testid="matrix-cell-filled"
                        data-status={cell.status}
                        className={cn(
                          "inline-block w-full rounded px-1.5 py-1 tabular-nums",
                          CELL_CLASS[cell.status],
                        )}
                      >
                        {cellLabel(cell)}
                      </Link>
                    ) : (
                      <span className="text-slate-200">·</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
