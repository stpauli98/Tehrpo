import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { formatDatum } from "@/lib/date"
import { rokRelativnaOznaka } from "@/lib/hitno"
import type { HitnoKasniItem } from "@/lib/termini"
import { cn } from "@/lib/utils"

const TONE: Record<"danger" | "warning", string> = {
  danger: "text-red-600",
  warning: "text-amber-600",
}

export function HitnoKasniList({
  items,
  ukupnoKasni,
  today,
}: {
  items: HitnoKasniItem[]
  ukupnoKasni: number
  today: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4" data-testid="hitno-kasni-list">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden />
        <h2 className="font-semibold">Hitno / kasni</h2>
      </div>
      {items.length === 0 ? (
        <p data-testid="hitno-kasni-empty" className="text-sm text-slate-500">
          Nema hitnih ni kasnih termina.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => {
            const oznaka = rokRelativnaOznaka(t.rok_dospijeca, today)
            return (
              <li key={t.id}>
                <Link
                  href={`/termini?selected=${t.id}`}
                  data-testid="hitno-kasni-row"
                  className="flex items-center justify-between gap-2 py-2 hover:bg-slate-50 -mx-2 px-2 rounded"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.klijent_naziv}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {t.vrsta_naziv}
                      {t.lokacija_naziv ? ` · ${t.lokacija_naziv}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn("shrink-0 text-sm font-medium", TONE[oznaka.tone])}
                    title={formatDatum(t.rok_dospijeca)}
                  >
                    {oznaka.text}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {ukupnoKasni > 0 && (
        <Link
          href="/plan-aktivnosti?view=lista&status=kasni"
          data-testid="hitno-kasni-footer"
          className="mt-3 inline-block text-xs text-brand hover:underline"
        >
          Svi kasni rokovi ({ukupnoKasni}) →
        </Link>
      )}
    </div>
  )
}
