export type PlanRed = {
  klijent: string
  lokacija: string
  usluga: string
  rok: string
  status: string
  periodikaMj: number | null
  odgovorna: string
}

export type IzvozMeta = { naslov: string; period: string }

export const PLAN_KOLONE = ["Klijent", "Lokacija", "Usluga", "Rok", "Status", "Periodika (mj)", "Odgovorna osoba"] as const
