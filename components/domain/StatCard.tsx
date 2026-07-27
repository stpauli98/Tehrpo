import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Tone = "default" | "danger" | "success" | "warning"

const TONE_CLASS: Record<Tone, string> = {
  default: "text-foreground",
  danger: "text-destructive",
  success: "text-success",
  warning: "text-warning",
}

export function StatCard({
  label, value, sub, icon: Icon, tone = "default", testId, interactive = false,
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  tone?: Tone
  testId?: string
  interactive?: boolean
}) {
  return (
    <Card
      data-testid={testId}
      className={cn(
        "h-full",
        interactive &&
          "cursor-pointer transition-shadow motion-reduce:transition-none hover:shadow-md",
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
        <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
      </CardContent>
    </Card>
  )
}
