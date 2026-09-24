export type PlanRed = {
  klijent: string
  lokacija: string
  usluga: string
  rok: string
  /** true = otvorena obaveza prenesena iz perioda prije odabranog (v. lib/plan-izvoz/period). */
  preneseno: boolean
  status: string
  periodikaMj: number | null
  odgovorna: string
  nacin: string
}

export type IzvozMeta = {
  naslov: string
  period: string
  /** Opcioni red ispod podnaslova (npr. objašnjenje prenesenih obaveza). */
  napomena?: string
}

/** Ključevi kolona plana (prevode se na mjestu renderovanja — izvoz.plan.kolone / izvoz.plan.kolonePdf). */
export const PLAN_KOLONE_KEYS = [
  "klijent", "lokacija", "usluga", "rok", "preneseno", "status", "periodika", "odgovorna", "nacin",
] as const

/**
 * Vrijednosti reda u ISTOM redoslijedu kao PLAN_KOLONE_KEYS — jedan izvor istine za
 * XLSX i PDF, da zaglavlje i ćelije ne mogu razići.
 * `prenesenoLabel` prima prevedene oznake (Da / —), `prazno` je popuna za periodiku.
 */
export function planRedCelije(
  r: PlanRed,
  prenesenoLabel: (p: boolean) => string,
  prazno: string,
): (string | number)[] {
  return [
    r.klijent,
    r.lokacija,
    r.usluga,
    r.rok,
    prenesenoLabel(r.preneseno),
    r.status,
    r.periodikaMj ?? prazno,
    r.odgovorna,
    r.nacin,
  ]
}
