"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useRef, useState, useTransition } from "react"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { STATUS_FILTER_OPTIONS } from "@/lib/termini"
import { MONTHS_BS_OPTION } from "@/lib/termini-filters"

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

  const status = params.get("status") ?? "svi"
  const q = params.get("q") ?? ""
  const klijentId = params.get("klijent_id") ?? "svi"
  const vrstaId = params.get("vrsta_id") ?? "svi"
  const mjesec = params.get("mjesec") ?? "svi"
  const lokacijaId = params.get("lokacija") ?? "svi"
  const firmaLokacije = klijentId !== "svi" ? lokacijeByFirma[klijentId] ?? [] : []

  // items mape (value→label) — base-ui SelectValue prikazuje labelu kad je dropdown zatvoren
  const firmaItems: Record<string, string> = { svi: "Sve firme", ...Object.fromEntries(klijenti.map((k) => [k.id, k.naziv])) }
  const lokacijaItems: Record<string, string> = { svi: "Sve lokacije", ...Object.fromEntries(firmaLokacije.map((l) => [l.id, l.naziv])) }
  const vrstaItems: Record<string, string> = { svi: "Sve vrste", ...Object.fromEntries(vrste.map((v) => [v.id, v.naziv])) }
  const mjesecItems: Record<string, string> = { svi: "Svi mjeseci", ...Object.fromEntries(MONTHS_BS_OPTION.map((m) => [m.value, m.label])) }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (!value || value === "svi" || value === "") next.delete(key)
    else next.set(key, value)
    next.delete("page")       // reset paginaciju
    next.delete("selected")   // zatvori detalje
    startTransition(() => router.push(`/termini?${next.toString()}`))
  }

  // Promjena firme resetuje lokaciju (stale lokacija druge firme → prazna lista)
  function setKlijent(value: string) {
    const next = new URLSearchParams(params.toString())
    if (!value || value === "svi") next.delete("klijent_id")
    else next.set("klijent_id", value)
    next.delete("lokacija")
    next.delete("page")
    next.delete("selected")
    startTransition(() => router.push(`/termini?${next.toString()}`))
  }

  // Live search: kontrolisani input + debounce (filtrira čim se kuca, bez Entera).
  const [term, setTerm] = useState(q)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
            onClick={() => setParam("status", o.value)}
            className={cn(
              "px-3 py-1 rounded-full text-sm border transition",
              status === o.value
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Klijent (firma) dropdown */}
      <Select value={klijentId} onValueChange={(v) => setKlijent(v ?? "svi")} items={firmaItems}>
        <SelectTrigger className="w-48" data-testid="filter-klijent">
          <SelectValue placeholder="Sve firme" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">Sve firme</SelectItem>
          {klijenti.map((k) => (
            <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Lokacija dropdown — samo kad je firma izabrana i ima lokacija */}
      {firmaLokacije.length > 0 && (
        <Select value={lokacijaId} onValueChange={(v) => setParam("lokacija", v)} items={lokacijaItems}>
          <SelectTrigger className="w-48" data-testid="filter-lokacija">
            <SelectValue placeholder="Sve lokacije" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="svi">Sve lokacije</SelectItem>
            {firmaLokacije.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Vrsta dropdown */}
      <Select value={vrstaId} onValueChange={(v) => setParam("vrsta_id", v)} items={vrstaItems}>
        <SelectTrigger className="w-48" data-testid="filter-vrsta">
          <SelectValue placeholder="Sve vrste" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">Sve vrste</SelectItem>
          {vrste.map((v) => (
            <SelectItem key={v.id} value={v.id}>{v.naziv}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Mjesec dropdown */}
      <Select value={mjesec} onValueChange={(v) => setParam("mjesec", v)} items={mjesecItems}>
        <SelectTrigger className="w-36" data-testid="filter-mjesec">
          <SelectValue placeholder="Svi mjeseci" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">Svi mjeseci</SelectItem>
          {MONTHS_BS_OPTION.map((m) => (
            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Search — live (debounce); Enter samo ubrza */}
      <Input
        type="search"
        placeholder="Pretraga firme..."
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
