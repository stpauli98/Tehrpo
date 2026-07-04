import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * ⓘ ikona sa hover objašnjenjem (isti CSS-only obrazac kao ikona-tooltip.tsx,
 * ali sa prelomom teksta za rečenice). Wrapper je aria-hidden da ne zagadi
 * accessible name roditelja (npr. TabsTrigger dugmeta).
 */
export function InfoIkona({
  tekst,
  className,
  testId,
  strana = "lijevo",
}: {
  tekst: string
  className?: string
  testId?: string
  strana?: "lijevo" | "desno"
}) {
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={cn("group/tt relative inline-flex items-center", className)}
    >
      <Info className="size-3.5 text-slate-400 transition-colors group-hover/tt:text-slate-600" />
      <span
        className={cn(
          "pointer-events-none absolute top-full z-50 mt-1.5 hidden w-max max-w-72 whitespace-normal rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-xs font-medium leading-relaxed text-white shadow-md group-hover/tt:block",
          strana === "desno" ? "right-0" : "left-0",
        )}
      >
        {tekst}
      </span>
    </span>
  )
}
