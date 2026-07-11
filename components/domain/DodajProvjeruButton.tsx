"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { useAkcijaToast } from "@/components/akcija-toast"
import { createProfilProvjere, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { APP_NAME } from "@/lib/brand"
import { href } from "@/i18n/routes"
import { useMozeUrediti } from "@/providers/korisnik-provider"

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
  const t = useTranslations("termini.dodajProvjeru")
  const tc = useTranslations("common")
  const mozeUrediti = useMozeUrediti()
  const [open, setOpen] = useState(false)
  const [vrstaId, setVrstaId] = useState("")
  const [lokId, setLokId] = useState("")
  const [rezim, setRezim] = useState<Rezim>("vec_radeno")
  const [nacin, setNacin] = useState<"izvrsava" | "pracenje">("izvrsava")
  const [state, action, pending] = useActionState(createProfilProvjere, initial)
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

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

  if (!mozeUrediti) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button data-testid="dodaj-provjeru-btn"><Plus className="w-4 h-4" aria-hidden /> {t("dugme")}</Button>} />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dodaj-provjeru-sheet">
        <DialogHeader><DialogTitle>{t("naslov")}</DialogTitle></DialogHeader>
        {lokacije.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="profil-bez-lokacija">
            {t("bezLokacijaTekst")}{" "}
            <Link href={href(`/klijenti/${klijentId}?tab=lokacije`)} className="text-brand underline">
              {t("bezLokacijaLink")}
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
            <span className="text-muted-foreground">{t("poljeVrsta")}</span>
            <Select value={vrstaId} onValueChange={(v) => setVrstaId(v ?? "")} items={vrstaItems}>
              <SelectTrigger className="w-full" data-testid="profil-vrsta"><SelectValue placeholder={t("placeholderVrsta")} /></SelectTrigger>
              <SelectContent>
                {vrste.map((v) => <SelectItem key={v.id} value={v.id}>{v.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeLokacija")}</span>
            <Select value={lokId} onValueChange={(v) => setLokId(v ?? "")} items={lokItems}>
              <SelectTrigger className="w-full" data-testid="profil-lokacija"><SelectValue placeholder={t("placeholderLokacija")} /></SelectTrigger>
              <SelectContent>
                {lokacije.map((l) => <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeInterval")}</span>
            <Input value={interval ?? ""} placeholder={t("placeholderVrsta")} disabled readOnly data-testid="profil-interval" />
          </label>
          {vrstaId && !interval && (
            <p className="text-sm text-destructive" role="alert" data-testid="profil-bez-intervala">
              {t("bezIntervalaTekst")}{" "}
              <Link href={href("/postavke")} className="underline">{t("bezIntervalaLink")}</Link> {t("bezIntervalaKraj")}
            </p>
          )}

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeRadjenoRanije")}</span>
            <Select value={rezim} onValueChange={(v) => setRezim((v as Rezim) ?? "vec_radeno")} items={{ vec_radeno: t("opcijaVecRadeno"), prvi_put: t("opcijaPrviPut") }}>
              <SelectTrigger className="w-full" data-testid="profil-rezim"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vec_radeno">{t("opcijaVecRadeno")}</SelectItem>
                <SelectItem value="prvi_put">{t("opcijaPrviPut")}</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {rezim === "vec_radeno" ? (
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("poljeZadnjiDatum")}</span>
              <Input name="zadnji_datum" type="date" required data-testid="profil-zadnji-datum" />
            </label>
          ) : (
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("poljePrviRok")}</span>
              <Input name="prvi_rok" type="date" required data-testid="profil-prvi-rok" />
            </label>
          )}

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeNacinIzvrsenja")}</span>
            <Select value={nacin} onValueChange={(v) => setNacin((v as "izvrsava" | "pracenje") ?? "izvrsava")} items={{ izvrsava: t("nacinIzvrsava", { appName: APP_NAME }), pracenje: t("nacinPracenje") }}>
              <SelectTrigger className="w-full" data-testid="profil-nacin"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="izvrsava">{t("nacinIzvrsava", { appName: APP_NAME })}</SelectItem>
                <SelectItem value="pracenje">{t("nacinPracenje")}</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">{state.message}</p>
          )}

          <Button type="submit" disabled={pending || !vrstaId || !lokId || !interval} data-testid="profil-submit">
            {pending ? t("dodajem") : t("dodajIGenerisi")}
          </Button>
        </form>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
