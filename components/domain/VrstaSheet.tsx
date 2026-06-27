"use client"

import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateVrsta, postaviVrstaAktivna, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function VrstaSheet({
  vrsta,
}: {
  vrsta: { id: string; naziv: string; interval: number | null; zakonski_osnov: string | null; aktivna: boolean; vodi_dokumentaciju: boolean }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(updateVrsta, initial)
  const submitted = useRef(false)
  const [togglePending, startToggle] = useTransition()

  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; setOpen(false); router.refresh() }
  }, [state, pending, router])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <Button variant="outline" size="sm" data-testid={`uredi-vrstu-${vrsta.id}`}>
          <Pencil className="w-3.5 h-3.5" aria-hidden /> Uredi
        </Button>
      } />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="vrsta-sheet">
        <SheetHeader><SheetTitle>Uredi vrstu pregleda</SheetTitle></SheetHeader>
        <form
          key={vrsta.id}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="vrsta-form"
        >
          <input type="hidden" name="id" value={vrsta.id} />
          <label className="block text-sm">
            <span className="text-slate-600">Naziv *</span>
            <Input name="naziv" required defaultValue={vrsta.naziv} data-testid="vrsta-naziv" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Interval (mjeseci)</span>
            <Input name="interval" type="number" min={1} max={120} defaultValue={vrsta.interval ?? ""} placeholder="prazno = bez auto-zakazivanja" data-testid="vrsta-interval" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Zakonski osnov</span>
            <Input name="zakonski_osnov" defaultValue={vrsta.zakonski_osnov ?? ""} data-testid="vrsta-osnov" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="vodi_dokumentaciju" defaultChecked={vrsta.vodi_dokumentaciju} data-testid="vrsta-vodi-dok" />
            <span className="text-slate-600">Za ovu uslugu se vodi dokumentacija</span>
          </label>
          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="vrsta-submit">
            {pending ? "Spremam…" : "Spremi izmjene"}
          </Button>
        </form>
        <SheetFooter className="flex-row justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={togglePending}
            data-testid="vrsta-toggle-aktivna"
            className={vrsta.aktivna ? "text-red-600 border-red-200 hover:bg-red-50" : "text-green-700 border-green-200 hover:bg-green-50"}
            onClick={() => startToggle(async () => { await postaviVrstaAktivna(vrsta.id, !vrsta.aktivna); router.refresh() })}
          >
            {vrsta.aktivna ? "Deaktiviraj" : "Aktiviraj"}
          </Button>
          <SheetClose render={<Button variant="outline">Zatvori</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
