"use client"

import { useActionState, useEffect, useRef } from "react"
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
import { useAkcijaToast } from "@/components/akcija-toast"
import { deleteLokacija, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { useDozvole } from "@/providers/korisnik-provider"

const initial: ActionResult = { ok: true }

export function ObrisiLokacijuButton({ lokacijaId }: { lokacijaId: string }) {
  const t = useTranslations("klijenti.obrisiLokaciju")
  const tc = useTranslations("common")
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteLokacija, initial)
  const submitted = useRef(false)
  // Lokacija je dio "klijent, ugovor i lokacija" prekidača (20260730151000).
  const { smije_brisati_klijente } = useDozvole()
  useAkcijaToast(state, { uspjeh: tc("obrisano"), greska: tc("greska") })

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      router.refresh()
    }
  }, [state, pending, router])

  if (!smije_brisati_klijente) return null

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm" data-testid={`obrisi-lokaciju-${lokacijaId}`}>
            {tc("obrisi")}
          </Button>
        }
      />
      <DialogContent data-testid="obrisi-lokaciju-dialog">
        <DialogHeader>
          <DialogTitle>{t("dialogNaslov")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("dialogOpis")}
        </p>
        {state.ok === false && state.message && (
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} />
          <form
            action={(fd) => {
              submitted.current = true
              action(fd)
            }}
          >
            <input type="hidden" name="id" value={lokacijaId} />
            <Button
              type="submit"
              variant="destructive"
              disabled={pending}
              data-testid="obrisi-lokaciju-potvrdi"
            >
              {pending ? t("confirmPending") : tc("obrisi")}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
