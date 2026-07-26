import { cn, FOCUS_RING } from "@/lib/utils"

/** Kvadratno icon-dugme u stilu sidebar-a (border + hover). Sadrži `group/tt relative`. */
export const IKONA_DUGME_KLASA =
  `group/tt relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`

/** Inline icon-akcija (npr. u redu tabele) — bez bordera, kompaktna. Sadrži `group/tt relative`. */
export const IKONA_INLINE_KLASA =
  `group/tt relative inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`

/** Hover tooltip (isti obrazac kao sidebar). Postavi kao dijete elementa koji ima `group/tt relative`. */
export function Tooltip({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-foreground/10 group-hover/tt:block group-focus-visible/tt:block",
        className,
      )}
    >
      {children}
    </span>
  )
}
