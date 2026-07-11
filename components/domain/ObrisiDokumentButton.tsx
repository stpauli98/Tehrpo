"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { useAkcijaToast } from "@/components/akcija-toast"
import { deleteDokumentAction, type ActionResult } from "@/app/(dashboard)/dokumenti/actions"
import { useUloga } from "@/providers/korisnik-provider"
import { jeAdmin } from "@/lib/auth/roles"

const initial: ActionResult = { ok: true }

export function ObrisiDokumentButton({
  dokumentId,
  label,
  testId = "dokument-obrisi",
}: {
  dokumentId: string
  label?: string
  testId?: string
}) {
  const t = useTranslations("dokumenti")
  const tc = useTranslations("common")
  const router = useRouter()
  const uloga = useUloga()
  const [state, action, pending] = useActionState(deleteDokumentAction, initial)
  const prev = useRef(state)
  useEffect(() => {
    if (state !== prev.current) {
      prev.current = state
      if (state.ok) router.refresh()
    }
  }, [state, router])
  useAkcijaToast(state, { uspjeh: tc("obrisano"), greska: tc("greska") })
  // Brisanje dokumenata je admin-only (server akcija to i nameće) — ne-adminima ne nudi dugme.
  if (!uloga || !jeAdmin(uloga)) return null
  const resolvedLabel = label ?? t("obrisiDokument")
  return (
    <form action={action}>
      <input type="hidden" name="dokument_id" value={dokumentId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        data-testid={testId}
        aria-label={resolvedLabel}
        className="group/tt relative text-destructive hover:bg-destructive/20 hover:text-destructive"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
        <Tooltip>{resolvedLabel}</Tooltip>
      </Button>
      {state.ok === false && state.message && (
        <span className="ml-2 text-xs text-destructive" role="alert">{state.message}</span>
      )}
    </form>
  )
}
