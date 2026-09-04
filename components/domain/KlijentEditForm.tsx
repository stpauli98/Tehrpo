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
import { FieldError } from "@/components/domain/FieldError"
import { useAkcijaToast } from "@/components/akcija-toast"
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
    telefon?: string | null; email?: string | null; zaduzeni_korisnik_id?: string | null
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
  useAkcijaToast(state, { uspjeh: t("uspjeh"), greska: tc("greska") })

  // items mapa (value→label) za base-ui SelectValue — prikaz IMENA radnika kad je
  // select zatvoren (bez nje base-ui prikaže sirovu vrijednost = UUID).
  const nijePostavljeno = t("nijePostavljeno")
  const zaduzeniItems: Record<string, string> = {
    none: nijePostavljeno,
    ...Object.fromEntries(korisnici.map((k) => [k.id, k.ime])),
  }
  // Isti razlog i za tip odnosa — bez items mape zatvoren select prikaže sirovo
  // "none"/"ugovor"/"ponuda" umjesto prevoda.
  const tipOdnosaItems: Record<string, string> = {
    none: nijePostavljeno,
    ugovor: t("tipOdnosaOpcije.ugovor"),
    ponuda: t("tipOdnosaOpcije.ponuda"),
  }

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  if (!mozeUrediti) return null

  const errors = state.ok === false ? state.errors : undefined
  const opisano = (name: string) => (errors?.[name] ? `edit-klijent-${name}-err` : undefined)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="uredi-klijent-btn">
            <Pencil className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("dugme")}
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
            <span className="text-muted-foreground">{t("poljeNaziv")}</span>
            <Input
              name="naziv"
              required
              defaultValue={klijent.naziv}
              data-testid="edit-klijent-naziv"
              aria-describedby={opisano("naziv")}
            />
            <FieldError id="edit-klijent-naziv-err" errors={errors?.naziv} />
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeNapomena")}</span>
            <Input
              name="napomena"
              defaultValue={klijent.napomena ?? ""}
              data-testid="edit-klijent-napomena"
              aria-describedby={opisano("napomena")}
            />
            <FieldError id="edit-klijent-napomena-err" errors={errors?.napomena} />
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
              <span className="text-muted-foreground">{label}</span>
              <Input
                name={name}
                type={name === "email" ? "email" : "text"}
                required={obavezno}
                defaultValue={(klijent[name] as string | null | undefined) ?? ""}
                data-testid={`edit-klijent-${name}`}
                aria-describedby={opisano(name)}
              />
              <FieldError id={`edit-klijent-${name}-err`} errors={errors?.[name]} />
            </label>
          ))}

          <div className="space-y-1">
            <span className="block text-sm text-muted-foreground">{t("zaduzenaOsoba", { appName: APP_NAME })}</span>
            <Select name="zaduzeni_korisnik_id" defaultValue={klijent.zaduzeni_korisnik_id ?? "none"} items={zaduzeniItems}>
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
            <FieldError id="edit-klijent-zaduzeni-err" errors={errors?.zaduzeni_korisnik_id} />
          </div>

          <div className="space-y-1">
            <span className="block text-sm text-muted-foreground">{t("tipOdnosaLabel")}</span>
            <Select
              name="tip_odnosa"
              defaultValue={klijent.tip_odnosa ?? "none"}
              items={tipOdnosaItems}
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
            <FieldError id="edit-klijent-tip-odnosa-err" errors={errors?.tip_odnosa} />
          </div>

          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <DialogFooter className="mt-1">
            <DialogClose render={<Button type="button" variant="outline">{tc("otkazi")}</Button>} />
            <Button type="submit" disabled={pending} data-testid="edit-klijent-submit">
              {pending ? t("submitPending") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
