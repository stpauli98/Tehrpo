"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import Link from "next/link"
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

type Rezim = "vec_radeno" | "prvi_put"

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
  const [lokId, setLokId] = useState("")
  const [rezim, setRezim] = useState<Rezim>("vec_radeno")
  const [nacin, setNacin] = useState<"izvrsava" | "pracenje">("izvrsava")
  const [state, action, pending] = useActionState(createProfilProvjere, initial)
  const submitted = useRef(false)

  const vrstaItems: Record<string, string> = Object.fromEntries(vrste.map((v) => [v.id, v.naziv]))
  const lokItems: Record<string, string> = Object.fromEntries(lokacije.map((l) => [l.id, l.naziv]))
  const izabranaVrsta = vrste.find((v) => v.id === vrstaId)
  // Periodika je zaključana na podrazumijevani interval vrste (Postavke) — bez ručnog unosa.
  const interval = izabranaVrsta?.interval ?? null

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      setVrstaId(""); setLokId("")
      setRezim("vec_radeno")
      setNacin("izvrsava")
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button data-testid="dodaj-provjeru-btn"><Plus className="w-4 h-4" aria-hidden /> Dodaj provjeru</Button>} />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dodaj-provjeru-sheet">
        <DialogHeader><DialogTitle>Dodaj provjeru u profil</DialogTitle></DialogHeader>
        {lokacije.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="profil-bez-lokacija">
            Klijent nema nijednu lokaciju, a svaka provjera mora biti vezana za lokaciju.{" "}
            <Link href={`/klijenti/${klijentId}?tab=lokacije`} className="text-brand underline">
              Prvo unesite lokaciju klijenta.
            </Link>
          </p>
        ) : (
        <form
          action={(fd) => {
            fd.set("klijent_id", klijentId)
            fd.set("vrsta_provjere_id", vrstaId)
            fd.set("lokacija_id", lokId)
            fd.set("rezim", rezim)
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
            <span className="text-slate-600">Lokacija *</span>
            <Select value={lokId} onValueChange={(v) => setLokId(v ?? "")} items={lokItems}>
              <SelectTrigger className="w-full" data-testid="profil-lokacija"><SelectValue placeholder="Izaberi lokaciju" /></SelectTrigger>
              <SelectContent>
                {lokacije.map((l) => <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Interval (mjeseci) — povučeno iz vrste</span>
            <Input value={interval ?? ""} placeholder="Izaberi vrstu" disabled readOnly data-testid="profil-interval" />
          </label>
          {vrstaId && !interval && (
            <p className="text-sm text-status-kasni" role="alert" data-testid="profil-bez-intervala">
              Ova vrsta nema podrazumijevani interval — postavite ga u{" "}
              <Link href="/postavke" className="underline">Postavkama</Link> prije dodavanja u profil.
            </p>
          )}

          <label className="block text-sm">
            <span className="text-slate-600">Da li je provjera već rađena? *</span>
            <Select value={rezim} onValueChange={(v) => setRezim((v as Rezim) ?? "vec_radeno")} items={{ vec_radeno: "Da — unosim zadnji datum", prvi_put: "Ne — prvi put (unosim prvi rok)" }}>
              <SelectTrigger className="w-full" data-testid="profil-rezim"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vec_radeno">Da — unosim zadnji datum</SelectItem>
                <SelectItem value="prvi_put">Ne — prvi put (unosim prvi rok)</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {rezim === "vec_radeno" ? (
            <label className="block text-sm">
              <span className="text-slate-600">Zadnji put rađeno *</span>
              <Input name="zadnji_datum" type="date" required data-testid="profil-zadnji-datum" />
            </label>
          ) : (
            <label className="block text-sm">
              <span className="text-slate-600">Prvi rok *</span>
              <Input name="prvi_rok" type="date" required data-testid="profil-prvi-rok" />
            </label>
          )}

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

          <Button type="submit" disabled={pending || !vrstaId || !lokId || !interval} data-testid="profil-submit">
            {pending ? "Dodajem…" : "Dodaj i generiši termin"}
          </Button>
        </form>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
