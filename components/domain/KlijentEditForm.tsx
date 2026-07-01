"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { APP_NAME } from "@/lib/brand"
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
import { updateKlijent, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

const initial: ActionResult = { ok: true }

// Minimalni prop type — edit forma treba samo id/naziv/napomena/podsjetnik_emails (ne created_at/updated_at),
// pa nema rekonstrukcije iz nullable klijenti_view sa `!` asercijama.
export function KlijentEditForm({
  klijent,
  korisnici,
}: {
  klijent: {
    id: string; naziv: string; napomena: string | null; podsjetnik_emails: string[]; tip_odnosa?: string | null
    adresa?: string | null; pib?: string | null; maticni_broj?: string | null; sifra_djelatnosti?: string | null
    telefon?: string | null; email?: string | null; zaduzeni_tehpro_id?: string | null
  }
  korisnici: { id: string; ime: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(updateKlijent, initial)
  const submitted = useRef(false)

  // items mapa (value→label) za base-ui SelectValue — prikaz IMENA radnika kad je
  // select zatvoren (bez nje base-ui prikaže sirovu vrijednost = UUID).
  const zaduzeniItems: Record<string, string> = {
    none: "— (nije postavljeno)",
    ...Object.fromEntries(korisnici.map((k) => [k.id, k.ime])),
  }

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="uredi-klijent-btn">
            <Pencil className="w-3.5 h-3.5" aria-hidden /> Uredi
          </Button>
        }
      />
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="klijent-edit-sheet"
      >
        <DialogHeader>
          <DialogTitle>Uredi klijenta</DialogTitle>
        </DialogHeader>

        <form
          // Potpis svih vrijednosti: kad se podaci promijene nakon router.refresh(),
          // forma se remountuje umjesto da mijenja defaultValue uncontrolled polja
          // (inače base-ui javlja "changing default value of uncontrolled ...").
          key={JSON.stringify(klijent)}
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="klijent-edit-form"
        >
          <input type="hidden" name="id" value={klijent.id} />

          <label className="block text-sm">
            <span className="text-slate-600">Naziv *</span>
            <Input
              name="naziv"
              required
              defaultValue={klijent.naziv}
              data-testid="edit-klijent-naziv"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Napomena</span>
            <Input
              name="napomena"
              defaultValue={klijent.napomena ?? ""}
              data-testid="edit-klijent-napomena"
            />
          </label>

          {([
            ["adresa", "Adresa"],
            ["telefon", "Telefon"],
            ["email", "Email"],
            ["pib", "PIB"],
            ["maticni_broj", "Matični broj"],
            ["sifra_djelatnosti", "Šifra djelatnosti"],
          ] as const).map(([name, label]) => (
            <label key={name} className="block text-sm">
              <span className="text-slate-600">{label}</span>
              <Input
                name={name}
                defaultValue={(klijent[name] as string | null | undefined) ?? ""}
                data-testid={`edit-klijent-${name}`}
              />
            </label>
          ))}

          <div className="space-y-1">
            <span className="block text-sm text-slate-600">Zadužena osoba ({APP_NAME})</span>
            <Select name="zaduzeni_tehpro_id" defaultValue={klijent.zaduzeni_tehpro_id ?? "none"} items={zaduzeniItems}>
              <SelectTrigger data-testid="edit-klijent-zaduzeni" className="w-full">
                <SelectValue placeholder="— (nije postavljeno)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— (nije postavljeno)</SelectItem>
                {korisnici.map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.ime}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="block text-sm">
            <span className="text-slate-600">Primaoci podsjetnika (email, odvojeni zarezom)</span>
            <Input
              name="podsjetnik_emails"
              defaultValue={klijent.podsjetnik_emails.join(", ")}
              placeholder="npr. sef@firma.com, tehnicar@firma.com"
              data-testid="edit-klijent-primaoci"
            />
          </label>

          <div className="space-y-1">
            <span className="block text-sm text-slate-600">Tip odnosa</span>
            <Select
              name="tip_odnosa"
              defaultValue={klijent.tip_odnosa ?? "none"}
            >
              <SelectTrigger data-testid="klijent-tip-odnosa" className="w-full">
                <SelectValue placeholder="— (nije postavljeno)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— (nije postavljeno)</SelectItem>
                <SelectItem value="ugovor">Po ugovoru</SelectItem>
                <SelectItem value="ponuda">Po ponudi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending} data-testid="edit-klijent-submit">
            {pending ? "Spremam…" : "Spremi izmjene"}
          </Button>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
