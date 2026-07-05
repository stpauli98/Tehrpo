"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { STATUS_FILTER_OPTIONS } from "@/lib/termini"
import { currentYear, monthName } from "@/lib/date"
import { href } from "@/i18n/routes"

type Opt = { id: string; naziv: string }

export function TerminiFilters({
  klijenti, vrste, lokacijeByFirma,
}: {
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const t = useTranslations("termini.filteri")
  const tStatus = useTranslations("status")

  const status = params.get("status") ?? "svi"
  const q = params.get("q") ?? ""
  const klijentId = params.get("klijent_id") ?? "svi"
  const vrstaId = params.get("vrsta_id") ?? "svi"
  const mjesec = params.get("mjesec") ?? "tn"
  const lokacijaId = params.get("lokacija") ?? "svi"
  const nacin = params.get("nacin") ?? "svi"
  const godina = params.get("godina") ?? String(currentYear())
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]
  const godinaItems: Record<string, string> = Object.fromEntries(godine.map((g) => [String(g), String(g)]))
  const firmaLokacije = klijentId !== "svi" ? lokacijeByFirma[klijentId] ?? [] : []

  // Mjesec opcije — građeno u komponenti (useTranslations + monthName), NE preko
  // lib/termini-filters.ts (Task 15 fix: taj modul vuče i18n/messages, koji ne
  // smije ući u klijent bundle — vidi buildMonthsOption za server-only ekvivalent).
  const monthsOption = useMemo(() => [
    { value: "tn", label: t("tekuciNaredni") },
    ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) })),
  ], [t])

  // items mape (value→label) — base-ui SelectValue prikazuje labelu kad je dropdown zatvoren
  const firmaItems: Record<string, string> = { svi: t("sveFirme"), ...Object.fromEntries(klijenti.map((k) => [k.id, k.naziv])) }
  const lokacijaItems: Record<string, string> = { svi: t("sveLokacije"), ...Object.fromEntries(firmaLokacije.map((l) => [l.id, l.naziv])) }
  const vrstaItems: Record<string, string> = { svi: t("sveVrste"), ...Object.fromEntries(vrste.map((v) => [v.id, v.naziv])) }
  const mjesecItems: Record<string, string> = { svi: t("sviMjeseci"), ...Object.fromEntries(monthsOption.map((m) => [m.value, m.label])) }
  const nacinItems: Record<string, string> = { svi: t("sviNacini"), izvrsava: t("nacinIzvrsava"), pracenje: t("nacinPracenje") }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (!value || value === "svi" || value === "") next.delete(key)
    else next.set(key, value)
    next.delete("page")       // reset paginaciju
    next.delete("selected")   // zatvori detalje
    startTransition(() => router.push(href(`/plan-aktivnosti?${next.toString()}`)))
  }

  function setStatus(value: string) {
    const next = new URLSearchParams(params.toString())
    if (!value || value === "svi") next.delete("status")
    else next.set("status", value)
    // Kasni rokovi su po prirodi u prošlosti → prikaži sve mjesece (ne samo tekući),
    // inače tekući mjesečni filter sakrije prošle kasne termine.
    if (value === "kasni") next.set("mjesec", "svi")
    next.delete("page")
    next.delete("selected")
    startTransition(() => router.push(href(`/plan-aktivnosti?${next.toString()}`)))
  }

  function setMjesec(value: string) {
    const next = new URLSearchParams(params.toString())
    next.set("mjesec", value) // uvijek eksplicitno (tn|svi|1..12)
    next.delete("page")
    next.delete("selected")
    startTransition(() => router.push(href(`/plan-aktivnosti?${next.toString()}`)))
  }

  // Promjena firme resetuje lokaciju (stale lokacija druge firme → prazna lista)
  function setKlijent(value: string) {
    const next = new URLSearchParams(params.toString())
    if (!value || value === "svi") next.delete("klijent_id")
    else next.set("klijent_id", value)
    next.delete("lokacija")
    next.delete("page")
    next.delete("selected")
    startTransition(() => router.push(href(`/plan-aktivnosti?${next.toString()}`)))
  }

  // Live search: kontrolisani input + debounce (filtrira čim se kuca, bez Entera).
  const [term, setTerm] = useState(q)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Otkaži pending debounce pri unmount-u — inače zaostali timer okine router.push
  // (bez view=kalendar) i poništi prebacivanje prikaza / navigaciju.
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])
  // Sinhronizuj kad se q promijeni izvana (reset filtera / nazad dugme) —
  // adjust-state-during-render obrazac (bez useEffect-a, bez kaskadnih rendera)
  const [prevQ, setPrevQ] = useState(q)
  if (q !== prevQ) {
    setPrevQ(q)
    setTerm(q)
  }
  function pushSearch(value: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setParam("q", value)
  }
  function onSearchChange(value: string) {
    setTerm(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setParam("q", value), 300)
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="termini-filters" data-pending={pending}>
      {/* Status pills */}
      <div className="flex items-center gap-1">
        {STATUS_FILTER_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            data-testid={`status-pill-${o.value}`}
            data-active={status === o.value}
            onClick={() => setStatus(o.value)}
            className={cn(
              "px-3 py-1 rounded-full text-sm border transition",
              status === o.value
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
            )}
          >
            {o.value === "svi" ? t("svi") : tStatus(o.value)}
          </button>
        ))}
      </div>

      {/* Klijent (firma) dropdown */}
      <Select value={klijentId} onValueChange={(v) => setKlijent(v ?? "svi")} items={firmaItems}>
        <SelectTrigger className="w-48" data-testid="filter-klijent">
          <SelectValue placeholder={t("sveFirme")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">{t("sveFirme")}</SelectItem>
          {klijenti.map((k) => (
            <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Lokacija dropdown — samo kad je firma izabrana i ima lokacija */}
      {firmaLokacije.length > 0 && (
        <Select value={lokacijaId} onValueChange={(v) => setParam("lokacija", v)} items={lokacijaItems}>
          <SelectTrigger className="w-48" data-testid="filter-lokacija">
            <SelectValue placeholder={t("sveLokacije")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="svi">{t("sveLokacije")}</SelectItem>
            {firmaLokacije.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Vrsta dropdown */}
      <Select value={vrstaId} onValueChange={(v) => setParam("vrsta_id", v)} items={vrstaItems}>
        <SelectTrigger className="w-48" data-testid="filter-vrsta">
          <SelectValue placeholder={t("sveVrste")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">{t("sveVrste")}</SelectItem>
          {vrste.map((v) => (
            <SelectItem key={v.id} value={v.id}>{v.naziv}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Mjesec dropdown */}
      <Select value={mjesec} onValueChange={(v) => setMjesec(v ?? "tn")} items={mjesecItems}>
        <SelectTrigger className="w-36" data-testid="filter-mjesec">
          <SelectValue placeholder={t("sviMjeseci")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">{t("sviMjeseci")}</SelectItem>
          {monthsOption.map((m) => (
            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Način izvršenja dropdown */}
      <Select value={nacin} onValueChange={(v) => setParam("nacin", v)} items={nacinItems}>
        <SelectTrigger className="w-40" data-testid="filter-nacin">
          <SelectValue placeholder={t("sviNacini")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">{t("sviNacini")}</SelectItem>
          <SelectItem value="izvrsava">{t("nacinIzvrsava")}</SelectItem>
          <SelectItem value="pracenje">{t("nacinPracenje")}</SelectItem>
        </SelectContent>
      </Select>

      {/* Godina — relevantna samo uz odabran numerički mjesec */}
      {mjesec !== "svi" && mjesec !== "tn" && (
        <Select value={godina} onValueChange={(v) => setParam("godina", v)} items={godinaItems}>
          <SelectTrigger className="w-24" data-testid="filter-godina">
            <SelectValue placeholder={t("godina")} />
          </SelectTrigger>
          <SelectContent>
            {godine.map((g) => (
              <SelectItem key={g} value={String(g)}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Search — live (debounce); Enter samo ubrza */}
      <Input
        type="search"
        placeholder={t("pretragaPlaceholder")}
        value={term}
        data-testid="filter-search"
        className="w-56 ml-auto"
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") pushSearch((e.target as HTMLInputElement).value)
        }}
      />
    </div>
  )
}
