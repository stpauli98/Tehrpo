import { monthRange, currentYear, tekuciNarednomMjesecuRange } from "@/lib/date"

export type PlanFilteri = {
  status: string
  q: string
  klijentId: string
  lokacijaId: string
  vrstaId: string
  mjesec: string // "tn" (default) | "svi" | "1".."12"
  godina: number
  nacin: "svi" | "izvrsava" | "pracenje"
}

/** Parsiraj filtere iz query stringa (isto za lista i izvoz rutu). Default mjeseca = "tn". */
export function parsePlanFilteri(sp: URLSearchParams): PlanFilteri {
  return {
    status: sp.get("status") ?? "svi",
    q: (sp.get("q") ?? "").trim(),
    klijentId: sp.get("klijent_id") ?? "",
    lokacijaId: sp.get("lokacija") ?? "",
    vrstaId: sp.get("vrsta_id") ?? "",
    mjesec: sp.get("mjesec") || "tn",
    godina: Number(sp.get("godina")) || currentYear(),
    nacin: (() => {
      const n = sp.get("nacin")
      return n === "izvrsava" || n === "pracenje" ? n : "svi"
    })(),
  }
}

/** Datumski raspon za mjesec-filter: "tn" → tekući+naredni, "1".."12" → taj mjesec, "svi" → null. */
export function mjesecRange(f: PlanFilteri): { from: string; to: string } | null {
  if (f.mjesec === "tn") return tekuciNarednomMjesecuRange()
  const mn = Number(f.mjesec)
  if (mn >= 1 && mn <= 12) return monthRange(f.godina, mn)
  return null
}
