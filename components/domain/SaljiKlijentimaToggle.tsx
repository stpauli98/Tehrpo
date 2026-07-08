"use client"

import { useActionState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { updateSaljiKlijentima, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function SaljiKlijentimaToggle({ salji }: { salji: boolean }) {
  const t = useTranslations("postavke.saljiKlijentima")
  const checkboxRef = useRef<HTMLInputElement>(null)
  const [state, action, pending] = useActionState(updateSaljiKlijentima, initial)
  const obradjeno = useRef(initial)

  useEffect(() => {
    if (state !== obradjeno.current) {
      obradjeno.current = state
      if (state.ok === false && checkboxRef.current) checkboxRef.current.checked = salji
    }
  }, [state, salji])

  return (
    <div className="space-y-2">
      <form action={action} className="flex items-start gap-3">
        <input
          ref={checkboxRef}
          type="checkbox"
          name="salji"
          defaultChecked={salji}
          disabled={pending}
          aria-label={t("naslov")}
          data-testid="salji-klijentima-toggle"
          className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <div>
          <p className="text-sm font-medium">{t("naslov")}</p>
          <p className="text-sm text-amber-600">{t("upozorenje")}</p>
        </div>
      </form>
      {state.ok === false && state.message && (
        <p className="text-xs text-red-600" role="alert">{state.message}</p>
      )}
    </div>
  )
}
