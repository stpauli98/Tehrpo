import Link from "next/link"
import type { DerivedStatus } from "@/lib/termini"
import { cn } from "@/lib/utils"
import type { MatrixRow, MatrixColumn, MatrixCell } from "@/lib/matrix"

// Re-export types for consumers that reference them from this module
export type { MatrixCell, MatrixRow, MatrixColumn } from "@/lib/matrix"

function withParam(search: string, key: string, value: string): string {
  const p = new URLSearchParams(search)
  p.set(key, value)
  return p.toString()
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

export function MatrixGrid({
  columns,
  rows,
  currentSearch,
  emptyMessage = "Nema podataka.",
}: {
  columns: MatrixColumn[]
  rows: MatrixRow[]
  currentSearch: string
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="matrix-empty"
        className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
      >
        {emptyMessage}
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
            {columns.map((c) => (
              <th
                key={c.id}
                className={cn(
                  "px-2 py-2 text-center font-medium text-slate-500 whitespace-nowrap min-w-[56px]",
                  c.isCurrent && "ring-2 ring-brand rounded",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowId} data-testid="matrix-row" className="border-t border-slate-100">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700 border-r border-slate-100 min-w-[220px]">
                {row.rowLabel}
              </td>
              {columns.map((c) => {
                const cell = row.cells[c.id] ?? null
                return (
                  <td
                    key={c.id}
                    className="p-1 text-center align-middle"
                    data-testid="matrix-cell"
                    data-col={c.id}
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
