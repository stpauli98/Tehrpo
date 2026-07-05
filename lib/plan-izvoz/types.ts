export type PlanRed = {
  klijent: string
  lokacija: string
  usluga: string
  rok: string
  status: string
  periodikaMj: number | null
  odgovorna: string
  nacin: string
}

export type IzvozMeta = { naslov: string; period: string }

/** Ključevi kolona plana (prevode se na mjestu renderovanja — izvoz.plan.kolone / izvoz.plan.kolonePdf). */
export const PLAN_KOLONE_KEYS = [
  "klijent", "lokacija", "usluga", "rok", "status", "periodika", "odgovorna", "nacin",
] as const
