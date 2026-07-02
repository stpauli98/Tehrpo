import { monthRange, currentYear, tekuciNarednomMjesecuRange } from "@/lib/date"
import type { PostgrestFilterBuilder } from "@supabase/supabase-js"

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

/** Primjenjuje sve plan-filtere na termini_view upit (DRY: isto za lista i izvoz rutu). */
export function applyPlanFilteri<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Q extends PostgrestFilterBuilder<any, any, any, any, any>,
>(q: Q, f: PlanFilteri): Q {
  let out = q
  if (f.status && f.status !== "svi") out = out.eq("status_izvedeni", f.status)
  if (f.q) {
    const safe = f.q.replace(/[(),]/g, " ")
    out = out.or(`klijent_naziv.ilike.%${safe}%,lokacija_naziv.ilike.%${safe}%`)
  }
  if (f.klijentId) out = out.eq("klijent_id", f.klijentId)
  if (f.lokacijaId) out = out.eq("lokacija_id", f.lokacijaId)
  if (f.vrstaId) out = out.eq("vrsta_provjere_id", f.vrstaId)
  if (f.nacin !== "svi") out = out.eq("nacin_izvrsenja", f.nacin)
  const r = mjesecRange(f)
  if (r) out = out.gte("rok_dospijeca", r.from).lte("rok_dospijeca", r.to)
  return out
}
