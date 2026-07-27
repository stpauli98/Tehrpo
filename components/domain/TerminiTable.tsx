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
import { href } from "@/i18n/routes"

export type TerminRow = Database["public"]["Views"]["termini_view"]["Row"]

const COL_KEYS = [
  "datumRoka", "klijent", "lokacija", "vrsta", "status", "zaduzeni", "akcije",
] as const

/** Gradi href za "Detalji" — čuva postojeće search parametre, dodaje selected. */
function detailHref(id: string, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch)
  params.set("selected", id)
  return href(`/plan-aktivnosti?${params.toString()}`)
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
        className="rounded-xl bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10"
      >
        {t("prazno")}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <table className="w-full text-sm" data-testid="termini-table">
        <thead className="bg-muted">
          <tr>
            {COL_KEYS.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap"
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
                "border-t border-border hover:bg-muted",
                r.id && "cursor-pointer",
              )}
            >
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                {formatDatum(r.datum_prikaza)}
                {r.datum_zakazan && r.datum_zakazan !== r.rok_dospijeca && (
                  <span className="block text-xs text-muted-foreground">
                    {t("rokKratko", { datum: formatDatum(r.rok_dospijeca) })}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-medium text-foreground">{r.klijent_naziv ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.lokacija_naziv ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {r.vrsta_naziv ?? "—"}
                {r.nacin_izvrsenja === "pracenje" && (
                  <span className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground align-middle">
                    {t("samoPracenje")}
                  </span>
                )}
              </td>
              <td className="px-3 py-2"><StatusBadge status={r.status_izvedeni} stvarniStatus={r.status} datumZakazan={r.datum_zakazan} /></td>
              <td className="px-3 py-2 text-muted-foreground">{r.zaduzeni ?? "—"}</td>
              <td className="px-3 py-2">
                {r.id && (
                  <Link
                    href={detailHref(r.id, currentSearch)}
                    onClick={(e) => e.stopPropagation()}
                    className={IKONA_INLINE_KLASA}
                    data-testid="termin-detalji"
                    aria-label={t("detalji")}
                  >
                    <Eye className="h-[18px] w-[18px] shrink-0" aria-hidden />
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
