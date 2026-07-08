"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { postaviDodjeleZaKlijenta } from "@/app/(dashboard)/klijenti/[id]/actions"

export function DodjelaRadnikaFirmi({
  klijentId, radnici, izabrani,
}: { klijentId: string; radnici: { id: string; ime: string }[]; izabrani: string[] }) {
  const t = useTranslations("klijenti.dodjelaRadnika")
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
    startTransition(async () => {
      const res = await postaviDodjeleZaKlijenta(klijentId, [...sel])
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else toast.error(res.message)
    })
  }

  return (
    <div className="max-w-xl space-y-3" data-testid="dodjela-radnika">
      <div>
        <p className="text-sm font-medium">{t("naslov")}</p>
        <p className="text-sm text-slate-500">{t("opis")}</p>
      </div>
      <div className="space-y-1">
        {radnici.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm" data-testid={`radnik-${r.id}`}>
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)}
              className="h-4 w-4 cursor-pointer accent-brand" />
            {r.ime}
          </label>
        ))}
        {radnici.length === 0 && <p className="text-sm text-slate-400">{t("nemaRadnika")}</p>}
      </div>
      <Button type="button" size="sm" onClick={spasi} disabled={pending} data-testid="dodjela-radnika-spasi">
        {pending ? t("snimam") : t("spasi")}
      </Button>
    </div>
  )
}
