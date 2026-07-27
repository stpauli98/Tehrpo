import { currentYear } from "@/lib/date"
import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * Raspon godina za filter „Godina" — čista funkcija (unit-testabilna, bez baze).
 *
 * `minGodina`/`maxGodina` dolaze iz RPC-a `get_termini_godine()`; oba su NULL kad
 * korisnik nema nijedan vidljiv termin (prazna tabela ili RLS `termini_sel` sve
 * odsijekao). U tom slučaju vraća se dosadašnje ponašanje svih 5 potrošača
 * (`TerminiFilters.tsx`, `ObilasciToolbar.tsx`, `_views/kalendar.tsx`,
 * `_views/matrica.tsx`, `PlanIzvozModal.tsx`): tekuća ± 1.
 *
 * Tekuća godina je UVIJEK u nizu — ona je default vrijednost `godina` filtera, pa
 * bi bez nje selektovana opcija nedostajala u padajućem meniju.
 */
export function godineRaspon(
  minGodina: number | null,
  maxGodina: number | null,
  tekuca: number,
): number[] {
  if (minGodina === null || maxGodina === null) {
    return [tekuca - 1, tekuca, tekuca + 1]
  }
  const od = Math.min(minGodina, tekuca)
  const doGodine = Math.max(maxGodina, tekuca)
  const niz: number[] = []
  for (let g = od; g <= doGodine; g++) niz.push(g)
  return niz
}

/**
 * Server-only: godine koje postoje u terminima VIDLJIVIM prijavljenom korisniku.
 *
 * RPC je SECURITY INVOKER (v. 20260726120000_get_termini_godine_rpc.sql), pa raspon
 * prati RLS. Na grešku ili prazan odgovor vraća se fallback umjesto bacanja — filter
 * godine je sporedni UI kontrol i ne smije oboriti ekran (za razliku od
 * `lib/queries/aktivnost.ts`, gdje su redovi sam sadržaj ekrana pa greška baca).
 */
export async function dohvatiGodineTermina(): Promise<number[]> {
  const tekuca = currentYear()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_termini_godine")
  const red = error ? undefined : data?.[0]
  if (!red) {
    return godineRaspon(null, null, tekuca)
  }
  // `?? null` namjerno: gen-types kolone tipizira kao ne-nullable, ali RPC nad
  // praznom (ili RLS-om ispražnjenom) tabelom stvarno vraća NULL/NULL.
  return godineRaspon(red.min_godina ?? null, red.max_godina ?? null, tekuca)
}
