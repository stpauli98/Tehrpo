"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
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
import { useMozeUrediti } from "@/providers/korisnik-provider"

const initial: ActionResult = { ok: true }

// Minimalni prop type — edit forma treba samo id/naziv/napomena/... (ne created_at/updated_at),
// pa nema rekonstrukcije iz nullable klijenti_view sa `!` asercijama.
export function KlijentEditForm({
  klijent,
  korisnici,
}: {
  klijent: {
    id: string; naziv: string; napomena: string | null; tip_odnosa?: string | null
    adresa?: string | null; pib?: string | null; maticni_broj?: string | null; sifra_djelatnosti?: string | null
    telefon?: string | null; email?: string | null; zaduzeni_tehpro_id?: string | null
  }
  korisnici: { id: string; ime: string }[]
}) {
  const t = useTranslations("klijenti.uredi")
  const tc = useTranslations("common")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(updateKlijent, initial)
  const submitted = useRef(false)
  const mozeUrediti = useMozeUrediti()

  // items mapa (value→label) za base-ui SelectValue — prikaz IMENA radnika kad je
  // select zatvoren (bez nje base-ui prikaže sirovu vrijednost = UUID).
  const nijePostavljeno = t("nijePostavljeno")
  const zaduzeniItems: Record<string, string> = {
    none: nijePostavljeno,
    ...Object.fromEntries(korisnici.map((k) => [k.id, k.ime])),
  }

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  if (!mozeUrediti) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="uredi-klijent-btn">
            <Pencil className="w-3.5 h-3.5" aria-hidden /> {t("dugme")}
          </Button>
        }
      />
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="klijent-edit-sheet"
      >
        <DialogHeader>
          <DialogTitle>{t("naslov")}</DialogTitle>
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
            <span className="text-slate-600">{t("poljeNaziv")}</span>
            <Input
              name="naziv"
              required
              defaultValue={klijent.naziv}
              data-testid="edit-klijent-naziv"
            />
            {state.ok === false && state.errors?.naziv && (
              <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors.naziv[0]}</p>
            )}
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">{t("poljeNapomena")}</span>
            <Input
              name="napomena"
              defaultValue={klijent.napomena ?? ""}
              data-testid="edit-klijent-napomena"
            />
          </label>

          {([
            ["adresa", t("polja.adresa"), true],
            ["telefon", t("polja.telefon"), true],
            ["email", t("polja.email"), true],
            ["pib", t("polja.pib"), false],
            ["maticni_broj", t("polja.maticniBroj"), false],
            ["sifra_djelatnosti", t("polja.sifraDjelatnosti"), false],
          ] as const).map(([name, label, obavezno]) => (
            <label key={name} className="block text-sm">
              <span className="text-slate-600">{label}</span>
              <Input
                name={name}
                type={name === "email" ? "email" : "text"}
                required={obavezno}
                defaultValue={(klijent[name] as string | null | undefined) ?? ""}
                data-testid={`edit-klijent-${name}`}
              />
              {state.ok === false && state.errors?.[name] && (
                <p className="text-sm text-status-kasni mt-1" role="alert">{state.errors[name]![0]}</p>
              )}
            </label>
          ))}

          <div className="space-y-1">
            <span className="block text-sm text-slate-600">{t("zaduzenaOsoba", { appName: APP_NAME })}</span>
            <Select name="zaduzeni_tehpro_id" defaultValue={klijent.zaduzeni_tehpro_id ?? "none"} items={zaduzeniItems}>
              <SelectTrigger data-testid="edit-klijent-zaduzeni" className="w-full">
                <SelectValue placeholder={nijePostavljeno} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{nijePostavljeno}</SelectItem>
                {korisnici.map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.ime}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <span className="block text-sm text-slate-600">{t("tipOdnosaLabel")}</span>
            <Select
              name="tip_odnosa"
              defaultValue={klijent.tip_odnosa ?? "none"}
            >
              <SelectTrigger data-testid="klijent-tip-odnosa" className="w-full">
                <SelectValue placeholder={nijePostavljeno} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{nijePostavljeno}</SelectItem>
                <SelectItem value="ugovor">{t("tipOdnosaOpcije.ugovor")}</SelectItem>
                <SelectItem value="ponuda">{t("tipOdnosaOpcije.ponuda")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending} data-testid="edit-klijent-submit">
            {pending ? t("submitPending") : t("submit")}
          </Button>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
