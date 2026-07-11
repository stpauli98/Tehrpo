"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { updateKlijentSaljiPodsjetnik } from "@/app/(dashboard)/klijenti/[id]/actions"
import { PrimaociCombobox, type KontaktZaPodsjetnik } from "./PrimaociCombobox"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import { Checkbox } from "@/components/ui/checkbox"
import { toastRezultat } from "@/components/akcija-toast"

export function KlijentPodsjetniciForm({
  klijentId, salji, kontakti, adHocEmails,
}: {
  klijentId: string
  salji: boolean
  kontakti: KontaktZaPodsjetnik[]
  adHocEmails: string[]
}) {
  const t = useTranslations("klijenti.podsjetnici")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const [pending, startTransition] = useTransition()
  const [saljiState, setSalji] = useState(salji)

  function toggleSalji(next: boolean) {
    setSalji(next)
    startTransition(async () => {
      const res = toastRezultat(await updateKlijentSaljiPodsjetnik(klijentId, next), {
        uspjeh: t("spaseno"),
        greska: tc("greska"),
      })
      if (res.ok) { router.refresh() }
      else { setSalji(!next) }
    })
  }

  return (
    <div className="max-w-xl space-y-4" data-testid="klijent-podsjetnici-form">
      <label className="flex items-start gap-3">
        <Checkbox
          checked={saljiState}
          disabled={pending || !mozeUrediti}
          data-testid="klijent-salji-toggle"
          className="mt-0.5"
          onCheckedChange={(next) => toggleSalji(next)}
        />
        <span>
          <span className="block text-sm font-medium">{t("saljiNaslov")}</span>
          <span className="block text-sm text-muted-foreground">{t("saljiOpis")}</span>
        </span>
      </label>

      <PrimaociCombobox klijentId={klijentId} kontakti={kontakti} adHocEmails={adHocEmails} />
    </div>
  )
}
