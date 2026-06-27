"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createKontakt, updateKontakt, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]
const initial: ActionResult = { ok: true }

const FIELDS: readonly [string, string, boolean][] = [
  ["ime", "Ime i prezime *", true],
  ["funkcija", "Funkcija", false],
  ["telefon", "Telefon", false],
  ["email", "Email", false],
]

export function KontaktSheet({ klijentId, kontakt }: { klijentId: string; kontakt?: KontaktRow }) {
  const router = useRouter()
  const isEdit = !!kontakt
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(isEdit ? updateKontakt : createKontakt, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; setOpen(false); router.refresh() }
  }, [state, pending, router])

  const trigger = isEdit
    ? <Button variant="outline" size="sm" data-testid={`uredi-kontakt-${kontakt.id}`}>Uredi</Button>
    : <Button data-testid="novi-kontakt-btn"><Plus className="w-4 h-4" aria-hidden /> Novi kontakt</Button>

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="kontakt-sheet">
        <SheetHeader><SheetTitle>{isEdit ? "Uredi kontakt" : "Novi kontakt"}</SheetTitle></SheetHeader>
        <form
          key={kontakt?.id ?? "new"}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="kontakt-form"
        >
          {isEdit && <input type="hidden" name="id" value={kontakt.id} />}
          <input type="hidden" name="klijent_id" value={klijentId} />
          {FIELDS.map(([name, label, req]) => (
            <label key={name} className="block text-sm">
              <span className="text-slate-600">{label}</span>
              <Input
                name={name}
                required={req}
                defaultValue={isEdit ? (kontakt[name as keyof KontaktRow] as string | null | undefined) ?? "" : ""}
                data-testid={`kontakt-${name}`}
              />
            </label>
          ))}
          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="kontakt-submit">
            {pending ? "Spremam…" : isEdit ? "Spremi izmjene" : "Kreiraj kontakt"}
          </Button>
        </form>
        <SheetFooter><SheetClose render={<Button variant="outline">Otkaži</Button>} /></SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
