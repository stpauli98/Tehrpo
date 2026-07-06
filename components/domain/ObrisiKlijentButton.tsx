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
import { deleteKlijent } from "@/app/(dashboard)/klijenti/actions"
import { useState } from "react"
import { href } from "@/i18n/routes"

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

  // Klijent sa terminima se NE može obrisati (FK RESTRICT) — disable + objašnjenje
  if (brojTermina > 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        title={t("disabledTitle")}
        data-testid="obrisi-klijent-disabled"
      >
        {tc("obrisi")}
      </Button>
    )
  }

  function handleDelete() {
    setErrorMsg(null)
    const fd = new FormData()
    fd.append("id", klijentId)
    startTransition(async () => {
      const result = await deleteKlijent({ ok: true }, fd)
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
        <p className="text-sm text-slate-600">
          {t("dialogOpis")}
        </p>
        {errorMsg && (
          <p className="text-sm text-red-600" role="alert">
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
