"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { useAkcijaToast } from "@/components/akcija-toast"
import { deleteProfilProvjere, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { useMozeUrediti } from "@/providers/korisnik-provider"

const initial: ActionResult = { ok: true }

export function ObrisiProfilButton({ id }: { id: string }) {
  const t = useTranslations("klijenti.obrisiProfil")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const [state, action, pending] = useActionState(deleteProfilProvjere, initial)
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("obrisano"), greska: tc("greska") })
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      router.refresh()
    }
  }, [state, pending, router])

  if (!mozeUrediti) return null

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="icon-sm" data-testid="obrisi-profil-btn" aria-label={tc("obrisi")} className="group/tt relative text-destructive hover:bg-destructive/20 hover:text-destructive"><Trash2 className="h-4 w-4" aria-hidden /><Tooltip>{t("tooltip")}</Tooltip></Button>
        }
      />
      <DialogContent data-testid="obrisi-profil-dialog">
        <DialogHeader>
          <DialogTitle>{t("dialogNaslov")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("dialogOpis")}
        </p>
        {state.ok === false && state.message && (
          <p className="text-sm text-destructive" role="alert">{state.message}</p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} />
          <form action={(fd) => { submitted.current = true; action(fd) }}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="destructive" disabled={pending} data-testid="obrisi-profil-potvrdi">
              {pending ? t("confirmPending") : t("potvrdi")}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
