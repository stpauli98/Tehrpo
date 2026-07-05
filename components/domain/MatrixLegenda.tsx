"use client"
import { useTranslations } from "next-intl"
import { STATUS_ORDER, type DerivedStatus } from "@/lib/termini"

const BOJE: Record<DerivedStatus, string> = {
  izvrseno: "bg-green-100",
  planirano: "bg-blue-50",
  zakazano: "bg-cyan-50",
  kasni: "bg-red-100",
  otkazano: "bg-slate-100",
}

export function MatrixLegenda() {
  const t = useTranslations("plan.legenda")
  const tMatrix = useTranslations("plan.matrixLegenda")
  const tStatus = useTranslations("status")
  return (
    <div
      data-testid="matrix-legenda"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"
    >
      <span className="font-medium text-slate-600">{t("naslov")}</span>
      <span>{tMatrix("izvrseno")}</span>
      <span>{tMatrix("kasni")}</span>
      <span>{tMatrix("viseTermina")}</span>
      <span>{tMatrix("nemaTermina")}</span>
      <span className="mx-1 inline-block h-3 w-px bg-slate-200" />
      {STATUS_ORDER.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded ${BOJE[s]} ring-1 ring-inset ring-black/5`} />
          {tStatus(s)}
        </span>
      ))}
    </div>
  )
}
