/**
 * Statičke provjere integracije. Tanka ljuska — sva logika je u lib/integracija/,
 * gdje je pokrivena vitest testovima (vitest.config.ts ne obuhvata scripts/).
 *
 * Izlazni kod: 0 čisto, 1 ima nalaza.
 *
 * Pokretanje: pnpm provjeri:integraciju
 */
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { nadjiSudarenePrefikse, nadjiNeispravnaImena } from "../lib/integracija/migracije"
import { nadjiNeparitet, nadjiIcuOne, type Katalog } from "../lib/integracija/prijevodi"
import { provjeriIzvore, type Izvor, type Nalaz } from "../lib/integracija/pravila"
import { RLS_INTENTIONAL_POLICYLESS } from "../lib/rlsCoverage"

const KORIJEN = process.cwd()
const JEZICI = ["sr", "en", "de"] as const
// `supabase/migrations` se NE obrađuje ovdje kao obična grana — v. ucitajMigracijeIzvor.
const OBUHVAT = ["app", "components", "lib", "tests"]
const EKSTENZIJE = /\.(ts|tsx|sql)$/

async function skupiFajlove(pocetak: string): Promise<string[]> {
  const stavke = await readdir(pocetak, { withFileTypes: true, recursive: true })
  return stavke
    .filter((s) => s.isFile() && EKSTENZIJE.test(s.name))
    .map((s) => join(s.parentPath, s.name))
}

/** Maskira poklapanje razmacima, karakter po karakter, čuvajući nove redove — tako
 *  brojevi linija ostaju tačni i poslije maskiranja. */
function maskiraj(poklapanje: string): string {
  return poklapanje.replace(/[^\n]/g, " ")
}

/**
 * SQL-specifično čišćenje prije tekstualne provjere iz pravila.ts: linijski komentari
 * (`-- ...`) i sadržaj jednostrukih navodnika se maskiraju razmacima (linije se ne
 * pomjeraju, samo se prazne). Bez ovoga podniz poput 'CREATE TABLE AS' unutar string
 * literala (stvarni izvršni SQL u rls_auto_enable(), 20260627110000_review_fixes.sql —
 * kopija cloud event trigger funkcije, citira PostgreSQL command_tag vrijednosti kao
 * stringove) ili "create table if not exists" unutar komentara
 * (20260726121000_gradovi_tabela.sql) lažno pogodi TABELA/VIEW obrasce iz pravila.ts —
 * pravila su namjerno tekstualna, ne AST, pa ne razlikuju izvršni kod od komentara/
 * stringova sami. Dollar-quoted ($$...$$) tijela funkcija se NE diraju — ona nose
 * stvaran izvršni SQL (npr. RLS politike u DO blokovima) koji provjera mora vidjeti.
 */
function sanitizujSql(sadrzaj: string): string {
  return sadrzaj.replace(/--[^\n]*/g, maskiraj).replace(/'(?:[^'\\]|\\.)*'/g, maskiraj)
}

/**
 * RLS/security_invoker se u ovom repou po ustaljenom obrascu naknadno dograđuje kroz
 * ODVOJENU migraciju (npr. 20260626211000_rls_enable.sql, sedmicama nakon migracija
 * koje su tabele/viewove tek stvorile) — provjeriSql iz pravila.ts je namjerno po
 * pojedinačnom Izvoru (jednom fajlu), pa bi gledanje SVAKE migracije izolovano lažno
 * prijavilo svaku raniju tabelu/view kao "bez RLS", iako je stvarna kumulativna shema
 * (ono što realno postoji na cloud-u nakon što se sve migracije primijene redom)
 * pokrivena. Zato se cijela istorija migracija spaja u JEDAN Izvor, hronološkim
 * redoslijedom imena fajlova (isti redoslijed kojim se stvarno primjenjuju), prije
 * sanitizacije po fajlu — provjera tako vidi konačno stanje sheme i i dalje hvata
 * pravi propust: tabelu/view koji NI U JEDNOJ migraciji ne dobije politiku/invoker.
 */
async function ucitajMigracijeIzvor(): Promise<Izvor | null> {
  const imena = (
    await readdir(join(KORIJEN, "supabase/migrations")).catch(() => [] as string[])
  )
    .filter((ime) => ime.endsWith(".sql"))
    .sort()
  if (imena.length === 0) return null

  const sadrzaji = await Promise.all(
    imena.map((ime) => readFile(join(KORIJEN, "supabase/migrations", ime), "utf8")),
  )

  return {
    putanja: "supabase/migrations/(kumulativna-shema).sql",
    sadrzaj: sadrzaji.map(sanitizujSql).join("\n"),
  }
}

async function ucitajIzvore(): Promise<Izvor[]> {
  const grane = await Promise.all(
    OBUHVAT.map((dir) => skupiFajlove(join(KORIJEN, dir)).catch(() => [])),
  )
  const putanje = grane.flat()
  const izvori: Izvor[] = await Promise.all(
    putanje.map(async (p) => ({
      putanja: relative(KORIJEN, p).split("\\").join("/"),
      sadrzaj: await readFile(p, "utf8"),
    })),
  )

  const migracije = await ucitajMigracijeIzvor()
  return migracije ? [...izvori, migracije] : izvori
}

/** Ime tabele iz poruke pravila "tabela-bez-politike" (v. pravila.ts `provjeriSql`). */
const IME_IZ_PORUKE = /^tabela (\S+) nema RLS politiku/

/**
 * Da li je nalaz zapravo poznat, namjerno policyless slučaj (RLS uključen, pristup
 * isključivo preko service-role klijenta u cron rutama — v. lib/rlsCoverage.ts
 * RLS_INTENTIONAL_POLICYLESS, koji već koristi `pnpm rls:check`). pravila.ts nema
 * mehanizam izuzetka za ovo pravilo (za razliku od `integracija-dozvoli` markera kod
 * admin-klijenta), pa se ovdje ponovo koristi POSTOJEĆA, već testirana allowlista —
 * ne izmišlja se nova niti se pravilo isključuje.
 */
function jeNamjerniPolicyless(nalaz: Nalaz): boolean {
  if (nalaz.pravilo !== "tabela-bez-politike") return false
  const ime = IME_IZ_PORUKE.exec(nalaz.poruka)?.[1]
  return ime !== undefined && RLS_INTENTIONAL_POLICYLESS.includes(ime)
}

async function main(): Promise<void> {
  const nalazi: Nalaz[] = []

  // 1 + 2 — migracije
  const imenaMigracija = (
    await readdir(join(KORIJEN, "supabase/migrations")).catch(() => [] as string[])
  ).sort()

  for (const sudar of nadjiSudarenePrefikse(imenaMigracija)) {
    nalazi.push({
      putanja: `supabase/migrations/${sudar.fajlovi[0]}`,
      linija: 1,
      pravilo: "sudar-migracija",
      poruka: `prefiks ${sudar.prefiks} dijeli ${sudar.fajlovi.length} fajla: ${sudar.fajlovi.join(", ")} — redoslijed primjene je nedefinisan`,
    })
  }

  for (const ime of nadjiNeispravnaImena(imenaMigracija)) {
    nalazi.push({
      putanja: `supabase/migrations/${ime}`,
      linija: 1,
      pravilo: "ime-migracije",
      poruka: "nedostaje 14-cifreni timestamp prefiks",
    })
  }

  // 3 — prevodi
  const katalozi = Object.fromEntries(
    await Promise.all(
      JEZICI.map(async (j) => [
        j,
        JSON.parse(await readFile(join(KORIJEN, `messages/${j}.json`), "utf8")) as Katalog,
      ]),
    ),
  ) as Record<(typeof JEZICI)[number], Katalog>

  for (const nalaz of nadjiNeparitet(katalozi)) {
    nalazi.push({
      putanja: "messages/",
      linija: 1,
      pravilo: "paritet-prevoda",
      poruka: `ključ ${nalaz.kljuc} nedostaje u: ${nalaz.nedostajeU.join(", ")}`,
    })
  }

  for (const kljuc of nadjiIcuOne(katalozi.sr)) {
    nalazi.push({
      putanja: "messages/sr.json",
      linija: 1,
      pravilo: "icu-one-u-srpskom",
      poruka: `ključ ${kljuc} koristi ICU kategoriju one`,
    })
  }

  // 4 — tekstualna pravila
  nalazi.push(...provjeriIzvore(await ucitajIzvore()).filter((n) => !jeNamjerniPolicyless(n)))

  if (nalazi.length === 0) {
    console.log("✓ provjera integracije: čisto")
    return
  }

  console.error(`✗ provjera integracije: ${nalazi.length} nalaz(a)\n`)
  for (const n of nalazi) {
    console.error(`  ${n.putanja}:${n.linija} — [${n.pravilo}] ${n.poruka}`)
  }
  process.exitCode = 1
}

main().catch((greska) => {
  console.error("provjera integracije je pukla:", greska)
  process.exitCode = 1
})
