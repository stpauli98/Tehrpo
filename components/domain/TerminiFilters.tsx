"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { STATUS_FILTER_OPTIONS } from "@/lib/termini"
import { MONTHS_BS_OPTION } from "@/lib/termini-filters"

type Opt = { id: string; naziv: string }

export function TerminiFilters({
  klijenti, vrste,
}: {
  klijenti: Opt[]
  vrste: Opt[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const status = params.get("status") ?? "svi"
  const q = params.get("q") ?? ""
  const klijentId = params.get("klijent_id") ?? "svi"
  const vrstaId = params.get("vrsta_id") ?? "svi"
  const mjesec = params.get("mjesec") ?? "svi"

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (!value || value === "svi" || value === "") next.delete(key)
    else next.set(key, value)
    next.delete("page")       // reset paginaciju
    next.delete("selected")   // zatvori detalje
    startTransition(() => router.push(`/termini?${next.toString()}`))
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

      {/* Klijent dropdown */}
      <Select value={klijentId} onValueChange={(v) => setParam("klijent_id", v)}>
        <SelectTrigger className="w-48" data-testid="filter-klijent">
          <SelectValue placeholder="Svi klijenti" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">Svi klijenti</SelectItem>
          {klijenti.map((k) => (
            <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Vrsta dropdown */}
      <Select value={vrstaId} onValueChange={(v) => setParam("vrsta_id", v)}>
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
      <Select value={mjesec} onValueChange={(v) => setParam("mjesec", v)}>
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

      {/* Search */}
      <Input
        key={q}
        type="search"
        placeholder="Pretraga firme..."
        defaultValue={q}
        data-testid="filter-search"
        className="w-56 ml-auto"
        onKeyDown={(e) => {
          if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value)
        }}
      />
    </div>
  )
}
