import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * Prijedlozi za polje „Zaduženi" (S8.6).
 *
 * Izvor je RPC `get_aktivni_korisnici()` (SECURITY DEFINER, v.
 * `20260726122000_get_aktivni_korisnici_rpc.sql`) — NIKAD direktan
 * `from("korisnici")`: RLS polisa `korisnici_sel` je self-select, pa bi operateru
 * vratila SAMO njega samog (tiha regresija koju admin-testiranje ne otkriva).
 *
 * `termini.zaduzeni` je i dalje SLOBODAN TEKST (nije FK), pa se ovdje vraćaju samo
 * imena — polje ostaje otvoreno za unos, prijedlozi su UX sloj.
 */

/** Čist dio: imena za prijedloge — bez praznih, bez duplikata, sortirano. */
export function imenaZaPrijedloge(
  redovi: { ime?: string | null }[] | null | undefined,
): string[] {
  if (!redovi) return []
  const jedinstvena = new Set<string>()
  for (const red of redovi) {
    const ime = (red.ime ?? "").trim()
    if (ime !== "") jedinstvena.add(ime)
  }
  return [...jedinstvena].sort((a, b) => a.localeCompare(b))
}

/**
 * Server-only: imena aktivnih korisnika.
 *
 * Na grešku vraća prazan niz umjesto da baca — prijedlozi su sporedni UI sloj i
 * ne smiju oboriti ekran (isti princip kao `dohvatiGodineTermina`).
 */
export async function dohvatiImenaAktivnihKorisnika(): Promise<string[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_aktivni_korisnici")
  if (error) return []
  return imenaZaPrijedloge(data)
}
