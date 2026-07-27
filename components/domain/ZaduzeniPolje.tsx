"use client"

import { useId } from "react"
import { Input } from "@/components/ui/input"

/**
 * Polje „Zaduženi" sa prijedlozima imena aktivnih korisnika (S8.6).
 *
 * Slobodan unos OSTAJE dozvoljen — `termini.zaduzeni` je slobodan tekst u bazi
 * (nije FK) i postojeći podaci su unošeni ručno; prijedlozi su UX sloj koji
 * sprječava da svako ime ima pet varijanti. Zato `<datalist>`, ne combobox koji
 * zaključava izbor.
 *
 * Imena stižu propom iz server komponente (`dohvatiImenaAktivnihKorisnika`) —
 * nikad direktnim `from("korisnici")` upitom (RLS self-select bi operateru dao
 * samo njega samog).
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
  const listId = useId()

  return (
    <>
      <Input
        name="zaduzeni"
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testId}
        list={prijedlozi.length > 0 ? listId : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
      />
      {prijedlozi.length > 0 && (
        <datalist id={listId} data-testid="zaduzeni-prijedlozi">
          {prijedlozi.map((ime) => (
            <option key={ime} value={ime} />
          ))}
        </datalist>
      )}
    </>
  )
}
