import { STATUS_BADGE_CLASS, STATUS_LABEL, toDerivedStatus } from "@/lib/termini"
import { cn } from "@/lib/utils"

export function StatusBadge({ status }: { status: string | null }) {
  const s = toDerivedStatus(status)
  return (
    <span
      data-testid="status-badge"
      data-status={s}
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        STATUS_BADGE_CLASS[s]
      )}
    >
      {STATUS_LABEL[s]}
    </span>
  )
}
