/**
 * Primjenjuje JEDAN SQL migracioni fajl na cloud (session pooler).
 *
 * Okruženje se bira EKSPLICITNO, nikad podrazumijevano:
 *   pnpm db:apply-cloud --demo supabase/migrations/<fajl>.sql
 *   POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/<fajl>.sql
 *
 * Ranije je skripta čitala DATABASE_URL bez ijedne provjere, a npm skripta je
 * vezana na --env-file=.env.local — dakle podrazumijevani cilj je bio PRODUKCIJA,
 * a pogrešan cilj se nije mogao primijetiti dok se migracija ne izvrši. Sada:
 *   1. bez --demo/--prod skripta odbija da radi,
 *   2. connection string mora sadržavati ref koji odgovara traženom cilju,
 *   3. za --prod se traži i potvrda kroz POTVRDI_PROD=da.
 *
 * EVIDENCIJA (N10, 2026-08-01): svaka uspješna primjena upisuje red u
 * `public.primijenjene_migracije` (ime fajla + sha256 + vrijeme + ko). Ista
 * migracija se drugi put ODBIJA osim uz `--ponovo`. Razlog: migracije
 * 20260703102000 i 20260703103000 nisu bile primijenjene ni na DEMO ni na PROD
 * punih mjesec dana, a nije postojalo mjesto na kojem bi se preskok vidio.
 *
 * Dodatne zastavice:
 *   --ponovo            svjesno ponovi već evidentiranu migraciju (uvećava broj_primjena)
 *   --samo-evidencija   NE izvršava SQL, samo upiše red — za popisivanje migracija
 *                       primijenjenih prije nego što je evidencija uvedena
 *   --spisak            ispiše evidenciju za izabrani cilj i izađe (ništa ne mijenja)
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { userInfo } from "node:os"
import { Client } from "pg"
import { zahtijevajCilj, prepoznajCilj } from "@/lib/supabase/refs"

/**
 * Bootstrap evidencije. Namjerno duplira DDL iz
 * supabase/migrations/20260801190000_primijenjene_migracije.sql: evidencija mora
 * postojati i u bazi u koju ta migracija još nije stigla, inače prvi upis pada i
 * skripta opet ostaje bez ikakvog traga — tačno problem koji rješavamo.
 * Sve je `if not exists`, dakle bezopasno na svakom pozivu.
 */
export const EVIDENCIJA_DDL = `
  create table if not exists public.primijenjene_migracije (
    naziv text primary key,
    kontrolna_suma text not null,
    primijenjeno_at timestamptz not null default now(),
    primijenio text,
    broj_primjena integer not null default 1,
    samo_evidencija boolean not null default false
  );
  alter table public.primijenjene_migracije enable row level security;
`

/** sha256 sadržaja migracije — hvata i naknadnu izmjenu već primijenjenog fajla. */
export function kontrolnaSuma(sadrzaj: string): string {
  return createHash("sha256").update(sadrzaj, "utf8").digest("hex")
}

export type EvidencijaRed = {
  naziv: string
  kontrolna_suma: string
  primijenjeno_at: Date | string
  broj_primjena: number
  samo_evidencija: boolean
}

export type Odluka = { dozvoli: true; napomena?: string } | { dozvoli: false; razlog: string }

/**
 * Čista odluka: smije li se migracija pustiti s obzirom na zatečenu evidenciju.
 * Izdvojeno iz main() da se ponašanje može provjeriti bez baze.
 */
export function odluciOPrimjeni(
  naziv: string,
  suma: string,
  postojeci: EvidencijaRed | null,
  ponovo: boolean,
): Odluka {
  if (!postojeci) return { dozvoli: true }
  const kada =
    postojeci.primijenjeno_at instanceof Date
      ? postojeci.primijenjeno_at.toISOString()
      : String(postojeci.primijenjeno_at)
  const istaSuma = postojeci.kontrolna_suma === suma
  if (!ponovo) {
    const drift = istaSuma
      ? ""
      : `\n   ⚠ sadržaj fajla se RAZLIKUJE od primijenjene verzije (evidentirano ${postojeci.kontrolna_suma.slice(0, 12)}…, sada ${suma.slice(0, 12)}…) — migracioni fajl je mijenjan poslije primjene.`
    return {
      dozvoli: false,
      razlog:
        `${naziv} je već primijenjena na ovaj cilj (${kada}, broj primjena: ${postojeci.broj_primjena}` +
        `${postojeci.samo_evidencija ? ", upisana kao samo-evidencija" : ""}).${drift}` +
        `\n   Ako je ponavljanje stvarno namjera, dodaj --ponovo.`,
    }
  }
  return {
    dozvoli: true,
    napomena: istaSuma
      ? `--ponovo: ${naziv} je već evidentirana (${kada}), puštam ponovo.`
      : `--ponovo: ${naziv} je evidentirana ${kada} sa DRUGAČIJIM sadržajem — puštam izmijenjenu verziju.`,
  }
}

function usage(poruka: string): never {
  console.error(`❌ ${poruka}

Upotreba:
  pnpm db:apply-cloud --demo <putanja/do/migracije.sql>
  POTVRDI_PROD=da pnpm db:apply-cloud --prod <putanja/do/migracije.sql>

Zastavice:
  --ponovo            ponovi migraciju koja je već u evidenciji
  --samo-evidencija   upiši u evidenciju bez izvršavanja SQL-a
  --spisak            ispiši evidenciju za izabrani cilj`)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const demo = args.includes("--demo")
  const prod = args.includes("--prod")
  const ponovo = args.includes("--ponovo")
  const samoEvidencija = args.includes("--samo-evidencija")
  const spisak = args.includes("--spisak")
  const file = args.find((a) => !a.startsWith("--"))

  if (demo && prod) usage("--demo i --prod se međusobno isključuju.")
  if (!demo && !prod) usage("Nedostaje --demo ili --prod. Cilj se mora navesti eksplicitno.")
  if (!file && !spisak) usage("Putanja do .sql fajla je obavezna.")
  if (ponovo && samoEvidencija) usage("--ponovo i --samo-evidencija se međusobno isključuju.")

  const cilj = prod ? "prod" : "demo"
  const url = prod ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEMO
  if (!url) usage(`${prod ? "DATABASE_URL" : "DATABASE_URL_DEMO"} nije postavljen.`)

  // Guard: connection string mora stvarno voditi na traženo okruženje.
  zahtijevajCilj(url, cilj, `db:apply-cloud --${cilj}`)

  // --spisak samo čita; potvrda za PROD se traži čim se baza stvarno dira.
  if (prod && !spisak && process.env.POTVRDI_PROD !== "da") {
    usage("Primjena na PRODUKCIJU traži POTVRDI_PROD=da u okruženju.")
  }

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    // Evidencija se stvara prije svega ostalog i VAN transakcije migracije, da
    // neuspjela migracija ne povuče sa sobom i samu tabelu evidencije.
    await client.query(EVIDENCIJA_DDL)

    if (spisak) {
      const res = await client.query(
        `select naziv, left(kontrolna_suma, 12) as suma, primijenjeno_at, primijenio,
                broj_primjena, samo_evidencija
           from public.primijenjene_migracije order by naziv`,
      )
      console.log(`▶ evidencija na ${prepoznajCilj(url).toUpperCase()} — ${res.rowCount} zapis(a)`)
      console.table(res.rows)
      return
    }

    const putanja = file as string
    const sql = readFileSync(putanja, "utf8")
    const naziv = basename(putanja)
    const suma = kontrolnaSuma(sql)

    const postojeci =
      (
        await client.query<EvidencijaRed>(
          `select naziv, kontrolna_suma, primijenjeno_at, broj_primjena, samo_evidencija
             from public.primijenjene_migracije where naziv = $1`,
          [naziv],
        )
      ).rows[0] ?? null

    const odluka = odluciOPrimjeni(naziv, suma, postojeci, ponovo)
    if (!odluka.dozvoli) {
      console.error(`❌ ${odluka.razlog}`)
      process.exit(1)
    }
    if (odluka.napomena) console.warn(`⚠ ${odluka.napomena}`)

    console.log(
      `▶ cilj: ${prepoznajCilj(url).toUpperCase()} · fajl: ${putanja} · sha256: ${suma.slice(0, 12)}…` +
        `${samoEvidencija ? " · SAMO EVIDENCIJA (SQL se ne izvršava)" : ""}`,
    )

    // SQL migracije i upis u evidenciju idu u ISTOJ transakciji: ako migracija
    // padne, evidencija ne smije tvrditi da je prošla (ni obrnuto).
    await client.query("BEGIN")
    try {
      if (!samoEvidencija) await client.query(sql)
      await client.query(
        `insert into public.primijenjene_migracije
           (naziv, kontrolna_suma, primijenio, samo_evidencija)
         values ($1, $2, $3, $4)
         on conflict (naziv) do update set
           kontrolna_suma = excluded.kontrolna_suma,
           primijenjeno_at = now(),
           primijenio = excluded.primijenio,
           broj_primjena = public.primijenjene_migracije.broj_primjena + 1,
           samo_evidencija = excluded.samo_evidencija`,
        [naziv, suma, process.env.PRIMIJENIO ?? userInfo().username, samoEvidencija],
      )
      await client.query("COMMIT")
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    }

    console.log(
      samoEvidencija
        ? `✅ Evidentirano (bez izvršavanja) na ${cilj.toUpperCase()}: ${naziv}`
        : `✅ Primijenjeno i evidentirano na ${cilj.toUpperCase()}: ${naziv}`,
    )
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
