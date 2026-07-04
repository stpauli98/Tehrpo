"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { deleteDokumentAction, type ActionResult } from "@/app/(dashboard)/dokumenti/actions"
import { useUloga } from "@/providers/korisnik-provider"
import { jeAdmin } from "@/lib/auth/roles"

const initial: ActionResult = { ok: true }

export function ObrisiDokumentButton({
  dokumentId,
  label = "Obriši dokument",
  testId = "dokument-obrisi",
}: {
  dokumentId: string
  label?: string
  testId?: string
}) {
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
  // Brisanje dokumenata je admin-only (server akcija to i nameće) — ne-adminima ne nudi dugme.
  if (!uloga || !jeAdmin(uloga)) return null
  return (
    <form action={action}>
      <input type="hidden" name="dokument_id" value={dokumentId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        data-testid={testId}
        aria-label={label}
        className="group/tt relative text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
        <Tooltip>{label}</Tooltip>
      </Button>
      {state.ok === false && state.message && (
        <span className="ml-2 text-xs text-red-600" role="alert">{state.message}</span>
      )}
    </form>
  )
}
