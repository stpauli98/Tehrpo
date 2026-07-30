"use client"

import { Autocomplete } from "@base-ui/react/autocomplete"
import { ChevronDownIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { useKorisnikIme } from "@/providers/korisnik-provider"

/**
 * Polje „Zaduženi" kao combobox (base-ui Autocomplete): prijavljeni korisnik je
 * PRVI prijedlog (označen „(ti)"), ispod su kolege sa pristupom firmi (admin dobija
 * sve radnike — v. NoviTerminButton/TerminSheet), a kucanje filtrira listu.
 *
 * Slobodan unos OSTAJE dozvoljen — `termini.zaduzeni` je slobodan tekst u bazi
 * (nije FK) i postojeći podaci su unošeni ručno; vrijednost forme je uvijek tekst
 * input-a, izbor iz liste ga samo popuni. Zato Autocomplete (vrijednost = tekst),
 * ne Select koji zaključava izbor.
 *
 * Imena stižu propom iz server komponente (`dohvatiZaduzeniPrijedlogeByFirma` /
 * `dohvatiImenaAktivnihKorisnika`) — nikad direktnim `from("korisnici")` upitom
 * (RLS self-select bi operateru dao samo njega samog).
 */
export function ZaduzeniPolje({
  prijedlozi,
  defaultValue,
  placeholder,
  disabled,
  testId,
  describedBy,
}: {
  prijedlozi: string[]
  defaultValue?: string
  placeholder?: string
  disabled?: boolean
  testId?: string
  describedBy?: string
}) {
  const t = useTranslations("common")
  const ja = useKorisnikIme()

  // Prijavljeni korisnik uvijek prvi (i kad prijedlozi za firmu još nisu učitani —
  // „sebe" smiješ zadužiti uvijek); ostatak zadržava sortirani redoslijed sa servera.
  const imena = ja ? [ja, ...prijedlozi.filter((ime) => ime !== ja)] : [...prijedlozi]

  // Bez ijednog prijedloga nema šta da se otvori → obično tekst polje.
  if (imena.length === 0) {
    return (
      <Input
        name="zaduzeni"
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testId}
        aria-describedby={describedBy}
        autoComplete="off"
      />
    )
  }

  return (
    <Autocomplete.Root items={imena} defaultValue={defaultValue}>
      <div className="relative">
        <Autocomplete.Input
          render={
            <Input
              name="zaduzeni"
              placeholder={placeholder}
              disabled={disabled}
              data-testid={testId}
              aria-describedby={describedBy}
              autoComplete="off"
              className="pr-8"
            />
          }
        />
        <Autocomplete.Trigger
          aria-label={t("zaduzeniPrikaziListu")}
          disabled={disabled}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-8 cursor-pointer items-center justify-center rounded-r-lg text-muted-foreground outline-none transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronDownIcon className="size-4" aria-hidden />
        </Autocomplete.Trigger>
      </div>
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} className="isolate z-50">
          <Autocomplete.Popup
            data-testid="zaduzeni-prijedlozi"
            className="relative isolate z-50 max-h-[min(18rem,var(--available-height))] w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none"
          >
            <Autocomplete.Empty className="px-2.5 py-1.5 text-xs text-muted-foreground empty:hidden">
              {t("zaduzeniSlobodanUnos")}
            </Autocomplete.Empty>
            <Autocomplete.List className="p-1">
              {(ime: string) => (
                <Autocomplete.Item
                  key={ime}
                  value={ime}
                  className="flex w-full cursor-default items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="truncate">{ime}</span>
                  {ime === ja && (
                    <span className="shrink-0 text-xs text-muted-foreground">{t("zaduzeniTi")}</span>
                  )}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  )
}
