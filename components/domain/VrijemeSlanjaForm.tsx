"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { updateVrijemeSlanja, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { useAkcijaToast } from "@/components/akcija-toast"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

const initial: ActionResult = { ok: true }
const SATI = Array.from({ length: 24 }, (_, i) => i)
// Base UI Select.Value renders the raw stored value (npr. "9") umjesto formatiranog labela
// dok se popup barem jednom ne otvori, OSIM ako Select.Root dobije `items` mapu — tada
// zna prikazati "09:00" i prije prve interakcije (npr. odmah nakon reload-a).
const SAT_ITEMS: Record<string, string> = Object.fromEntries(
  SATI.map((s) => [String(s), `${String(s).padStart(2, "0")}:00`])
)

export function VrijemeSlanjaForm({ vrijemeSat }: { vrijemeSat: number }) {
  const t = useTranslations("postavke.vrijemeSlanja")
  const tc = useTranslations("common")
  const router = useRouter()
  const [state, action, pending] = useActionState(updateVrijemeSlanja, initial)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })
  const prev = useRef<ActionResult>(initial)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!pending && state !== prev.current) {
      prev.current = state
      if (state.ok) router.refresh()
    }
  }, [state, pending, router])

  return (
    <form ref={formRef} action={action} className="max-w-xl space-y-2" data-testid="vrijeme-slanja-form">
      <label htmlFor="vrijeme_slanja_sat" className="text-sm font-medium">{t("naslov")}</label>
      <p className="text-sm text-muted-foreground">{t("opis")}</p>
      <div className="flex items-center gap-2">
        <Select
          id="vrijeme_slanja_sat"
          name="vrijeme_slanja_sat"
          items={SAT_ITEMS}
          defaultValue={String(vrijemeSat)}
          disabled={pending}
          // Base UI's Select.Root calls onValueChange BEFORE it commits the new value to its
          // internal (React-controlled) hidden input — requestSubmit() called synchronously here
          // would submit the STALE value (confirmed empirically). Defer to a macrotask so React
          // flushes the state update first.
          onValueChange={() => setTimeout(() => formRef.current?.requestSubmit(), 0)}
        >
          <SelectTrigger data-testid="vrijeme-slanja-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SATI.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {String(s).padStart(2, "0")}:00
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{t("zona")}</span>
      </div>
      {state.ok === false && state.message && (
        <p className="text-sm text-destructive" role="alert">{state.message}</p>
      )}
    </form>
  )
}
