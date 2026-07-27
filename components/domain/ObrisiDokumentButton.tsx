"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { toastRezultat } from "@/components/akcija-toast"
import { deleteDokumentAction } from "@/app/(dashboard)/dokumenti/actions"
import { useUloga } from "@/providers/korisnik-provider"
import { jeAdmin } from "@/lib/auth/roles"
import { PotvrdiBrisanjeDialog } from "./PotvrdiBrisanjeDialog"

export function ObrisiDokumentButton({
  dokumentId,
  label,
  testId = "dokument-obrisi",
}: {
  dokumentId: string
  label?: string
  testId?: string
}) {
  const t = useTranslations("dokumenti")
  const tc = useTranslations("common")
  const router = useRouter()
  const uloga = useUloga()
  // Brisanje dokumenata je admin-only (server akcija to i nameće) — ne-adminima ne nudi dugme.
  if (!uloga || !jeAdmin(uloga)) return null
  const resolvedLabel = label ?? t("obrisiDokument")

  // Pending i inline grešku nosi sam dialog; toast ide odavde (obrazac ObrisiKlijentButton).
  async function obrisi() {
    const fd = new FormData()
    fd.append("dokument_id", dokumentId)
    return toastRezultat(await deleteDokumentAction({ ok: true }, fd), {
      uspjeh: tc("obrisano"),
      greska: tc("greska"),
    })
  }

  return (
    <PotvrdiBrisanjeDialog
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid={testId}
          aria-label={resolvedLabel}
          className="group/tt relative text-destructive hover:bg-destructive/20 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          <Tooltip>{resolvedLabel}</Tooltip>
        </Button>
      }
      naslov={t("potvrdaBrisanjaNaslov")}
      opis={t("potvrdaBrisanjaOpis")}
      onPotvrdi={obrisi}
      onUspjeh={() => router.refresh()}
      testId="dokument-obrisi-dialog"
    />
  )
}
