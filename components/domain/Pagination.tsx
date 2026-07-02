import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/ikona-tooltip"

export function Pagination({
  pageNum, totalPages, hrefFor, pageTestId,
}: {
  pageNum: number
  totalPages: number
  hrefFor: (p: number) => string
  pageTestId: string
}) {
  if (totalPages <= 1) return null
  const cls = cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "group/tt relative")
  const disabled = cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "pointer-events-none opacity-50")
  return (
    <div className="flex items-center gap-2">
      {pageNum <= 1 ? (
        <span aria-label="Prethodna" className={disabled}><ChevronLeft className="h-4 w-4" aria-hidden /></span>
      ) : (
        <Link href={hrefFor(pageNum - 1)} aria-label="Prethodna" className={cls}>
          <ChevronLeft className="h-4 w-4" aria-hidden /><Tooltip>Prethodna</Tooltip>
        </Link>
      )}
      <span data-testid={pageTestId}>Strana {pageNum} / {totalPages}</span>
      {pageNum >= totalPages ? (
        <span aria-label="Sljedeća" className={disabled}><ChevronRight className="h-4 w-4" aria-hidden /></span>
      ) : (
        <Link href={hrefFor(pageNum + 1)} aria-label="Sljedeća" className={cls}>
          <ChevronRight className="h-4 w-4" aria-hidden /><Tooltip>Sljedeća</Tooltip>
        </Link>
      )}
    </div>
  )
}
