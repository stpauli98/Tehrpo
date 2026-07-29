import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * Prijedlozi za polje „Zaduženi" ograničeni na firmu (docs/superpowers/specs/
 * 2026-07-29-zaduzeni-po-firmi-design.md). Izvor je RPC `get_zaduzeni_dodjele()`
 * (SECURITY DEFINER, v. `20260729130000_get_zaduzeni_dodjele_rpc.sql`) — RLS polisa
 * `korisnici_sel` je self-select, pa direktan `from("korisnici")` vrati operateru
 * samo njega samog (tiha regresija koju admin-testiranje ne otkriva).
 *
 * `termini.zaduzeni` je i dalje SLOBODAN TEKST (nije FK) — polje ostaje otvoreno za
 * unos, prijedlozi su UX sloj.
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
 * ne smiju oboriti ekran (isti princip kao `dohvatiGodineTermina`).
 */
export async function dohvatiZaduzeniPrijedlogeByFirma(): Promise<Record<string, string[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_zaduzeni_dodjele")
  if (error) return {}
  return grupisiPrijedlogeByFirma(data)
}

/**
 * Server-only: imena SVIH aktivnih korisnika (RPC `get_aktivni_korisnici`).
 * Namijenjeno ADMIN prijedlozima za „Zaduženi" — admin smije zadužiti bilo kog
 * radnika (firma mu se tada auto-dodijeli u `korisnik_klijent`, v. termini/actions),
 * pa mu se ne nudi lista sužena po firmi. Pozivalac je dužan provjeriti ulogu i za
 * ne-admine proslijediti prazan niz. Na grešku vraća [] (isti princip kao gore).
 */
export async function dohvatiImenaAktivnihKorisnika(): Promise<string[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_aktivni_korisnici")
  if (error) return []
  const imena = new Set<string>()
  for (const red of data ?? []) {
    const ime = (red.ime ?? "").trim()
    if (ime !== "") imena.add(ime)
  }
  return [...imena].sort((a, b) => a.localeCompare(b))
}
