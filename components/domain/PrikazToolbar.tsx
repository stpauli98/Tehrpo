"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { useTranslations } from "next-intl"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { cn, FOCUS_RING } from "@/lib/utils"
import { monthName, todayIso } from "@/lib/date"
import { href } from "@/i18n/routes"

type Opt = { id: string; naziv: string }

const MJESEC_NAZIVI = Array.from({ length: 12 }, (_, i) => monthName(i + 1))

export function PrikazToolbar({
  klijenti,
  godine,
  godina: aktivnaGodina,
}: {
  klijenti: Opt[]
  godine: number[]
  godina: number
}) {
  const t = useTranslations("pregled.prikaz")
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const klijent = params.get("klijent") ?? ""
  const godina = params.get("godina") ?? String(aktivnaGodina)
  const mode = params.get("mode") ?? "klijent"
  const mjesec = params.get("mjesec") ?? ""
  const sviKlijentiLabel = t("sviKlijenti")
  // items mapa (value→label) za base-ui SelectValue (prikaz imena firme kad je zatvoreno)
  const klijentItems: Record<string, string> = {
    __svi__: sviKlijentiLabel,
    ...Object.fromEntries(klijenti.map((k) => [k.id, k.naziv])),
  }
  const mjesecItems: Record<string, string> = Object.fromEntries(
    MJESEC_NAZIVI.map((label, i) => [String(i + 1), label])
  )

  function setMode(m: "klijent" | "mjesec") {
    const next = new URLSearchParams(params.toString())
    next.set("mode", m)
    next.delete("selected")
    if (m === "mjesec" && !next.get("mjesec")) {
      next.set("mjesec", String(Number(todayIso().slice(5, 7))))
    }
    startTransition(() => router.push(href(`/plan-aktivnosti?${next.toString()}`)))
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete("selected")
    startTransition(() => router.push(href(`/plan-aktivnosti?${next.toString()}`)))
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="prikaz-toolbar" data-pending={pending}>
      <div className="inline-flex rounded-lg border border-slate-200 p-0.5" data-testid="prikaz-mode-toggle">
        <button
          type="button"
          data-testid="prikaz-mode-klijent"
          aria-pressed={mode === "klijent"}
          onClick={() => setMode("klijent")}
          className={cn(
            "px-3 py-1 text-sm rounded-md transition-colors",
            FOCUS_RING,
            mode === "klijent" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          {t("modKlijent")}
        </button>
        <button
          type="button"
          data-testid="prikaz-mode-mjesec"
          aria-pressed={mode === "mjesec"}
          onClick={() => setMode("mjesec")}
          className={cn(
            "px-3 py-1 text-sm rounded-md transition-colors",
            FOCUS_RING,
            mode === "mjesec" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          {t("modMjesec")}
        </button>
      </div>

      {mode === "klijent" ? (
        <>
          <Select value={klijent} onValueChange={(v) => setParam("klijent", v === "__svi__" ? "" : (v ?? ""))} items={klijentItems}>
            <SelectTrigger className="w-72" data-testid="prikaz-klijent"><SelectValue placeholder={t("izaberiKlijenta")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__svi__">{sviKlijentiLabel}</SelectItem>
              {klijenti.map((k) => <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={godina} onValueChange={(v) => setParam("godina", v ?? "")}>
            <SelectTrigger className="w-28" data-testid="prikaz-godina"><SelectValue placeholder={t("godina")} /></SelectTrigger>
            <SelectContent>
              {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </>
      ) : (
        <>
          <Select value={mjesec} onValueChange={(v) => setParam("mjesec", v ?? "")} items={mjesecItems}>
            <SelectTrigger className="w-40" data-testid="prikaz-mjesec"><SelectValue placeholder={t("izaberiMjesec")} /></SelectTrigger>
            <SelectContent>
              {MJESEC_NAZIVI.map((label, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={godina} onValueChange={(v) => setParam("godina", v ?? "")}>
            <SelectTrigger className="w-28" data-testid="prikaz-godina"><SelectValue placeholder={t("godina")} /></SelectTrigger>
            <SelectContent>
              {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  )
}
