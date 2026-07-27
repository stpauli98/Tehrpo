/**
 * Upiti taba Pregled (`app/(dashboard)/pregled`).
 *
 * Zamjenjuju `getPredstojeciCount`/`getHitnoKasni` iz `lib/termini.ts` (jedini
 * potrošač oba je bio `pregled/page.tsx`). Dvije razlike u odnosu na stare:
 * 1. `error` se VRAĆA pozivaocu umjesto da se maskira u `?? 0` / `?? []` — bez
 *    toga stranica ne može razlikovati „nema podataka" od „upit je pao" (S1).
 * 2. `otkazano` je isječeno iz oba upita (Pregled N2) — otkazani termin nije ni
 *    predstojeći ni hitan.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import { todayIso } from "@/lib/date"

export type HitnoKasniItem = {
  id: string
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  rok_dospijeca: string
  status_izvedeni: string
}

const SELECT_HITNO =
  "id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, rok_dospijeca, status_izvedeni"

/** Statusi koji ne pripadaju ni jednoj „traži se akcija" metrici, u PostgREST `in` sintaksi. */
const ZAVRSENI_STATUSI = '("izvrseno","otkazano")'

function isoPlusDays(days: number): string {
  const d = new Date(todayIso())
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * PostgREST `or` izraz za listu „Hitno / kasni": već zakašnjeli termini ILI oni
 * kojima rok ističe do `granicaIso`.
 *
 * Donja granica roka drugom ogranku ne treba: `termini_view` mapira `otkazano`
 * PRIJE `kasni` grane, pa davno prošli neotkazani termini već ulaze kroz prvi
 * ogranak (`status_izvedeni.eq.kasni`). Curili su jedino otkazani — njih siječe
 * `not.in`.
 *
 * Čista funkcija (bez baze) da je granica ↔ status-filter kombinacija pokrivena
 * unit testom.
 */
export function hitnoKasniOrFilter(granicaIso: string): string {
  return `status_izvedeni.eq.kasni,and(rok_dospijeca.lte.${granicaIso},status_izvedeni.not.in.${ZAVRSENI_STATUSI})`
}

/** Broj termina kojima rok ističe u narednih `dana` dana, a nisu izvršeni ni otkazani. */
export async function getPredstojeciCount(
  supabase: SupabaseClient,
  dana = 30,
): Promise<{ count: number | null; error: PostgrestError | null }> {
  const { count, error } = await supabase
    .from("termini_view")
    .select("id", { count: "exact", head: true })
    .gte("rok_dospijeca", todayIso())
    .lte("rok_dospijeca", isoPlusDays(dana))
    .not("status_izvedeni", "in", ZAVRSENI_STATUSI)
  return { count, error }
}

/** Najhitniji termini (zakašnjeli + rok u narednih 30 dana), sortirani po roku. */
export async function getHitnoKasni(
  supabase: SupabaseClient,
  limit = 8,
): Promise<{ data: HitnoKasniItem[] | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from("termini_view")
    .select(SELECT_HITNO)
    .or(hitnoKasniOrFilter(isoPlusDays(30)))
    .order("rok_dospijeca", { ascending: true })
    .limit(limit)
  return { data: data as HitnoKasniItem[] | null, error }
}
