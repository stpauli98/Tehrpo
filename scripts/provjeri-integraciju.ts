/**
 * Statičke provjere integracije. Tanka ljuska — sva logika je u lib/integracija/,
 * gdje je pokrivena vitest testovima (vitest.config.ts ne obuhvata scripts/).
 *
 * Obuhvat SQL migracija zavisi od načina pokretanja (v. parsirajOpcije ispod) —
 * provjere koje NE zavise od obuhvata (sudar prefiksa, neispravno ime, paritet
 * prevoda, ICU `one`) i pravila nad .ts/.tsx uvijek idu nad cijelim repozitorijem
 * (nemaju šum koji bi tražio suženje).
 *
 * Izlazni kod: 0 čisto, 1 ima nalaza, 2 bazna grana nije razrešiva lokalno.
 *
 * Pokretanje:
 *   pnpm provjeri:integraciju                  # bazna grana: origin/main
 *   pnpm provjeri:integraciju -- --baza <ref>  # eksplicitna bazna grana
 *   pnpm provjeri:integraciju -- --sve         # sve migracije, bez obzira na git
 */
import { execFileSync } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { nadjiSudarenePrefikse, nadjiNeispravnaImena } from "../lib/integracija/migracije"
import { nadjiNeparitet, nadjiIcuOne, type Katalog } from "../lib/integracija/prijevodi"
import { provjeriIzvore, type Izvor, type Nalaz } from "../lib/integracija/pravila"
import { sanitizujSql, filtrirajNamjernePolicyless } from "../lib/integracija/sql"
import { RLS_INTENTIONAL_POLICYLESS } from "../lib/rlsCoverage"

const KORIJEN = process.cwd()
const JEZICI = ["sr", "en", "de"] as const
const OBUHVAT_TS = ["app", "components", "lib", "tests"]
const BAZA_PODRAZUMIJEVANA = "origin/main"

type Opcije = { sve: boolean; baza: string }

function parsirajOpcije(argovi: string[]): Opcije {
  let sve = false
  let baza = BAZA_PODRAZUMIJEVANA
  for (let i = 0; i < argovi.length; i++) {
    const a = argovi[i]
    if (a === "--sve") {
      sve = true
    } else if (a === "--baza") {
      const vrijednost = argovi[i + 1]
      if (vrijednost === undefined) {
        throw new Error("--baza zahtijeva vrijednost (npr. --baza origin/main)")
      }
      baza = vrijednost
      i++
    }
  }
  return { sve, baza }
}

/** Bazna grana nije razrešiva lokalno — jasna greška i izlazni kod 2, ne tiho "čisto". */
class BaznaGranaGreska extends Error {}

function git(argovi: string[]): string {
  return execFileSync("git", argovi, { cwd: KORIJEN, encoding: "utf8" })
}

function bazaPostojiLokalno(baza: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", baza])
    return true
  } catch {
    return false
  }
}

/** Migracije nove/izmijenjene na trenutnoj grani u odnosu na `baza` — ono što grana
 *  STVARNO donosi, ne cijela istorija (koja legitimno razdvaja tabelu i njenu politiku
 *  po različitim migracijama iz različitih, davno spojenih grana). */
function izmijenjeneMigracije(baza: string): string[] {
  if (!bazaPostojiLokalno(baza)) {
    throw new BaznaGranaGreska(
      `bazna grana "${baza}" nije razrešiva lokalno (možda treba \`git fetch origin\`?)`,
    )
  }
  const izlaz = git(["diff", "--name-only", "--diff-filter=ACMR", `${baza}...HEAD`])
  return izlaz
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("supabase/migrations/") && r.endsWith(".sql"))
    .sort()
}

async function skupiFajlove(pocetak: string, ekstenzije: RegExp): Promise<string[]> {
  const stavke = await readdir(pocetak, { withFileTypes: true, recursive: true })
  return stavke
    .filter((s) => s.isFile() && ekstenzije.test(s.name))
    .map((s) => join(s.parentPath, s.name))
}

async function ucitajTsIzvore(): Promise<Izvor[]> {
  const grane = await Promise.all(
    OBUHVAT_TS.map((dir) => skupiFajlove(join(KORIJEN, dir), /\.tsx?$/).catch(() => [])),
  )
  const putanje = grane.flat()
  return Promise.all(
    putanje.map(async (p) => ({
      putanja: relative(KORIJEN, p).split("\\").join("/"),
      sadrzaj: await readFile(p, "utf8"),
    })),
  )
}

/** Relativne putanje (`supabase/migrations/*.sql`) čiji sadržaj treba provjeriti —
 *  zavisi od `opcije.sve` (cijeli direktorij) ili `opcije.baza` (git diff). */
function odaberiPutanjeMigracija(opcije: Opcije, sveImenaMigracija: string[]): string[] {
  if (opcije.sve) {
    return sveImenaMigracija.map((ime) => `supabase/migrations/${ime}`)
  }
  return izmijenjeneMigracije(opcije.baza)
}

/** Svaki fajl ide kroz provjeriSql ZASEBNO (jedan Izvor = jedan fajl) — tako `putanja`
 *  i `linija` u nalazu pokazuju na stvaran fajl i stvarnu liniju, ne na sintetički
 *  agregat. */
async function ucitajMigracijeIzvore(putanje: string[]): Promise<Izvor[]> {
  return Promise.all(
    putanje.map(async (putanja) => ({
      putanja,
      sadrzaj: sanitizujSql(await readFile(join(KORIJEN, putanja), "utf8")),
    })),
  )
}

async function main(): Promise<void> {
  const opcije = parsirajOpcije(process.argv.slice(2))
  const nalazi: Nalaz[] = []

  // 1 + 2 — migracije: imena se provjeravaju nad CIJELIM repozitorijem, ne zavise od
  // obuhvata (sudar prefiksa i neispravno ime pogađaju bilo koju granu, ne samo onu
  // koja ih je unijela).
  const sveImenaMigracija = (
    await readdir(join(KORIJEN, "supabase/migrations")).catch(() => [] as string[])
  ).sort()

  for (const sudar of nadjiSudarenePrefikse(sveImenaMigracija)) {
    nalazi.push({
      putanja: `supabase/migrations/${sudar.fajlovi[0]}`,
      linija: 1,
      pravilo: "sudar-migracija",
      poruka: `prefiks ${sudar.prefiks} dijeli ${sudar.fajlovi.length} fajla: ${sudar.fajlovi.join(", ")} — redoslijed primjene je nedefinisan`,
    })
  }

  for (const ime of nadjiNeispravnaImena(sveImenaMigracija)) {
    nalazi.push({
      putanja: `supabase/migrations/${ime}`,
      linija: 1,
      pravilo: "ime-migracije",
      poruka: "nedostaje 14-cifreni timestamp prefiks",
    })
  }

  // 3 — prevodi: cijeli repozitorij, ne zavisi od obuhvata.
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

  // 4 — tekstualna pravila. SQL migracije: obuhvat zavisi od --sve/--baza, svaki fajl
  // zasebno (v. ucitajMigracijeIzvore). TS/TSX: uvijek cijeli repozitorij.
  let putanjeMigracija: string[]
  try {
    putanjeMigracija = odaberiPutanjeMigracija(opcije, sveImenaMigracija)
  } catch (greska) {
    if (greska instanceof BaznaGranaGreska) {
      console.error(`✗ ${greska.message}`)
      process.exitCode = 2
      return
    }
    throw greska
  }

  // Uvijek ispisano — i kad je obuhvat prazan — da prazan obuhvat ne izgleda kao
  // uspješna provjera.
  console.log(
    opcije.sve
      ? `ℹ obuhvat migracija: ${putanjeMigracija.length} fajl(ova) (--sve, bez obzira na git)`
      : `ℹ obuhvat migracija: ${putanjeMigracija.length} fajl(ova) izmijenjeno u odnosu na ${opcije.baza}`,
  )

  const sviIzvori = [
    ...(await ucitajTsIzvore()),
    ...(await ucitajMigracijeIzvore(putanjeMigracija)),
  ]
  nalazi.push(
    ...filtrirajNamjernePolicyless(provjeriIzvore(sviIzvori), RLS_INTENTIONAL_POLICYLESS),
  )

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
