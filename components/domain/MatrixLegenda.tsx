"use client"
import { useTranslations } from "next-intl"
import { STATUS_CELL_CLASS, STATUS_ORDER } from "@/lib/termini"

export function MatrixLegenda() {
  const t = useTranslations("plan.legenda")
  const tMatrix = useTranslations("plan.matrixLegenda")
  const tStatus = useTranslations("status")
  return (
    <div
      data-testid="matrix-legenda"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground">{t("naslov")}</span>
      <span>{tMatrix("izvrseno")}</span>
      <span>{tMatrix("kasni")}</span>
      <span>{tMatrix("viseTermina")}</span>
      <span>{tMatrix("nemaTermina")}</span>
      <span className="mx-1 inline-block h-3 w-px bg-border" />
      {STATUS_ORDER.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded ${STATUS_CELL_CLASS[s]} ring-1 ring-inset ring-foreground/10`} />
          {tStatus(s)}
        </span>
      ))}
    </div>
  )
}
