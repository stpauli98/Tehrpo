"use client"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"

const AKCIJE = ["INSERT","UPDATE","DELETE","NAVIGATE","VIEW","LOGIN","LOGOUT","FILTER"] as const

export function AktivnostFilteri() {
  const t = useTranslations("aktivnost")
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  function postavi(kljuc: string, vrijednost: string) {
    const p = new URLSearchParams(sp.toString())
    if (vrijednost) p.set(kljuc, vrijednost)
    else p.delete(kljuc)
    p.delete("strana") // reset paginacije pri promjeni filtera
    router.push(`${pathname}?${p.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.akcija")}
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          defaultValue={sp.get("akcija") ?? ""}
          onChange={(e) => postavi("akcija", e.target.value)}
        >
          <option value="">{t("filteri.svi")}</option>
          {AKCIJE.map((a) => (
            <option key={a} value={a}>{t(`akcije.${a}` as never)}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.pretraga")}
        <input
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          defaultValue={sp.get("q") ?? ""}
          onBlur={(e) => postavi("q", e.target.value.trim())}
          placeholder="…"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.od")}
        <input type="date" className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          defaultValue={sp.get("od") ?? ""} onChange={(e) => postavi("od", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.do")}
        <input type="date" className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          defaultValue={sp.get("do") ?? ""} onChange={(e) => postavi("do", e.target.value)} />
      </label>
      <button
        className="rounded-md border border-input px-3 py-1 text-sm"
        onClick={() => router.push(pathname)}
      >
        {t("filteri.ocisti")}
      </button>
    </div>
  )
}
