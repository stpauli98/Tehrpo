"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { deleteLokacija, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function ObrisiLokacijuButton({ lokacijaId }: { lokacijaId: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteLokacija, initial)
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
          <Button variant="destructive" size="sm" data-testid={`obrisi-lokaciju-${lokacijaId}`}>
            Obriši
          </Button>
        }
      />
      <DialogContent data-testid="obrisi-lokaciju-dialog">
        <DialogHeader>
          <DialogTitle>Obrisati lokaciju?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">
          Brisanje lokacije će ukloniti vezu sa postojećim terminima (termin ostaje, lokacija
          postaje prazna).
        </p>
        {state.ok === false && state.message && (
          <p className="text-sm text-red-600" role="alert">
            {state.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
          <form
            action={(fd) => {
              submitted.current = true
              action(fd)
            }}
          >
            <input type="hidden" name="id" value={lokacijaId} />
            <Button
              type="submit"
              variant="destructive"
              disabled={pending}
              data-testid="obrisi-lokaciju-potvrdi"
            >
              {pending ? "Brišem…" : "Obriši"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
