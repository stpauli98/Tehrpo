/**
 * Pomoćne funkcije za scripts/provjeri-integraciju.ts koje moraju biti pod vitest-om
 * (vitest.config.ts obuhvata lib/**, ne scripts/) — SQL sanitizacija prije tekstualne
 * provjere iz pravila.ts i filtriranje poznatih namjernih izuzetaka. Ljuska smije samo
 * pozvati ove funkcije; logika ovdje ostaje čista (bez diska, mreže, process.env).
 */
import type { Nalaz } from "./pravila"

/** Maskira poklapanje razmacima, karakter po karakter, čuvajući nove redove — tako
 *  brojevi linija ostaju tačni i poslije maskiranja. */
export function maskiraj(poklapanje: string): string {
  return poklapanje.replace(/[^\n]/g, " ")
}

/**
 * SQL-specifično čišćenje prije tekstualne provjere iz pravila.ts: linijski komentari
 * (`-- ...`) i sadržaj jednostrukih navodnika se maskiraju razmacima (linije se ne
 * pomjeraju, samo se prazne). Bez ovoga podniz poput 'CREATE TABLE AS' unutar string
 * literala (stvaran izvršni SQL u rls_auto_enable() — kopija cloud event trigger
 * funkcije koja citira PostgreSQL command_tag vrijednosti kao stringove) ili
 * "create table if not exists" unutar komentara lažno pogodi TABELA/VIEW obrasce iz
 * pravila.ts — pravila su namjerno tekstualna, ne AST, pa sama ne razlikuju izvršni
 * kod od komentara/stringova.
 *
 * String literal se prepoznaje po PostgreSQL pravilu (standard_conforming_strings=on,
 * podrazumijevano od PG9): apostrof UNUTAR stringa se bježi UDVAJANJEM (''), ne
 * obrnutom kosom crtom — zato `(?:[^']|'')*`, ne JS-stil `\'` escape.
 *
 * NAPOMENA: ovo NE preskače dollar-quoted ($$...$$) tijela funkcija kao cjelinu —
 * string literali UNUTAR takvog tijela (npr. gore pomenuti 'CREATE TABLE AS') se i
 * dalje maskiraju, i to je poenta (baš taj literal je izvor lažnog pogotka). Stvaran
 * izvršni SQL izvan navodnika unutar $$...$$ tijela (npr. prava CREATE POLICY u DO
 * bloku) ostaje netaknut i vidljiv provjeri.
 */
export function sanitizujSql(sadrzaj: string): string {
  return sadrzaj.replace(/--[^\n]*/g, maskiraj).replace(/'(?:[^']|'')*'/g, maskiraj)
}

/** Ime tabele iz poruke pravila "tabela-bez-politike" (v. pravila.ts `provjeriSql`). */
const IME_IZ_PORUKE = /^tabela (\S+) nema RLS politiku/

/**
 * Izbaci nalaze pravila "tabela-bez-politike" za tabele iz `allowlist` — tabele koje
 * su POZNATO, namjerno policyless (RLS uključen, pristup isključivo preko service-role
 * klijenta; v. lib/rlsCoverage.ts `RLS_INTENTIONAL_POLICYLESS`, koju već koristi
 * `pnpm rls:check`). pravila.ts nema mehanizam izuzetka za ovo pravilo (za razliku od
 * `integracija-dozvoli` markera kod admin-klijenta), pa se ljuska oslanja na ovaj
 * filter umjesto da izmišlja novi mehanizam ili gasi pravilo. Svi ostali nalazi
 * (uključujući "tabela-bez-politike" za tabele van allowlist-e) prolaze nepromijenjeni.
 *
 * Ime tabele se parsira regexom iz teksta `Nalaz.poruka` — krhko (zavisi od tačnog
 * teksta poruke u pravila.ts `provjeriSql`), ali prihvaćeno: dodavanje strukturiranog
 * polja u `Nalaz` bi značilo mijenjanje pravila.ts, što je van dozvoljenog obuhvata
 * ovog zadatka. Ako se tekst poruke ikad promijeni, ova funkcija prestaje prepoznavati
 * izuzetke i te tabele će se ponovo prijaviti — vidljivo (provjera padne), ne tiho.
 */
export function filtrirajNamjernePolicyless(
  nalazi: readonly Nalaz[],
  allowlist: readonly string[],
): Nalaz[] {
  return nalazi.filter((n) => {
    if (n.pravilo !== "tabela-bez-politike") return true
    const ime = IME_IZ_PORUKE.exec(n.poruka)?.[1]
    return ime === undefined || !allowlist.includes(ime)
  })
}
