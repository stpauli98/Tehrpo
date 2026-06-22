"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { deleteDokumentAction, type ActionResult } from "@/app/(dashboard)/dokumenti/actions"

const initial: ActionResult = { ok: true }

export function ObrisiDokumentButton({ dokumentId }: { dokumentId: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteDokumentAction, initial)
  const prev = useRef(state)
  useEffect(() => {
    if (state !== prev.current) {
      prev.current = state
      if (state.ok) router.refresh()
    }
  }, [state, router])
  return (
    <form action={action}>
      <input type="hidden" name="dokument_id" value={dokumentId} />
      <Button type="submit" variant="ghost" disabled={pending} data-testid="pregled-delete" aria-label="Obriši zapisnik">
        {pending ? "Brišem…" : "Obriši"}
      </Button>
      {state.ok === false && state.message && (
        <span className="ml-2 text-xs text-red-600" role="alert">{state.message}</span>
      )}
    </form>
  )
}
