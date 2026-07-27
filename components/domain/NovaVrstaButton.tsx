"use client"

import { useActionState, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
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
import { createVrsta, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function NovaVrstaButton() {
  const t = useTranslations("postavke.novaVrsta")
  const [open, setOpen] = useState(false)
  // `instanca` remount-uje sadržaj dijaloga pri SVAKOM otvaranju (kanon reseta:
  // DodjelaKlijenata). `useActionState` živi u pod-komponenti, pa remount briše
  // zaostalu poruku greške i vraća polja na prazno.
  const [instanca, setInstanca] = useState(0)
  const zatvori = useCallback(() => setOpen(false), [])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setInstanca((n) => n + 1)
        setOpen(o)
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="nova-vrsta-btn">
            <Plus className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("dugme")}
          </Button>
        }
      />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="nova-vrsta-sheet">
        <DialogHeader>
          <DialogTitle>{t("naslov")}</DialogTitle>
        </DialogHeader>
        <NovaVrstaForma key={instanca} onGotovo={zatvori} />
      </DialogContent>
    </Dialog>
  )
}

function NovaVrstaForma({ onGotovo }: { onGotovo: () => void }) {
  const router = useRouter()
  const t = useTranslations("postavke.novaVrsta")
  const tc = useTranslations("common")
  const [state, action, pending] = useActionState(createVrsta, initial)
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      onGotovo()
      router.refresh()
    }
  }, [state, pending, router, onGotovo])

  return (
    <form
      action={(fd) => {
        submitted.current = true
        action(fd)
      }}
      className="space-y-3"
      data-testid="nova-vrsta-form"
    >
      <label className="block text-sm">
        <span className="text-muted-foreground">{t("poljeNaziv")}</span>
        <Input
          name="naziv"
          required
          placeholder={t("placeholderNaziv")}
          data-testid="nova-vrsta-naziv"
        />
      </label>

      <label className="block text-sm">
        <span className="text-muted-foreground">{t("poljeInterval")}</span>
        <Input
          name="interval"
          type="number"
          min={1}
          max={120}
          placeholder={t("placeholderInterval")}
          data-testid="nova-vrsta-interval"
        />
      </label>

      <label className="block text-sm">
        <span className="text-muted-foreground">{t("poljeZakonskiOsnov")}</span>
        <Input
          name="zakonski_osnov"
          placeholder={t("placeholderZakonskiOsnov")}
          data-testid="nova-vrsta-osnov"
        />
      </label>

      {state.ok === false && state.message && (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      )}

      <DialogFooter className="flex-row justify-end gap-2">
        <DialogClose
          render={
            <Button type="button" variant="outline" data-testid="nova-vrsta-cancel">
              {tc("otkazi")}
            </Button>
          }
        />
        <Button type="submit" disabled={pending} data-testid="nova-vrsta-submit">
          {pending ? t("kreiram") : t("kreirajVrstu")}
        </Button>
      </DialogFooter>
    </form>
  )
}
