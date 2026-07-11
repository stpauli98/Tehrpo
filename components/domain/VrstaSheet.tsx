"use client"

import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Pencil } from "lucide-react"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { updateVrsta, postaviVrstaAktivna, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function VrstaSheet({
  vrsta,
}: {
  vrsta: { id: string; naziv: string; interval: number | null; zakonski_osnov: string | null; aktivna: boolean; vodi_dokumentaciju: boolean }
}) {
  const router = useRouter()
  const t = useTranslations("termini.vrstaSheet")
  const tc = useTranslations("common")
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(updateVrsta, initial)
  const submitted = useRef(false)
  const [togglePending, startToggle] = useTransition()

  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; setOpen(false); router.refresh() }
  }, [state, pending, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button variant="outline" size="icon-sm" data-testid={`uredi-vrstu-${vrsta.id}`} aria-label={t("urediAriaLabel")} className="group/tt relative">
          <Pencil className="h-4 w-4" aria-hidden />
          <Tooltip>{t("urediAriaLabel")}</Tooltip>
        </Button>
      } />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="vrsta-sheet">
        <DialogHeader><DialogTitle>{t("naslov")}</DialogTitle></DialogHeader>
        <form
          key={vrsta.id}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="space-y-3"
          data-testid="vrsta-form"
        >
          <input type="hidden" name="id" value={vrsta.id} />
          {/* Interval se uređuje inline u tabeli "Vrste pregleda"; ovdje skriveno
              polje samo čuva trenutnu vrijednost da je updateVrsta ne prebriše na NULL. */}
          <input type="hidden" name="interval" value={vrsta.interval ?? ""} />
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeNaziv")}</span>
            <Input name="naziv" required defaultValue={vrsta.naziv} data-testid="vrsta-naziv" />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeZakonskiOsnov")}</span>
            <Input name="zakonski_osnov" defaultValue={vrsta.zakonski_osnov ?? ""} data-testid="vrsta-osnov" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="vodi_dokumentaciju" value="on" defaultChecked={vrsta.vodi_dokumentaciju} data-testid="vrsta-vodi-dok" />
            <span className="text-muted-foreground">{t("poljeVodiDokumentaciju")}</span>
          </label>
          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="vrsta-submit">
            {pending ? t("spremam") : t("spremiIzmjene")}
          </Button>
        </form>
        <DialogFooter className="justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={togglePending}
            data-testid="vrsta-toggle-aktivna"
            className={vrsta.aktivna ? "text-destructive border-destructive/30 hover:bg-destructive/10" : "text-green-700 border-green-200 hover:bg-green-50"}
            onClick={() => startToggle(async () => { await postaviVrstaAktivna(vrsta.id, !vrsta.aktivna); router.refresh() })}
          >
            {vrsta.aktivna ? t("deaktiviraj") : t("aktiviraj")}
          </Button>
          <DialogClose render={<Button variant="outline">{tc("zatvori")}</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
