"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn, FOCUS_RING } from "@/lib/utils"

export function CollapsibleSection({
  title,
  description,
  action,
  children,
  defaultOpen = false,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="rounded-xl border border-slate-200">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn("flex flex-1 items-center gap-2 rounded-md text-left", FOCUS_RING)}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-slate-400 transition-transform",
              open ? "" : "-rotate-90",
            )}
          />
          <h2 className="text-base font-medium">{title}</h2>
        </button>
        {action}
      </div>
      {open && (
        <div className="border-t border-slate-100 p-4">
          {description && <p className="mb-4 text-sm text-slate-500">{description}</p>}
          {children}
        </div>
      )}
    </section>
  )
}
