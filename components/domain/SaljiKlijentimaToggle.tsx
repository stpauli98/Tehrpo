"use client"

import { useActionState, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { updateSaljiKlijentima, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Checkbox } from "@/components/ui/checkbox"

const initial: ActionResult = { ok: true }

export function SaljiKlijentimaToggle({ salji }: { salji: boolean }) {
  const t = useTranslations("postavke.saljiKlijentima")
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState(updateSaljiKlijentima, initial)
  // "trenutno" = vrijednost prikazana korisniku; "verzija" forsira REMOUNT Checkbox-a
  // (svjež defaultChecked) — OBA se mijenjaju ISKLJUČIVO ZAJEDNO (nikad "trenutno" samo),
  // nakon SVAKOG završenog round-trip-a (uspjeh ILI neuspjeh). Klik samo bilježi namjeru
  // u `namjeraChecked` i SINHRONO submit-uje (vidi napomenu na onCheckedChange niže) —
  // ne mijenja "trenutno" direktno.
  //
  // Zašto remount a ne kontrolisan `checked`: React 19 nakon uspješne form-akcije radi
  // automatski form.reset() koji vraća native input na NJEGOV ORIGINALNI (mount-time)
  // defaultChecked — MIMO React-ove kontrolisane sinhronizacije. Potvrđeno empirijski
  // (throwaway Playwright skript): sa `checked={state}` je checkbox nakon USPJEŠNOG
  // submit-a vizuelno skakao nazad na staro stanje iako je DB ispravno ažuriran, što je
  // drugi klik pretvaralo u pogrešnu tranziciju. Remont sa svježim `defaultChecked` (isti
  // obrazac kao UgovorSheet-ov `key={ugovor?.id ?? "new"}`) izbjegava taj konflikt jer je
  // nova instanca uvijek već "u default stanju" koje želimo.
  //
  // Zašto `namjeraChecked` (state, ne ref) a ne setTrenutno direktno na klik: mijenjanje
  // `trenutno` (defaultChecked) BEZ remounta (dok je "verzija" ista) je promjena
  // defaultChecked na VEĆ montiranoj nekontrolisanoj Base UI Checkbox instanci —
  // bezopasno funkcionalno (native input već ima ispravan checked od samog klika), ali
  // Base UI za to loguje dev-only console.error upozorenje ("changing default checked
  // state of an uncontrolled Checkbox after being initialized"). Odgađanjem "trenutno"
  // ažuriranja do tačno istog rendera kad se i "verzija" mijenja (dakle uvijek pravi
  // remount, nikad in-place prop promjena) to upozorenje se u potpunosti izbjegava. Mora
  // biti state (ne ref) jer se čita unutar "adjust state while rendering" bloka — čitanje
  // ref.current tokom rendera je zabranjeno (react-hooks/refs).
  const [trenutno, setTrenutno] = useState(salji)
  const [verzija, setVerzija] = useState(0)
  const [namjeraChecked, setNamjeraChecked] = useState(salji)
  const [prevState, setPrevState] = useState(state)
  // "Adjust state while rendering" obrazac (bez useEffect-a — react-hooks/set-state-in-effect).
  if (state !== prevState) {
    setPrevState(state)
    setTrenutno(state.ok === false ? salji : namjeraChecked)
    setVerzija((v) => v + 1)
  }

  return (
    <div className="space-y-2">
      <form ref={formRef} action={action} className="flex items-start gap-3">
        <Checkbox
          key={verzija}
          name="salji"
          value="on"
          defaultChecked={trenutno}
          disabled={pending}
          aria-label={t("naslov")}
          data-testid="salji-klijentima-toggle"
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
          <p className="text-sm text-amber-600">{t("upozorenje")}</p>
        </div>
      </form>
      {state.ok === false && state.message && (
        <p className="text-xs text-destructive" role="alert">{state.message}</p>
      )}
    </div>
  )
}
