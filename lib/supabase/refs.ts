/**
 * Prepoznavanje cloud okruženja iz connection stringa ili Supabase URL-a.
 *
 * Postoji zato što se PROD i DEMO razlikuju SAMO po ref-u u URL-u, a nekoliko
 * alata (migracije, E2E) bira okruženje kroz env varijable koje se lako zamijene.
 * Dana 2026-07-20 je E2E prolaz otišao na PROD jer je u worktree-u nedostajao
 * .env.development.local, pa je dev server tiho pao nazad na .env.local.
 *
 * Bez zavisnosti na lib/env.ts — koriste ga i skripte koje se pokreću prije
 * nego što je aplikacijski env uopšte validiran.
 */

export const PROD_REF = "fqtqkehjidkzeasiegnq"
export const DEMO_REF = "mtwwotmwrasozmcgqwhc"

export type Cilj = "prod" | "demo" | "nepoznato"

/** Koje okruženje pogađa dati URL / connection string. */
export function prepoznajCilj(url: string | null | undefined): Cilj {
  if (!url) return "nepoznato"
  if (url.includes(PROD_REF)) return "prod"
  if (url.includes(DEMO_REF)) return "demo"
  return "nepoznato"
}

/**
 * Baca ako `url` ne pogađa tačno očekivano okruženje.
 * `kontekst` ulazi u poruku da se odmah vidi ko je pozvao.
 */
export function zahtijevajCilj(url: string | null | undefined, ocekivano: "prod" | "demo", kontekst: string): void {
  const stvarno = prepoznajCilj(url)
  if (stvarno === ocekivano) return
  const opis =
    stvarno === "nepoznato"
      ? "URL ne sadrži nijedan poznati ref (ni PROD ni DEMO)"
      : `URL pogađa ${stvarno.toUpperCase()}`
  throw new Error(`${kontekst}: očekivano ${ocekivano.toUpperCase()}, ali ${opis}. Prekidam.`)
}
