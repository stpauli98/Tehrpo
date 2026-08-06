"use client"
import { useActionState, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAkcijaToast } from "@/components/akcija-toast"
import { urediKorisnika, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FieldError } from "./FieldError"

const initial: ActionResult = { ok: true }

export function UrediKorisnikaDialog({
  trigger,
  korisnikId,
  ime,
  email,
}: {
  trigger: React.ReactElement
  korisnikId: string
  ime: string
  email: string
}) {
  const t = useTranslations("postavke.urediKorisnika")
  const [open, setOpen] = useState(false)
  // `instanca` remount-uje formu pri svakom otvaranju (isti trik kao NoviKorisnikButton):
  // briše zaostale greške i vraća polja na proslijeđene vrijednosti.
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
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader><DialogTitle>{t("naslov")}</DialogTitle></DialogHeader>
        <UrediKorisnikaForma key={instanca} korisnikId={korisnikId} ime={ime} email={email} onGotovo={zatvori} />
      </DialogContent>
    </Dialog>
  )
}

function UrediKorisnikaForma({
  korisnikId,
  ime,
  email,
  onGotovo,
}: {
  korisnikId: string
  ime: string
  email: string
  onGotovo: () => void
}) {
  const t = useTranslations("postavke.urediKorisnika")
  const tc = useTranslations("common")
  const router = useRouter()
  const [state, action, pending] = useActionState(urediKorisnika, initial)
  const submitted = useRef(false)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      onGotovo()
      router.refresh()
    }
  }, [state, pending, router, onGotovo])

  const greske = state.ok === false ? state.errors : undefined
  const idImeGreska = `uredi-korisnik-ime-greska-${korisnikId}`
  const idEmailGreska = `uredi-korisnik-email-greska-${korisnikId}`

  return (
    <form
      action={(fd) => {
        submitted.current = true
        action(fd)
      }}
      className="space-y-3"
    >
      <input type="hidden" name="id" value={korisnikId} />
      <div>
        <label className="block text-sm">
          <span className="text-muted-foreground">{t("poljeIme")}</span>
          <Input
            name="ime"
            required
            defaultValue={ime}
            data-testid={`uredi-korisnik-ime-${korisnikId}`}
            aria-describedby={greske?.ime ? idImeGreska : undefined}
          />
        </label>
        <FieldError id={idImeGreska} errors={greske?.ime} />
      </div>
      <div>
        <label className="block text-sm">
          <span className="text-muted-foreground">{t("poljeEmail")}</span>
          <Input
            name="email"
            type="email"
            required
            defaultValue={email}
            data-testid={`uredi-korisnik-email-${korisnikId}`}
            aria-describedby={greske?.email ? idEmailGreska : undefined}
          />
        </label>
        <FieldError id={idEmailGreska} errors={greske?.email} />
      </div>
      {state.ok === false && state.message && (
        <p className="text-sm text-destructive" role="alert">{state.message}</p>
      )}
      <Button type="submit" disabled={pending} className="w-full" data-testid={`uredi-korisnik-submit-${korisnikId}`}>
        {pending ? t("submitPending") : t("submit")}
      </Button>
    </form>
  )
}
