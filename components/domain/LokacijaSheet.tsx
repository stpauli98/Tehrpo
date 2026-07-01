"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil } from "lucide-react"
import { Tooltip } from "@/components/ui/ikona-tooltip"
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
    <Button variant="outline" size="icon-sm" data-testid={`uredi-lokaciju-${lokacija.id}`} aria-label="Uredi" className="group/tt relative">
      <Pencil className="h-4 w-4" aria-hidden />
      <Tooltip>Uredi</Tooltip>
    </Button>
  ) : (
    <Button data-testid="nova-lokacija-btn">
      <Plus className="w-4 h-4" aria-hidden /> Nova lokacija
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="lokacija-sheet"
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Uredi lokaciju" : "Nova lokacija"}</DialogTitle>
        </DialogHeader>

        <form
          key={lokacija?.id ?? "new"}
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
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

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
