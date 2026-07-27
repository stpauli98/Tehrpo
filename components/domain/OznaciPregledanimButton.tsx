"use client"

import { useTransition } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { toastRezultat } from "@/components/akcija-toast"
import { useUloga } from "@/providers/korisnik-provider"
import { mozeUrediti } from "@/lib/auth/roles"
import { oznaciPregledanim } from "@/app/(dashboard)/poslati-mejlovi/actions"

/**
 * Per-red akcija "Označi pregledanim" (S2 + odluka O4).
 *
 * Klijentska omotnica oko serverske akcije: pending (disabled + `aria-busy`)
 * spriječava dupli zahtjev, a `toastRezultat` daje jedini vidljivi feedback za
 * grešku (uspjeh se inače vidi tek kroz `revalidatePath`).
 *
 * Gate (O4) — dugme se ne renderuje kad:
 *  - uloga ne smije uređivati (`pregled` / nepoznata uloga), ili
 *  - red nema `klijent_id`, a korisnik nije admin: RPC bi takav red tiho preskočio
 *    (RLS takve redove ne-adminima ionako ne prikazuje — gate je defanzivan).
 */
export function OznaciPregledanimButton({
  id,
  imaKlijenta,
}: {
  id: string
  imaKlijenta: boolean
}) {
  const uloga = useUloga()
  const t = useTranslations("poslatiMejlovi")
  const [isPending, startTransition] = useTransition()

  // Gate tek POSLIJE svih hook poziva (Rules of Hooks).
  if (!uloga || !mozeUrediti(uloga)) return null
  if (!imaKlijenta && uloga !== "admin") return null

  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      disabled={isPending}
      aria-busy={isPending}
      onClick={() =>
        startTransition(async () => {
          toastRezultat(await oznaciPregledanim(id), {
            uspjeh: t("oznacenoPregledanim"),
            greska: t("greskaOznacavanja"),
          })
        })
      }
    >
      {t("oznaciPregledanim")}
    </Button>
  )
}
