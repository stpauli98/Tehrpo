"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { deleteProfilProvjere, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function ObrisiProfilButton({ id }: { id: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteProfilProvjere, initial)
  const submitted = useRef(false)
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="obrisi-profil-btn">Obriši</Button>
        }
      />
      <DialogContent data-testid="obrisi-profil-dialog">
        <DialogHeader>
          <DialogTitle>Ukloniti provjeru iz profila?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">
          Uklanja stavku iz profila. Postojeći termini ostaju (vode se kroz Termini).
        </p>
        {state.ok === false && state.message && (
          <p className="text-sm text-red-600" role="alert">{state.message}</p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
          <form action={(fd) => { submitted.current = true; action(fd) }}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="destructive" disabled={pending} data-testid="obrisi-profil-potvrdi">
              {pending ? "Brišem…" : "Ukloni"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
