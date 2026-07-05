"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import type { Database } from "@/db/types"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { Eye } from "lucide-react"
import { formatDatum } from "@/lib/date"
import { cn } from "@/lib/utils"
import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"

export type TerminRow = Database["public"]["Views"]["termini_view"]["Row"]

const COL_KEYS = [
  "datumRoka", "klijent", "lokacija", "vrsta", "status", "zaduzeni", "akcije",
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
  const t = useTranslations("termini.tabela")
  const tKolone = useTranslations("termini.tabela.kolone")

  if (rows.length === 0) {
    return (
      <div
        data-testid="termini-empty"
        className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
      >
        {t("prazno")}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm" data-testid="termini-table">
        <thead className="bg-slate-50">
          <tr>
            {COL_KEYS.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 whitespace-nowrap"
              >
                {tKolone(c)}
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
              <td className="px-3 py-2 text-slate-600">
                {r.vrsta_naziv ?? "—"}
                {r.nacin_izvrsenja === "pracenje" && (
                  <span className="ml-2 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 align-middle">
                    {t("samoPracenje")}
                  </span>
                )}
              </td>
              <td className="px-3 py-2"><StatusBadge status={r.status_izvedeni} stvarniStatus={r.status} datumZakazan={r.datum_zakazan} /></td>
              <td className="px-3 py-2 text-slate-600">{r.zaduzeni ?? "—"}</td>
              <td className="px-3 py-2">
                {r.id && (
                  <Link
                    href={detailHref(r.id, currentSearch)}
                    onClick={(e) => e.stopPropagation()}
                    className={IKONA_INLINE_KLASA}
                    data-testid="termin-detalji"
                    aria-label={t("detalji")}
                  >
                    <Eye className="h-4 w-4" aria-hidden />
                    <Tooltip>{t("detalji")}</Tooltip>
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
