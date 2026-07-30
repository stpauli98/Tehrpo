"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { FieldError } from "@/components/domain/FieldError"
import { ZaduzeniPolje } from "@/components/domain/ZaduzeniPolje"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { createTermin, type ActionResult } from "@/app/(dashboard)/termini/actions"
import { useAkcijaToast } from "@/components/akcija-toast"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import { useInvalidatePlanQueries } from "@/lib/queries/plan-invalidacije"
import { jeZakazanoPoslijeRoka, danaPoslijeRoka } from "@/lib/plan-datum"
import { formatDatum } from "@/lib/date"

export type Opt = { id: string; naziv: string }
type Greske = Record<string, string[] | undefined>
const initial: ActionResult = { ok: true }

export function NoviTerminDialog({
  open,
  onOpenChange,
  klijenti,
  vrste,
  lokacijeByFirma,
  zaduzeniPrijedloziByFirma,
  sviRadnici,
  defaultRok,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
  /** Imena korisnika koji imaju pristup toj firmi (za ne-admine i ograničenje na
   * serveru) — vidi docs/superpowers/specs/2026-07-29-zaduzeni-po-firmi-design.md. */
  zaduzeniPrijedloziByFirma: Record<string, string[]>
  /** Prazno za ne-admine; admin dobija sva aktivna imena (smije zadužiti bilo koga,
   * firma se radniku auto-dodijeli u termini/actions). */
  sviRadnici: string[]
  /** Prefill roka dospijeća (kalendar: klik na dan) — ISO `yyyy-mm-dd`. */
  defaultRok?: string
}) {
  const router = useRouter()
  const invalidirajPlan = useInvalidatePlanQueries()
  const t = useTranslations("termini.noviTermin")
  const tc = useTranslations("common")
  const tAkcije = useTranslations("termini.actions")
  const [klijentId, setKlijentId] = useState("")
  const [vrstaId, setVrstaId] = useState("")
  const [lokacijaId, setLokacijaId] = useState("")
  const [rok, setRok] = useState(defaultRok ?? "")
  const [zakazan, setZakazan] = useState("")
  // Podrazumijevano jednokratno: ad-hoc termin ne smije tiho postati trajna obaveza.
  const [ponavljanje, setPonavljanje] = useState("jednom")
  // S2: predvidive greške se hvataju prije round-tripa. base-ui Select nema native
  // `required`, pa obavezna polja provjeravamo ovdje; server (Zod) ostaje izvor istine.
  const [lokalneGreske, setLokalneGreske] = useState<Greske>({})
  const tz = useTranslations("termini.zakazanoUpozorenje")
  const [state, action, pending] = useActionState(createTermin, initial)
  const submitted = useRef(false)
  const mozeUrediti = useMozeUrediti()
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

  const lokacije = klijentId ? lokacijeByFirma[klijentId] ?? [] : []

  // Admin (sviRadnici popunjeno) bira iz svih aktivnih imena; ne-admin dobija samo
  // imena s pristupom izabranoj firmi — prazno dok firma nije izabrana (potvrđeno
  // u dizajnu), bez fallback-a na globalnu listu.
  const jeAdminLista = sviRadnici.length > 0
  const zaduzeniPrijedlozi = jeAdminLista
    ? sviRadnici
    : klijentId ? zaduzeniPrijedloziByFirma[klijentId] ?? [] : []

  // S2: `errors` idu isključivo inline (FieldError), `message` isključivo u toast.
  const greske: Greske = {
    ...(state.ok === false ? state.errors ?? {} : {}),
    ...lokalneGreske,
  }

  // items mape (value→label) za base-ui SelectValue (prikaz labele kad je zatvoreno)
  const klijentItems: Record<string, string> = Object.fromEntries(klijenti.map((k) => [k.id, k.naziv]))
  const vrstaItems: Record<string, string> = Object.fromEntries(vrste.map((v) => [v.id, v.naziv]))
  const lokacijaItems: Record<string, string> = Object.fromEntries(lokacije.map((l) => [l.id, l.naziv]))

  // Zatvori sheet TEK nakon stvarnog submita koji je uspio (submitted ref
  // razlikuje uspjeh od initial { ok: true } stanja).
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      onOpenChange(false)
      setKlijentId("")
      setVrstaId("")
      setLokacijaId("")
      setRok(defaultRok ?? "")
      setZakazan("")
      setPonavljanje("jednom")
      setLokalneGreske({})
      // Novi termin pripada i lista/matrica/kalendar prikazima; keševi su perzistentni
      // preko view-switch-a (staleTime 60s) pa ih invalidira dijeljeni hook.
      invalidirajPlan()
      router.refresh()
    }
  }, [state, pending, router, invalidirajPlan, onOpenChange, defaultRok])

  if (!mozeUrediti) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="novi-termin-sheet"
      >
        <DialogHeader>
          <DialogTitle>{t("dugme")}</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) => {
            const lokalne: Greske = {}
            if (!klijentId) lokalne.klijent_id = [tAkcije("klijentObavezan")]
            if (!vrstaId) lokalne.vrsta_provjere_id = [tAkcije("vrstaObavezna")]
            if (Object.keys(lokalne).length > 0) {
              setLokalneGreske(lokalne)
              return
            }
            setLokalneGreske({})
            fd.set("klijent_id", klijentId)
            fd.set("vrsta_provjere_id", vrstaId)
            if (lokacijaId) fd.set("lokacija_id", lokacijaId)
            if (ponavljanje === "ponavlja") fd.set("ponavlja_se", "on")
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="novi-termin-form"
        >
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeKlijent")}</span>
            <Select
              value={klijentId}
              onValueChange={(v) => {
                setKlijentId(v ?? "")
                setLokacijaId("") // reset lokacije kad se promijeni firma
              }}
              items={klijentItems}
            >
              <SelectTrigger
                className="w-full"
                data-testid="novi-klijent"
                aria-required
                aria-invalid={greske.klijent_id ? true : undefined}
                aria-describedby={greske.klijent_id ? "greska-novi-klijent" : undefined}
              >
                <SelectValue placeholder={t("placeholderKlijent")} />
              </SelectTrigger>
              <SelectContent>
                {klijenti.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    <span className="whitespace-normal">{k.naziv}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <FieldError id="greska-novi-klijent" errors={greske.klijent_id} />

          {lokacije.length > 0 && (
            <>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("poljeLokacija")}</span>
                <Select value={lokacijaId} onValueChange={(v) => setLokacijaId(v ?? "")} items={lokacijaItems}>
                  <SelectTrigger
                    className="w-full"
                    data-testid="novi-lokacija"
                    aria-invalid={greske.lokacija_id ? true : undefined}
                    aria-describedby={greske.lokacija_id ? "greska-novi-lokacija" : undefined}
                  >
                    <SelectValue placeholder={t("placeholderLokacija")} />
                  </SelectTrigger>
                  <SelectContent>
                    {lokacije.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        <span className="whitespace-normal">{l.naziv}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <FieldError id="greska-novi-lokacija" errors={greske.lokacija_id} />
            </>
          )}

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeVrsta")}</span>
            <Select value={vrstaId} onValueChange={(v) => setVrstaId(v ?? "")} items={vrstaItems}>
              <SelectTrigger
                className="w-full"
                data-testid="novi-vrsta"
                aria-required
                aria-invalid={greske.vrsta_provjere_id ? true : undefined}
                aria-describedby={greske.vrsta_provjere_id ? "greska-novi-vrsta" : undefined}
              >
                <SelectValue placeholder={t("placeholderVrsta")} />
              </SelectTrigger>
              <SelectContent>
                {vrste.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    <span className="whitespace-normal">{v.naziv}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <FieldError id="greska-novi-vrsta" errors={greske.vrsta_provjere_id} />

          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("ponavljanjeNaslov")}
            </legend>
            <RadioGroup
              value={ponavljanje}
              onValueChange={(v) => setPonavljanje(String(v ?? "jednom"))}
              data-testid="novi-termin-ponavljanje"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="jednom" /> {t("ponavljanjeJednom")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="ponavlja" /> {t("ponavljanjePonavlja")}
              </label>
            </RadioGroup>
            {ponavljanje === "ponavlja" && (
              <p className="text-xs text-muted-foreground">{t("ponavljanjePomoc")}</p>
            )}
          </fieldset>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeRok")}</span>
            <Input type="date" name="rok_dospijeca" required value={rok}
              aria-describedby={greske.rok_dospijeca ? "greska-novi-rok" : undefined}
              onChange={(e) => setRok(e.target.value)} data-testid="novi-rok" />
          </label>
          <FieldError id="greska-novi-rok" errors={greske.rok_dospijeca} />

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeDatumZakazan")}</span>
            <Input type="date" name="datum_zakazan" value={zakazan}
              aria-describedby={greske.datum_zakazan ? "greska-novi-zakazan" : undefined}
              onChange={(e) => setZakazan(e.target.value)} data-testid="novi-zakazan" />
          </label>
          <FieldError id="greska-novi-zakazan" errors={greske.datum_zakazan} />
          {jeZakazanoPoslijeRoka(rok, zakazan) && (
            <p className="text-xs text-warning" role="status" data-testid="zakazano-poslije-roka">
              {tz("poslijeRoka", { dana: danaPoslijeRoka(rok, zakazan), rok: formatDatum(rok) })}
            </p>
          )}

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeZaduzeni")}</span>
            <ZaduzeniPolje
              prijedlozi={zaduzeniPrijedlozi}
              placeholder={t("placeholderZaduzeni")}
              testId="novi-zaduzeni"
              describedBy={greske.zaduzeni ? "greska-novi-zaduzeni" : undefined}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {jeAdminLista ? t("zaduzeniHintAdmin") : t("zaduzeniHintRadnik")}
            </span>
          </label>
          <FieldError id="greska-novi-zaduzeni" errors={greske.zaduzeni} />

          <Button type="submit" disabled={pending} data-testid="novi-submit">
            {pending ? t("kreiram") : t("kreirajTermin")}
          </Button>
        </form>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" data-testid="novi-cancel">
                {tc("otkazi")}
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
