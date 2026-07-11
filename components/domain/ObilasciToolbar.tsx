"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { useTranslations } from "next-intl"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { monthName, currentYear } from "@/lib/date"

const MJESEC_NAZIVI = Array.from({ length: 12 }, (_, i) => monthName(i + 1))

export function ObilasciToolbar({
  period: initialPeriod,
  godina: initialGodina,
  mjesec: initialMjesec,
  kvartal: initialKvartal,
  gradovi,
}: {
  period?: string
  godina?: number
  mjesec?: number
  kvartal?: number
  gradovi?: string[]
}) {
  const t = useTranslations("obilasci.toolbar")
  const tStatus = useTranslations("status")
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [, startTransition] = useTransition()

  const period = sp.get("period") ?? initialPeriod ?? "mjesec"
  const godinaStr = sp.get("godina") ?? String(initialGodina ?? currentYear())
  const mjesecStr = sp.get("mjesec") ?? (initialMjesec ? String(initialMjesec) : "")
  const kvartalStr = sp.get("kvartal") ?? (initialKvartal ? String(initialKvartal) : "")
  const status = sp.get("status") ?? "aktivni"
  const grad = sp.get("grad") ?? "svi"

  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  const periodItems: Record<string, string> = {
    mjesec: t("periodMjesec"), kvartal: t("periodKvartal"), godina: t("periodGodina"),
  }
  const statusItems: Record<string, string> = {
    aktivni: t("statusAktivni"), svi: t("statusSvi"), kasni: tStatus("kasni"), planirano: tStatus("planirano"),
    zakazano: tStatus("zakazano"), izvrseno: tStatus("izvrseno"), otkazano: tStatus("otkazano"),
  }
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

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.push(`${pathname}?${next.toString()}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="obilasci-toolbar">
      <Select value={period} onValueChange={(v) => setParam("period", v ?? "")} items={periodItems}>

        <SelectTrigger data-testid="obilasci-period" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mjesec">{t("periodMjesec")}</SelectItem>
          <SelectItem value="kvartal">{t("periodKvartal")}</SelectItem>
          <SelectItem value="godina">{t("periodGodina")}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(v) => setParam("status", v ?? "")} items={statusItems}>
        <SelectTrigger data-testid="obilasci-status" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="aktivni">{t("statusAktivni")}</SelectItem>
          <SelectItem value="svi">{t("statusSvi")}</SelectItem>
          <SelectItem value="kasni">{tStatus("kasni")}</SelectItem>
          <SelectItem value="planirano">{tStatus("planirano")}</SelectItem>
          <SelectItem value="zakazano">{tStatus("zakazano")}</SelectItem>
          <SelectItem value="izvrseno">{tStatus("izvrseno")}</SelectItem>
          <SelectItem value="otkazano">{tStatus("otkazano")}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={grad} onValueChange={(v) => setParam("grad", v === "svi" ? "" : (v ?? ""))} items={gradItems}>
        <SelectTrigger data-testid="obilasci-grad" className="w-44">
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
          <SelectTrigger data-testid="obilasci-mjesec" className="w-40">
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
          <SelectTrigger data-testid="obilasci-kvartal" className="w-32">
            <SelectValue placeholder={t("placeholderKvartal")} />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((q) => (
              <SelectItem key={q} value={String(q)}>{t("kvartalLabel", { broj: q })}</SelectItem>
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
