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
 */
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { zahtijevajCilj, prepoznajCilj } from "@/lib/supabase/refs"

function usage(poruka: string): never {
  console.error(`❌ ${poruka}

Upotreba:
  pnpm db:apply-cloud --demo <putanja/do/migracije.sql>
  POTVRDI_PROD=da pnpm db:apply-cloud --prod <putanja/do/migracije.sql>`)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const demo = args.includes("--demo")
  const prod = args.includes("--prod")
  const file = args.find((a) => !a.startsWith("--"))

  if (demo && prod) usage("--demo i --prod se međusobno isključuju.")
  if (!demo && !prod) usage("Nedostaje --demo ili --prod. Cilj se mora navesti eksplicitno.")
  if (!file) usage("Putanja do .sql fajla je obavezna.")

  const cilj = prod ? "prod" : "demo"
  const url = prod ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEMO
  if (!url) usage(`${prod ? "DATABASE_URL" : "DATABASE_URL_DEMO"} nije postavljen.`)

  // Guard: connection string mora stvarno voditi na traženo okruženje.
  zahtijevajCilj(url, cilj, `db:apply-cloud --${cilj}`)

  if (prod && process.env.POTVRDI_PROD !== "da") {
    usage("Primjena na PRODUKCIJU traži POTVRDI_PROD=da u okruženju.")
  }

  const sql = readFileSync(file, "utf8")
  console.log(`▶ cilj: ${prepoznajCilj(url).toUpperCase()} · fajl: ${file}`)

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(sql)
    console.log(`✅ Primijenjeno na ${cilj.toUpperCase()}: ${file}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
