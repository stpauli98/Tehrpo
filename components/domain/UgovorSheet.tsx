"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, Pencil } from "lucide-react"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createUgovor, updateUgovor, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"
import { useMozeUrediti } from "@/providers/korisnik-provider"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
const initial: ActionResult = { ok: true }

export function UgovorSheet({ klijentId, ugovor }: { klijentId: string; ugovor?: UgovorRow }) {
  const t = useTranslations("klijenti.ugovorSheet")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const isEdit = !!ugovor
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(isEdit ? updateUgovor : createUgovor, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  if (!mozeUrediti) return null

  const trigger = isEdit
    ? <Button variant="outline" size="icon-sm" data-testid={`uredi-ugovor-${ugovor.id}`} aria-label={t("uredi")} className="group/tt relative"><Pencil className="h-4 w-4" aria-hidden /><Tooltip>{t("uredi")}</Tooltip></Button>
    : <Button data-testid="novi-ugovor-btn"><Plus className="w-4 h-4" aria-hidden /> {t("novi")}</Button>

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="ugovor-sheet">
        <DialogHeader><DialogTitle>{isEdit ? t("naslovUredi") : t("naslovNovi")}</DialogTitle></DialogHeader>
        <form
          key={ugovor?.id ?? "new"}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="space-y-3"
          data-testid="ugovor-form"
        >
          {isEdit && <input type="hidden" name="id" value={ugovor.id} />}
          <input type="hidden" name="klijent_id" value={klijentId} />

          <label className="block text-sm">
            <span className="text-slate-600">{t("poljeZavodniBroj")}</span>
            <Input name="zavodni_broj" defaultValue={ugovor?.zavodni_broj ?? ""} data-testid="ugovor-zavodni" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">{t("poljeDatumPotpisivanja")}</span>
              <Input type="date" name="datum_potpisivanja" defaultValue={ugovor?.datum_potpisivanja ?? ""} data-testid="ugovor-potpis" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">{t("poljeDatumIsteka")}</span>
              <Input type="date" name="datum_isteka" defaultValue={ugovor?.datum_isteka ?? ""} data-testid="ugovor-istek" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">{t("poljeVazenje")}</span>
              <Input type="number" min={1} max={600} name="vazenje_mjeseci" defaultValue={ugovor?.vazenje_mjeseci ?? ""} data-testid="ugovor-vazenje" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">{t("poljeObilasci")}</span>
              <Input type="number" min={0} max={31} name="broj_obilazaka_mjesecno" defaultValue={ugovor?.broj_obilazaka_mjesecno ?? ""} data-testid="ugovor-obilasci" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="automatsko_obnavljanje" defaultChecked={ugovor?.automatsko_obnavljanje ?? false} data-testid="ugovor-auto" />
            <span className="text-slate-600">{t("poljeAutoObnavljanje")}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="aktivan" defaultChecked={ugovor?.aktivan ?? true} data-testid="ugovor-aktivan" />
            <span className="text-slate-600">{t("poljeAktivan")}</span>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">{t("poljeNapomena")}</span>
            <Input name="napomena" defaultValue={ugovor?.napomena ?? ""} data-testid="ugovor-napomena" />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="ugovor-submit">
            {pending ? t("submitPending") : isEdit ? t("submitEdit") : t("submitNovi")}
          </Button>
        </form>
        <DialogFooter><DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} /></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
