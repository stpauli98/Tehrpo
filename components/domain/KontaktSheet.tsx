"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil } from "lucide-react"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
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
    ? <Button variant="outline" size="icon-sm" data-testid={`uredi-kontakt-${kontakt.id}`} aria-label="Uredi" className="group/tt relative"><Pencil className="h-4 w-4" aria-hidden /><Tooltip>Uredi</Tooltip></Button>
    : <Button data-testid="novi-kontakt-btn"><Plus className="w-4 h-4" aria-hidden /> Novi kontakt</Button>

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="kontakt-sheet">
        <DialogHeader><DialogTitle>{isEdit ? "Uredi kontakt" : "Novi kontakt"}</DialogTitle></DialogHeader>
        <form
          key={kontakt?.id ?? "new"}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="space-y-3"
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
        <DialogFooter><DialogClose render={<Button variant="outline">Otkaži</Button>} /></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
