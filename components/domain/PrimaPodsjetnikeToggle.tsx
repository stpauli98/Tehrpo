"use client"
import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { postaviPrimaPodsjetnike } from "@/app/(dashboard)/postavke/actions"
import { toastRezultat } from "@/components/akcija-toast"
import { Checkbox } from "@/components/ui/checkbox"

export function PrimaPodsjetnikeToggle({
  korisnikId, prima, onemoguceno = false,
}: { korisnikId: string; prima: boolean; onemoguceno?: boolean }) {
  const t = useTranslations("postavke.primaPodsjetnike")
  const [checked, setChecked] = useState(prima)
  const [pending, start] = useTransition()
  return (
    <Checkbox
      checked={checked}
      disabled={pending || onemoguceno}
      data-testid={`prima-podsjetnike-${korisnikId}`}
      aria-label={t("aria")}
      title={t("aria")}
      onCheckedChange={(next) => {
        setChecked(next)
        start(async () => {
          const r = toastRezultat(await postaviPrimaPodsjetnike(korisnikId, next), { uspjeh: t("sacuvano"), greska: t("greska") })
          if (!r.ok) setChecked(!next) // brana odbila → vrati na stvarno stanje
        })
      }}
    />
  )
}
