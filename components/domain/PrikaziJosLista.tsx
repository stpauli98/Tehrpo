"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn, FOCUS_RING } from "@/lib/utils"

// Lista koja prikazuje prvih `limit` stavki, a ostatak skriva iza "Prikaži još N".
// Stavke su gotovi <li> čvorovi (sa svojim key-em) — radi i za server i klijent roditelja.
export function PrikaziJosLista({
  items,
  limit = 5,
  ulClassName,
  imenicaGenitiv,
  testId,
}: {
  items: ReactNode[]
  limit?: number
  ulClassName?: string
  imenicaGenitiv: string
  testId?: string
}) {
  const t = useTranslations("common.prikaziJosLista")
  const [expanded, setExpanded] = useState(false)
  const overflow = items.length > limit
  const visible = !overflow || expanded ? items : items.slice(0, limit)

  return (
    <div>
      <ul className={ulClassName}>{visible}</ul>
      {overflow && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          data-testid={testId}
          className={cn(
            "mt-3 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-brand transition-colors motion-reduce:transition-none hover:underline",
            FOCUS_RING,
          )}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden />
          {expanded ? t("prikaziManje") : t("prikaziJos", { count: items.length - limit, imenica: imenicaGenitiv })}
        </button>
      )}
    </div>
  )
}
