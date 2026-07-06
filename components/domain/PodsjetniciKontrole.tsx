"use client"

import { useActionState, useRef, useState, useTransition } from "react"
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
import {
  updatePodsjetniciAktivni,
  pokreniPodsjetnikeSada,
  type ActionResult,
  type PokreniRezultat,
} from "@/app/(dashboard)/postavke/actions"

const initialToggleState: ActionResult = { ok: true }

// Kontrole automatskog slanja podsjetnika: toggle (perzistira se preko servera —
// bez lokalnog stanja koje bi preživjelo reload, isto kao PrimaPodsjetnikeToggle)
// i dugme za ručno pokretanje sa dijalogom potvrde (obrazac iz ObrisiKlijentButton).
export function PodsjetniciKontrole({ aktivni }: { aktivni: boolean }) {
  const t = useTranslations("postavke.podsjetniciKontrole")
  const tc = useTranslations("common")
  const formRef = useRef<HTMLFormElement>(null)
  const [toggleState, toggleAction, togglePending] = useActionState(
    updatePodsjetniciAktivni,
    initialToggleState,
  )

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [rezultat, setRezultat] = useState<PokreniRezultat | null>(null)

  function potvrdiPokretanje() {
    setDialogOpen(false)
    startTransition(async () => {
      setRezultat(await pokreniPodsjetnikeSada())
    })
  }

  return (
    <div className="space-y-4">
      <form ref={formRef} action={toggleAction} className="flex items-start gap-3">
        <input
          type="checkbox"
          name="aktivni"
          defaultChecked={aktivni}
          disabled={togglePending}
          aria-label={t("naslov")}
          title={t("naslov")}
          data-testid="podsjetnici-aktivni-toggle"
          className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
          onChange={(e) => {
            e.currentTarget.form?.requestSubmit()
          }}
        />
        <div>
          <p className="text-sm font-medium">{t("naslov")}</p>
          <p className="text-sm text-slate-500">{t("opis")}</p>
        </div>
      </form>
      {toggleState.ok === false && toggleState.message && (
        <p className="text-xs text-red-600" role="alert">
          {toggleState.message}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              data-testid="pokreni-podsjetnike"
            >
              {pending ? t("saljem") : t("pokreni")}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("potvrda")}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} />
            <Button
              type="button"
              data-testid="pokreni-podsjetnike-potvrdi"
              onClick={potvrdiPokretanje}
            >
              {t("pokreni")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rezultat && (
        <p
          data-testid="pokreni-rezultat"
          role={rezultat.ok ? undefined : "alert"}
          className={rezultat.ok ? "text-sm text-slate-600" : "text-sm text-red-600"}
        >
          {rezultat.ok
            ? t("rezultat", {
                poslano: rezultat.poslano,
                preskoceno: rezultat.preskoceno,
                greske: rezultat.greske,
              })
            : rezultat.message}
        </p>
      )}
    </div>
  )
}
