"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, Repeat, TriangleAlert, Mail } from "lucide-react"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
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
import { useMozeUrediti, useUloga } from "@/providers/korisnik-provider"
import { jeAdmin } from "@/lib/auth/roles"

const initial: ActionResult = { ok: true }

type Rezim = "vec_radeno" | "prvi_put"

export function DodajProvjeruButton({
  klijentId, vrste, lokacije, admini,
}: {
  klijentId: string
  vrste: { id: string; naziv: string; interval: number | null }[]
  lokacije: { id: string; naziv: string }[]
  admini: { ime: string; email: string }[]
}) {
  const router = useRouter()
  const t = useTranslations("klijenti.dodajProvjeru")
  const tc = useTranslations("common")
  const mozeUrediti = useMozeUrediti()
  const uloga = useUloga()
  const korisnikJeAdmin = jeAdmin(uloga ?? "pregled")
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

  const imaLokacija = lokacije.length > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button data-testid="dodaj-provjeru-btn"><Plus className="w-4 h-4" aria-hidden /> {t("dugme")}</Button>} />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dodaj-provjeru-sheet">
        <DialogHeader>
          <DialogTitle>{t("naslov")}</DialogTitle>
          <DialogDescription>{t("opis")}</DialogDescription>
        </DialogHeader>
        {!imaLokacija ? (
          <>
            <p className="text-sm text-muted-foreground" data-testid="profil-bez-lokacija">
              {t("bezLokacijaTekst")}{" "}
              <Link href={href(`/klijenti/${klijentId}?tab=lokacije`)} className="text-brand underline underline-offset-2">
                {t("bezLokacijaLink")}
              </Link>
            </p>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline">{tc("otkazi")}</Button>} />
            </DialogFooter>
          </>
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
          className="space-y-4"
          data-testid="dodaj-provjeru-form"
        >
          <label className="block">
            <span className="text-sm font-medium text-foreground">{t("poljeVrsta")}</span>
            <Select value={vrstaId} onValueChange={(v) => setVrstaId(v ?? "")} items={vrstaItems}>
              <SelectTrigger className="mt-1.5 w-full" data-testid="profil-vrsta"><SelectValue placeholder={t("placeholderVrsta")} /></SelectTrigger>
              <SelectContent>
                {vrste.map((v) => <SelectItem key={v.id} value={v.id}>{v.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-foreground">{t("poljeLokacija")}</span>
            <Select value={lokId} onValueChange={(v) => setLokId(v ?? "")} items={lokItems}>
              <SelectTrigger className="mt-1.5 w-full" data-testid="profil-lokacija"><SelectValue placeholder={t("placeholderLokacija")} /></SelectTrigger>
              <SelectContent>
                {lokacije.map((l) => <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <div>
            <label className="block">
              <span className="text-sm font-medium text-foreground">{t("poljeInterval")}</span>
              <div className="relative mt-1.5">
                <Repeat className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={interval ?? ""}
                  placeholder={t("placeholderVrsta")}
                  disabled
                  readOnly
                  data-testid="profil-interval"
                  className="bg-muted/40 pl-9 font-semibold tabular-nums"
                />
              </div>
            </label>
            {vrstaId && !interval && (
              korisnikJeAdmin ? (
                <div className="mt-2 flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="profil-bez-intervala">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <p>
                    {t("bezIntervalaTekst")}{" "}
                    <Link href={href("/postavke")} className="font-medium underline underline-offset-2">{t("bezIntervalaLink")}</Link> {t("bezIntervalaKraj")}
                  </p>
                </div>
              ) : (
                <div className="mt-2 flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="profil-bez-intervala-operater">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <div className="space-y-2">
                    <p>{t("bezIntervalaOperater")}</p>
                    {admini.length > 0 && (
                      <ul className="space-y-1">
                        {admini.map((a) => (
                          <li key={a.email} className="flex items-center gap-2 text-foreground">
                            <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <a href={`mailto:${a.email}`} className="font-medium underline-offset-2 hover:underline">{a.ime}</a>
                            <span className="text-muted-foreground">{a.email}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            )}
          </div>

          <label className="block">
            <span className="text-sm font-medium text-foreground">{t("poljeRadjenoRanije")}</span>
            <Select value={rezim} onValueChange={(v) => setRezim((v as Rezim) ?? "vec_radeno")} items={{ vec_radeno: t("opcijaVecRadeno"), prvi_put: t("opcijaPrviPut") }}>
              <SelectTrigger className="mt-1.5 w-full" data-testid="profil-rezim"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vec_radeno">{t("opcijaVecRadeno")}</SelectItem>
                <SelectItem value="prvi_put">{t("opcijaPrviPut")}</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {rezim === "vec_radeno" ? (
            <label className="block">
              <span className="text-sm font-medium text-foreground">{t("poljeZadnjiDatum")}</span>
              <Input name="zadnji_datum" type="date" required data-testid="profil-zadnji-datum" className="mt-1.5" />
            </label>
          ) : (
            <label className="block">
              <span className="text-sm font-medium text-foreground">{t("poljePrviRok")}</span>
              <Input name="prvi_rok" type="date" required data-testid="profil-prvi-rok" className="mt-1.5" />
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-foreground">{t("poljeNacinIzvrsenja")}</span>
            <Select value={nacin} onValueChange={(v) => setNacin((v as "izvrsava" | "pracenje") ?? "izvrsava")} items={{ izvrsava: t("nacinIzvrsava", { appName: APP_NAME }), pracenje: t("nacinPracenje") }}>
              <SelectTrigger className="mt-1.5 w-full" data-testid="profil-nacin"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="izvrsava">{t("nacinIzvrsava", { appName: APP_NAME })}</SelectItem>
                <SelectItem value="pracenje">{t("nacinPracenje")}</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">{state.message}</p>
          )}

          <DialogFooter className="mt-1">
            <DialogClose render={<Button type="button" variant="outline">{tc("otkazi")}</Button>} />
            <Button type="submit" disabled={pending || !vrstaId || !lokId || !interval} data-testid="profil-submit">
              {pending ? t("dodajem") : t("dodajIGenerisi")}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
