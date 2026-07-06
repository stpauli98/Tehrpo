"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
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
import { formatDatum, todayIso } from "@/lib/date"
import {
  updateTermin,
  markIzvrseno,
  otkaziTermin,
  type ActionResult,
} from "@/app/(dashboard)/termini/actions"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { DokumentiSekcija } from "@/components/domain/DokumentiSekcija"
import type { Database } from "@/db/types"

const initial: ActionResult = { ok: true }

export function TerminSheet({
  termin,
  istorija,
  dokumenti,
  closeHref,
}: {
  termin: TerminRow
  istorija: TerminRow[]
  dokumenti: Database["public"]["Tables"]["dokumenti"]["Row"][]
  closeHref: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const t = useTranslations("termini.sheet")
  const tc = useTranslations("common")
  const [updateState, updateAction, updatePending] = useActionState(updateTermin, initial)
  const [markState, markAction, markPending] = useActionState(markIzvrseno, initial)
  const [otkazState, otkazAction, otkazPending] = useActionState(otkaziTermin, initial)
  const [izvrDatum, setIzvrDatum] = useState(todayIso())
  const [otkazArmed, setOtkazArmed] = useState(false)

  // Toast potvrda + TanStack Query invalidacija kad akcija prijeđe iz pending u uspjeh
  const prevUpdPending = useRef(updatePending)
  useEffect(() => {
    if (prevUpdPending.current && !updatePending && updateState.ok) {
      toast.success(t("toastIzmjeneSacuvane"))
      if (termin.id) {
        void queryClient.invalidateQueries({ queryKey: ["termin-detail", termin.id] })
      }
      void queryClient.invalidateQueries({ queryKey: ["termini-lista"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-matrica"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-kalendar"] })
    }
    prevUpdPending.current = updatePending
  }, [updatePending, updateState, queryClient, termin.id, t])

  const prevMarkPending = useRef(markPending)
  useEffect(() => {
    if (prevMarkPending.current && !markPending && markState.ok) {
      toast.success(t("toastOznacenIzvrsenim"))
      if (termin.id) {
        void queryClient.invalidateQueries({ queryKey: ["termin-detail", termin.id] })
      }
      void queryClient.invalidateQueries({ queryKey: ["termini-lista"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-matrica"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-kalendar"] })
    }
    prevMarkPending.current = markPending
  }, [markPending, markState, queryClient, termin.id, t])

  const prevOtkazPending = useRef(otkazPending)
  useEffect(() => {
    if (prevOtkazPending.current && !otkazPending && otkazState.ok) {
      toast.success(t("toastOtkazan"))
      if (termin.id) {
        void queryClient.invalidateQueries({ queryKey: ["termin-detail", termin.id] })
      }
      void queryClient.invalidateQueries({ queryKey: ["termini-lista"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-matrica"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-kalendar"] })
    }
    prevOtkazPending.current = otkazPending
  }, [otkazPending, otkazState, queryClient, termin.id, t])

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
          <p className="text-sm text-slate-500">
            {termin.vrsta_naziv ?? "—"}
            {termin.lokacija_naziv ? ` · ${termin.lokacija_naziv}` : ""}
          </p>
          <p className="text-xs text-slate-400">{t("rok", { datum: formatDatum(termin.rok_dospijeca) })}</p>
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
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t("detaljiNaslov")}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-slate-600">{t("poljeDatumZakazan")}</span>
                <Input
                  type="date"
                  name="datum_zakazan"
                  defaultValue={termin.datum_zakazan ?? ""}
                  data-testid="edit-datum-zakazan"
                />
              </label>
              {termin.status === "izvrseno" && (
                <label className="block text-sm">
                  <span className="text-slate-600">{t("poljeDatumIzvrsenja")}</span>
                  <Input
                    type="date"
                    name="datum_izvrsenja"
                    defaultValue={termin.datum_izvrsenja ?? ""}
                    data-testid="edit-datum-izvrsenja"
                  />
                </label>
              )}
              <label className="block text-sm">
                <span className="text-slate-600">{t("poljeZaduzeni")}</span>
                <Input
                  name="zaduzeni"
                  defaultValue={termin.zaduzeni ?? ""}
                  placeholder={t("placeholderZaduzeni")}
                  data-testid="edit-zaduzeni"
                />
              </label>
              <label className="block text-sm col-span-2">
                <span className="text-slate-600">{t("poljeNapomena")}</span>
                <Input
                  name="napomena"
                  defaultValue={termin.napomena ?? ""}
                  data-testid="edit-napomena"
                />
              </label>
            </div>
            {updateState.ok === false && updateState.message && (
              <p className="text-sm text-red-600" role="alert">
                {updateState.message}
              </p>
            )}
            <Button type="submit" disabled={updatePending} data-testid="edit-save">
              {updatePending ? t("spremam") : t("spremiIzmjene")}
            </Button>
          </form>

          {/* Akcije — Označi izvršeno + Otkaži, jedno pored drugog */}
          {termin.status !== "izvrseno" && (
            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t("akcijeNaslov")}</p>
              <div className="grid grid-cols-2 gap-3 items-start">
                <form
                  action={markAction}
                  className="space-y-2 rounded-lg border border-slate-200 p-3"
                  data-testid="mark-done-form"
                >
                  <p className="text-sm font-medium">{t("oznaciKaoIzvrseno")}</p>
                  <input type="hidden" name="id" value={termin.id ?? ""} />
                  <Input
                    type="date"
                    name="datum_izvrsenja"
                    value={izvrDatum}
                    onChange={(e) => setIzvrDatum(e.target.value)}
                    data-testid="mark-datum"
                  />
                  {markState.ok === false && markState.message && (
                    <p className="text-sm text-red-600" role="alert">
                      {markState.message}
                    </p>
                  )}
                  <Button
                    type="submit"
                    variant="default"
                    disabled={markPending}
                    className="w-full"
                    data-testid="mark-done-submit"
                  >
                    {markPending ? t("oznacavam") : t("oznaciIzvrseno")}
                  </Button>
                  <p className="text-xs text-slate-400">
                    {t("autoCiklus")}
                  </p>
                </form>

                {/* Otkaži termin — dvostepena potvrda */}
                {termin.status !== "otkazano" && (
                  <form
                    action={otkazAction}
                    className="space-y-2 rounded-lg border border-slate-200 p-3"
                    data-testid="otkazi-form"
                  >
                    <p className="text-sm font-medium">{t("otkaziTermin")}</p>
                    <input type="hidden" name="id" value={termin.id ?? ""} />
                    {otkazState.ok === false && otkazState.message && (
                      <p className="text-sm text-red-600" role="alert">{otkazState.message}</p>
                    )}
                    {!otkazArmed ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setOtkazArmed(true)}
                        className="w-full text-red-600 border-red-200 hover:bg-red-50"
                        data-testid="otkazi-arm"
                      >
                        {t("otkaziTermin")}
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <Button
                          type="submit"
                          variant="outline"
                          disabled={otkazPending}
                          className="w-full text-red-600 border-red-300 hover:bg-red-50"
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
            <p className="text-xs uppercase tracking-wide text-slate-400">{t("istorijaNaslov")}</p>
            {istorija.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">{t("istorijaPrazno")}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {istorija.map((h) => (
                  <li
                    key={h.id ?? ""}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-slate-600">{h.vrsta_naziv ?? "—"}</span>
                    <span className="text-green-600 tabular-nums">
                      {formatDatum(h.datum_izvrsenja)} ✓
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
