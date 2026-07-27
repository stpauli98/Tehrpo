"use client"

import { useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { usePendingFilteri } from "@/lib/use-pending-filteri"
import { TIP_KEY, STATUS_KEY } from "@/lib/poslati-mejlovi"
import { Constants, type Database } from "@/db/types"
import { href } from "@/i18n/routes"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]
type MejlStatus = Database["public"]["Enums"]["mejl_status"]

const SVI_TIPOVI = Constants.public.Enums.mejl_tip
const SVI_STATUSI = Constants.public.Enums.mejl_status

/** Sentinel za "bez filtera" — base-ui Select ne barata praznim stringom kao vrijednošću. */
const SVI = "svi"

/**
 * Filter-forma dnevnika mejlova (S4, S10, S12, S16).
 *
 * Imena URL parametara su nepromijenjena (`tip/status/od/do/samo_greske/nepregledano`)
 * da stari bookmarkovani linkovi i e2e navigacije rade — mijenja se samo način na
 * koji ih forma sastavlja (lokalni state + `router.push` umjesto native GET submita).
 *
 * A11y napomena: `Select` (base-ui) renderuje dugme, a `<label htmlFor>` se veže samo
 * za labelabilne elemente — zato selecti dobijaju vidljiv `<span>` sa `id` i
 * `aria-labelledby` na trigeru, dok `Input`/`Checkbox` (koji imaju pravi `<input>`)
 * koriste klasičan `<label htmlFor>`.
 */
export function PoslatiMejloviFilteri({
  tip: tipProp,
  status: statusProp,
  od: odProp,
  do_: doProp,
  samoGreske: samoGreskeProp,
  nepregledano: nepregledanoProp,
}: {
  tip: MejlTip | null
  status: MejlStatus | null
  od: string
  do_: string
  samoGreske: boolean
  nepregledano: boolean
}) {
  const t = useTranslations("poslatiMejlovi")
  const { isPending, push } = usePendingFilteri()

  const [tip, setTip] = useState<string>(tipProp ?? SVI)
  const [status, setStatus] = useState<string>(statusProp ?? SVI)
  const [od, setOd] = useState(odProp)
  const [do_, setDo] = useState(doProp)
  const [samoGreske, setSamoGreske] = useState(samoGreskeProp)
  const [nepregledano, setNepregledano] = useState(nepregledanoProp)

  const imaFiltera =
    tip !== SVI || status !== SVI || od !== "" || do_ !== "" || samoGreske || nepregledano

  // items mape (value→label) — base-ui SelectValue prikazuje labelu kad je dropdown zatvoren
  const tipItems: Record<string, string> = {
    [SVI]: t("filteri.svi"),
    ...Object.fromEntries(SVI_TIPOVI.map((v) => [v, t(`tip.${TIP_KEY[v]}` as never)])),
  }
  const statusItems: Record<string, string> = {
    [SVI]: t("filteri.svi"),
    ...Object.fromEntries(SVI_STATUSI.map((v) => [v, t(`status.${STATUS_KEY[v]}` as never)])),
  }

  function naviguj(params: URLSearchParams) {
    const qs = params.toString()
    // `page` se namjerno ne prenosi — novi filter uvijek vraća na prvu stranu.
    push(href(qs ? `/poslati-mejlovi?${qs}` : "/poslati-mejlovi"))
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (tip !== SVI) params.set("tip", tip)
    if (status !== SVI) params.set("status", status)
    if (od) params.set("od", od)
    if (do_) params.set("do", do_)
    if (samoGreske) params.set("samo_greske", "1")
    if (nepregledano) params.set("nepregledano", "1")
    naviguj(params)
  }

  function ponisti() {
    setTip(SVI)
    setStatus(SVI)
    setOd("")
    setDo("")
    setSamoGreske(false)
    setNepregledano(false)
    naviguj(new URLSearchParams())
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-busy={isPending}
      className={`flex flex-wrap items-end gap-3${isPending ? " opacity-60" : ""}`}
    >
      <div className="flex flex-col gap-1">
        <span id="filter-tip-label" className="text-sm">{t("filteri.tip")}</span>
        <Select value={tip} onValueChange={(v) => setTip(String(v ?? SVI))} items={tipItems}>
          <SelectTrigger className="w-48" aria-labelledby="filter-tip-label" data-testid="filter-mejl-tip">
            <SelectValue placeholder={t("filteri.svi")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SVI}>{t("filteri.svi")}</SelectItem>
            {SVI_TIPOVI.map((v) => (
              <SelectItem key={v} value={v}>{t(`tip.${TIP_KEY[v]}` as never)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span id="filter-status-label" className="text-sm">{t("filteri.status")}</span>
        <Select value={status} onValueChange={(v) => setStatus(String(v ?? SVI))} items={statusItems}>
          <SelectTrigger className="w-44" aria-labelledby="filter-status-label" data-testid="filter-mejl-status">
            <SelectValue placeholder={t("filteri.svi")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SVI}>{t("filteri.svi")}</SelectItem>
            {SVI_STATUSI.map((v) => (
              <SelectItem key={v} value={v}>{t(`status.${STATUS_KEY[v]}` as never)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-od" className="text-sm">{t("filteri.od")}</label>
        <Input
          id="filter-od"
          type="date"
          className="w-40"
          value={od}
          onChange={(e) => setOd(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-do" className="text-sm">{t("filteri.do")}</label>
        <Input
          id="filter-do"
          type="date"
          className="w-40"
          value={do_}
          onChange={(e) => setDo(e.target.value)}
        />
      </div>

      <div className="flex h-8 items-center gap-2">
        <Checkbox
          id="filter-samo-greske"
          checked={samoGreske}
          onCheckedChange={(v) => setSamoGreske(v)}
        />
        <label htmlFor="filter-samo-greske" className="text-sm">{t("filteri.samoGreske")}</label>
      </div>

      <div className="flex h-8 items-center gap-2">
        <Checkbox
          id="filter-nepregledano"
          checked={nepregledano}
          onCheckedChange={(v) => setNepregledano(v)}
        />
        <label htmlFor="filter-nepregledano" className="text-sm">{t("filteri.samoNerijesene")}</label>
      </div>

      <Button type="submit" variant="outline" disabled={isPending}>
        {t("filteri.filtriraj")}
      </Button>

      {imaFiltera && (
        <Button type="button" variant="ghost" disabled={isPending} onClick={ponisti}>
          {t("filteri.ponisti")}
        </Button>
      )}
    </form>
  )
}
