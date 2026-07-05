import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { AlertTriangle } from "lucide-react"
import { formatDatum } from "@/lib/date"
import { rokRelativnaOznaka } from "@/lib/hitno"
import type { HitnoKasniItem } from "@/lib/termini"
import { cn } from "@/lib/utils"

const TONE: Record<"danger" | "warning", string> = {
  danger: "text-red-600",
  warning: "text-amber-600",
}

export async function HitnoKasniList({
  items,
  ukupnoKasni,
  today,
}: {
  items: HitnoKasniItem[]
  ukupnoKasni: number
  today: string
}) {
  const t = await getTranslations("pregled.hitnoKasni")
  return (
    <div className="rounded-xl border border-slate-200 p-4" data-testid="hitno-kasni-list">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden />
        <h2 className="font-semibold">{t("naslov")}</h2>
      </div>
      {items.length === 0 ? (
        <p data-testid="hitno-kasni-empty" className="text-sm text-slate-500">
          {t("prazno")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => {
            const oznaka = rokRelativnaOznaka(item.rok_dospijeca, today)
            return (
              <li key={item.id}>
                <Link
                  href={`/plan-aktivnosti?view=lista&selected=${item.id}&mjesec=svi`}
                  data-testid="hitno-kasni-row"
                  className="flex items-center justify-between gap-2 py-2 hover:bg-slate-50 -mx-2 px-2 rounded"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.klijent_naziv}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {item.vrsta_naziv}
                      {item.lokacija_naziv ? ` · ${item.lokacija_naziv}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn("shrink-0 text-sm font-medium", TONE[oznaka.tone])}
                    title={formatDatum(item.rok_dospijeca)}
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
          href="/plan-aktivnosti?view=lista&status=kasni&mjesec=svi"
          data-testid="hitno-kasni-footer"
          className="mt-3 inline-block text-xs text-brand hover:underline"
        >
          {t("footer", { count: ukupnoKasni })}
        </Link>
      )}
    </div>
  )
}
