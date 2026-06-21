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
import { createLokacija, updateLokacija, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

const initial: ActionResult = { ok: true }

const FIELDS: readonly [string, string, boolean][] = [
  ["naziv", "Naziv *", true],
  ["grad", "Grad", false],
  ["regija", "Regija", false],
  ["adresa", "Adresa", false],
  ["kontakt_osoba", "Kontakt osoba", false],
  ["kontakt_email", "Email", false],
  ["kontakt_telefon", "Telefon", false],
]

export function LokacijaSheet({
  klijentId,
  lokacija,
}: {
  klijentId: string
  lokacija?: LokacijaRow
}) {
  const router = useRouter()
  const isEdit = !!lokacija
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    isEdit ? updateLokacija : createLokacija,
    initial,
  )
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  const trigger = isEdit ? (
    <Button variant="outline" size="sm" data-testid={`uredi-lokaciju-${lokacija.id}`}>
      Uredi
    </Button>
  ) : (
    <Button data-testid="nova-lokacija-btn">
      <Plus className="w-4 h-4" aria-hidden /> Nova lokacija
    </Button>
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent
        side="right"
        className="w-full lg:max-w-md flex flex-col"
        data-testid="lokacija-sheet"
      >
        <SheetHeader>
          <SheetTitle>{isEdit ? "Uredi lokaciju" : "Nova lokacija"}</SheetTitle>
        </SheetHeader>

        <form
          key={lokacija?.id ?? "new"}
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="lokacija-form"
        >
          {isEdit ? (
            <input type="hidden" name="id" value={lokacija.id} />
          ) : (
            <input type="hidden" name="klijent_id" value={klijentId} />
          )}

          {FIELDS.map(([name, label, req]) => (
            <label key={name} className="block text-sm">
              <span className="text-slate-600">{label}</span>
              <Input
                name={name}
                required={req}
                defaultValue={
                  isEdit
                    ? (lokacija[name as keyof LokacijaRow] as string | null | undefined) ?? ""
                    : ""
                }
                data-testid={`lokacija-${name}`}
              />
            </label>
          ))}

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending} data-testid="lokacija-submit">
            {pending ? "Spremam…" : isEdit ? "Spremi izmjene" : "Kreiraj lokaciju"}
          </Button>
        </form>

        <SheetFooter>
          <SheetClose render={<Button variant="outline">Otkaži</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
