"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { deleteKlijent } from "@/app/(dashboard)/klijenti/actions"
import { useState } from "react"
import { href } from "@/i18n/routes"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import { toastRezultat } from "@/components/akcija-toast"

export function ObrisiKlijentButton({
  klijentId,
  brojTermina,
}: {
  klijentId: string
  brojTermina: number
}) {
  const t = useTranslations("klijenti.obrisi")
  const tc = useTranslations("common")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const mozeUrediti = useMozeUrediti()
  if (!mozeUrediti) return null

  // Klijent sa terminima se NE može obrisati (FK RESTRICT) — disable + objašnjenje.
  // Disabled dugme nije fokusabilno, pa objašnjenje nosi fokusabilan wrapper sa
  // tooltipom (S12: informacija nikad samo u `title` atributu).
  if (brojTermina > 0) {
    return (
      <span tabIndex={0} className="group/tt relative inline-flex rounded-lg">
        <Button
          variant="outline"
          size="sm"
          disabled
          data-testid="obrisi-klijent-disabled"
        >
          {tc("obrisi")}
        </Button>
        <Tooltip>{t("disabledTitle")}</Tooltip>
      </span>
    )
  }

  function handleDelete() {
    setErrorMsg(null)
    const fd = new FormData()
    fd.append("id", klijentId)
    startTransition(async () => {
      const result = toastRezultat(await deleteKlijent({ ok: true }, fd), {
        uspjeh: tc("obrisano"),
        greska: t("greskaFallback"),
      })
      if (result.ok) {
        router.push(href("/klijenti"))
      } else {
        setErrorMsg("message" in result && result.message ? result.message : t("greskaFallback"))
      }
    })
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm" data-testid="obrisi-klijent-btn">
            {tc("obrisi")}
          </Button>
        }
      />
      <DialogContent data-testid="obrisi-klijent-dialog">
        <DialogHeader>
          <DialogTitle>{t("dialogNaslov")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("dialogOpis")}
        </p>
        {errorMsg && (
          <p className="text-sm text-destructive" role="alert">
            {errorMsg}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} />
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            data-testid="obrisi-klijent-potvrdi"
            onClick={handleDelete}
          >
            {isPending ? t("confirmPending") : tc("obrisi")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
