"use client"

import { useActionState, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { updateZakazanoObavijest, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Checkbox } from "@/components/ui/checkbox"

const initial: ActionResult = { ok: true }

// Prekidač za automatsku "zakazano poslije roka" obavijest. Isti obrazac kao
// SaljiKlijentimaToggle: perzistira preko servera, rollback checkbox-a na server-istinu
// tačno jednom po neuspjehu. FormData paritet: Checkbox nosi `value="on"` pa server
// akcija (`formData.get("aktivna") === "on"`) dobija istu vrijednost kao native input.
export function ZakazanoObavijestToggle({ aktivna }: { aktivna: boolean }) {
  const t = useTranslations("postavke.zakazanoObavijest")
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState(updateZakazanoObavijest, initial)
  // "trenutno" = vrijednost prikazana korisniku; "verzija" forsira REMOUNT Checkbox-a
  // (svjež defaultChecked) — OBA se mijenjaju ISKLJUČIVO ZAJEDNO (nikad "trenutno" samo),
  // nakon SVAKOG završenog round-trip-a (uspjeh ILI neuspjeh). Klik samo bilježi namjeru
  // u `namjeraChecked` i SINHRONO submit-uje — ne mijenja "trenutno" direktno. Detaljno
  // obrazloženje remount-a i "adjust state while rendering" obrasca: vidi SaljiKlijentimaToggle.
  const [trenutno, setTrenutno] = useState(aktivna)
  const [verzija, setVerzija] = useState(0)
  const [namjeraChecked, setNamjeraChecked] = useState(aktivna)
  const [prevState, setPrevState] = useState(state)
  if (state !== prevState) {
    setPrevState(state)
    setTrenutno(state.ok === false ? aktivna : namjeraChecked)
    setVerzija((v) => v + 1)
  }

  return (
    <div className="space-y-2">
      <form ref={formRef} action={action} className="flex items-start gap-3">
        <Checkbox
          key={verzija}
          name="aktivna"
          value="on"
          defaultChecked={trenutno}
          disabled={pending}
          aria-label={t("naslov")}
          data-testid="zakazano-obavijest-toggle"
          className="mt-0.5"
          // Native <input type=checkbox> mijenja .checked SINHRONO na klik, pa je sinhroni
          // requestSubmit ispravan (za razliku od Select-a koji treba deferred submit).
          onCheckedChange={(next) => {
            setNamjeraChecked(next)
            formRef.current?.requestSubmit()
          }}
        />
        <div>
          <p className="text-sm font-medium">{t("naslov")}</p>
          <p className="text-sm text-muted-foreground">{t("opis")}</p>
        </div>
      </form>
      {state.ok === false && state.message && (
        <p className="text-xs text-destructive" role="alert">{state.message}</p>
      )}
    </div>
  )
}
