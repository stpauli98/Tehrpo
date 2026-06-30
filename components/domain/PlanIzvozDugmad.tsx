"use client"
import { useSearchParams } from "next/navigation"

export function PlanIzvozDugmad() {
  const params = useSearchParams()
  const href = (format: string) => {
    const next = new URLSearchParams(params.toString())
    next.delete("view")
    next.delete("page")
    next.delete("selected")
    next.set("format", format)
    return `/api/plan-aktivnosti/izvoz?${next.toString()}`
  }
  const klasa = "px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50"
  return (
    <div className="flex items-center gap-2">
      <a href={href("xlsx")} className={klasa} data-testid="izvoz-excel">Izvoz Excel</a>
      <a href={href("pdf")} className={klasa} data-testid="izvoz-pdf">Izvoz PDF</a>
    </div>
  )
}
