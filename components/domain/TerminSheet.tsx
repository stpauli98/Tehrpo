"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { FieldError } from "@/components/domain/FieldError"
import { ZaduzeniPolje } from "@/components/domain/ZaduzeniPolje"
import { formatDatum, todayIso } from "@/lib/date"
import { jeZakazanoPoslijeRoka, danaPoslijeRoka } from "@/lib/plan-datum"
import {
  updateTermin,
  markIzvrseno,
  otkaziTermin,
  type ActionResult,
} from "@/app/(dashboard)/termini/actions"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { DokumentiSekcija } from "@/components/domain/DokumentiSekcija"
import type { Database } from "@/db/types"
import { useAkcijaToast } from "@/components/akcija-toast"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import { useInvalidatePlanQueries } from "@/lib/queries/plan-invalidacije"

const initial: ActionResult = { ok: true }

/** S2: `errors` iz `ActionResult` — inline pod poljem, nikad u toast. */
function greskeIz(state: ActionResult): Record<string, string[] | undefined> {
  return state.ok === false ? state.errors ?? {} : {}
}

export function TerminSheet({
  termin,
  istorija,
  dokumenti,
  closeHref,
  zaduzeniPrijedlozi,
}: {
  termin: TerminRow
  istorija: TerminRow[]
  dokumenti: Database["public"]["Tables"]["dokumenti"]["Row"][]
  closeHref: string
  /** S8.6: imena aktivnih korisnika iz `get_aktivni_korisnici()` (prijedlozi, ne ograničenje). */
  zaduzeniPrijedlozi: string[]
}) {
  const router = useRouter()
  const invalidirajPlan = useInvalidatePlanQueries()
  const t = useTranslations("termini.sheet")
  const tc = useTranslations("common")
  const tz = useTranslations("termini.zakazanoUpozorenje")
  const [updateState, updateAction, updatePending] = useActionState(updateTermin, initial)
  const [markState, markAction, markPending] = useActionState(markIzvrseno, initial)
  const [otkazState, otkazAction, otkazPending] = useActionState(otkaziTermin, initial)
  const [izvrDatum, setIzvrDatum] = useState(todayIso())
  const [otkazArmed, setOtkazArmed] = useState(false)
  const [zakazanInput, setZakazanInput] = useState(termin.datum_zakazan ?? "")
  // Mixed component (read detalji + write akcije) — NE sakrivati čitanje, gejtovati samo
  // write-kontrole (v. docs/superpowers/specs/2026-07-10-pregled-readonly-design.md).
  const mozeUrediti = useMozeUrediti()

  const updateGreske = greskeIz(updateState)
  const markGreske = greskeIz(markState)

  useAkcijaToast(updateState, { uspjeh: t("toastIzmjeneSacuvane"), greska: tc("greska") })
  useAkcijaToast(markState, { uspjeh: t("toastOznacenIzvrsenim"), greska: tc("greska") })
  useAkcijaToast(otkazState, { uspjeh: t("toastOtkazan"), greska: tc("greska") })

  // TanStack Query invalidacija kad akcija prijeđe iz pending u uspjeh (toast pokriven
  // useAkcijaToast iznad). Spisak keševa je jedan — v. `useInvalidatePlanQueries`.
  const prevUpdPending = useRef(updatePending)
  useEffect(() => {
    if (prevUpdPending.current && !updatePending && updateState.ok) {
      invalidirajPlan(termin.id ?? undefined)
    }
    prevUpdPending.current = updatePending
  }, [updatePending, updateState, invalidirajPlan, termin.id])

  const prevMarkPending = useRef(markPending)
  useEffect(() => {
    if (prevMarkPending.current && !markPending && markState.ok) {
      invalidirajPlan(termin.id ?? undefined)
    }
    prevMarkPending.current = markPending
  }, [markPending, markState, invalidirajPlan, termin.id])

  const prevOtkazPending = useRef(otkazPending)
  useEffect(() => {
    if (prevOtkazPending.current && !otkazPending && otkazState.ok) {
      invalidirajPlan(termin.id ?? undefined)
    }
    prevOtkazPending.current = otkazPending
  }, [otkazPending, otkazState, invalidirajPlan, termin.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sinhronizacija lokalnog inputa sa novim terminom (sheet se ne remountuje, samo unutrašnja forma)
    setZakazanInput(termin.datum_zakazan ?? "")
  }, [termin.id, termin.datum_zakazan])

  function close() {
    router.push(closeHref)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="termin-sheet"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{termin.klijent_naziv ?? t("naslovFallback")}</span>
            <StatusBadge status={termin.status_izvedeni} stvarniStatus={termin.status} datumZakazan={termin.datum_zakazan} />
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {termin.vrsta_naziv ?? "—"}
            {termin.lokacija_naziv ? ` · ${termin.lokacija_naziv}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">{t("rok", { datum: formatDatum(termin.rok_dospijeca) })}</p>
        </DialogHeader>

        <div className="space-y-6">
          {/* Edit forma — key ovisi o SVIM vrijednostima koje pune defaultValue (ne samo id),
              pa se uncontrolled Input-i remountuju i kad se isti termin osvježi (npr. nakon
              save-a → revalidate → react-query refetch vrati nove vrijednosti). Inače base-ui
              FieldControl javlja dev warning "changing the default value state of an uncontrolled
              FieldControl" i polja pokazuju zastarjele vrijednosti. */}
          <form
            key={`${termin.id}|${termin.status}|${termin.datum_zakazan ?? ""}|${termin.datum_izvrsenja ?? ""}|${termin.zaduzeni ?? ""}|${termin.napomena ?? ""}`}
            action={updateAction}
            className="space-y-3"
            data-testid="termin-edit-form"
          >
            <input type="hidden" name="id" value={termin.id ?? ""} />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("detaljiNaslov")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm">
                  <span className="text-muted-foreground">{t("poljeDatumZakazan")}</span>
                  <Input
                    type="date"
                    name="datum_zakazan"
                    defaultValue={termin.datum_zakazan ?? ""}
                    disabled={!mozeUrediti}
                    aria-describedby={updateGreske.datum_zakazan ? "greska-edit-datum-zakazan" : undefined}
                    onChange={(e) => setZakazanInput(e.target.value)}
                    data-testid="edit-datum-zakazan"
                  />
                </label>
                <FieldError id="greska-edit-datum-zakazan" errors={updateGreske.datum_zakazan} />
              </div>
              {jeZakazanoPoslijeRoka(termin.rok_dospijeca, zakazanInput) && (
                <p
                  className="col-span-2 text-xs text-warning"
                  role="status"
                  data-testid="zakazano-poslije-roka"
                >
                  {tz("poslijeRoka", {
                    dana: danaPoslijeRoka(termin.rok_dospijeca ?? "", zakazanInput),
                    rok: formatDatum(termin.rok_dospijeca),
                  })}
                </p>
              )}
              {termin.status === "izvrseno" && (
                <div>
                  <label className="block text-sm">
                    <span className="text-muted-foreground">{t("poljeDatumIzvrsenja")}</span>
                    <Input
                      type="date"
                      name="datum_izvrsenja"
                      defaultValue={termin.datum_izvrsenja ?? ""}
                      max={todayIso()}
                      disabled={!mozeUrediti}
                      aria-describedby={updateGreske.datum_izvrsenja ? "greska-edit-datum-izvrsenja" : undefined}
                      data-testid="edit-datum-izvrsenja"
                    />
                  </label>
                  <FieldError id="greska-edit-datum-izvrsenja" errors={updateGreske.datum_izvrsenja} />
                </div>
              )}
              <div>
                <label className="block text-sm">
                  <span className="text-muted-foreground">{t("poljeZaduzeni")}</span>
                  <ZaduzeniPolje
                    prijedlozi={zaduzeniPrijedlozi}
                    defaultValue={termin.zaduzeni ?? ""}
                    placeholder={t("placeholderZaduzeni")}
                    disabled={!mozeUrediti}
                    testId="edit-zaduzeni"
                    describedBy={updateGreske.zaduzeni ? "greska-edit-zaduzeni" : undefined}
                  />
                </label>
                <FieldError id="greska-edit-zaduzeni" errors={updateGreske.zaduzeni} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm">
                  <span className="text-muted-foreground">{t("poljeNapomena")}</span>
                  <Input
                    name="napomena"
                    defaultValue={termin.napomena ?? ""}
                    disabled={!mozeUrediti}
                    aria-describedby={updateGreske.napomena ? "greska-edit-napomena" : undefined}
                    data-testid="edit-napomena"
                  />
                </label>
                <FieldError id="greska-edit-napomena" errors={updateGreske.napomena} />
              </div>
            </div>
            {mozeUrediti && (
              <Button type="submit" disabled={updatePending} data-testid="edit-save">
                {updatePending ? t("spremam") : t("spremiIzmjene")}
              </Button>
            )}
          </form>

          {/* Akcije — Označi izvršeno + Otkaži, jedno pored drugog. Čisto write (nema
              nezavisnog read sadržaja), pa se cijela sekcija gejtuje za pregled. */}
          {mozeUrediti && termin.status !== "izvrseno" && (
            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("akcijeNaslov")}</p>
              <div className="grid grid-cols-2 gap-3 items-start">
                <form
                  action={markAction}
                  className="space-y-2 rounded-lg border border-border p-3"
                  data-testid="mark-done-form"
                >
                  <p className="text-sm font-medium">{t("oznaciKaoIzvrseno")}</p>
                  <input type="hidden" name="id" value={termin.id ?? ""} />
                  <Input
                    type="date"
                    name="datum_izvrsenja"
                    value={izvrDatum}
                    max={todayIso()}
                    aria-label={t("poljeDatumIzvrsenja")}
                    aria-describedby={markGreske.datum_izvrsenja ? "greska-mark-datum" : undefined}
                    onChange={(e) => setIzvrDatum(e.target.value)}
                    data-testid="mark-datum"
                  />
                  <FieldError id="greska-mark-datum" errors={markGreske.datum_izvrsenja} />
                  <Button
                    type="submit"
                    variant="default"
                    disabled={markPending}
                    className="w-full"
                    data-testid="mark-done-submit"
                  >
                    {markPending ? t("oznacavam") : t("oznaciIzvrseno")}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {t("autoCiklus")}
                  </p>
                </form>

                {/* Otkaži termin — dvostepena potvrda (arm → potvrdi/odustani). */}
                {termin.status !== "otkazano" && (
                  <form
                    action={otkazAction}
                    className="space-y-2 rounded-lg border border-border p-3"
                    data-testid="otkazi-form"
                  >
                    <p className="text-sm font-medium">{t("otkaziTermin")}</p>
                    <input type="hidden" name="id" value={termin.id ?? ""} />
                    {!otkazArmed ? (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => setOtkazArmed(true)}
                        className="w-full"
                        data-testid="otkazi-arm"
                      >
                        {t("otkaziTermin")}
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <Button
                          type="submit"
                          variant="destructive"
                          disabled={otkazPending}
                          className="w-full"
                          data-testid="otkazi-submit"
                        >
                          {otkazPending ? t("otkazujem") : t("potvrdiOtkazivanje")}
                        </Button>
                        <Button type="button" variant="outline" className="w-full" onClick={() => setOtkazArmed(false)}>
                          {t("odustani")}
                        </Button>
                      </div>
                    )}
                  </form>
                )}
              </div>
            </section>
          )}

          {/* Dokumenti — upload + AI zapisnik */}
          <DokumentiSekcija terminId={termin.id ?? ""} dokumenti={dokumenti} izvrsen={termin.status === "izvrseno"} />

          {/* Istorija — prethodni izvršeni ciklusi (isti klijent + vrsta) */}
          <section data-testid="sheet-istorija">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("istorijaNaslov")}</p>
            {istorija.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">{t("istorijaPrazno")}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {istorija.map((h) => (
                  <li
                    key={h.id ?? ""}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">{h.vrsta_naziv ?? "—"}</span>
                    <span className="inline-flex items-center gap-1 text-success tabular-nums">
                      {formatDatum(h.datum_izvrsenja)}
                      <Check className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} data-testid="sheet-close">
            {tc("zatvori")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
