"use client"

import { useActionState, useEffect, useRef, useState } from "react"
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
import { FieldError } from "@/components/domain/FieldError"
import { useAkcijaToast } from "@/components/akcija-toast"
import { createKlijent, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { useMozeUrediti } from "@/providers/korisnik-provider"

const initial: ActionResult = { ok: true }

export function NoviKlijentButton() {
  const t = useTranslations("klijenti.noviKlijent")
  const tc = useTranslations("common")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(createKlijent, initial)
  const submitted = useRef(false)
  const mozeUrediti = useMozeUrediti()
  useAkcijaToast(state, { uspjeh: t("uspjeh"), greska: tc("greska") })

  // Zatvori dialog TEK nakon stvarnog submita koji je uspio (submitted ref
  // razlikuje uspjeh od initial { ok: true } stanja).
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  if (!mozeUrediti) return null

  const errors = state.ok === false ? state.errors : undefined
  const opisano = (name: string) => (errors?.[name] ? `novi-klijent-${name}-err` : undefined)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button data-testid="novi-klijent-btn">
            <Plus className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("dugme")}
          </Button>
        }
      />
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="novi-klijent-sheet"
      >
        <DialogHeader>
          <DialogTitle>{t("naslov")}</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) => {
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="novi-klijent-form"
        >
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeNaziv")}</span>
            <Input
              name="naziv"
              required
              placeholder={t("placeholderNaziv")}
              data-testid="novi-klijent-naziv"
              aria-describedby={opisano("naziv")}
            />
            <FieldError id="novi-klijent-naziv-err" errors={errors?.naziv} />
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeAdresa")}</span>
            <Input name="adresa" required data-testid="novi-klijent-adresa" aria-describedby={opisano("adresa")} />
            <FieldError id="novi-klijent-adresa-err" errors={errors?.adresa} />
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeTelefon")}</span>
            <Input name="telefon" required data-testid="novi-klijent-telefon" aria-describedby={opisano("telefon")} />
            <FieldError id="novi-klijent-telefon-err" errors={errors?.telefon} />
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeEmail")}</span>
            <Input name="email" type="email" required data-testid="novi-klijent-email" aria-describedby={opisano("email")} />
            <FieldError id="novi-klijent-email-err" errors={errors?.email} />
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeNapomena")}</span>
            <Input name="napomena" data-testid="novi-klijent-napomena" aria-describedby={opisano("napomena")} />
            <FieldError id="novi-klijent-napomena-err" errors={errors?.napomena} />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <DialogFooter className="mt-1">
            <DialogClose
              render={
                <Button type="button" variant="outline" data-testid="novi-klijent-cancel">
                  {tc("otkazi")}
                </Button>
              }
            />
            <Button type="submit" disabled={pending} data-testid="novi-klijent-submit">
              {pending ? t("submitPending") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
