"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createKlijent, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function NoviKlijentButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(createKlijent, initial)
  const submitted = useRef(false)

  // Zatvori sheet TEK nakon stvarnog submita koji je uspio (submitted ref
  // razlikuje uspjeh od initial { ok: true } stanja).
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button data-testid="novi-klijent-btn">
            <Plus className="w-4 h-4" aria-hidden /> Novi klijent
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full lg:max-w-md flex flex-col"
        data-testid="novi-klijent-sheet"
      >
        <SheetHeader>
          <SheetTitle>Novi klijent</SheetTitle>
        </SheetHeader>

        <form
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="flex-1 overflow-auto px-4 space-y-3"
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

        <SheetFooter>
          <SheetClose
            render={
              <Button variant="outline" data-testid="novi-klijent-cancel">
                Otkaži
              </Button>
            }
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
