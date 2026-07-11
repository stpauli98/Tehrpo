"use client"

import { useActionState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { updateZakazanoObavijest, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

// Prekidač za automatsku "zakazano poslije roka" obavijest. Isti obrazac kao
// SaljiKlijentimaToggle: perzistira preko servera, rollback checkbox-a na server-istinu
// tačno jednom po neuspjehu.
export function ZakazanoObavijestToggle({ aktivna }: { aktivna: boolean }) {
  const t = useTranslations("postavke.zakazanoObavijest")
  const checkboxRef = useRef<HTMLInputElement>(null)
  const [state, action, pending] = useActionState(updateZakazanoObavijest, initial)
  const obradjeno = useRef(initial)

  useEffect(() => {
    if (state !== obradjeno.current) {
      obradjeno.current = state
      if (state.ok === false && checkboxRef.current) checkboxRef.current.checked = aktivna
    }
  }, [state, aktivna])

  return (
    <div className="space-y-2">
      <form action={action} className="flex items-start gap-3">
        <input
          ref={checkboxRef}
          type="checkbox"
          name="aktivna"
          defaultChecked={aktivna}
          disabled={pending}
          aria-label={t("naslov")}
          data-testid="zakazano-obavijest-toggle"
          className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <div>
          <p className="text-sm font-medium">{t("naslov")}</p>
          <p className="text-sm text-slate-500">{t("opis")}</p>
        </div>
      </form>
      {state.ok === false && state.message && (
        <p className="text-xs text-red-600" role="alert">{state.message}</p>
      )}
    </div>
  )
}
