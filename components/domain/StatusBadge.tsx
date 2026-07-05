"use client"

import { useTranslations } from "next-intl"
import { STATUS_BADGE_CLASS, toDerivedStatus } from "@/lib/termini"
import { formatDatum } from "@/lib/date"
import { cn } from "@/lib/utils"

export function StatusBadge({
  status,
  stvarniStatus,
  datumZakazan,
}: {
  status: string | null
  /** Sirovi termini.status — kad je izvedeni "kasni" a stvarni "zakazano", uz badge se prikazuje oznaka zakazivanja. */
  stvarniStatus?: string | null
  datumZakazan?: string | null
}) {
  const t = useTranslations("status")
  const tSheet = useTranslations("termini.statusBadge")
  const s = toDerivedStatus(status)
  const badge = (
    <span
      data-testid="status-badge"
      data-status={s}
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        STATUS_BADGE_CLASS[s]
      )}
    >
      {t(s)}
    </span>
  )
  if (s !== "kasni" || stvarniStatus !== "zakazano") return badge
  return (
    <span className="inline-flex items-center gap-1.5">
      {badge}
      <span data-testid="status-zakazan-hint" className="whitespace-nowrap text-xs text-slate-500">
        {datumZakazan ? tSheet("zakPrefix", { datum: formatDatum(datumZakazan) }) : tSheet("zakazanoFallback")}
      </span>
    </span>
  )
}
