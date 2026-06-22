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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { createTermin, type ActionResult } from "@/app/(dashboard)/termini/actions"

type Opt = { id: string; naziv: string }
const initial: ActionResult = { ok: true }

export function NoviTerminButton({
  klijenti,
  vrste,
  lokacijeByFirma,
}: {
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [klijentId, setKlijentId] = useState("")
  const [vrstaId, setVrstaId] = useState("")
  const [lokacijaId, setLokacijaId] = useState("")
  const [state, action, pending] = useActionState(createTermin, initial)
  const submitted = useRef(false)

  const lokacije = klijentId ? lokacijeByFirma[klijentId] ?? [] : []

  // Zatvori sheet TEK nakon stvarnog submita koji je uspio (submitted ref
  // razlikuje uspjeh od initial { ok: true } stanja).
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      setKlijentId("")
      setVrstaId("")
      setLokacijaId("")
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button data-testid="novi-termin-btn">
            <Plus className="w-4 h-4" aria-hidden /> Novi termin
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full lg:max-w-md flex flex-col"
        data-testid="novi-termin-sheet"
      >
        <SheetHeader>
          <SheetTitle>Novi termin</SheetTitle>
        </SheetHeader>

        <form
          action={(fd) => {
            fd.set("klijent_id", klijentId)
            fd.set("vrsta_provjere_id", vrstaId)
            if (lokacijaId) fd.set("lokacija_id", lokacijaId)
            submitted.current = true
            action(fd)
          }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="novi-termin-form"
        >
          <label className="block text-sm">
            <span className="text-slate-600">Klijent *</span>
            <Select
              value={klijentId}
              onValueChange={(v) => {
                setKlijentId(v ?? "")
                setLokacijaId("") // reset lokacije kad se promijeni firma
              }}
            >
              <SelectTrigger data-testid="novi-klijent">
                <SelectValue placeholder="Izaberi klijenta" />
              </SelectTrigger>
              <SelectContent>
                {klijenti.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.naziv}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {lokacije.length > 0 && (
            <label className="block text-sm">
              <span className="text-slate-600">Lokacija</span>
              <Select value={lokacijaId} onValueChange={(v) => setLokacijaId(v ?? "")}>
                <SelectTrigger data-testid="novi-lokacija">
                  <SelectValue placeholder="Izaberi lokaciju (opcionalno)" />
                </SelectTrigger>
                <SelectContent>
                  {lokacije.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.naziv}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <label className="block text-sm">
            <span className="text-slate-600">Vrsta provjere *</span>
            <Select value={vrstaId} onValueChange={(v) => setVrstaId(v ?? "")}>
              <SelectTrigger data-testid="novi-vrsta">
                <SelectValue placeholder="Izaberi vrstu" />
              </SelectTrigger>
              <SelectContent>
                {vrste.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.naziv}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Rok dospijeća *</span>
            <Input type="date" name="rok_dospijeca" required data-testid="novi-rok" />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Datum zakazan</span>
            <Input type="date" name="datum_zakazan" data-testid="novi-zakazan" />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Zaduženi</span>
            <Input name="zaduzeni" placeholder="npr. Marija K." data-testid="novi-zaduzeni" />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending} data-testid="novi-submit">
            {pending ? "Kreiram…" : "Kreiraj termin"}
          </Button>
        </form>

        <SheetFooter>
          <SheetClose
            render={
              <Button variant="outline" data-testid="novi-cancel">
                Otkaži
              </Button>
            }
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
