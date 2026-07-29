"use client"
import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { postaviPrimaPodsjetnike } from "@/app/(dashboard)/postavke/actions"
import { toastRezultat } from "@/components/akcija-toast"
import { Checkbox } from "@/components/ui/checkbox"

export function PrimaPodsjetnikeToggle({
  korisnikId, prima, onemoguceno = false, razlogOnemogucen,
}: { korisnikId: string; prima: boolean; onemoguceno?: boolean; razlogOnemogucen?: string }) {
  const t = useTranslations("postavke.primaPodsjetnike")
  const [checked, setChecked] = useState(prima)
  const [pending, start] = useTransition()

  const aria = t("aria")
  // Vizuelni razlog nosi hover Tooltip na omotaču (KorisniciTabela) — tooltip je
  // `display:none` dok se ne hoverne, a disabled checkbox ne može dobiti fokus, pa
  // za tastaturu/čitač ekrana razlog mora i u pristupačno ime (isto kao SaljiFirmiToggle).
  const opis = razlogOnemogucen ? `${aria} — ${razlogOnemogucen}` : aria

  return (
    <Checkbox
      checked={checked}
      disabled={pending || onemoguceno}
      data-testid={`prima-podsjetnike-${korisnikId}`}
      aria-label={opis}
      title={onemoguceno ? undefined : aria}
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
