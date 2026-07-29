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

/**
 * Prijedlozi za polje „Zaduženi" ograničeni na firmu (docs/superpowers/specs/
 * 2026-07-29-zaduzeni-po-firmi-design.md). Izvor je RPC `get_zaduzeni_dodjele()`
 * (SECURITY DEFINER, v. `20260729130000_get_zaduzeni_dodjele_rpc.sql`) — isti razlog
 * kao gore: RLS polisa `korisnici_sel` je self-select.
 */

/** Čist dio: (klijent_id, ime) parovi → mapa firma→imena (bez praznih, bez duplikata, sortirano). */
export function grupisiPrijedlogeByFirma(
  redovi: { klijent_id?: string | null; ime?: string | null }[] | null | undefined,
): Record<string, string[]> {
  const poFirmi = new Map<string, Set<string>>()
  for (const red of redovi ?? []) {
    const klijentId = (red.klijent_id ?? "").trim()
    const ime = (red.ime ?? "").trim()
    if (klijentId === "" || ime === "") continue
    if (!poFirmi.has(klijentId)) poFirmi.set(klijentId, new Set())
    poFirmi.get(klijentId)!.add(ime)
  }
  const rezultat: Record<string, string[]> = {}
  for (const [klijentId, imena] of poFirmi) {
    rezultat[klijentId] = [...imena].sort((a, b) => a.localeCompare(b))
  }
  return rezultat
}

/**
 * Server-only: prijedlozi za „Zaduženi" grupisani po firmi.
 *
 * Na grešku vraća prazan objekat umjesto da baca — prijedlozi su sporedni UX sloj i
 * ne smiju oboriti ekran (isti princip kao `dohvatiImenaAktivnihKorisnika`).
 */
export async function dohvatiZaduzeniPrijedlogeByFirma(): Promise<Record<string, string[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_zaduzeni_dodjele")
  if (error) return {}
  return grupisiPrijedlogeByFirma(data)
}
