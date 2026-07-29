"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { updateKlijentSaljiPodsjetnik } from "@/app/(dashboard)/klijenti/[id]/actions"
import { toastRezultat } from "@/components/akcija-toast"
import { Checkbox } from "@/components/ui/checkbox"

/**
 * Sirovi per-firma prekidač (`klijenti.salji_podsjetnik_klijentu`) u tabeli „Ko šta prima".
 * NIJE isto što i kolona „Firma prima?" — ta je izvedena (globalno && firma && ima adrese)
 * i ostaje read-only badge. Zato nakon uspjeha ide `router.refresh()`: badge i razlog
 * računa server, pa se moraju ponovo renderovati.
 *
 * Kad je globalni prekidač isključen kontrola je `disabled` — isto pravilo kao na
 * klijentovom tabu, gdje se forma tada uopšte ne prikazuje.
 */
export function SaljiFirmiToggle({
  klijentId,
  naziv,
  salji,
  globalnoIskljuceno,
}: {
  klijentId: string
  naziv: string
  salji: boolean
  globalnoIskljuceno: boolean
}) {
  const t = useTranslations("postavke.koStaPrima")
  const tc = useTranslations("common")
  const router = useRouter()
  const [checked, setChecked] = useState(salji)
  const [pending, start] = useTransition()

  const aria = t("saljiFirmiAria", { firma: naziv })
  // Vizuelni razlog nosi hover Tooltip na omotaču (KoStaPrimaTab) — `title` na disabled
  // elementu Chrome ne prikazuje. Za čitače ekrana razlog ide u samo pristupačno ime,
  // jer je tooltip `display:none` dok se ne hoverne.
  const opis = globalnoIskljuceno ? `${aria} — ${t("saljiFirmiIskljuceno")}` : aria

  return (
    <Checkbox
      checked={checked}
      disabled={pending || globalnoIskljuceno}
      aria-label={opis}
      title={globalnoIskljuceno ? undefined : aria}
      data-testid={`ksp-salji-${klijentId}`}
      onCheckedChange={(next) => {
        setChecked(next)
        start(async () => {
          const r = toastRezultat(await updateKlijentSaljiPodsjetnik(klijentId, next), {
            uspjeh: tc("sacuvano"),
            greska: tc("greska"),
          })
          if (r.ok) router.refresh()
          else setChecked(!next) // RLS/brana odbila → vrati na stvarno stanje
        })
      }}
    />
  )
}
