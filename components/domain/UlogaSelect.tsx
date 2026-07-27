"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toastRezultat } from "@/components/akcija-toast"
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
  // `verzija` forsira REMOUNT Select-a nakon ODBIJENE promjene (isti rollback obrazac
  // kao kod checkbox toggle-ova — SaljiKlijentimaToggle/PodsjetniciKontrole): Select je
  // nekontrolisan (`defaultValue`), a `router.refresh()` ne remount-uje komponentu, pa
  // bi bez novog `key`-a prikaz ostao na neuspjeloj ulozi (npr. kad brana "bar jedan
  // admin" odbije). Nova instanca kreće od server-propa `uloga`.
  const [verzija, setVerzija] = useState(0)
  // Base UI Select.Value renders the raw stored value umjesto prevedenog labela dok se
  // popup barem jednom ne otvori, OSIM ako Select.Root dobije `items` mapu — vidi
  // VrijemeSlanjaForm.tsx za isti obrazac.
  const ulogaItems = Object.fromEntries(ULOGE.map((v) => [v, tu(v)]))

  return (
    <Select
      key={verzija}
      items={ulogaItems}
      defaultValue={uloga}
      disabled={pending || jeJa}
      onValueChange={(v) => {
        const next = v as Uloga
        start(async () => {
          const res = toastRezultat(await postaviUlogu(korisnikId, next), {
            uspjeh: t("sacuvano"),
            greska: t("greska"),
          })
          // Uspjeh → svjež server-prop kroz refresh; neuspjeh → remount vraća prikaz
          // na `uloga` (refresh sam po sebi ne bi vratio nekontrolisani Select).
          if (res.ok) router.refresh()
          else setVerzija((n) => n + 1)
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
