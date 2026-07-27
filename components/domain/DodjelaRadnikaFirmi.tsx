"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { postaviDodjeleZaKlijenta } from "@/app/(dashboard)/klijenti/[id]/actions"
import { toastRezultat } from "@/components/akcija-toast"

export function DodjelaRadnikaFirmi({
  klijentId, radnici, izabrani,
}: { klijentId: string; radnici: { id: string; ime: string }[]; izabrani: string[] }) {
  const t = useTranslations("klijenti.dodjelaRadnika")
  const tc = useTranslations("common")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [sel, setSel] = useState<Set<string>>(new Set(izabrani))

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function spasi() {
    // Snapshot prije poziva: na {ok:false} vraćamo checkboxe na stanje iz baze,
    // inače UI tvrdi jedno a baza drugo (S2 — optimistic update mora imati rollback).
    const prije = new Set(sel)
    startTransition(async () => {
      const res = toastRezultat(await postaviDodjeleZaKlijenta(klijentId, [...sel]), {
        uspjeh: t("spaseno"),
        greska: tc("greska"),
      })
      if (res.ok) router.refresh()
      else setSel(prije)
    })
  }

  return (
    <div className="max-w-xl space-y-3" data-testid="dodjela-radnika">
      <div>
        <p className="text-sm font-medium">{t("naslov")}</p>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      <div className="space-y-1">
        {radnici.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm" data-testid={`radnik-${r.id}`}>
            <Checkbox
              checked={sel.has(r.id)}
              onCheckedChange={() => toggle(r.id)}
              aria-label={t("checkboxAriaLabel", { ime: r.ime })}
            />
            {r.ime}
          </label>
        ))}
        {radnici.length === 0 && <p className="text-sm text-muted-foreground">{t("nemaRadnika")}</p>}
      </div>
      <Button type="button" size="sm" onClick={spasi} disabled={pending} data-testid="dodjela-radnika-spasi">
        {pending ? t("snimam") : t("spasi")}
      </Button>
    </div>
  )
}
