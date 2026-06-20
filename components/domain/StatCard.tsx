import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Tone = "default" | "danger" | "success" | "warning"

const TONE_CLASS: Record<Tone, string> = {
  default: "text-slate-700",
  danger: "text-red-600",
  success: "text-green-600",
  warning: "text-amber-600",
}

export function StatCard({
  label, value, sub, icon: Icon, tone = "default", testId,
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  tone?: Tone
  testId?: string
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
            {value}
          </p>
          {sub && <p className={cn("mt-1 text-xs", TONE_CLASS[tone])}>{sub}</p>}
        </div>
        <Icon className="w-5 h-5 shrink-0 text-slate-400" aria-hidden />
      </CardContent>
    </Card>
  )
}
