"use client"

import { useState, useTransition } from "react"
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

/**
 * Standardni dialog za potvrdu brisanja (S3/O3, kanon: ObrisiKlijentButton).
 *
 * Namjena: brisanja iz listi/tabela/stranica. Unutar VEĆ otvorenog sheet-a ili
 * dialoga važi dvostepeni „arm" obrazac (O3) — NE ovaj dialog.
 *
 * Komponenta NE prikazuje toast i NE radi RBAC:
 * - toast po potrebi zove pozivalac unutar svog `onPotvrdi` (npr. `toastRezultat`,
 *   kao ObrisiKlijentButton) — nema zavisnosti na `akcija-toast`;
 * - rendering gate-uje pozivalac sa `useMozeUrediti()` (CLAUDE.md konvencija).
 *
 * Ponašanje: potvrda ide kroz `startTransition`; tokom pendinga su oba dugmeta
 * disabled, a potvrda prikazuje `common.ucitavanje`. Na `ok:false` dialog ostaje
 * otvoren sa inline greškom (`message ?? common.greska`); na `ok:true` se zatvara
 * i poziva `onUspjeh?.()`.
 */
export function PotvrdiBrisanjeDialog({
  trigger,
  naslov,
  opis,
  potvrdiLabel,
  onPotvrdi,
  onUspjeh,
  testId,
}: {
  trigger: React.ReactElement
  naslov: string
  opis: string
  potvrdiLabel?: string
  onPotvrdi: () => Promise<{ ok: true } | { ok: false; message?: string }>
  onUspjeh?: () => void
  testId?: string
}) {
  const tc = useTranslations("common")
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setErrorMsg(null)
  }

  function handlePotvrdi() {
    setErrorMsg(null)
    startTransition(async () => {
      const result = await onPotvrdi()
      if (result.ok) {
        setOpen(false)
        onUspjeh?.()
      } else {
        setErrorMsg(result.message ?? tc("greska"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{naslov}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{opis}</p>
        {errorMsg && (
          <p className="text-sm text-destructive" role="alert">
            {errorMsg}
          </p>
        )}
        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={isPending}>
                {tc("otkazi")}
              </Button>
            }
          />
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={handlePotvrdi}
          >
            {isPending ? tc("ucitavanje") : (potvrdiLabel ?? tc("obrisi"))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
