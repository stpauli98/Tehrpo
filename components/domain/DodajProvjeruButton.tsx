"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { createProfilProvjere, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { APP_NAME } from "@/lib/brand"

const initial: ActionResult = { ok: true }

export function DodajProvjeruButton({
  klijentId, vrste, lokacije,
}: {
  klijentId: string
  vrste: { id: string; naziv: string; interval: number | null }[]
  lokacije: { id: string; naziv: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [vrstaId, setVrstaId] = useState("")
  const [lokId, setLokId] = useState("none")
  const [nacin, setNacin] = useState<"izvrsava" | "pracenje">("izvrsava")
  const [state, action, pending] = useActionState(createProfilProvjere, initial)
  const submitted = useRef(false)

  const vrstaItems: Record<string, string> = Object.fromEntries(vrste.map((v) => [v.id, v.naziv]))
  const lokItems: Record<string, string> = { none: "— bez lokacije —", ...Object.fromEntries(lokacije.map((l) => [l.id, l.naziv])) }
  const intervalPlaceholder = String(vrste.find((v) => v.id === vrstaId)?.interval ?? "")

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      setVrstaId(""); setLokId("none")
      setNacin("izvrsava")
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button data-testid="dodaj-provjeru-btn"><Plus className="w-4 h-4" aria-hidden /> Dodaj provjeru</Button>} />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dodaj-provjeru-sheet">
        <DialogHeader><DialogTitle>Dodaj provjeru u profil</DialogTitle></DialogHeader>
        <form
          action={(fd) => {
            fd.set("klijent_id", klijentId)
            fd.set("vrsta_provjere_id", vrstaId)
            fd.set("lokacija_id", lokId)
            fd.set("nacin_izvrsenja", nacin)
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="dodaj-provjeru-form"
        >
          <label className="block text-sm">
            <span className="text-slate-600">Vrsta *</span>
            <Select value={vrstaId} onValueChange={(v) => setVrstaId(v ?? "")} items={vrstaItems}>
              <SelectTrigger className="w-full" data-testid="profil-vrsta"><SelectValue placeholder="Izaberi vrstu" /></SelectTrigger>
              <SelectContent>
                {vrste.map((v) => <SelectItem key={v.id} value={v.id}>{v.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Lokacija</span>
            <Select value={lokId} onValueChange={(v) => setLokId(v ?? "none")} items={lokItems}>
              <SelectTrigger className="w-full" data-testid="profil-lokacija"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— bez lokacije —</SelectItem>
                {lokacije.map((l) => <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Interval (mjeseci) — prazno = podrazumevani vrste</span>
            <Input name="interval_mjeseci" type="number" min={1} max={120} placeholder={intervalPlaceholder || "npr. 12"} data-testid="profil-interval" />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Zadnji put rađeno *</span>
            <Input name="zadnji_datum" type="date" required data-testid="profil-zadnji-datum" />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Način izvršenja *</span>
            <Select value={nacin} onValueChange={(v) => setNacin((v as "izvrsava" | "pracenje") ?? "izvrsava")} items={{ izvrsava: `${APP_NAME} izvršava`, pracenje: "Samo praćenje roka" }}>
              <SelectTrigger className="w-full" data-testid="profil-nacin"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="izvrsava">{APP_NAME} izvršava</SelectItem>
                <SelectItem value="pracenje">Samo praćenje roka</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}

          <Button type="submit" disabled={pending || !vrstaId} data-testid="profil-submit">
            {pending ? "Dodajem…" : "Dodaj i generiši termin"}
          </Button>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
