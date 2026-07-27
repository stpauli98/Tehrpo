"use client"
import { useActionState, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { useAkcijaToast } from "@/components/akcija-toast"
import { kreirajKorisnika, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FieldError } from "./FieldError"
import { PoljeLozinke } from "./PoljeLozinke"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

const initial: ActionResult = { ok: true }

// Fiksni id-jevi FieldError kontejnera — komponenta je singleton na stranici,
// pa nema kolizije; `aria-describedby` se veže samo kad greška postoji (S2).
const ID_IME = "novi-korisnik-ime-greska"
const ID_EMAIL = "novi-korisnik-email-greska"
const ID_LOZINKA = "novi-korisnik-lozinka-greska"

export function NoviKorisnikButton() {
  const t = useTranslations("postavke.noviKorisnik")
  const [open, setOpen] = useState(false)
  // `instanca` remount-uje formu pri SVAKOM otvaranju: `useActionState` živi u
  // pod-komponenti, pa remount briše zaostale greške i vraća polja na prazno.
  const [instanca, setInstanca] = useState(0)
  const zatvori = useCallback(() => setOpen(false), [])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setInstanca((n) => n + 1)
        setOpen(o)
      }}
    >
      <DialogTrigger render={<Button size="sm"><Plus className="w-4 h-4" aria-hidden /> {t("dugme")}</Button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>{t("naslov")}</DialogTitle></DialogHeader>
        <NoviKorisnikForma key={instanca} onGotovo={zatvori} />
      </DialogContent>
    </Dialog>
  )
}

function NoviKorisnikForma({ onGotovo }: { onGotovo: () => void }) {
  const t = useTranslations("postavke.noviKorisnik")
  const tu = useTranslations("postavke.uloge")
  const tc = useTranslations("common")
  const router = useRouter()
  const [state, action, pending] = useActionState(kreirajKorisnika, initial)
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      onGotovo()
      router.refresh()
    }
  }, [state, pending, router, onGotovo])

  const greske = state.ok === false ? state.errors : undefined

  return (
    <form
      action={(fd) => {
        submitted.current = true
        action(fd)
      }}
      className="space-y-3"
    >
      <div>
        <label className="block text-sm">
          <span className="text-muted-foreground">{t("poljeIme")}</span>
          <Input
            name="ime"
            required
            placeholder={t("placeholderIme")}
            aria-describedby={greske?.ime ? ID_IME : undefined}
          />
        </label>
        <FieldError id={ID_IME} errors={greske?.ime} />
      </div>
      <div>
        <label className="block text-sm">
          <span className="text-muted-foreground">{t("poljeEmail")}</span>
          <Input
            name="email"
            type="email"
            required
            placeholder={t("placeholderEmail")}
            aria-describedby={greske?.email ? ID_EMAIL : undefined}
          />
        </label>
        <FieldError id={ID_EMAIL} errors={greske?.email} />
      </div>
      <div>
        <PoljeLozinke
          label={t("poljeLozinka")}
          name="lozinka"
          autoComplete="new-password"
          testid="novi-korisnik-lozinka"
          minLength={8}
          opisId={greske?.lozinka ? ID_LOZINKA : undefined}
          prikaziLabela={t("prikaziLozinku")}
          sakrijLabela={t("sakrijLozinku")}
        />
        <FieldError id={ID_LOZINKA} errors={greske?.lozinka} />
      </div>
      <div className="space-y-1.5">
        {/* Isti obrazac kao VrijemeSlanjaForm: <label htmlFor> + `id` na Select-u. */}
        <label htmlFor="novi-korisnik-uloga" className="block text-sm text-muted-foreground">
          {t("poljeUloga")}
        </label>
        <Select
          id="novi-korisnik-uloga"
          name="uloga"
          defaultValue="operater"
          items={{ operater: tu("operater"), pregled: tu("pregled"), admin: tu("admin") }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="operater">{tu("operater")}</SelectItem>
            <SelectItem value="pregled">{tu("pregled")}</SelectItem>
            <SelectItem value="admin">{tu("admin")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {state.ok === false && state.message && (
        <p className="text-sm text-destructive" role="alert">{state.message}</p>
      )}
      <Button type="submit" disabled={pending} className="w-full">{pending ? t("submitPending") : t("submit")}</Button>
    </form>
  )
}
