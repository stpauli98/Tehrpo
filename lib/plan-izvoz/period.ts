import { monthRange, periodRange, todayIso, monthName, formatDatum } from "@/lib/date"

/** Način izbora perioda za izvoz. */
export type IzvozPeriod =
  | { mod: "om" }
  | { mod: "god"; godina: number }
  | { mod: "mj"; godina: number; mjesec: number }
  | { mod: "raspon"; od: string; do: string }
  | { mod: "svi" }

/** Striktni ISO YYYY-MM-DD. */
export function validIsoDatum(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/** Raspon je validan kad su oba ISO i od <= do (leksikografsko poređenje radi za ISO). */
export function validRaspon(od: string | null | undefined, doD: string | null | undefined): boolean {
  return validIsoDatum(od) && validIsoDatum(doD) && od <= doD
}

/** Datumski raspon za odabrani period; null = bez vremenskog ograničenja. `danas` je ISO override za test. */
export function izvozPeriodRange(p: IzvozPeriod, danas?: string): { from: string; to: string } | null {
  switch (p.mod) {
    case "om": {
      const iso = danas ?? todayIso()
      return monthRange(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)))
    }
    case "god": {
      const r = periodRange("godina", p.godina)
      return { from: r.od, to: r.do }
    }
    case "mj":
      return monthRange(p.godina, p.mjesec)
    case "raspon":
      return { from: p.od, to: p.do }
    case "svi":
      return null
  }
}

/**
 * Statusi koji znače da je obaveza ZATVORENA. Sve ostalo je otvoreno i, ako mu je
 * datum_prikaza ispod donje granice perioda, prenosi se u plan tog perioda.
 */
export const ZATVORENI_STATUSI = ["izvrseno", "otkazano"] as const

/**
 * Donja granica perioda — datum ispod kojeg otvorena obaveza „ispada" iz plana
 * (i zato mora biti prikazana kao PRENESENA). null = period nema donju granicu
 * (mod "svi") → nema šta da se prenosi.
 */
export function prenesenoGranica(p: IzvozPeriod, danas?: string): string | null {
  return izvozPeriodRange(p, danas)?.from ?? null
}

/**
 * PostgREST `or=` izraz: red je UNUTAR perioda ILI je otvorena obaveza iz ranijeg
 * perioda (prenesena). Bez ovoga godišnji plan za 2027. gubi sve zaostalo iz 2026.
 *
 * Namjerno `status_izvedeni.neq.X` umjesto `not.in.(...)` — ugniježđene zagrade
 * unutar `or()`/`and()` su izvor grešaka u PostgREST parseru.
 */
export function prenesenoOrIzraz(from: string, to: string): string {
  const uPeriodu = `and(datum_prikaza.gte.${from},datum_prikaza.lte.${to})`
  const zatvoreni = ZATVORENI_STATUSI.map((s) => `status_izvedeni.neq.${s}`).join(",")
  const preneseno = `and(datum_prikaza.lt.${from},${zatvoreni})`
  return `${uPeriodu},${preneseno}`
}

/**
 * Je li red prenesen iz ranijeg perioda. Redovi ispod granice u rezultatu upita su
 * po konstrukciji otvoreni (v. `prenesenoOrIzraz`), pa je dovoljna provjera datuma.
 *
 * Odlučuje `rok_dospijeca` — isti datum koji izvještaj ispisuje u koloni „Rok" —
 * a NE `datum_prikaza` po kojem upit bira redove. To dvoje se razilazi čim je termin
 * zakazan van svog roka (`datum_prikaza = COALESCE(datum_zakazan, rok_dospijeca)`), pa
 * je plan umio da označi „prenesena obaveza iz perioda prije 01.09." red čiji Rok
 * piše 01.09. Oznaka mora biti provjerljiva iz onoga što čitalac vidi na papiru.
 */
export function jePreneseniRed(
  red: { rok_dospijeca?: string | null; datum_prikaza?: string | null },
  granica: string | null,
): boolean {
  const rok = red.rok_dospijeca ?? red.datum_prikaza
  return !!granica && !!rok && rok < granica
}

/** Ljudski čitljiv label perioda (PDF/Excel podnaslov + naziv fajla). `sviLabel` = prevod za "svi mjeseci". */
export function izvozPeriodLabel(p: IzvozPeriod, sviLabel: string, danas?: string): string {
  switch (p.mod) {
    case "om": {
      const iso = danas ?? todayIso()
      return `${monthName(Number(iso.slice(5, 7)))} ${Number(iso.slice(0, 4))}`
    }
    case "god":
      return String(p.godina)
    case "mj":
      return `${monthName(p.mjesec)} ${p.godina}`
    case "raspon":
      return `${formatDatum(p.od)}–${formatDatum(p.do)}`
    case "svi":
      return sviLabel
  }
}
