"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { MONTHS_BS, currentYear } from "@/lib/date"

export function ObilasciToolbar({
  period: initialPeriod,
  godina: initialGodina,
  mjesec: initialMjesec,
  kvartal: initialKvartal,
}: {
  period?: string
  godina?: number
  mjesec?: number
  kvartal?: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [, startTransition] = useTransition()

  const period = sp.get("period") ?? initialPeriod ?? "mjesec"
  const godinaStr = sp.get("godina") ?? String(initialGodina ?? currentYear())
  const mjesecStr = sp.get("mjesec") ?? (initialMjesec ? String(initialMjesec) : "")
  const kvartalStr = sp.get("kvartal") ?? (initialKvartal ? String(initialKvartal) : "")

  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.push(`${pathname}?${next.toString()}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="obilasci-toolbar">
      <Select value={period} onValueChange={(v) => setParam("period", v ?? "")}>

        <SelectTrigger data-testid="obilasci-period" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mjesec">Mjesec</SelectItem>
          <SelectItem value="kvartal">Kvartal</SelectItem>
          <SelectItem value="godina">Godina</SelectItem>
        </SelectContent>
      </Select>

      {period === "mjesec" && (
        <Select value={mjesecStr} onValueChange={(v) => setParam("mjesec", v ?? "")}>
          <SelectTrigger data-testid="obilasci-mjesec" className="w-40">
            <SelectValue placeholder="Månac" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS_BS.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {period === "kvartal" && (
        <Select value={kvartalStr} onValueChange={(v) => setParam("kvartal", v ?? "")}>
          <SelectTrigger data-testid="obilasci-kvartal" className="w-32">
            <SelectValue placeholder="Kvartal" />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((q) => (
              <SelectItem key={q} value={String(q)}>{`Q${q}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={godinaStr} onValueChange={(v) => setParam("godina", v ?? "")}>

        <SelectTrigger data-testid="obilasci-godina" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {godine.map((g) => (
            <SelectItem key={g} value={String(g)}>{g}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
