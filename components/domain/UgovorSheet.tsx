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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { FieldError } from "@/components/domain/FieldError"
import { useAkcijaToast } from "@/components/akcija-toast"
import { createUgovor, updateUgovor, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { VAZENJE_PRESETI, normalizujVazenje } from "@/lib/ugovori-vazenje"
import type { Database } from "@/db/types"
import { useMozeUrediti } from "@/providers/korisnik-provider"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
const initial: ActionResult = { ok: true }

export function UgovorSheet({ klijentId, ugovor }: { klijentId: string; ugovor?: UgovorRow }) {
  const t = useTranslations("klijenti.ugovorSheet")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const isEdit = !!ugovor
  const [open, setOpen] = useState(false)
  // „na neodređeno" gasi i datum isteka i trajanje u mjesecima.
  const [naNeodredjeno, setNaNeodredjeno] = useState(ugovor?.na_neodredjeno ?? false)
  // Zatečena vrijednost koja nije u presetima → forma se otvara u „custom" grani.
  const zatecenoVazenje = ugovor?.vazenje_mjeseci ?? null
  const zatecenoJePreset =
    zatecenoVazenje != null && (VAZENJE_PRESETI as readonly number[]).includes(zatecenoVazenje)
  const [vazenjeIzbor, setVazenjeIzbor] = useState(
    ugovor?.na_neodredjeno ? "neodredjeno"
      : zatecenoVazenje == null ? ""
      : zatecenoJePreset ? String(zatecenoVazenje)
      : "custom",
  )
  const [vazenjeCustom, setVazenjeCustom] = useState(
    zatecenoVazenje != null && !zatecenoJePreset ? String(zatecenoVazenje) : "",
  )
  const vazenjeGreska = normalizujVazenje(vazenjeIzbor, vazenjeCustom).greska
  const [state, action, pending] = useActionState(isEdit ? updateUgovor : createUgovor, initial)
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

  // Field-greške servera (S2) — bez ovoga errors-only rezultat nema nikakav
  // feedback (odlukaToast namjerno ne toasta field greške).
  const errors = state.ok === false ? state.errors : undefined
  const errId = (name: string) => `ugovor-${name}-err`
  const opisano = (name: string) => (errors?.[name] ? errId(name) : undefined)

  // base-ui SelectValue prikazuje labelu iz mape kad je select zatvoren.
  const vazenjeItems: Record<string, string> = {
    ...Object.fromEntries(VAZENJE_PRESETI.map((m) => [String(m), t("vazenjePreset", { count: m })])),
    custom: t("vazenjeCustom"),
    neodredjeno: t("vazenjeNeodredjeno"),
  }

  const trigger = isEdit
    ? <Button variant="outline" size="icon-sm" data-testid={`uredi-ugovor-${ugovor.id}`} aria-label={t("uredi")} className="group/tt relative"><Pencil className="h-[18px] w-[18px] shrink-0" aria-hidden /><Tooltip>{t("uredi")}</Tooltip></Button>
    : <Button data-testid="novi-ugovor-btn"><Plus className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("novi")}</Button>

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="ugovor-sheet">
        <DialogHeader><DialogTitle>{isEdit ? t("naslovUredi") : t("naslovNovi")}</DialogTitle></DialogHeader>
        <form
          key={ugovor?.id ?? "new"}
          action={(fd) => {
            const { vazenje, greska } = normalizujVazenje(vazenjeIzbor, vazenjeCustom)
            if (greska) return // poruka se već prikazuje inline
            fd.set("vazenje_mjeseci", vazenje == null ? "" : String(vazenje))
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="ugovor-form"
        >
          {isEdit && <input type="hidden" name="id" value={ugovor.id} />}
          <input type="hidden" name="klijent_id" value={klijentId} />

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeZavodniBroj")}</span>
            <Input name="zavodni_broj" defaultValue={ugovor?.zavodni_broj ?? ""} data-testid="ugovor-zavodni" aria-describedby={opisano("zavodni_broj")} />
            <FieldError id={errId("zavodni_broj")} errors={errors?.zavodni_broj} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("poljeDatumPotpisivanja")}</span>
              <Input type="date" name="datum_potpisivanja" defaultValue={ugovor?.datum_potpisivanja ?? ""} data-testid="ugovor-potpis" aria-describedby={opisano("datum_potpisivanja")} />
              <FieldError id={errId("datum_potpisivanja")} errors={errors?.datum_potpisivanja} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("poljeDatumIsteka")}</span>
              <Input
                type="date"
                name="datum_isteka"
                defaultValue={ugovor?.datum_isteka ?? ""}
                disabled={naNeodredjeno}
                data-testid="ugovor-istek"
                aria-describedby={opisano("datum_isteka")}
              />
              <FieldError id={errId("datum_isteka")} errors={errors?.datum_isteka} />
            </label>
            <div className="space-y-1 text-sm">
              <span className="block text-muted-foreground">{t("poljeVazenje")}</span>
              <Select
                value={vazenjeIzbor}
                onValueChange={(v) => {
                  const iz = String(v ?? "")
                  setVazenjeIzbor(iz)
                  // Dropdown i checkbox su jedan te isti izbor — drži ih usaglašenim.
                  setNaNeodredjeno(iz === "neodredjeno")
                }}
                items={vazenjeItems}
              >
                <SelectTrigger className="w-full" data-testid="ugovor-vazenje">
                  <SelectValue placeholder={t("vazenjeOdaberi")} />
                </SelectTrigger>
                <SelectContent>
                  {VAZENJE_PRESETI.map((m) => (
                    <SelectItem key={m} value={String(m)}>{t("vazenjePreset", { count: m })}</SelectItem>
                  ))}
                  <SelectItem value="custom">{t("vazenjeCustom")}</SelectItem>
                  <SelectItem value="neodredjeno">{t("vazenjeNeodredjeno")}</SelectItem>
                </SelectContent>
              </Select>
              {vazenjeIzbor === "custom" && (
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={vazenjeCustom}
                  onChange={(e) => setVazenjeCustom(e.target.value)}
                  data-testid="ugovor-vazenje-custom"
                  aria-invalid={vazenjeGreska ? true : undefined}
                  aria-describedby={vazenjeGreska ? "ugovor-vazenje-custom-err" : undefined}
                />
              )}
              {vazenjeGreska && (
                <p id="ugovor-vazenje-custom-err" className="text-sm text-destructive" role="alert">
                  {t("vazenjeGreskaOpseg")}
                </p>
              )}
              <FieldError id={errId("vazenje_mjeseci")} errors={errors?.vazenje_mjeseci} />
            </div>
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("poljeObilasci")}</span>
              <Input type="number" min={0} max={31} name="broj_obilazaka_mjesecno" defaultValue={ugovor?.broj_obilazaka_mjesecno ?? ""} data-testid="ugovor-obilasci" aria-describedby={opisano("broj_obilazaka_mjesecno")} />
              <FieldError id={errId("broj_obilazaka_mjesecno")} errors={errors?.broj_obilazaka_mjesecno} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              name="na_neodredjeno"
              value="on"
              checked={naNeodredjeno}
              onCheckedChange={(v) => {
                const b = Boolean(v)
                setNaNeodredjeno(b)
                setVazenjeIzbor(b ? "neodredjeno" : "")
              }}
              data-testid="ugovor-neodredjeno"
            />
            <span className="text-muted-foreground">{t("poljeNaNeodredjeno")}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="automatsko_obnavljanje" value="on" defaultChecked={ugovor?.automatsko_obnavljanje ?? false} data-testid="ugovor-auto" />
            <span className="text-muted-foreground">{t("poljeAutoObnavljanje")}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="aktivan" value="on" defaultChecked={ugovor?.aktivan ?? true} data-testid="ugovor-aktivan" />
            <span className="text-muted-foreground">{t("poljeAktivan")}</span>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeNapomena")}</span>
            <Input name="napomena" defaultValue={ugovor?.napomena ?? ""} data-testid="ugovor-napomena" aria-describedby={opisano("napomena")} />
            <FieldError id={errId("napomena")} errors={errors?.napomena} />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">{state.message}</p>
          )}

          <DialogFooter className="mt-1">
            <DialogClose render={<Button type="button" variant="outline">{tc("otkazi")}</Button>} />
            <Button type="submit" disabled={pending} data-testid="ugovor-submit">
              {pending ? t("submitPending") : isEdit ? t("submitEdit") : t("submitNovi")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
