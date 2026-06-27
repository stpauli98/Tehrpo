"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createUgovor, updateUgovor, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
const initial: ActionResult = { ok: true }

export function UgovorSheet({ klijentId, ugovor }: { klijentId: string; ugovor?: UgovorRow }) {
  const router = useRouter()
  const isEdit = !!ugovor
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(isEdit ? updateUgovor : createUgovor, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  const trigger = isEdit
    ? <Button variant="outline" size="sm" data-testid={`uredi-ugovor-${ugovor.id}`}>Uredi</Button>
    : <Button data-testid="novi-ugovor-btn"><Plus className="w-4 h-4" aria-hidden /> Novi ugovor</Button>

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="ugovor-sheet">
        <SheetHeader><SheetTitle>{isEdit ? "Uredi ugovor" : "Novi ugovor"}</SheetTitle></SheetHeader>
        <form
          key={ugovor?.id ?? "new"}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="ugovor-form"
        >
          {isEdit && <input type="hidden" name="id" value={ugovor.id} />}
          <input type="hidden" name="klijent_id" value={klijentId} />

          <label className="block text-sm">
            <span className="text-slate-600">Zavodni broj (broj ugovora)</span>
            <Input name="zavodni_broj" defaultValue={ugovor?.zavodni_broj ?? ""} data-testid="ugovor-zavodni" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">Datum potpisivanja</span>
              <Input type="date" name="datum_potpisivanja" defaultValue={ugovor?.datum_potpisivanja ?? ""} data-testid="ugovor-potpis" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Datum isteka</span>
              <Input type="date" name="datum_isteka" defaultValue={ugovor?.datum_isteka ?? ""} data-testid="ugovor-istek" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Važenje (mjeseci)</span>
              <Input type="number" min={1} max={600} name="vazenje_mjeseci" defaultValue={ugovor?.vazenje_mjeseci ?? ""} data-testid="ugovor-vazenje" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Obilazaka / mjesec</span>
              <Input type="number" min={0} max={31} name="broj_obilazaka_mjesecno" defaultValue={ugovor?.broj_obilazaka_mjesecno ?? ""} data-testid="ugovor-obilasci" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="automatsko_obnavljanje" defaultChecked={ugovor?.automatsko_obnavljanje ?? false} data-testid="ugovor-auto" />
            <span className="text-slate-600">Automatsko obnavljanje</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="aktivan" defaultChecked={ugovor?.aktivan ?? true} data-testid="ugovor-aktivan" />
            <span className="text-slate-600">Aktivan ugovor (deaktivira ostale)</span>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Napomena</span>
            <Input name="napomena" defaultValue={ugovor?.napomena ?? ""} data-testid="ugovor-napomena" />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="ugovor-submit">
            {pending ? "Spremam…" : isEdit ? "Spremi izmjene" : "Kreiraj ugovor"}
          </Button>
        </form>
        <SheetFooter><SheetClose render={<Button variant="outline">Otkaži</Button>} /></SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
