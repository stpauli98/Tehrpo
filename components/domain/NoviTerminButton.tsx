"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NoviTerminDialog, type Opt } from "@/components/domain/NoviTerminDialog"
import { useMozeUrediti } from "@/providers/korisnik-provider"

/** Dugme + kontrolisani NoviTerminDialog — forma živi u NoviTerminDialog.tsx. */
export function NoviTerminButton({
  klijenti,
  vrste,
  lokacijeByFirma,
  zaduzeniPrijedloziByFirma,
  sviRadnici,
}: {
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
  zaduzeniPrijedloziByFirma: Record<string, string[]>
  sviRadnici: string[]
}) {
  const t = useTranslations("termini.noviTermin")
  const [open, setOpen] = useState(false)
  const mozeUrediti = useMozeUrediti()
  if (!mozeUrediti) return null

  return (
    <>
      <Button data-testid="novi-termin-btn" onClick={() => setOpen(true)}>
        <Plus className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("dugme")}
      </Button>
      <NoviTerminDialog
        open={open}
        onOpenChange={setOpen}
        klijenti={klijenti}
        vrste={vrste}
        lokacijeByFirma={lokacijeByFirma}
        zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma}
        sviRadnici={sviRadnici}
      />
    </>
  )
}
