"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { Eye, EyeOff, UserRound } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn, FOCUS_RING } from "@/lib/utils"
import { toastRezultat } from "@/components/akcija-toast"
import { promijeniLozinku } from "@/app/(dashboard)/postavke/actions"

function PoljeLozinke({
  label,
  value,
  onChange,
  autoComplete,
  testid,
  prikaziLabela,
  sakrijLabela,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  testid: string
  prikaziLabela: string
  sakrijLabela: string
}) {
  const [prikazi, setPrikazi] = useState(false)
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="relative">
        <Input
          type={prikazi ? "text" : "password"}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-9"
          data-testid={testid}
        />
        <button
          type="button"
          onClick={() => setPrikazi((p) => !p)}
          aria-label={prikazi ? sakrijLabela : prikaziLabela}
          aria-pressed={prikazi}
          className={cn(
            "absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
            FOCUS_RING,
          )}
        >
          {prikazi ? (
            <EyeOff className="h-[18px] w-[18px]" aria-hidden />
          ) : (
            <Eye className="h-[18px] w-[18px]" aria-hidden />
          )}
        </button>
      </div>
    </label>
  )
}

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
      <PoljeLozinke
        label={t("nova")}
        value={nova}
        onChange={setNova}
        autoComplete="new-password"
        testid="loz-nova"
        prikaziLabela={t("prikaziLozinku")}
        sakrijLabela={t("sakrijLozinku")}
      />
      <PoljeLozinke
        label={t("potvrda")}
        value={potvrda}
        onChange={setPotvrda}
        autoComplete="new-password"
        testid="loz-potvrda"
        prikaziLabela={t("prikaziLozinku")}
        sakrijLabela={t("sakrijLozinku")}
      />

      <Button type="submit" disabled={pending} data-testid="loz-submit">
        {pending ? t("uToku") : t("dugme")}
      </Button>
    </form>
  )
}
