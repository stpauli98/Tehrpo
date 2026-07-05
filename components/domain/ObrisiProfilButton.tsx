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
import { deleteProfilProvjere, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function ObrisiProfilButton({ id }: { id: string }) {
  const t = useTranslations("klijenti.obrisiProfil")
  const tc = useTranslations("common")
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteProfilProvjere, initial)
  const submitted = useRef(false)
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="icon-sm" data-testid="obrisi-profil-btn" aria-label={tc("obrisi")} className="group/tt relative text-red-600 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" aria-hidden /><Tooltip>{t("tooltip")}</Tooltip></Button>
        }
      />
      <DialogContent data-testid="obrisi-profil-dialog">
        <DialogHeader>
          <DialogTitle>{t("dialogNaslov")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">
          {t("dialogOpis")}
        </p>
        {state.ok === false && state.message && (
          <p className="text-sm text-red-600" role="alert">{state.message}</p>
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
