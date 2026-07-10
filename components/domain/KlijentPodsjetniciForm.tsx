"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { updateKlijentSaljiPodsjetnik } from "@/app/(dashboard)/klijenti/[id]/actions"
import { PrimaociCombobox, type KontaktZaPodsjetnik } from "./PrimaociCombobox"
import { useMozeUrediti } from "@/providers/korisnik-provider"

export function KlijentPodsjetniciForm({
  klijentId, salji, kontakti, adHocEmails,
}: {
  klijentId: string
  salji: boolean
  kontakti: KontaktZaPodsjetnik[]
  adHocEmails: string[]
}) {
  const t = useTranslations("klijenti.podsjetnici")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const [pending, startTransition] = useTransition()
  const [saljiState, setSalji] = useState(salji)

  function toggleSalji(next: boolean) {
    setSalji(next)
    startTransition(async () => {
      const res = await updateKlijentSaljiPodsjetnik(klijentId, next)
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else { setSalji(!next); toast.error(res.message) }
    })
  }

  return (
    <div className="max-w-xl space-y-4" data-testid="klijent-podsjetnici-form">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={saljiState}
          disabled={pending || !mozeUrediti}
          data-testid="klijent-salji-toggle"
          className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
          onChange={mozeUrediti ? (e) => toggleSalji(e.target.checked) : undefined}
        />
        <span>
          <span className="block text-sm font-medium">{t("saljiNaslov")}</span>
          <span className="block text-sm text-slate-500">{t("saljiOpis")}</span>
        </span>
      </label>

      <PrimaociCombobox klijentId={klijentId} kontakti={kontakti} adHocEmails={adHocEmails} />
    </div>
  )
}
