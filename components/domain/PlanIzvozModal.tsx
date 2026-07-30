"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ChevronDown, ChevronRight, Download } from "lucide-react"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { cn, FOCUS_RING } from "@/lib/utils"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { currentYear, monthName, todayIso } from "@/lib/date"
import { validRaspon } from "@/lib/plan-izvoz/period"
import { imeIzContentDisposition } from "@/lib/plan-izvoz/naziv-fajla"
import { porukaIzOdgovora } from "@/lib/queries/plan-aktivnosti"
import { useSmijePreuzeti } from "@/providers/korisnik-provider"

type PeriodMod = "om" | "god" | "mj" | "raspon" | "svi"
const FILTER_KEYS = ["status", "q", "klijent_id", "lokacija", "vrsta_id", "nacin"] as const

export function PlanIzvozModal({ godine }: { godine: number[] }) {
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
  const [preuzimanje, setPreuzimanje] = useState(false)
  const smijePreuzeti = useSmijePreuzeti()

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

  // `pregled` ne smije izvoziti — cijela komponenta je izvozni okidač (nakon svih
  // hook poziva, Rules of Hooks); okolna traka (npr. PlanViewSwitcher) ostaje.
  if (!smijePreuzeti) return null

  /**
   * S13: izvoz ide kroz `fetch` + blob, nikad `window.location.assign` — ruta na
   * grešci vraća JSON `{error}`, koji bi kod navigacije završio kao sirovi tekst na
   * bijeloj stranici, a modal bi se već bio zatvorio. Modal se sada zatvara TEK
   * nakon uspješno snimljenog fajla.
   */
  async function preuzmi() {
    if (rasponNevazeci || preuzimanje) return
    setPreuzimanje(true)
    try {
      const res = await fetch(`/api/plan-aktivnosti/izvoz?${buildParams(false).toString()}`)
      if (!res.ok) {
        const poruka = await porukaIzOdgovora(res)
        toast.error(poruka || t("greskaPreuzimanja"))
        return // modal OSTAJE otvoren — korisnik može ispraviti izbor
      }
      const blob = await res.blob()
      const ime = imeIzContentDisposition(
        res.headers.get("Content-Disposition"),
        `plan.${format === "pdf" ? "pdf" : "xlsx"}`,
      )
      const url = URL.createObjectURL(blob)
      try {
        const a = document.createElement("a")
        a.href = url
        a.download = ime
        document.body.appendChild(a)
        a.click()
        a.remove()
      } finally {
        URL.revokeObjectURL(url)
      }
      toast.success(t("uspjeh"))
      setOpen(false)
    } catch {
      toast.error(t("greskaPreuzimanja"))
    } finally {
      setPreuzimanje(false)
    }
  }

  // Plan N16: nevažeći raspon NIJE isto što i pad brojanja — razdvojene poruke.
  const brojTekst =
    rasponNevazeci ? t("rasponNevazeci")
    : broj === "loading" ? t("racunam")
    : broj === null ? t("greskaBroj")
    : t("brojAktivnosti", { broj })

  const linkKlase = cn("self-start rounded-sm text-sm text-brand hover:underline", FOCUS_RING)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="icon-lg"
            aria-label={t("preuzmi")}
            className="group/tt relative"
            data-testid="izvoz-trigger"
          />
        }
      >
        <Download className="h-[18px] w-[18px]" aria-hidden />
        <Tooltip>{t("preuzmiOpis")}</Tooltip>
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
              type="button" className={linkKlase}
              data-testid="izvoz-prilagodi"
              onClick={() => { setPeriodMod("om"); setPrilagodi(true) }}
            >
              <ChevronRight className="mr-1 inline-block h-[18px] w-[18px] shrink-0 align-text-bottom" aria-hidden />
              {t("prilagodi")}
            </button>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2" data-testid="izvoz-period">
              <legend className="text-xs font-medium text-muted-foreground mb-1">{t("period")}</legend>

              {/* S4: native radio → ui/radio-group (fokus prsten i tokeni dolaze iz primitiva).
                  S12: svaka stavka nosi vlastiti `aria-label`. Base UI `Radio.Root` renderuje
                  `<span role="radio">` uz `aria-hidden` skriveni input, pa `<label>` koji ga
                  obavija imenuje samo taj skriveni input — vidljivi radio bi ostao bez imena
                  (native `<input type="radio">` je ime dobijao od istog tog labela). */}
              <RadioGroup
                value={periodMod}
                onValueChange={(v) => setPeriodMod(v as PeriodMod)}
                aria-label={t("period")}
                className="gap-2"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="om" data-testid="izvoz-period-om" aria-label={t("periodOvajMjesec")} />
                  {t("periodOvajMjesec")}
                </label>

                <div className="flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="god" data-testid="izvoz-period-god" aria-label={t("periodGodina")} />
                    {t("periodGodina")}
                  </label>
                  {periodMod === "god" && (
                    <Select value={String(godina)} onValueChange={(v) => setGodina(Number(v))}>
                      <SelectTrigger size="sm" className="w-24" data-testid="izvoz-godina" aria-label={t("periodGodina")}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="mj" data-testid="izvoz-period-mj" aria-label={t("periodMjesec")} />
                    {t("periodMjesec")}
                  </label>
                  {periodMod === "mj" && (
                    <>
                      <Select value={String(mjesec)} onValueChange={(v) => setMjesec(Number(v))}>
                        <SelectTrigger size="sm" className="w-32" data-testid="izvoz-mjesec" aria-label={t("periodMjesec")}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 12 }, (_, i) => (
                            <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={String(godina)} onValueChange={(v) => setGodina(Number(v))}>
                        <SelectTrigger size="sm" className="w-24" aria-label={t("periodGodina")}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="raspon" data-testid="izvoz-period-raspon" aria-label={t("periodRaspon")} />
                  {t("periodRaspon")}
                </label>
                {periodMod === "raspon" && (
                  <div className="flex items-center gap-2 pl-6 text-sm">
                    <span className="text-muted-foreground">{t("od")}</span>
                    <Input type="date" value={od} onChange={(e) => setOd(e.target.value)} className="w-40" data-testid="izvoz-od" aria-label={t("od")} />
                    <span className="text-muted-foreground">{t("do")}</span>
                    <Input type="date" value={doDatum} onChange={(e) => setDoDatum(e.target.value)} className="w-40" data-testid="izvoz-do" aria-label={t("do")} />
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="svi" data-testid="izvoz-period-svi" aria-label={t("periodSvi")} />
                  {t("periodSvi")}
                </label>
              </RadioGroup>
            </fieldset>

            {/* Opseg */}
            <fieldset className="flex flex-col gap-2" data-testid="izvoz-opseg">
              <legend className="text-xs font-medium text-muted-foreground mb-1">{t("opseg")}</legend>
              <RadioGroup
                value={opseg}
                onValueChange={(v) => setOpseg(v as "sve" | "filtrirano")}
                aria-label={t("opseg")}
                className="gap-2"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="sve" data-testid="izvoz-opseg-sve" aria-label={t("opsegSve")} />
                  {t("opsegSve")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="filtrirano" data-testid="izvoz-opseg-filtrirano" aria-label={t("opsegFiltrirano")} />
                  {t("opsegFiltrirano")}
                </label>
              </RadioGroup>
              {opseg === "filtrirano" && (
                <p className="pl-6 text-xs text-muted-foreground">
                  {aktivniFilteri.length > 0 ? t("filteriPrimijenjeni") : t("nemaFiltera")}
                </p>
              )}
            </fieldset>

            <button
              type="button" className={linkKlase}
              data-testid="izvoz-sakrij"
              onClick={() => setPrilagodi(false)}
            >
              <ChevronDown className="mr-1 inline-block h-[18px] w-[18px] shrink-0 align-text-bottom" aria-hidden />
              {t("sakrij")}
            </button>
          </>
        )}

        {/* Živi broj + akcija */}
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground" data-testid="izvoz-broj">{brojTekst}</span>
          <Button
            type="button"
            onClick={() => void preuzmi()}
            disabled={rasponNevazeci || preuzimanje}
            data-testid="izvoz-preuzmi"
          >
            <Download className="h-[18px] w-[18px] shrink-0" aria-hidden />{" "}
            {preuzimanje ? t("preuzimam") : t("preuzmi")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
