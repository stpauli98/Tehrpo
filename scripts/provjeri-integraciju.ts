/**
 * Statičke provjere integracije. Tanka ljuska — sva logika je u lib/integracija/,
 * gdje je pokrivena vitest testovima (vitest.config.ts ne obuhvata scripts/). Ova
 * datoteka smije samo: pozvati `git`, čitati disk (`readdir`/`readFile`), pozvati čiste
 * funkcije iz lib/integracija/, i formatirati ispis/izlazni kod.
 *
 * Obuhvat SQL migracija zavisi od načina pokretanja (v. lib/integracija/opcije.ts) —
 * provjere koje NE zavise od obuhvata (sudar prefiksa, neispravno ime, paritet
 * prevoda, ICU `one`) i pravila nad .ts/.tsx uvijek idu nad cijelim repozitorijem
 * (nemaju šum koji bi tražio suženje).
 *
 * Izlazni kod: 0 čisto, 1 ima nalaza, 2 greška u opcijama ili bazna grana nije
 * razrešiva lokalno.
 *
 * Pokretanje:
 *   pnpm provjeri:integraciju                  # bazna grana: origin/main
 *   pnpm provjeri:integraciju -- --baza <ref>  # eksplicitna bazna grana
 *   pnpm provjeri:integraciju -- --sve         # sve migracije, bez obzira na git
 *
 * U podrazumijevanom/--baza režimu, obuhvat migracija je UNIJA: fajlovi koje grana
 * stvarno donosi (`git diff <baza>...HEAD`) I necommitovane izmjene u radnom stablu
 * (`git status --porcelain`: untracked, staged, modified) — bez ovog drugog dijela,
 * pokretanje skripte LOKALNO prije komita (tačno trenutak kad je jedina korisna)
 * uvijek bi javljalo "0 fajlova, čisto" bez obzira šta je na disku.
 *
 * Oba git poziva koriste `-z` (NUL-terminated, sirov UTF-8, BEZ navodnika/escape-a) —
 * `core.quotePath` je podrazumijevano uključen u gitu i bez `-z` bi svaka migracija sa
 * ne-ASCII imenom (u repou čiji je domenski jezik BCS latinica to nije egzotično) bila
 * C-escapovana i omotana u navodnike, pa bi tiho ispala iz obuhvata — v.
 * lib/integracija/opcije.ts za detalje formata.
 */
import { execFileSync } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { nadjiSudarenePrefikse, nadjiNeispravnaImena } from "../lib/integracija/migracije"
import { nadjiNeparitet, nadjiIcuOne, type Katalog } from "../lib/integracija/prijevodi"
import { provjeriIzvore, type Izvor, type Nalaz } from "../lib/integracija/pravila"
import { sanitizujSql, filtrirajNamjernePolicyless } from "../lib/integracija/sql"
import {
  parsirajOpcije,
  filtrirajSqlImena,
  filtrirajMigracijskePutanje,
  parsirajGitDiffNameOnly,
  parsirajGitStatusPorcelainZ,
  spojiPutanje,
  zadrziPostojeceMigracije,
  normalizujPutanju,
  jeTsIzvor,
  type Opcije,
} from "../lib/integracija/opcije"
import { RLS_INTENTIONAL_POLICYLESS } from "../lib/rlsCoverage"

const KORIJEN = process.cwd()
const JEZICI = ["sr", "en", "de"] as const
const OBUHVAT_TS = ["app", "components", "lib", "tests"]

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

/** Migracije koje grana STVARNO donosi (commitovano) u odnosu na `baza`. */
function komitovaneMigracije(baza: string): string[] {
  if (!bazaPostojiLokalno(baza)) {
    throw new BaznaGranaGreska(
      `bazna grana "${baza}" nije razrešiva lokalno (možda treba \`git fetch origin\`?)`,
    )
  }
  const izlaz = git(["diff", "--name-only", "-z", "--diff-filter=ACMR", `${baza}...HEAD`])
  return filtrirajMigracijskePutanje(parsirajGitDiffNameOnly(izlaz))
}

/** Necommitovane migracije u radnom stablu (untracked, staged, modified) — v. napomenu
 *  o uniji u modul-nivo komentaru iznad. */
function radnoStabloMigracije(): string[] {
  const izlaz = git(["status", "--porcelain", "-z"])
  return filtrirajMigracijskePutanje(parsirajGitStatusPorcelainZ(izlaz))
}

async function skupiFajlove(pocetak: string, jeIzvor: (ime: string) => boolean): Promise<string[]> {
  const stavke = await readdir(pocetak, { withFileTypes: true, recursive: true })
  return stavke
    .filter((s) => s.isFile() && jeIzvor(s.name))
    .map((s) => join(s.parentPath, s.name))
}

async function ucitajTsIzvore(): Promise<Izvor[]> {
  const grane = await Promise.all(
    OBUHVAT_TS.map((dir) => skupiFajlove(join(KORIJEN, dir), jeTsIzvor).catch(() => [])),
  )
  const putanje = grane.flat()
  return Promise.all(
    putanje.map(async (p) => ({
      putanja: normalizujPutanju(relative(KORIJEN, p)),
      sadrzaj: await readFile(p, "utf8"),
    })),
  )
}

/** Imena FAJLOVA (ne poddirektorija) u supabase/migrations — poddirektorij bi inače
 *  pukao sa EISDIR kad bi ga ucitajMigracijeIzvore pokušao pročitati kao fajl (prošli
 *  defekt). */
async function imenaUMigracijama(): Promise<string[]> {
  const stavke = await readdir(join(KORIJEN, "supabase/migrations"), {
    withFileTypes: true,
  }).catch(() => [])
  return stavke
    .filter((s) => s.isFile())
    .map((s) => s.name)
    .sort()
}

/** Relativne putanje (`supabase/migrations/*.sql`) čiji sadržaj treba provjeriti.
 *  Unija se na kraju siječe sa stvarnim sadržajem direktorija — `git diff` vidi
 *  komitovanu migraciju i pod STARIM imenom poslije `git mv`/`rm`/`git rm`, a taj fajl
 *  više nije na disku (v. `zadrziPostojeceMigracije`). */
function odaberiPutanjeMigracija(opcije: Opcije, sveImenaMigracija: string[]): string[] {
  if (opcije.sve) {
    return filtrirajSqlImena(sveImenaMigracija).map((ime) => `supabase/migrations/${ime}`)
  }
  return zadrziPostojeceMigracije(
    spojiPutanje(komitovaneMigracije(opcije.baza), radnoStabloMigracije()),
    sveImenaMigracija,
  )
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
  const rezultatOpcija = parsirajOpcije(process.argv.slice(2))
  if (!rezultatOpcija.ok) {
    console.error(`✗ ${rezultatOpcija.poruka}`)
    process.exitCode = 2
    return
  }
  const { opcije, upozorenje } = rezultatOpcija
  if (upozorenje !== null) {
    console.error(`⚠ ${upozorenje}`)
  }

  const nalazi: Nalaz[] = []

  // 1 + 2 — migracije: imena se provjeravaju nad CIJELIM repozitorijem, ne zavise od
  // obuhvata (sudar prefiksa i neispravno ime pogađaju bilo koju granu, ne samo onu
  // koja ih je unijela).
  const sveImenaMigracija = await imenaUMigracijama()

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
      : `ℹ obuhvat migracija: ${putanjeMigracija.length} fajl(ova) — commitovano u odnosu na ${opcije.baza} ILI necommitovano u radnom stablu (untracked/staged/modified)`,
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
