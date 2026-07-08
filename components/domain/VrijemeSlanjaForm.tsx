"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { updateVrijemeSlanja, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }
const SATI = Array.from({ length: 24 }, (_, i) => i)

export function VrijemeSlanjaForm({ vrijemeSat }: { vrijemeSat: number }) {
  const t = useTranslations("postavke.vrijemeSlanja")
  const router = useRouter()
  const [state, action, pending] = useActionState(updateVrijemeSlanja, initial)
  const prev = useRef<ActionResult>(initial)

  useEffect(() => {
    if (!pending && state !== prev.current) {
      prev.current = state
      if (state.ok) router.refresh()
    }
  }, [state, pending, router])

  return (
    <form action={action} className="max-w-xl space-y-2" data-testid="vrijeme-slanja-form">
      <label htmlFor="vrijeme_slanja_sat" className="text-sm font-medium">{t("naslov")}</label>
      <p className="text-sm text-slate-500">{t("opis")}</p>
      <div className="flex items-center gap-2">
        <select
          id="vrijeme_slanja_sat"
          name="vrijeme_slanja_sat"
          defaultValue={String(vrijemeSat)}
          disabled={pending}
          data-testid="vrijeme-slanja-select"
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm disabled:opacity-50"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {SATI.map((s) => (
            <option key={s} value={String(s)}>
              {String(s).padStart(2, "0")}:00
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-400">{t("zona")}</span>
      </div>
      {state.ok === false && state.message && (
        <p className="text-sm text-red-600" role="alert">{state.message}</p>
      )}
    </form>
  )
}
