"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Download } from "lucide-react"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { currentYear, monthName, todayIso } from "@/lib/date"
import { validRaspon } from "@/lib/plan-izvoz/period"

type PeriodMod = "om" | "god" | "mj" | "raspon" | "svi"
const FILTER_KEYS = ["status", "q", "klijent_id", "lokacija", "vrsta_id", "nacin"] as const

export function PlanIzvozModal() {
  const params = useSearchParams()
  const t = useTranslations("plan.izvoz")

  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<"pdf" | "xlsx">("pdf")
  const [prilagodi, setPrilagodi] = useState(false)
  const [periodMod, setPeriodMod] = useState<PeriodMod>("om")
  const [godina, setGodina] = useState<number>(currentYear())
  const [mjesec, setMjesec] = useState<number>(Number(todayIso().slice(5, 7)))
  const [od, setOd] = useState("")
  const [doDatum, setDoDatum] = useState("")
  const [opseg, setOpseg] = useState<"sve" | "filtrirano">("sve")
  const [broj, setBroj] = useState<number | "loading" | null>(null)

  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]
  const rasponNevazeci = periodMod === "raspon" && !validRaspon(od, doDatum)

  const aktivniFilteri = useMemo(
    () => FILTER_KEYS.filter((k) => params.get(k)),
    [params]
  )

  // Gradi query za izvoz/count. forCount: doda count=1, izostavi format.
  function buildParams(forCount: boolean): URLSearchParams {
    const p = new URLSearchParams()
    if (forCount) p.set("count", "1")
    else p.set("format", format)
    p.set("period", periodMod)
    p.set("opseg", opseg)
    if (periodMod === "god" || periodMod === "mj") p.set("godina", String(godina))
    if (periodMod === "mj") p.set("mjesec", String(mjesec))
    if (periodMod === "raspon") { p.set("od", od); p.set("do", doDatum) }
    if (opseg === "filtrirano") {
      for (const k of FILTER_KEYS) { const v = params.get(k); if (v) p.set(k, v) }
    }
    return p
  }

  // Živi broj — debounce; ne zavisi od formata. Preskoči kad je raspon nevažeći.
  const filterKljuc = FILTER_KEYS.map((k) => params.get(k) ?? "").join("|")
  useEffect(() => {
    if (!open || rasponNevazeci) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setBroj("loading")
      try {
        const res = await fetch(`/api/plan-aktivnosti/izvoz?${buildParams(true).toString()}`, { signal: ctrl.signal })
        if (!res.ok) throw new Error("count")
        const data = (await res.json()) as { broj?: number }
        setBroj(typeof data.broj === "number" ? data.broj : null)
      } catch {
        if (!ctrl.signal.aborted) setBroj(null)
      }
    }, 300)
    return () => { ctrl.abort(); clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, periodMod, godina, mjesec, od, doDatum, opseg, filterKljuc, rasponNevazeci])

  function preuzmi() {
    if (rasponNevazeci) return
    window.location.assign(`/api/plan-aktivnosti/izvoz?${buildParams(false).toString()}`)
    setOpen(false)
  }

  const brojTekst =
    rasponNevazeci ? t("greskaBroj")
    : broj === "loading" ? t("racunam")
    : broj === null ? t("greskaBroj")
    : t("brojAktivnosti", { broj })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="icon-lg" aria-label={t("preuzmi")} data-testid="izvoz-trigger" />
        }
      >
        <Download className="h-[18px] w-[18px]" aria-hidden />
      </DialogTrigger>

      <DialogContent className="max-w-md" data-testid="izvoz-modal">
        <DialogHeader>
          <DialogTitle>{t("naslovModala")}</DialogTitle>
        </DialogHeader>

        {/* Format */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("format")}</span>
          <div className="flex gap-2">
            <Button
              type="button" variant={format === "pdf" ? "default" : "outline"} size="sm"
              aria-pressed={format === "pdf"} data-testid="izvoz-format-pdf"
              onClick={() => setFormat("pdf")}
            >{t("formatPdf")}</Button>
            <Button
              type="button" variant={format === "xlsx" ? "default" : "outline"} size="sm"
              aria-pressed={format === "xlsx"} data-testid="izvoz-format-xlsx"
              onClick={() => setFormat("xlsx")}
            >{t("formatExcel")}</Button>
          </div>
        </div>

        {/* Period: sažeto vs prilagođeno */}
        {!prilagodi ? (
          <div className="flex items-center justify-between text-sm">
            <span><span className="text-muted-foreground">{t("period")}: </span>{t("periodOvajMjesec")}</span>
            <button
              type="button" className="text-primary hover:underline text-sm"
              data-testid="izvoz-prilagodi"
              onClick={() => { setPeriodMod("om"); setPrilagodi(true) }}
            >▸ {t("prilagodi")}</button>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2" data-testid="izvoz-period">
              <legend className="text-xs font-medium text-muted-foreground mb-1">{t("period")}</legend>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "om"} onChange={() => setPeriodMod("om")} data-testid="izvoz-period-om" />
                {t("periodOvajMjesec")}
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "god"} onChange={() => setPeriodMod("god")} data-testid="izvoz-period-god" />
                {t("periodGodina")}
                {periodMod === "god" && (
                  <Select value={String(godina)} onValueChange={(v) => setGodina(Number(v))}>
                    <SelectTrigger size="sm" className="w-24" data-testid="izvoz-godina"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "mj"} onChange={() => setPeriodMod("mj")} data-testid="izvoz-period-mj" />
                {t("periodMjesec")}
                {periodMod === "mj" && (
                  <>
                    <Select value={String(mjesec)} onValueChange={(v) => setMjesec(Number(v))}>
                      <SelectTrigger size="sm" className="w-32" data-testid="izvoz-mjesec"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={String(godina)} onValueChange={(v) => setGodina(Number(v))}>
                      <SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "raspon"} onChange={() => setPeriodMod("raspon")} data-testid="izvoz-period-raspon" />
                {t("periodRaspon")}
              </label>
              {periodMod === "raspon" && (
                <div className="flex items-center gap-2 pl-6 text-sm">
                  <span className="text-muted-foreground">{t("od")}</span>
                  <Input type="date" value={od} onChange={(e) => setOd(e.target.value)} className="w-40" data-testid="izvoz-od" />
                  <span className="text-muted-foreground">{t("do")}</span>
                  <Input type="date" value={doDatum} onChange={(e) => setDoDatum(e.target.value)} className="w-40" data-testid="izvoz-do" />
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "svi"} onChange={() => setPeriodMod("svi")} data-testid="izvoz-period-svi" />
                {t("periodSvi")}
              </label>
            </fieldset>

            {/* Opseg */}
            <fieldset className="flex flex-col gap-2" data-testid="izvoz-opseg">
              <legend className="text-xs font-medium text-muted-foreground mb-1">{t("opseg")}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-opseg" checked={opseg === "sve"} onChange={() => setOpseg("sve")} data-testid="izvoz-opseg-sve" />
                {t("opsegSve")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-opseg" checked={opseg === "filtrirano"} onChange={() => setOpseg("filtrirano")} data-testid="izvoz-opseg-filtrirano" />
                {t("opsegFiltrirano")}
              </label>
              {opseg === "filtrirano" && (
                <p className="pl-6 text-xs text-muted-foreground">
                  {aktivniFilteri.length > 0 ? t("filteriPrimijenjeni") : t("nemaFiltera")}
                </p>
              )}
            </fieldset>

            <button
              type="button" className="text-primary hover:underline text-sm self-start"
              data-testid="izvoz-sakrij"
              onClick={() => setPrilagodi(false)}
            >▾ {t("sakrij")}</button>
          </>
        )}

        {/* Živi broj + akcija */}
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground" data-testid="izvoz-broj">{brojTekst}</span>
          <Button type="button" onClick={preuzmi} disabled={rasponNevazeci} data-testid="izvoz-preuzmi">
            <Download className="h-4 w-4" aria-hidden /> {t("preuzmi")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
