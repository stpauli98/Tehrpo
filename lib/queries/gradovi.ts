import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * Kanonska lista gradova iz kataloga `gradovi` (S8.2 — zamjena hardkodirane
 * `GRADOVI_BIH` whiteliste u UI putanji; migracija 20260726121000_gradovi_tabela.sql).
 *
 * Na grešku BACA (presedan `lib/queries/aktivnost.ts`): pozivalac mora razlikovati
 * „katalog je prazan" od „upit je pao" (S1) — tiho prazan select bi izgledao kao da
 * nijedan grad ne postoji i korisnik bi unio slobodan tekst mimo kataloga.
 *
 * Server-only: modul sam kreira SSR (anon + cookie) klijent, pa čitanje ide kroz RLS
 * pozivaoca (`gradovi_sel`: svaki prijavljen korisnik).
 */
export async function dohvatiGradove(): Promise<string[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from("gradovi").select("naziv").order("naziv")
  if (error) throw new Error(error.message)
  return (data ?? []).map((g) => g.naziv)
}
