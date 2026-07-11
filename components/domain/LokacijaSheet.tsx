"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, Pencil } from "lucide-react"
import { Tooltip } from "@/components/ui/ikona-tooltip"
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
import { Input } from "@/components/ui/input"
import { useAkcijaToast } from "@/components/akcija-toast"
import { createLokacija, updateLokacija, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"
import { useMozeUrediti } from "@/providers/korisnik-provider"

type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

const initial: ActionResult = { ok: true }

export function LokacijaSheet({
  klijentId,
  lokacija,
}: {
  klijentId: string
  lokacija?: LokacijaRow
}) {
  const t = useTranslations("klijenti.lokacijaSheet")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const isEdit = !!lokacija

  const FIELDS: readonly [string, string, boolean][] = [
    ["naziv", t("poljeNaziv"), true],
    ["grad", t("poljeGrad"), false],
    ["regija", t("poljeRegija"), false],
    ["adresa", t("poljeAdresa"), false],
    ["kontakt_osoba", t("poljeKontaktOsoba"), false],
    ["kontakt_email", t("poljeEmail"), false],
    ["kontakt_telefon", t("poljeTelefon"), false],
  ]
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    isEdit ? updateLokacija : createLokacija,
    initial,
  )
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  if (!mozeUrediti) return null

  const trigger = isEdit ? (
    <Button variant="outline" size="icon-sm" data-testid={`uredi-lokaciju-${lokacija.id}`} aria-label={t("uredi")} className="group/tt relative">
      <Pencil className="h-4 w-4" aria-hidden />
      <Tooltip>{t("uredi")}</Tooltip>
    </Button>
  ) : (
    <Button data-testid="nova-lokacija-btn">
      <Plus className="w-4 h-4" aria-hidden /> {t("novi")}
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="lokacija-sheet"
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? t("naslovUredi") : t("naslovNovi")}</DialogTitle>
        </DialogHeader>

        <form
          key={lokacija?.id ?? "new"}
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="lokacija-form"
        >
          {isEdit ? (
            <input type="hidden" name="id" value={lokacija.id} />
          ) : (
            <input type="hidden" name="klijent_id" value={klijentId} />
          )}

          {FIELDS.map(([name, label, req]) => (
            <label key={name} className="block text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Input
                name={name}
                required={req}
                defaultValue={
                  isEdit
                    ? (lokacija[name as keyof LokacijaRow] as string | null | undefined) ?? ""
                    : ""
                }
                data-testid={`lokacija-${name}`}
              />
            </label>
          ))}

          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending} data-testid="lokacija-submit">
            {pending ? t("submitPending") : isEdit ? t("submitEdit") : t("submitNovi")}
          </Button>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
