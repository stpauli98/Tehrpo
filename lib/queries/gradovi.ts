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

/** Čist dio: redovi lokacija → jedinstveni ne-prazni gradovi, sortirani (localeCompare). */
export function distinctGradovi(
  redovi: { grad: string | null }[] | null | undefined,
): string[] {
  const skup = new Set<string>()
  for (const red of redovi ?? []) {
    const grad = (red.grad ?? "").trim()
    if (grad !== "") skup.add(grad)
  }
  return [...skup].sort((a, b) => a.localeCompare(b))
}

/**
 * Gradovi u kojima klijenti STVARNO imaju lokacije (yoink zahtjev 2026-07-29) —
 * zamjena punog kataloga `gradovi` u obilasci FILTERU. Čita `lokacije.grad` kroz
 * RLS pozivaoca, pa operater dobija samo gradove svojih firmi (poželjno).
 *
 * Na grešku BACA — isti S1 ugovor kao `dohvatiGradove` iznad (pozivalac hvata
 * i razlikuje pad od praznog rezultata).
 */
export async function dohvatiGradoveLokacija(): Promise<string[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from("lokacije").select("grad")
  if (error) throw new Error(error.message)
  return distinctGradovi(data)
}
