"use client"

import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { cn, FOCUS_RING } from "@/lib/utils"
import { usePendingFilteri } from "@/lib/use-pending-filteri"
import { PLAN_VIEWS, buildViewHref, type PlanView } from "@/lib/plan-view"
import { Tooltip } from "@/components/ui/ikona-tooltip"

export function PlanViewSwitcher({ current }: { current: PlanView }) {
  const params = useSearchParams()
  // S10: pending nije samo test atribut — aria-busy + opacity + disable kontrola.
  const { isPending: pending, push } = usePendingFilteri()
  const t = useTranslations("plan.viewSwitcher")

  return (
    <div
      className={cn("flex items-center gap-1", pending && "opacity-60")}
      data-testid="plan-view-switcher"
      data-pending={pending}
      aria-busy={pending}
    >
      {PLAN_VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          data-testid={`view-${v}`}
          data-active={current === v}
          aria-pressed={current === v}
          disabled={pending}
          onClick={() => push(buildViewHref(new URLSearchParams(params.toString()), v))}
          className={cn(
            "group/tt relative px-3 py-1 rounded-full text-sm border transition-colors",
            FOCUS_RING,
            current === v
              ? "bg-brand text-white border-brand"
              : "bg-card text-muted-foreground border-border hover:bg-muted",
          )}
        >
          {t(v)}
          <Tooltip>{t(`${v}Opis`)}</Tooltip>
        </button>
      ))}
    </div>
  )
}
