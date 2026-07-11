"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { promijeniLozinku } from "@/app/(dashboard)/postavke/actions"

export function MojNalogForm() {
  const t = useTranslations("postavke.mojNalog")
  const [pending, start] = useTransition()
  const [trenutna, setTrenutna] = useState("")
  const [nova, setNova] = useState("")
  const [potvrda, setPotvrda] = useState("")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await promijeniLozinku(trenutna, nova, potvrda)
      if (r.ok) {
        toast.success(t("uspjeh"))
        setTrenutna(""); setNova(""); setPotvrda("")
      } else {
        toast.error(r.message ?? t("greske.opsta"))
      }
    })
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-3" data-testid="moj-nalog-form">
      <label className="block space-y-1">
        <span className="text-sm text-muted-foreground">{t("trenutna")}</span>
        <Input type="password" autoComplete="current-password" required value={trenutna}
          onChange={(e) => setTrenutna(e.target.value)} data-testid="loz-trenutna" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-muted-foreground">{t("nova")}</span>
        <Input type="password" autoComplete="new-password" required value={nova}
          onChange={(e) => setNova(e.target.value)} data-testid="loz-nova" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-muted-foreground">{t("potvrda")}</span>
        <Input type="password" autoComplete="new-password" required value={potvrda}
          onChange={(e) => setPotvrda(e.target.value)} data-testid="loz-potvrda" />
      </label>
      <Button type="submit" disabled={pending} data-testid="loz-submit">
        {pending ? t("uToku") : t("dugme")}
      </Button>
    </form>
  )
}
