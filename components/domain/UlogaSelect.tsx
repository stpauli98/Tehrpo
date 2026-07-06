"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { postaviUlogu } from "@/app/(dashboard)/postavke/actions"

type Uloga = "admin" | "operater" | "pregled"

const ULOGE: Uloga[] = ["admin", "operater", "pregled"]

export function UlogaSelect({
  korisnikId,
  uloga,
  jeJa,
}: {
  korisnikId: string
  uloga: Uloga
  jeJa: boolean
}) {
  const t = useTranslations("postavke.ulogaSelect")
  const tu = useTranslations("postavke.uloge")
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <select
      defaultValue={uloga}
      disabled={pending || jeJa}
      title={jeJa ? t("vlastitaUlogaTitle") : t("promijeniUlogu")}
      data-testid={`uloga-select-${korisnikId}`}
      onChange={(e) => {
        const next = e.target.value as Uloga
        start(async () => {
          const r = await postaviUlogu(korisnikId, next)
          if (r.ok) {
            toast.success(t("sacuvano"))
            router.refresh()
          } else {
            toast.error(r.message ?? t("greska"))
            router.refresh() // vrati select na stvarnu vrijednost ako je brana odbila
          }
        })
      }}
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
    >
      {ULOGE.map((v) => (
        <option key={v} value={v}>
          {tu(v)}
        </option>
      ))}
    </select>
  )
}
