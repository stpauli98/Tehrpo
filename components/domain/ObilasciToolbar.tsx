"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { monthName, currentYear } from "@/lib/date"
import { STATUS_FILTER_OPTIONS } from "@/lib/termini"
import { usePendingFilteri } from "@/lib/use-pending-filteri"
import { cn } from "@/lib/utils"

const MJESEC_NAZIVI = Array.from({ length: 12 }, (_, i) => monthName(i + 1))

// Jedan izvor za status select: "aktivni" (obilasci-specifično) + zajedničke opcije iz lib/termini.
const STATUS_OPCIJE = [{ value: "aktivni", labelKey: "aktivni" } as const, ...STATUS_FILTER_OPTIONS]

export function ObilasciToolbar({
  period: initialPeriod,
  godina: initialGodina,
  mjesec: initialMjesec,
  kvartal: initialKvartal,
  gradovi,
  godine,
}: {
  period?: string
  godina?: number
  mjesec?: number
  kvartal?: number
  gradovi?: string[]
  /**
   * Godine za koje postoje termini — dolaze iz `lib/queries/godine.ts`
   * (`dohvatiGodineTermina`, koji sam pada na tekuću ± 1). Obavezan prop: toolbar
   * namjerno više nema vlastiti `currentYear() ± 1` hardkod (S8.1).
   */
  godine: number[]
}) {
  const t = useTranslations("obilasci.toolbar")
  const tStatus = useTranslations("status")
  const pathname = usePathname()
  const sp = useSearchParams()
  const { isPending, push } = usePendingFilteri()

  const period = sp.get("period") ?? initialPeriod ?? "mjesec"
  const godinaStr = sp.get("godina") ?? String(initialGodina ?? currentYear())
  const mjesecStr = sp.get("mjesec") ?? (initialMjesec ? String(initialMjesec) : "")
  const kvartalStr = sp.get("kvartal") ?? (initialKvartal ? String(initialKvartal) : "")
  const status = sp.get("status") ?? "aktivni"
  const grad = sp.get("grad") ?? "svi"

  const periodItems: Record<string, string> = {
    mjesec: t("periodMjesec"), kvartal: t("periodKvartal"), godina: t("periodGodina"),
  }
  const statusItems: Record<string, string> = Object.fromEntries(
    STATUS_OPCIJE.map((o) => [o.value, tStatus(o.labelKey)])
  )
  const gradItems: Record<string, string> = {
    svi: t("gradSvi"), __bez__: t("gradBez"),
    ...Object.fromEntries((gradovi ?? []).map((g) => [g, g])),
  }
  const mjesecItems: Record<string, string> = Object.fromEntries(
    MJESEC_NAZIVI.map((label, i) => [String(i + 1), label])
  )
  const kvartalItems: Record<string, string> = Object.fromEntries(
    [1, 2, 3, 4].map((q) => [String(q), t("kvartalLabel", { broj: q })])
  )
  const godinaItems: Record<string, string> = Object.fromEntries(
    godine.map((g) => [String(g), String(g)])
  )

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    // Svaka promjena filtera vraća na prvu stranu (kanon: AktivnostSearch.tsx).
    next.delete("strana")
    push(`${pathname}?${next.toString()}`)
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-3", isPending && "opacity-60")}
      data-testid="obilasci-toolbar"
      aria-busy={isPending}
      data-pending={isPending}
    >
      <Select value={period} onValueChange={(v) => setParam("period", v ?? "")} items={periodItems}>
        <SelectTrigger data-testid="obilasci-period" className="w-40" disabled={isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mjesec">{t("periodMjesec")}</SelectItem>
          <SelectItem value="kvartal">{t("periodKvartal")}</SelectItem>
          <SelectItem value="godina">{t("periodGodina")}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(v) => setParam("status", v ?? "")} items={statusItems}>
        <SelectTrigger data-testid="obilasci-status" className="w-40" disabled={isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPCIJE.map((o) => (
            <SelectItem key={o.value} value={o.value}>{tStatus(o.labelKey)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={grad} onValueChange={(v) => setParam("grad", v === "svi" ? "" : (v ?? ""))} items={gradItems}>
        <SelectTrigger data-testid="obilasci-grad" className="w-44" disabled={isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">{t("gradSvi")}</SelectItem>
          {(gradovi ?? []).map((g) => (
            <SelectItem key={g} value={g}>{g}</SelectItem>
          ))}
          <SelectItem value="__bez__">{t("gradBez")}</SelectItem>
        </SelectContent>
      </Select>

      {period === "mjesec" && (
        <Select value={mjesecStr} onValueChange={(v) => setParam("mjesec", v ?? "")} items={mjesecItems}>
          <SelectTrigger data-testid="obilasci-mjesec" className="w-40" disabled={isPending}>
            <SelectValue placeholder={t("placeholderMjesec")} />
          </SelectTrigger>
          <SelectContent>
            {MJESEC_NAZIVI.map((m, i) => (
              <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {period === "kvartal" && (
        <Select value={kvartalStr} onValueChange={(v) => setParam("kvartal", v ?? "")} items={kvartalItems}>
          <SelectTrigger data-testid="obilasci-kvartal" className="w-32" disabled={isPending}>
            <SelectValue placeholder={t("placeholderKvartal")} />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((q) => (
              <SelectItem key={q} value={String(q)}>{t("kvartalLabel", { broj: q })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={godinaStr} onValueChange={(v) => setParam("godina", v ?? "")} items={godinaItems}>
        <SelectTrigger data-testid="obilasci-godina" className="w-28" disabled={isPending}>
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
