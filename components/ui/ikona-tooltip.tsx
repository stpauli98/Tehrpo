import { cn, FOCUS_RING } from "@/lib/utils"

/** Kvadratno icon-dugme u stilu sidebar-a (border + hover). Sadrži `group/tt relative`. */
export const IKONA_DUGME_KLASA =
  `group/tt relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 ${FOCUS_RING}`

/** Inline icon-akcija (npr. u redu tabele) — bez bordera, kompaktna. Sadrži `group/tt relative`. */
export const IKONA_INLINE_KLASA =
  `group/tt relative inline-flex items-center justify-center rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 ${FOCUS_RING}`

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
        "pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-md group-hover/tt:block group-focus-visible/tt:block",
        className,
      )}
    >
      {children}
    </span>
  )
}
