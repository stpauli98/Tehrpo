import { Info } from "lucide-react"
import { cn, FOCUS_RING } from "@/lib/utils"

/**
 * ⓘ ikona sa hover/fokus objašnjenjem (isti CSS-only obrazac kao ikona-tooltip.tsx,
 * ali sa prelomom teksta za rečenice).
 *
 * Standalone (default): trigger je fokusabilno dugme sa `aria-label={tekst}` — objašnjenje
 * je dostupno AT-u i tastaturi (tooltip se prikazuje na hover I na fokus).
 *
 * Unutar interaktivnog roditelja (npr. TabsTrigger): postavi `dekorativno`, pa ikona ostaje
 * `aria-hidden` i čisto CSS-only hover (ne pravi zaseban tab-stop niti zagađuje accessible
 * name roditelja). Tekst tada treba izložiti preko roditelja (npr. `title`/`aria-describedby`).
 */
export function InfoIkona({
  tekst,
  className,
  testId,
  strana = "lijevo",
  dekorativno = false,
}: {
  tekst: string
  className?: string
  testId?: string
  strana?: "lijevo" | "desno"
  dekorativno?: boolean
}) {
  const tooltip = (
    <span
      className={cn(
        "pointer-events-none absolute top-full z-50 mt-1.5 hidden w-max max-w-72 whitespace-normal rounded-md bg-popover px-2.5 py-1.5 text-left text-xs font-medium leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/10 group-hover/info:block",
        !dekorativno && "group-focus-visible/info:block",
        strana === "desno" ? "right-0" : "left-0",
      )}
    >
      {tekst}
    </span>
  )

  if (dekorativno) {
    return (
      <span
        aria-hidden
        data-testid={testId}
        className={cn("group/info relative inline-flex items-center", className)}
      >
        <Info className="size-3.5 text-muted-foreground transition-colors group-hover/info:text-foreground" />
        {tooltip}
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-label={tekst}
      data-testid={testId}
      className={cn("group/info relative inline-flex items-center rounded-full", FOCUS_RING, className)}
    >
      <Info
        aria-hidden
        className="size-3.5 text-muted-foreground transition-colors group-hover/info:text-foreground group-focus-visible/info:text-foreground"
      />
      {tooltip}
    </button>
  )
}
