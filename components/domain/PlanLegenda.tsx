"use client"
import { useTranslations } from "next-intl"
import { STATUS_DOT_CLASS, STATUS_ORDER } from "@/lib/termini"

export function PlanLegenda() {
  const t = useTranslations("plan.legenda")
  const tStatus = useTranslations("status")
  return (
    <div
      data-testid="plan-legenda"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground">{t("naslov")}</span>
      {STATUS_ORDER.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASS[s]}`} />
          {tStatus(s)}
        </span>
      ))}
    </div>
  )
}
