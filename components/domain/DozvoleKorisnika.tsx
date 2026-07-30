"use client"
import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { postaviDozvolu } from "@/app/(dashboard)/postavke/actions"
import { toastRezultat } from "@/components/akcija-toast"
import { Checkbox } from "@/components/ui/checkbox"
import { efektivneDozvole, type Dozvole } from "@/lib/auth/dozvole"
import type { Uloga } from "@/lib/auth/roles"

const STAVKE: { kljuc: keyof Dozvole; labela: string }[] = [
  { kljuc: "smije_brisati_svoje", labela: "smijeBrisatiSvoje" },
  { kljuc: "smije_brisati_tudje", labela: "smijeBrisatiTudje" },
  { kljuc: "smije_brisati_klijente", labela: "smijeBrisatiKlijente" },
  { kljuc: "smije_zatvoriti_bez_nalaza", labela: "smijeZatvoritiBezNalaza" },
]

function JedanPrekidac({
  korisnikId, kljuc, labela, pocetno, onemoguceno, razlog,
}: {
  korisnikId: string
  kljuc: keyof Dozvole
  labela: string
  pocetno: boolean
  onemoguceno: boolean
  razlog?: string
}) {
  const t = useTranslations("postavke.dozvole")
  // `pocetno` se čita samo pri mountu; resync na promjenu uloge radi `key` u roditelju
  // (React-ov obrazac "reset state with a key" — bez setState u efektu).
  const [checked, setChecked] = useState(pocetno)
  const [pending, start] = useTransition()
  const ime = t(labela)
  // Isti razlog kao u PrimaPodsjetnikeToggle: disabled checkbox ne prima fokus, pa
  // objašnjenje mora i u pristupačno ime, ne samo u tooltip.
  const opis = razlog ? `${ime} — ${razlog}` : ime

  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        disabled={pending || onemoguceno}
        data-testid={`dozvola-${kljuc}-${korisnikId}`}
        aria-label={opis}
        title={onemoguceno ? razlog : ime}
        onCheckedChange={(next) => {
          setChecked(next)
          start(async () => {
            const r = toastRezultat(await postaviDozvolu(korisnikId, kljuc, next), {
              uspjeh: t("dozvolaSacuvana"),
              greska: t("dozvolaGreska"),
            })
            if (!r.ok) setChecked(!next) // brana odbila → vrati na stvarno stanje
          })
        }}
      />
      <span>{ime}</span>
    </label>
  )
}

/**
 * Četiri prekidača dozvola za jednog korisnika. Za admina i pregled su zaključani i
 * prikazuju IZVEDENU vrijednost (admin sve, pregled ništa) — inače bi admin red izgledao
 * nepodešeno iako mu kolone ništa ne znače.
 */
export function DozvoleKorisnika({
  korisnikId, uloga, dozvole,
}: { korisnikId: string; uloga: Uloga; dozvole: Dozvole }) {
  const t = useTranslations("postavke.dozvole")
  const zakljucano = uloga !== "operater"
  const efektivne = efektivneDozvole(uloga, dozvole)

  return (
    <div className="flex flex-col gap-1">
      {STAVKE.map((s) => (
        <JedanPrekidac
          // Uloga u ključu: promjena uloge mijenja IZVEDENU vrijednost (admin sve, pregled
          // ništa), pa prekidač mora da se remounta i pročita novo `pocetno` — inače ostaje
          // na vrijednostima prethodne uloge iako ga docstring opisuje kao izvedenog.
          key={`${uloga}-${s.kljuc}`}
          korisnikId={korisnikId}
          kljuc={s.kljuc}
          labela={s.labela}
          pocetno={efektivne[s.kljuc]}
          onemoguceno={zakljucano}
          razlog={zakljucano ? t("dozvoleSamoOperater") : undefined}
        />
      ))}
    </div>
  )
}
