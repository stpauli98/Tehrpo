"use client"

import { useId, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn, FOCUS_RING } from "@/lib/utils"

export function CollapsibleSection({
  title,
  description,
  icon,
  action,
  children,
  defaultOpen = false,
}: {
  title: string
  description?: string
  /** Dekorativna lucide ikona (aria-hidden dobija automatski preko pločice). */
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          // Panel se renderuje samo dok je sekcija otvorena, pa bi `aria-controls`
          // u zatvorenom stanju pokazivao na nepostojeći id.
          aria-controls={open ? panelId : undefined}
          // Pristupačno ime = tačno naslov (ikona/chevron/opis su dekor unutar dugmeta).
          // E2E se oslanja na getByRole("button", { name: <naslov> }).
          aria-label={title}
          className={cn(
            "group flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
            // ring-inset: sekcija je overflow-hidden (čiste zaobljene ivice na hover-u),
            // pa outset prsten ne bi bio vidljiv — inset ostaje unutar dugmeta.
            FOCUS_RING,
            "focus-visible:ring-inset",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg transition-colors",
              open
                ? "bg-brand/10 text-brand"
                : "bg-muted text-muted-foreground group-hover:bg-brand/10 group-hover:text-brand",
            )}
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-medium leading-snug text-foreground">{title}</span>
            {description && (
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">{description}</span>
            )}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-[18px] shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open ? "text-foreground" : "-rotate-90",
            )}
          />
        </button>
        {action && <div className="flex shrink-0 items-center pl-2 pr-4">{action}</div>}
      </div>
      {open && (
        <div id={panelId} className="border-t border-border p-4 pt-5">
          {children}
        </div>
      )}
    </section>
  )
}
