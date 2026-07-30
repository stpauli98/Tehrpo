"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, Pencil } from "lucide-react"
import { Tooltip } from "@/components/ui/ikona-tooltip"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { FieldError } from "@/components/domain/FieldError"
import { useAkcijaToast } from "@/components/akcija-toast"
import { createLokacija, updateLokacija, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"
import { useMozeUrediti } from "@/providers/korisnik-provider"

type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

const initial: ActionResult = { ok: true }

export function LokacijaSheet({
  klijentId,
  lokacija,
  kontakti = [],
  slanjeUgaseno = false,
}: {
  klijentId: string
  lokacija?: LokacijaRow
  /**
   * Kontakti te firme. Ponuđeni su samo oni koji NISU već vezani za drugu lokaciju —
   * kontakt pripada najviše jednoj lokaciji, pa bi ostali samo zbunjivali.
   */
  kontakti?: { id: string; ime: string; lokacija_id: string | null }[]
  /** Oba prekidača (globalni + per-firma) nisu uključena → checkbox podsjetnika je bez efekta. */
  slanjeUgaseno?: boolean
}) {
  const t = useTranslations("klijenti.lokacijaSheet")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const isEdit = !!lokacija
  // "bez" | "postojeci" | "novi" — određuje šta server akcija radi poslije upisa lokacije.
  const [kontaktIzbor, setKontaktIzbor] = useState("bez")
  // Kontakt pripada najviše jednoj lokaciji: nudimo one bez veze i one već vezane
  // za OVU lokaciju (kod uređivanja), da izbor ne bude prazan bez objašnjenja.
  const slobodniKontakti = kontakti.filter(
    (k) => k.lokacija_id === null || k.lokacija_id === lokacija?.id,
  )
  const kontaktItems: Record<string, string> = Object.fromEntries(
    slobodniKontakti.map((k) => [k.id, k.ime]),
  )

  // [name, label, obavezno, inputType]. Kontakt polja su uklonjena 2026-07-30 —
  // kontakt lokacije živi isključivo u kontakt_osobe (fieldset ispod).
  const FIELDS: readonly [string, string, boolean, "text" | "email" | "tel"][] = [
    ["naziv", t("poljeNaziv"), true, "text"],
    ["grad", t("poljeGrad"), false, "text"],
    ["regija", t("poljeRegija"), false, "text"],
    ["adresa", t("poljeAdresa"), false, "text"],
  ]
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    isEdit ? updateLokacija : createLokacija,
    initial,
  )
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  if (!mozeUrediti) return null

  const errors = state.ok === false ? state.errors : undefined

  const trigger = isEdit ? (
    <Button variant="outline" size="icon-sm" data-testid={`uredi-lokaciju-${lokacija.id}`} aria-label={t("uredi")} className="group/tt relative">
      <Pencil className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <Tooltip>{t("uredi")}</Tooltip>
    </Button>
  ) : (
    <Button data-testid="nova-lokacija-btn">
      <Plus className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("novi")}
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="lokacija-sheet"
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? t("naslovUredi") : t("naslovNovi")}</DialogTitle>
        </DialogHeader>

        <form
          key={lokacija?.id ?? "new"}
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="lokacija-form"
        >
          {isEdit ? (
            <input type="hidden" name="id" value={lokacija.id} />
          ) : (
            <input type="hidden" name="klijent_id" value={klijentId} />
          )}

          {FIELDS.map(([name, label, req, tip]) => (
            <label key={name} className="block text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Input
                name={name}
                type={tip}
                required={req}
                defaultValue={
                  isEdit
                    ? (lokacija[name as keyof LokacijaRow] as string | null | undefined) ?? ""
                    : ""
                }
                data-testid={`lokacija-${name}`}
                aria-describedby={errors?.[name] ? `lokacija-${name}-err` : undefined}
              />
              <FieldError id={`lokacija-${name}-err`} errors={errors?.[name]} />
            </label>
          ))}

          {/* Kontakt za lokaciju. Nova lokacija po pravilu znači i novog čovjeka na njoj,
              pa se veza nudi odmah — inače bi korisnik morao u drugi tab i tražiti kontakt.
              Vezan kontakt prima podsjetnike SAMO za ovu lokaciju; kontakti firme ih
              dobijaju svakako (v. firmaRecipientsZa). */}
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("kontaktNaslov")}
            </legend>
            <RadioGroup
              name="kontakt_izbor"
              value={kontaktIzbor}
              onValueChange={(v) => setKontaktIzbor(String(v))}
              data-testid="lokacija-kontakt-izbor"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="bez" /> {t("kontaktBez")}
              </label>
              {slobodniKontakti.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="postojeci" /> {t("kontaktPostojeci")}
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="novi" /> {t("kontaktNovi")}
              </label>
            </RadioGroup>

            {kontaktIzbor === "postojeci" && slobodniKontakti.length > 0 && (
              <Select name="kontakt_id" defaultValue={slobodniKontakti[0]?.id ?? ""} items={kontaktItems}>
                <SelectTrigger className="w-full" data-testid="lokacija-kontakt-postojeci">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {slobodniKontakti.map((k) => (
                    <SelectItem key={k.id} value={k.id}>{k.ime}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {kontaktIzbor === "novi" && (
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="text-muted-foreground">{t("kontaktIme")}</span>
                  <Input name="kontakt_ime" required data-testid="lokacija-kontakt-ime" />
                  <FieldError id="lokacija-kontakt-ime-err" errors={errors?.kontakt_ime} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    <span className="text-muted-foreground">{t("poljeEmail")}</span>
                    <Input name="kontakt_novi_email" type="email" data-testid="lokacija-kontakt-email" />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted-foreground">{t("poljeTelefon")}</span>
                    <Input name="kontakt_novi_telefon" data-testid="lokacija-kontakt-telefon" />
                  </label>
                </div>
              </div>
            )}

            {kontaktIzbor !== "bez" && (
              <div className="space-y-1">
                {/* Onemogućen checkbox ne šalje NIKAKVU vrijednost — bez ovog skrivenog
                    polja server ne bi mogao razlikovati "korisnik je namjerno isključio"
                    od "kontrola je zaključana" i bi tiho pregazio postojeći true na false. */}
                {slanjeUgaseno && <input type="hidden" name="kontakt_prima_zakljucan" value="1" />}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="kontakt_prima"
                    value="1"
                    defaultChecked={!slanjeUgaseno}
                    disabled={slanjeUgaseno}
                    data-testid="lokacija-kontakt-prima"
                    aria-describedby={slanjeUgaseno ? "lokacija-kontakt-prima-ugaseno" : undefined}
                    className="size-4 rounded border-input disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className={slanjeUgaseno ? "text-muted-foreground" : undefined}>
                    {t("kontaktPrima")}
                  </span>
                </label>
                {slanjeUgaseno && (
                  <p
                    id="lokacija-kontakt-prima-ugaseno"
                    className="text-xs text-muted-foreground"
                    data-testid="lokacija-kontakt-prima-ugaseno"
                  >
                    {t("kontaktPrimaUgaseno")}
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("kontaktPomoc")}</p>
          </fieldset>

          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <DialogFooter className="mt-1">
            <DialogClose render={<Button type="button" variant="outline">{tc("otkazi")}</Button>} />
            <Button type="submit" disabled={pending} data-testid="lokacija-submit">
              {pending ? t("submitPending") : isEdit ? t("submitEdit") : t("submitNovi")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
