"use client"
import { useCallback, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
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
  // Imperativno (NE useActionState): red ove komponente živi u KorisniciTabela koja
  // filtrira client-side po pretrazi (`q`). Uspješna izmjena imena/emaila kroz
  // revalidatePath zna da red više ne odgovara filteru → tabela ga unmount-uje ODMAH,
  // prije nego što bi useActionState stigao isporučiti novi state, pa toast/onGotovo
  // efekat vezan za taj state nikad ne bi okinuo (komponenta je već nestala). `toast`
  // (sonner) je modul-level poziv koji radi i nakon unmount-a; `onGotovo`/`router.refresh()`
  // zovemo direktno iz iste closure-e, bez oslanjanja na naknadni render ove komponente.
  const [state, setState] = useState<ActionResult>(initial)
  const [pending, startTransition] = useTransition()

  const greske = state.ok === false ? state.errors : undefined
  const idImeGreska = `uredi-korisnik-ime-greska-${korisnikId}`
  const idEmailGreska = `uredi-korisnik-email-greska-${korisnikId}`

  function submit(fd: FormData) {
    startTransition(async () => {
      const res = await urediKorisnika(initial, fd)
      if (res.ok) {
        toast.success(tc("sacuvano"))
        onGotovo()
        router.refresh()
      } else {
        // Mutacija NIJE prošla → red u tabeli i dalje odgovara filteru (podaci
        // nepromijenjeni), komponenta je sigurno još mounted — lokalni state za
        // inline greške je bezbjedan.
        setState(res)
      }
    })
  }

  return (
    <form action={submit} className="space-y-3">
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
