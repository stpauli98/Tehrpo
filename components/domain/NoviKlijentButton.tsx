"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { createKlijent, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function NoviKlijentButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(createKlijent, initial)
  const submitted = useRef(false)

  // Zatvori dialog TEK nakon stvarnog submita koji je uspio (submitted ref
  // razlikuje uspjeh od initial { ok: true } stanja).
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button data-testid="novi-klijent-btn">
            <Plus className="w-4 h-4" aria-hidden /> Novi klijent
          </Button>
        }
      />
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="novi-klijent-sheet"
      >
        <DialogHeader>
          <DialogTitle>Novi klijent</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="novi-klijent-form"
        >
          <label className="block text-sm">
            <span className="text-slate-600">Naziv *</span>
            <Input
              name="naziv"
              required
              placeholder="npr. WAIKIKI Banja Luka"
              data-testid="novi-klijent-naziv"
            />
            {state.ok === false && state.errors?.naziv && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.naziv[0]}</p>
            )}
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Adresa *</span>
            <Input name="adresa" required data-testid="novi-klijent-adresa" />
            {state.ok === false && state.errors?.adresa && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.adresa[0]}</p>
            )}
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Telefon *</span>
            <Input name="telefon" required data-testid="novi-klijent-telefon" />
            {state.ok === false && state.errors?.telefon && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.telefon[0]}</p>
            )}
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Email *</span>
            <Input name="email" type="email" required data-testid="novi-klijent-email" />
            {state.ok === false && state.errors?.email && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.email[0]}</p>
            )}
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Napomena</span>
            <Input name="napomena" data-testid="novi-klijent-napomena" />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending} data-testid="novi-klijent-submit">
            {pending ? "Kreiram…" : "Kreiraj klijenta"}
          </Button>
        </form>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" data-testid="novi-klijent-cancel">
                Otkaži
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
