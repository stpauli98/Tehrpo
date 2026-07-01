"use client"
import { useSearchParams } from "next/navigation"
import { FileSpreadsheet, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/ikona-tooltip"

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
  // Ikonica-dugme u stilu sidebar-a; hover tooltip objašnjava akciju (Excel=zeleno, PDF=crveno).
  const klasa =
    "group/tt relative flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 transition-colors"
  return (
    <div className="flex items-center gap-2">
      <a
        href={href("xlsx")}
        className={cn(klasa, "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700")}
        data-testid="izvoz-excel"
        aria-label="Izvoz Excel"
      >
        <FileSpreadsheet className="h-[18px] w-[18px]" aria-hidden />
        <Tooltip>Izvoz Excel</Tooltip>
      </a>
      <a
        href={href("pdf")}
        className={cn(klasa, "text-red-600 hover:bg-red-50 hover:text-red-700")}
        data-testid="izvoz-pdf"
        aria-label="Izvoz PDF"
      >
        <FileText className="h-[18px] w-[18px]" aria-hidden />
        <Tooltip>Izvoz PDF</Tooltip>
      </a>
    </div>
  )
}
