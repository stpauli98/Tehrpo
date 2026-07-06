"use client"
import { useTransition } from "react"
import { useTranslations } from "next-intl"
import { postaviPrimaPodsjetnike } from "@/app/(dashboard)/postavke/actions"
import { toast } from "sonner"

export function PrimaPodsjetnikeToggle({ korisnikId, prima }: { korisnikId: string; prima: boolean }) {
  const t = useTranslations("postavke.primaPodsjetnike")
  const [pending, start] = useTransition()
  return (
    <input
      type="checkbox"
      defaultChecked={prima}
      disabled={pending}
      aria-label={t("aria")}
      title={t("aria")}
      className="h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
      onChange={(e) => {
        const el = e.currentTarget
        const next = el.checked
        start(async () => {
          const r = await postaviPrimaPodsjetnike(korisnikId, next)
          if (!r.ok) el.checked = !next // brana odbila → vrati na stvarno stanje
          toast[r.ok ? "success" : "error"](r.ok ? t("sacuvano") : (r.message ?? t("greska")))
        })
      }}
    />
  )
}
