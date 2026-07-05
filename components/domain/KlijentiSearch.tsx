"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"

export function KlijentiSearch() {
  const t = useTranslations("klijenti.pretraga")
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const q = params.get("q") ?? ""

  function commit(value: string) {
    const next = new URLSearchParams(params.toString())
    if (value.trim()) next.set("q", value.trim())
    else next.delete("q")
    next.delete("page")
    startTransition(() => router.push(`/klijenti?${next.toString()}`))
  }

  return (
    <Input
      key={q}
      type="search"
      placeholder={t("placeholder")}
      defaultValue={q}
      data-testid="klijenti-search"
      data-pending={pending}
      className="w-64"
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value)
      }}
    />
  )
}
