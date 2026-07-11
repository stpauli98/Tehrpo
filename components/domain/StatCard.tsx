import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Tone = "default" | "danger" | "success" | "warning"

const TONE_CLASS: Record<Tone, string> = {
  default: "text-foreground",
  danger: "text-destructive",
  success: "text-green-600",
  warning: "text-amber-600",
}

export function StatCard({
  label, value, sub, icon: Icon, tone = "default", testId, interactive = false, active = false,
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  tone?: Tone
  testId?: string
  interactive?: boolean
  active?: boolean
}) {
  return (
    <Card
      data-testid={testId}
      data-active={active || undefined}
      className={cn(
        "h-full",
        interactive &&
          "cursor-pointer transition-shadow hover:shadow-md hover:border-border",
        active && "ring-2 ring-brand border-brand"
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
            {value}
          </p>
          {sub && <p className={cn("mt-1 text-xs", TONE_CLASS[tone])}>{sub}</p>}
        </div>
        <Icon className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden />
      </CardContent>
    </Card>
  )
}
