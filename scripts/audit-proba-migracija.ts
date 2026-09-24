/**
 * AUDIT ALAT — suvi test migracija na DEMO ili PROD: sve u JEDNOJ transakciji, pa UVIJEK rollback.
 *
 * Postoji jer `provjeri-migraciju.ts` radi isključivo na DEMO, a prije primjene na produkciju
 * treba znati hoće li migracija proći na PRODUKCIJSKIM podacima — constraint koji DEMO zadovoljava
 * ne mora zadovoljiti PROD (npr. UNIQUE nad kolonom koja tamo ima duplikate).
 *
 * Ništa se ne mijenja: transakcija se poništava i kad sve prođe i kad padne.
 *
 *   pnpm audit:proba --demo supabase/migrations/*.sql
 *   pnpm audit:proba --prod supabase/migrations/*.sql
 */
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { zahtijevajCilj, prepoznajCilj } from "@/lib/supabase/refs"

async function main() {
  const args = process.argv.slice(2)
  const prod = args.includes("--prod")
  const demo = args.includes("--demo")
  const fajlovi = args.filter((a) => !a.startsWith("--"))

  if (demo === prod) {
    console.error("Navedi tačno jedan cilj: --demo ili --prod")
    process.exit(1)
  }
  if (fajlovi.length === 0) {
    console.error("Navedi bar jednu .sql migraciju")
    process.exit(1)
  }

  const url = prod ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEMO
  if (!url) {
    console.error(`${prod ? "DATABASE_URL" : "DATABASE_URL_DEMO"} nije postavljen.`)
    process.exit(1)
  }
  zahtijevajCilj(url, prod ? "prod" : "demo", "audit:proba")

  console.log(`▶ suvi test na ${prepoznajCilj(url).toUpperCase()} — ${fajlovi.length} migracija\n`)

  const c = new Client({ connectionString: url })
  await c.connect()
  let pao = false
  try {
    await c.query("begin")
    for (const f of fajlovi) {
      const t = Date.now()
      try {
        await c.query(readFileSync(f, "utf8"))
        console.log(`  OK   ${f}  (${Date.now() - t} ms)`)
      } catch (e) {
        pao = true
        console.error(`  PAD  ${f}\n       ${(e as Error).message}`)
        break
      }
    }
  } finally {
    await c.query("rollback").catch(() => {})
    await c.end()
  }
  console.log(pao ? "\n✗ Migracija pala. Rollback urađen — baza je netaknuta." : "\n✓ Sve prošlo. Rollback urađen — baza je netaknuta.")
  if (pao) process.exit(1)
}

main().catch((e) => {
  console.error("GREŠKA:", e.message)
  process.exit(1)
})
