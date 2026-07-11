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
import { Checkbox } from "@/components/ui/checkbox"
import { useAkcijaToast } from "@/components/akcija-toast"
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
  useAkcijaToast(toggleState, { uspjeh: tc("sacuvano"), greska: tc("greska") })
  // "trenutno" = vrijednost prikazana korisniku; "verzija" forsira REMOUNT Checkbox-a
  // (svjež defaultChecked) — OBA se mijenjaju ISKLJUČIVO ZAJEDNO (nikad "trenutno"
  // samo), nakon SVAKOG završenog round-trip-a (uspjeh ILI neuspjeh). Klik samo
  // bilježi namjeru u `namjeraChecked` i SINHRONO submit-uje (vidi napomenu na
  // onCheckedChange niže) — ne mijenja "trenutno" direktno.
  //
  // Zašto remount a ne kontrolisan `checked`: React 19 nakon uspješne form-akcije
  // radi automatski form.reset() koji vraća native input na NJEGOV ORIGINALNI
  // (mount-time) defaultChecked — MIMO React-ove kontrolisane sinhronizacije.
  // Potvrđeno empirijski (throwaway Playwright skript, isti mehanizam kao
  // SaljiKlijentimaToggle): sa `checked={state}` je checkbox nakon USPJEŠNOG
  // submit-a vizuelno skakao nazad na staro stanje iako je DB ispravno ažuriran,
  // što je drugi klik pretvaralo u pogrešnu tranziciju. Remont sa svježim
  // `defaultChecked` (isti obrazac kao UgovorSheet-ov `key={ugovor?.id ?? "new"}`)
  // izbjegava taj konflikt jer je nova instanca uvijek već "u default stanju" koje
  // želimo — rollback na server-istinu ide istim putem, bez useEffect-a
  // (react-hooks/set-state-in-effect), preko "adjust state while rendering" obrasca.
  //
  // Zašto `namjeraChecked` (state, ne ref) a ne setTrenutno direktno na klik: vidi
  // identičan komentar u SaljiKlijentimaToggle — izbjegava Base UI-jevo dev-only
  // console.error upozorenje za promjenu defaultChecked na već montiranoj
  // nekontrolisanoj instanci. Mora biti state (ne ref) jer se čita unutar "adjust
  // state while rendering" bloka — čitanje ref.current tokom rendera je zabranjeno
  // (react-hooks/refs).
  const [trenutno, setTrenutno] = useState(aktivni)
  const [verzija, setVerzija] = useState(0)
  const [namjeraChecked, setNamjeraChecked] = useState(aktivni)
  const [prevToggleState, setPrevToggleState] = useState(toggleState)
  if (toggleState !== prevToggleState) {
    setPrevToggleState(toggleState)
    setTrenutno(toggleState.ok === false ? aktivni : namjeraChecked)
    setVerzija((v) => v + 1)
  }

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
        <Checkbox
          key={verzija}
          name="aktivni"
          value="on"
          defaultChecked={trenutno}
          disabled={togglePending}
          aria-label={t("naslov")}
          title={t("naslov")}
          data-testid="podsjetnici-aktivni-toggle"
          className="mt-0.5"
          // NAPOMENA (razlikuje se od T3 Select-a): za checkbox NIJE potreban
          // setTimeout-deferred requestSubmit. Native <input type="checkbox"> mijenja
          // svoj .checked SINHRONO kao dio browser-ovog default click ponašanja PRIJE
          // nego 'change' uopšte ispali — za razliku od Select-a gdje Base UI mora
          // SINTETIZOVATI hidden input vrijednost kroz React re-render (asinhrono u
          // odnosu na onValueChange). Potvrđeno empirijski (page.evaluate odmah nakon
          // .click(): native .checked već tačan). Sinhroni requestSubmit ovdje je NE
          // SAMO ispravan nego i SIGURNIJI: setTimeout(...,0) otvara realan race-prozor
          // pod opterećenjem servera (empirijski uhvaćeno: reload nakon toBeEnabled()
          // je stigao PRIJE nego se odgođeni requestSubmit uopšte izvršio, pending
          // nikad nije ni postao true, pa je stara vrijednost ostala u DB).
          onCheckedChange={(next) => {
            setNamjeraChecked(next)
            formRef.current?.requestSubmit()
          }}
        />
        <div>
          <p className="text-sm font-medium">{t("naslov")}</p>
          <p className="text-sm text-muted-foreground">{t("opis")}</p>
        </div>
      </form>
      {toggleState.ok === false && toggleState.message && (
        <p className="text-xs text-destructive" role="alert">
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
          <p className="text-sm text-amber-600" role="alert">
            {t("pokreniUpozorenje")}
          </p>
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
          className={rezultat.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {rezultat.ok
            ? t("rezultat", {
                poslano: rezultat.poslano,
                preskoceno: rezultat.preskoceno,
                odgodjeno: rezultat.odgodjeno,
                greske: rezultat.greske,
              })
            : rezultat.message}
        </p>
      )}
    </div>
  )
}
