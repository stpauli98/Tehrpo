"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PoljeLozinke } from "./PoljeLozinke"
import { toastRezultat } from "@/components/akcija-toast"
import { promijeniLozinku } from "@/app/(dashboard)/postavke/actions"

export function MojNalogForm({ ime }: { ime?: string }) {
  const t = useTranslations("postavke.mojNalog")
  const [pending, start] = useTransition()
  const [trenutna, setTrenutna] = useState("")
  const [nova, setNova] = useState("")
  const [potvrda, setPotvrda] = useState("")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = toastRezultat(await promijeniLozinku(trenutna, nova, potvrda), {
        uspjeh: t("uspjeh"),
        greska: t("greske.opsta"),
      })
      if (res.ok) {
        setTrenutna("")
        setNova("")
        setPotvrda("")
      }
    })
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4" data-testid="moj-nalog-form">
      {ime && (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/10 text-brand"
          >
            <UserRound className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 text-sm">
            <span className="text-muted-foreground">{t("prijavljenKao")} </span>
            <span className="font-medium text-foreground">{ime}</span>
          </span>
        </div>
      )}

      <PoljeLozinke
        label={t("trenutna")}
        value={trenutna}
        onChange={setTrenutna}
        autoComplete="current-password"
        testid="loz-trenutna"
        prikaziLabela={t("prikaziLozinku")}
        sakrijLabela={t("sakrijLozinku")}
      />
      {/* minLength je UX sloj (S2) — server (validirajNovuLozinku) ostaje izvor istine. */}
      <PoljeLozinke
        label={t("nova")}
        value={nova}
        onChange={setNova}
        autoComplete="new-password"
        testid="loz-nova"
        minLength={8}
        prikaziLabela={t("prikaziLozinku")}
        sakrijLabela={t("sakrijLozinku")}
      />
      <PoljeLozinke
        label={t("potvrda")}
        value={potvrda}
        onChange={setPotvrda}
        autoComplete="new-password"
        testid="loz-potvrda"
        minLength={8}
        prikaziLabela={t("prikaziLozinku")}
        sakrijLabela={t("sakrijLozinku")}
      />

      <Button type="submit" disabled={pending} data-testid="loz-submit">
        {pending ? t("uToku") : t("dugme")}
      </Button>
    </form>
  )
}
