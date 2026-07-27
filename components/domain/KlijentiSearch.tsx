"use client"

import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { usePendingFilteri } from "@/lib/use-pending-filteri"
import { href } from "@/i18n/routes"

export function KlijentiSearch() {
  const t = useTranslations("klijenti.pretraga")
  const params = useSearchParams()
  const { isPending, push } = usePendingFilteri()
  const q = params.get("q") ?? ""

  function commit(value: string) {
    const next = new URLSearchParams(params.toString())
    if (value.trim()) next.set("q", value.trim())
    else next.delete("q")
    next.delete("page")
    push(href(`/klijenti?${next.toString()}`))
  }

  // S10: pending mora biti vidljiv (aria-busy + prigušenje + disable), ne samo
  // data-pending atribut za testove.
  return (
    <div aria-busy={isPending} className={isPending ? "opacity-60" : undefined}>
      <Input
        key={q}
        type="search"
        placeholder={t("placeholder")}
        aria-label={t("ariaLabel")}
        defaultValue={q}
        data-testid="klijenti-search"
        data-pending={isPending}
        disabled={isPending}
        className="w-64"
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value)
        }}
      />
    </div>
  )
}
