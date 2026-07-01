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
import { createVrsta, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function NovaVrstaButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(createVrsta, initial)
  const submitted = useRef(false)

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
          <Button variant="outline" size="sm" data-testid="nova-vrsta-btn">
            <Plus className="w-4 h-4" aria-hidden /> Nova vrsta
          </Button>
        }
      />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="nova-vrsta-sheet">
        <DialogHeader>
          <DialogTitle>Nova vrsta pregleda</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="nova-vrsta-form"
        >
          <label className="block text-sm">
            <span className="text-slate-600">Naziv *</span>
            <Input
              name="naziv"
              required
              placeholder="npr. Pregled ventilacionog sistema"
              data-testid="nova-vrsta-naziv"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Interval (mjeseci)</span>
            <Input
              name="interval"
              type="number"
              min={1}
              max={120}
              placeholder="prazno = bez auto-zakazivanja"
              data-testid="nova-vrsta-interval"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Zakonski osnov</span>
            <Input
              name="zakonski_osnov"
              placeholder="npr. Pravilnik… (opciono)"
              data-testid="nova-vrsta-osnov"
            />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">
              {state.message}
            </p>
          )}

          <DialogFooter className="flex-row justify-end gap-2">
            <DialogClose
              render={
                <Button type="button" variant="outline" data-testid="nova-vrsta-cancel">
                  Otkaži
                </Button>
              }
            />
            <Button type="submit" disabled={pending} data-testid="nova-vrsta-submit">
              {pending ? "Kreiram…" : "Kreiraj vrstu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
