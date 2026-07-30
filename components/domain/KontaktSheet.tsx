"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, Pencil } from "lucide-react"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { FieldError } from "@/components/domain/FieldError"
import { useAkcijaToast } from "@/components/akcija-toast"
import { createKontakt, updateKontakt, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"
import { useMozeUrediti } from "@/providers/korisnik-provider"

type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]
const initial: ActionResult = { ok: true }

export function KontaktSheet({
  klijentId,
  kontakt,
  lokacije = [],
}: {
  klijentId: string
  kontakt?: KontaktRow
  /** Lokacije te firme — prazan spisak sakriva polje (firma bez lokacija nema šta birati). */
  lokacije?: { id: string; naziv: string }[]
}) {
  const t = useTranslations("klijenti.kontaktSheet")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const isEdit = !!kontakt
  const [open, setOpen] = useState(false)
  // Firma bez ijedne lokacije nema šta birati → forma odmah nudi kreiranje nove.
  const [lokacijaIzbor, setLokacijaIzbor] = useState(lokacije.length > 0 ? "postojeca" : "nova")
  const [state, action, pending] = useActionState(isEdit ? updateKontakt : createKontakt, initial)
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

  // [name, label, obavezno, inputType] — email polje dobija type="email" da
  // browser uhvati nevalidan unos prije round-tripa (S2).
  const FIELDS: readonly [string, string, boolean, "text" | "email"][] = [
    ["ime", t("poljeIme"), true, "text"],
    ["funkcija", t("poljeFunkcija"), false, "text"],
    ["telefon", t("poljeTelefon"), false, "text"],
    ["email", t("poljeEmail"), false, "email"],
  ]

  // base-ui SelectValue prikazuje label iz mape kad je select zatvoren.
  const lokacijaItems: Record<string, string> = {
    "": t("lokacijaSve"),
    ...Object.fromEntries(lokacije.map((l) => [l.id, l.naziv])),
  }

  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; setOpen(false); router.refresh() }
  }, [state, pending, router])

  if (!mozeUrediti) return null

  const errors = state.ok === false ? state.errors : undefined

  const trigger = isEdit
    ? <Button variant="outline" size="icon-sm" data-testid={`uredi-kontakt-${kontakt.id}`} aria-label={t("uredi")} className="group/tt relative"><Pencil className="h-[18px] w-[18px] shrink-0" aria-hidden /><Tooltip>{t("uredi")}</Tooltip></Button>
    : <Button data-testid="novi-kontakt-btn"><Plus className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("novi")}</Button>

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="kontakt-sheet">
        <DialogHeader><DialogTitle>{isEdit ? t("naslovUredi") : t("naslovNovi")}</DialogTitle></DialogHeader>
        <form
          key={kontakt?.id ?? "new"}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="space-y-3"
          data-testid="kontakt-form"
        >
          {isEdit && <input type="hidden" name="id" value={kontakt.id} />}
          <input type="hidden" name="klijent_id" value={klijentId} />
          {FIELDS.map(([name, label, req, tip]) => (
            <label key={name} className="block text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Input
                name={name}
                type={tip}
                required={req}
                defaultValue={isEdit ? (kontakt[name as keyof KontaktRow] as string | null | undefined) ?? "" : ""}
                data-testid={`kontakt-${name}`}
                aria-describedby={errors?.[name] ? `kontakt-${name}-err` : undefined}
              />
              <FieldError id={`kontakt-${name}-err`} errors={errors?.[name]} />
            </label>
          ))}
          {/* Lokacija: prazna vrijednost = kontakt firme (prima za SVE lokacije).
              Izbor „Nova lokacija" postoji SAMO pri kreiranju — updateKontakt ne
              zna da kreira lokaciju, pa bi u edit formi prazno obavezno polje
              blokiralo snimanje nepovezanih izmjena, ili bi prelazak na „Nova"
              tiho izbrisao postojeću vezu (Select se ne renderuje → lokacija_id
              izostaje iz formData). Edit forma zato zadržava stari, prosti Select. */}
          {isEdit ? (
            lokacije.length > 0 && (
              <div className="space-y-1">
                <label className="block text-sm">
                  <span className="text-muted-foreground">{t("poljeLokacija")}</span>
                  <Select name="lokacija_id" defaultValue={kontakt?.lokacija_id ?? ""} items={lokacijaItems}>
                    <SelectTrigger className="w-full" data-testid="kontakt-lokacija">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t("lokacijaSve")}</SelectItem>
                      {lokacije.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <p className="text-xs text-muted-foreground">{t("lokacijaPomoc")}</p>
              </div>
            )
          ) : (
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("poljeLokacija")}
              </legend>
              <RadioGroup
                name="lokacija_izbor"
                value={lokacijaIzbor}
                onValueChange={(v) => setLokacijaIzbor(String(v))}
                data-testid="kontakt-lokacija-izbor"
              >
                {lokacije.length > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="postojeca" /> {t("lokacijaIzborPostojeca")}
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="nova" /> {t("lokacijaIzborNova")}
                </label>
              </RadioGroup>

              {lokacijaIzbor === "postojeca" && lokacije.length > 0 && (
                <Select name="lokacija_id" defaultValue="" items={lokacijaItems}>
                  <SelectTrigger className="w-full" data-testid="kontakt-lokacija">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t("lokacijaSve")}</SelectItem>
                    {lokacije.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {lokacijaIzbor === "nova" && (
                <div className="space-y-2">
                  <label className="block text-sm">
                    <span className="text-muted-foreground">{t("novaLokacijaNaziv")}</span>
                    <Input name="nova_lokacija_naziv" required data-testid="kontakt-nova-lokacija-naziv" />
                    <FieldError id="kontakt-nova-lokacija-naziv-err" errors={errors?.nova_lokacija_naziv} />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-sm">
                      <span className="text-muted-foreground">{t("novaLokacijaGrad")}</span>
                      <Input name="nova_lokacija_grad" data-testid="kontakt-nova-lokacija-grad" />
                    </label>
                    <label className="block text-sm">
                      <span className="text-muted-foreground">{t("novaLokacijaAdresa")}</span>
                      <Input name="nova_lokacija_adresa" data-testid="kontakt-nova-lokacija-adresa" />
                    </label>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {lokacijaIzbor === "nova" ? t("novaLokacijaPomoc") : t("lokacijaPomoc")}
              </p>
            </fieldset>
          )}
          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">{state.message}</p>
          )}
          <DialogFooter className="mt-1">
            <DialogClose render={<Button type="button" variant="outline">{tc("otkazi")}</Button>} />
            <Button type="submit" disabled={pending} data-testid="kontakt-submit">
              {pending ? t("submitPending") : isEdit ? t("submitEdit") : t("submitNovi")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
