"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { ArrowLeft, Check, History, ListChecks, Pencil } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { DokumentPregled } from "@/components/domain/DokumentPregled"
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
  // Kad je postavljen, kartica prikazuje sadržaj dokumenta umjesto detalja termina.
  const [pregled, setPregled] = useState<{ id: string; naziv: string } | null>(null)
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
        // Dva reda: zaglavlje je fiksno, skroluje SAMO tijelo — tako kartica uvijek
        // stane u prozor (bez skrola cijelog dijaloga lijevo/desno/gore/dolje).
        // Visinu ograničava `max-h` iz `DialogContent` (100dvh − 2rem). Zatvara se
        // preko X-a u uglu (fiksan, van skrolabilnog dijela) ili tasterom Escape.
        className="max-w-2xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
        data-testid="termin-sheet"
      >
        {pregled ? (
          /* Pregled dokumenta zauzima karticu umjesto da otvara dialog preko dialoga
             (isti razlog kao dvostepeno brisanje u `DokumentiSekcija`). */
          <DialogHeader>
            <DialogTitle className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setPregled(null)}
                aria-label={tc("nazad")}
                data-testid="pregled-nazad"
                className="shrink-0"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Button>
              <span className="truncate">{pregled.naziv}</span>
            </DialogTitle>
          </DialogHeader>
        ) : (
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
        )}

        {pregled ? (
          <div className="overflow-y-auto" data-testid="termin-sheet-pregled">
            <DokumentPregled key={pregled.id} dokumentId={pregled.id} />
          </div>
        ) : (
        /* Jedini skrolabilni dio kartice (zaglavlje ostaje fiksno). */
        <div className="space-y-6 overflow-y-auto">
          {/* Edit forma — key ovisi o SVIM vrijednostima koje pune defaultValue (ne samo id),
              pa se uncontrolled Input-i remountuju i kad se isti termin osvježi (npr. nakon
              save-a → revalidate → react-query refetch vrati nove vrijednosti). Inače base-ui
              FieldControl javlja dev warning "changing the default value state of an uncontrolled
              FieldControl" i polja pokazuju zastarjele vrijednosti. */}
          <form
            key={`${termin.id}|${termin.status}|${termin.datum_zakazan ?? ""}|${termin.datum_izvrsenja ?? ""}|${termin.zaduzeni ?? ""}|${termin.napomena ?? ""}`}
            action={updateAction}
            className="space-y-3 border-l-2 border-l-muted-foreground/30 pl-3"
            data-testid="termin-edit-form"
          >
            <input type="hidden" name="id" value={termin.id ?? ""} />
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t("detaljiNaslov")}
            </p>
            <div className="space-y-4">
              {/* Datumi — grupisani zajedno: zakazan uvijek, izvršenja samo ako je termin
                  izvršen. Kad je samo jedan prisutan, razvuče se preko cijelog reda umjesto
                  da ostavi prazninu pored sebe. */}
              <div className={termin.status === "izvrseno" ? "grid grid-cols-2 gap-3" : ""}>
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
              </div>
              {jeZakazanoPoslijeRoka(termin.rok_dospijeca, zakazanInput) && (
                <p
                  className="text-xs text-warning"
                  role="status"
                  data-testid="zakazano-poslije-roka"
                >
                  {tz("poslijeRoka", {
                    dana: danaPoslijeRoka(termin.rok_dospijeca ?? "", zakazanInput),
                    rok: formatDatum(termin.rok_dospijeca),
                  })}
                </p>
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
              <div>
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
            <section className="space-y-2 border-l-2 border-l-warning/60 pl-3">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" aria-hidden />
                {t("akcijeNaslov")}
              </p>
              {/* Jedna kartica, jasna hijerarhija: primarna akcija (Označi izvršeno)
                  gore, istaknuta; destruktivna/rijetka akcija (Otkaži) ispod,
                  odvojena linijom i vizuelno stišana — dvije zasebne <form>
                  (različite server akcije), ali JEDAN vizuelni kontejner. */}
              <div className="rounded-lg border border-border">
                <form
                  action={markAction}
                  className="flex flex-wrap items-end gap-3 p-3"
                  data-testid="mark-done-form"
                >
                  <input type="hidden" name="id" value={termin.id ?? ""} />
                  <div className="min-w-[9rem] flex-1">
                    <label className="block text-sm">
                      <span className="text-muted-foreground">{t("poljeDatumIzvrsenja")}</span>
                      <Input
                        type="date"
                        name="datum_izvrsenja"
                        value={izvrDatum}
                        max={todayIso()}
                        aria-describedby={markGreske.datum_izvrsenja ? "greska-mark-datum" : undefined}
                        onChange={(e) => setIzvrDatum(e.target.value)}
                        data-testid="mark-datum"
                      />
                    </label>
                    <FieldError id="greska-mark-datum" errors={markGreske.datum_izvrsenja} />
                  </div>
                  <Button
                    type="submit"
                    variant="default"
                    disabled={markPending}
                    data-testid="mark-done-submit"
                  >
                    {markPending ? t("oznacavam") : t("oznaciIzvrseno")}
                  </Button>
                </form>
                <p className="px-3 pb-3 text-xs text-muted-foreground">
                  {t("autoCiklus")}
                </p>

                {/* Otkaži termin — dvostepena potvrda (arm → potvrdi/odustani). */}
                {termin.status !== "otkazano" && (
                  <form
                    action={otkazAction}
                    className="flex items-center justify-center gap-3 border-t border-border px-3 py-2"
                    data-testid="otkazi-form"
                  >
                    <input type="hidden" name="id" value={termin.id ?? ""} />
                    {!otkazArmed ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setOtkazArmed(true)}
                        className="text-destructive hover:bg-transparent hover:text-destructive/80 dark:hover:bg-transparent"
                        data-testid="otkazi-arm"
                      >
                        {t("otkaziTermin")}
                      </Button>
                    ) : (
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">{t("otkaziTermin")}?</span>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => setOtkazArmed(false)}>
                            {t("odustani")}
                          </Button>
                          <Button
                            type="submit"
                            variant="destructive"
                            size="sm"
                            disabled={otkazPending}
                            data-testid="otkazi-submit"
                          >
                            {otkazPending ? t("otkazujem") : t("potvrdiOtkazivanje")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </form>
                )}
              </div>
            </section>
          )}

          {/* Dokumenti — upload + AI zapisnik */}
          <DokumentiSekcija
            terminId={termin.id ?? ""}
            dokumenti={dokumenti}
            izvrsen={termin.status === "izvrseno"}
            onPregled={setPregled}
          />

          {/* Istorija — prethodni izvršeni ciklusi (isti klijent + vrsta) */}
          <section data-testid="sheet-istorija" className="border-l-2 border-l-success/50 pl-3">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <History className="h-3.5 w-3.5" aria-hidden />
              {t("istorijaNaslov")}
            </p>
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
        )}
      </DialogContent>
    </Dialog>
  )
}
