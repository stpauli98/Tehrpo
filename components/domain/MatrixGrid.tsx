"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { STATUS_CELL_CLASS } from "@/lib/termini"
import { href as localizedHref } from "@/i18n/routes"
import { cn, FOCUS_RING } from "@/lib/utils"
import type { MatrixRow, MatrixColumn, MatrixCell } from "@/lib/matrix"

// Re-export types for consumers that reference them from this module
export type { MatrixCell, MatrixRow, MatrixColumn } from "@/lib/matrix"

function withParam(search: string, key: string, value: string): string {
  const p = new URLSearchParams(search)
  p.set(key, value)
  return p.toString()
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
  emptyMessage,
  multiHref,
  fillWidth = false,
}: {
  columns: MatrixColumn[]
  rows: MatrixRow[]
  currentSearch: string
  emptyMessage?: string
  multiHref?: (rowId: string, colId: string) => string
  // true → kolone se rašire preko cijele širine (klijent-mod, 12 mjeseci);
  // false → sadržaj-široke kolone + horizontalni scroll (mjesec-mod, puno firmi)
  fillWidth?: boolean
}) {
  const t = useTranslations("plan.matrixGrid")
  if (rows.length === 0) {
    return (
      <div
        data-testid="matrix-empty"
        className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground"
      >
        {emptyMessage ?? t("prazno")}
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-border overflow-x-auto">
      <table
        className={cn("text-xs border-collapse", fillWidth && "w-full table-fixed")}
        data-testid="prikaz-matrix"
      >
        <thead className="bg-muted">
          <tr>
            <th className={cn(
              "sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium text-muted-foreground border-r border-border",
              fillWidth ? "w-[220px]" : "min-w-[220px]",
            )}>
              {t("vrstaHeader")}
            </th>
            {columns.map((c) => (
              <th
                key={c.id}
                className={cn(
                  "px-2 py-2 text-center font-medium text-muted-foreground whitespace-nowrap min-w-[56px]",
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
            <tr key={row.rowId} data-testid="matrix-row" className="border-t border-border">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium text-foreground border-r border-border min-w-[220px]">
                {row.rowLabel}
              </td>
              {columns.map((c) => {
                const cell = row.cells[c.id] ?? null
                const href =
                  cell && cell.brojUCeliji > 1 && multiHref
                    ? multiHref(row.rowId, c.id)
                    : cell
                    ? localizedHref(`/plan-aktivnosti?${withParam(currentSearch, "selected", cell.terminId)}`)
                    : ""
                return (
                  <td
                    key={c.id}
                    className="p-1 text-center align-middle"
                    data-testid="matrix-cell"
                    data-col={c.id}
                  >
                    {cell ? (
                      <Link
                        href={href}
                        data-testid="matrix-cell-filled"
                        data-status={cell.status}
                        title={cell.brojUCeliji > 1 ? t("viseTerminaTitle") : undefined}
                        className={cn(
                          "inline-block w-full rounded px-1.5 py-1 tabular-nums",
                          STATUS_CELL_CLASS[cell.status],
                          FOCUS_RING,
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
