"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { Check } from "lucide-react"
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

/**
 * Tekstualni sadržaj ćelije (§7.2 C: „!" za kasni, „(+N)" za više termina).
 * Glif „✓" za izvršeno se NE vraća ovdje — renderuje se kao lucide `Check`
 * (S11), a puni tekstualni ekvivalent statusa nosi `aria-label` (S12).
 */
function cellLabel(cell: MatrixCell): string {
  const dan = String(cell.dan).padStart(2, "0") + "."
  const kasni = cell.status === "kasni" ? "!" : ""
  const vise = cell.brojUCeliji > 1 ? ` (+${cell.brojUCeliji - 1})` : ""
  return `${dan}${kasni}${vise}`
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
  const tStatus = useTranslations("status")
  if (rows.length === 0) {
    return (
      <div
        data-testid="matrix-empty"
        className="rounded-xl bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10"
      >
        {emptyMessage ?? t("prazno")}
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <table
        className={cn("text-xs border-collapse", fillWidth && "w-full table-fixed")}
        data-testid="prikaz-matrix"
      >
        <thead className="bg-muted">
          <tr>
            <th scope="col" className={cn(
              "sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium text-muted-foreground border-r border-border",
              fillWidth ? "w-[220px]" : "min-w-[220px]",
            )}>
              {t("vrstaHeader")}
            </th>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
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
              {/* S12: naziv vrste je zaglavlje reda, ne obična ćelija — `th scope="row"`
                  daje čitaču ekrana kontekst za svaku ćeliju u redu. */}
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-foreground border-r border-border min-w-[220px]"
              >
                {row.rowLabel}
              </th>
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
                        // S12: informacija nikad SAMO u `title` — puni tekstualni
                        // ekvivalent (vrsta, dan, status, broj termina) je u aria-label.
                        title={cell.brojUCeliji > 1 ? t("viseTerminaTitle") : undefined}
                        aria-label={
                          cell.brojUCeliji > 1
                            ? t("celijaViseAriaLabel", {
                                vrsta: row.rowLabel,
                                dan: cell.dan,
                                status: tStatus(cell.status),
                                broj: cell.brojUCeliji - 1,
                              })
                            : t("celijaAriaLabel", {
                                vrsta: row.rowLabel,
                                dan: cell.dan,
                                status: tStatus(cell.status),
                              })
                        }
                        className={cn(
                          "inline-flex w-full items-center justify-center gap-0.5 rounded px-1.5 py-1 tabular-nums",
                          STATUS_CELL_CLASS[cell.status],
                          FOCUS_RING,
                        )}
                      >
                        {cell.status === "izvrseno" && (
                          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        <span aria-hidden>{cellLabel(cell)}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground/30" aria-hidden>·</span>
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
