"use client"
import { useId } from "react"
import { useSearchParams, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { AKCIJE } from "@/lib/aktivnost/tipovi"
import { usePendingFilteri } from "@/lib/use-pending-filteri"
import { cn } from "@/lib/utils"

// Sentinel za „bez filtera" — base-ui Select ne prima prazan string kao vrijednost stavke.
const SVI = "svi"

export function AktivnostFilteri() {
  const t = useTranslations("aktivnost")
  const pathname = usePathname()
  const sp = useSearchParams()
  const { isPending, push } = usePendingFilteri()
  const akcijaLabelId = useId()

  // items mapa value→label — base-ui SelectValue prikazuje labelu kad je dropdown zatvoren
  const akcijaItems: Record<string, string> = {
    [SVI]: t("filteri.svi"),
    ...Object.fromEntries(AKCIJE.map((a) => [a, t(`akcije.${a}` as never)])),
  }

  function postavi(kljuc: string, vrijednost: string) {
    const p = new URLSearchParams(sp.toString())
    if (vrijednost) p.set(kljuc, vrijednost)
    else p.delete(kljuc)
    p.delete("strana") // reset paginacije pri promjeni filtera
    push(`${pathname}?${p.toString()}`)
  }

  return (
    <div
      aria-busy={isPending}
      className={cn("flex flex-wrap items-end gap-3", isPending && "opacity-60")}
    >
      {/* Labela je <span> + aria-labelledby: trigger je dugme, pa ga <label> ne bi ispravno imenovao. */}
      <div className="flex flex-col gap-1 text-xs">
        <span id={akcijaLabelId}>{t("filteri.akcija")}</span>
        <Select
          items={akcijaItems}
          value={sp.get("akcija") ?? SVI}
          onValueChange={(v) => postavi("akcija", !v || v === SVI ? "" : v)}
        >
          <SelectTrigger className="w-44" disabled={isPending} aria-labelledby={akcijaLabelId}>
            <SelectValue placeholder={t("filteri.svi")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SVI}>{t("filteri.svi")}</SelectItem>
            {AKCIJE.map((a) => (
              <SelectItem key={a} value={a}>{t(`akcije.${a}` as never)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.od")}
        <Input
          type="date"
          className="w-36"
          disabled={isPending}
          defaultValue={sp.get("od") ?? ""}
          onChange={(e) => postavi("od", e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.do")}
        <Input
          type="date"
          className="w-36"
          disabled={isPending}
          defaultValue={sp.get("do") ?? ""}
          onChange={(e) => postavi("do", e.target.value)}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() => push(pathname)}
      >
        {t("filteri.ocisti")}
      </Button>
    </div>
  )
}
