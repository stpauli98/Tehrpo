"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { postaviUlogu } from "@/app/(dashboard)/postavke/actions"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

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
  // Base UI Select.Value renders the raw stored value umjesto prevedenog labela dok se
  // popup barem jednom ne otvori, OSIM ako Select.Root dobije `items` mapu — vidi
  // VrijemeSlanjaForm.tsx za isti obrazac.
  const ulogaItems = Object.fromEntries(ULOGE.map((v) => [v, tu(v)]))

  return (
    <Select
      items={ulogaItems}
      defaultValue={uloga}
      disabled={pending || jeJa}
      onValueChange={(v) => {
        const next = v as Uloga
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
    >
      <SelectTrigger
        size="sm"
        title={jeJa ? t("vlastitaUlogaTitle") : t("promijeniUlogu")}
        data-testid={`uloga-select-${korisnikId}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ULOGE.map((v) => (
          <SelectItem key={v} value={v}>
            {tu(v)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
