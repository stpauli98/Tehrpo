"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { cn } from "@/lib/utils"
import { PLAN_VIEWS, buildViewHref, type PlanView } from "@/lib/plan-view"

const LABELE: Record<PlanView, string> = { lista: "Lista", kalendar: "Kalendar", matrica: "Matrica" }

export function PlanViewSwitcher({ current }: { current: PlanView }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-1" data-testid="plan-view-switcher" data-pending={pending}>
      {PLAN_VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          data-testid={`view-${v}`}
          data-active={current === v}
          onClick={() =>
            startTransition(() => router.push(buildViewHref(new URLSearchParams(params.toString()), v)))
          }
          className={cn(
            "px-3 py-1 rounded-full text-sm border transition",
            current === v
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50",
          )}
        >
          {LABELE[v]}
        </button>
      ))}
    </div>
  )
}
