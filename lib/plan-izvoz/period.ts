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
