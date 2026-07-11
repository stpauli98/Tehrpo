"use client"
import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { postaviPrimaPodsjetnike } from "@/app/(dashboard)/postavke/actions"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"

export function PrimaPodsjetnikeToggle({ korisnikId, prima }: { korisnikId: string; prima: boolean }) {
  const t = useTranslations("postavke.primaPodsjetnike")
  const [checked, setChecked] = useState(prima)
  const [pending, start] = useTransition()
  return (
    <Checkbox
      checked={checked}
      disabled={pending}
      aria-label={t("aria")}
      title={t("aria")}
      onCheckedChange={(next) => {
        setChecked(next)
        start(async () => {
          const r = await postaviPrimaPodsjetnike(korisnikId, next)
          if (!r.ok) setChecked(!next) // brana odbila → vrati na stvarno stanje
          toast[r.ok ? "success" : "error"](r.ok ? t("sacuvano") : (r.message ?? t("greska")))
        })
      }}
    />
  )
}
