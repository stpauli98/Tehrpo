import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/ikona-tooltip"

// Prop-driven dumb komponenta (renderuje se i iz server i iz klijent stabla —
// npr. klijenti/page.tsx prosljeđuje hrefFor kao plain funkciju, što onemogućuje
// "use client" na ovoj komponenti). Nema pristupa i18n kontekstu/katalozima na
// ovom nivou (namjerno — vidi Task 15 fix: i18n/messages ne smije ući u klijent
// bundle), pa su labele OBAVEZNI props — pozivalac ih prevodi (server:
// getTranslations, client: useTranslations), obje strane iz "common.pagination".
export function Pagination({
  pageNum, totalPages, hrefFor, pageTestId,
  prethodnaLabel,
  sljedecaLabel,
  stranaText,
}: {
  pageNum: number
  totalPages: number
  hrefFor: (p: number) => string
  pageTestId: string
  prethodnaLabel: string
  sljedecaLabel: string
  stranaText: string
}) {
  if (totalPages <= 1) return null
  const cls = cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "group/tt relative")
  const disabled = cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "pointer-events-none opacity-50")
  return (
    <div className="flex items-center gap-2">
      {pageNum <= 1 ? (
        <span aria-label={prethodnaLabel} className={disabled}><ChevronLeft className="h-4 w-4" aria-hidden /></span>
      ) : (
        <Link href={hrefFor(pageNum - 1)} aria-label={prethodnaLabel} className={cls}>
          <ChevronLeft className="h-4 w-4" aria-hidden /><Tooltip>{prethodnaLabel}</Tooltip>
        </Link>
      )}
      <span data-testid={pageTestId}>{stranaText}</span>
      {pageNum >= totalPages ? (
        <span aria-label={sljedecaLabel} className={disabled}><ChevronRight className="h-4 w-4" aria-hidden /></span>
      ) : (
        <Link href={hrefFor(pageNum + 1)} aria-label={sljedecaLabel} className={cls}>
          <ChevronRight className="h-4 w-4" aria-hidden /><Tooltip>{sljedecaLabel}</Tooltip>
        </Link>
      )}
    </div>
  )
}
