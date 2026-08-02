/**
 * AUDIT ALAT (samo u audit worktree-u) — pokreće SQL upit nad DEMO ili PROD bazom.
 *
 * PROD je TVRDO read-only: upit se izvršava u `BEGIN; SET TRANSACTION READ ONLY;`
 * pa `ROLLBACK`, tako da Postgres sam odbija svaki pokušaj pisanja.
 * DEMO se smije i pisati (uz --pisi), jer je to okruženje za testove.
 *
 *   pnpm audit:sql --demo "select count(*) from termini"
 *   pnpm audit:sql --prod "select ..."            # uvijek read-only
 *   pnpm audit:sql --demo --pisi "update ..."     # eksplicitno pisanje na DEMO
 *   pnpm audit:sql --demo --fajl upit.sql
 */
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { zahtijevajCilj } from "@/lib/supabase/refs"

async function main() {
  const args = process.argv.slice(2)
  const prod = args.includes("--prod")
  const demo = args.includes("--demo")
  const pisi = args.includes("--pisi")
  const fajlIdx = args.indexOf("--fajl")
  const putanja = fajlIdx >= 0 ? args[fajlIdx + 1] : undefined
  const sql = putanja
    ? readFileSync(putanja, "utf8")
    : args.find((a) => !a.startsWith("--"))

  if (demo === prod) {
    console.error("Navedi tačno jedan cilj: --demo ili --prod")
    process.exit(1)
  }
  if (!sql) {
    console.error("Nedostaje SQL (kao argument ili --fajl <putanja>)")
    process.exit(1)
  }
  if (prod && pisi) {
    console.error("PROD je read-only u auditu. --pisi nije dozvoljen.")
    process.exit(1)
  }

  const url = prod ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEMO
  if (!url) {
    console.error(`${prod ? "DATABASE_URL" : "DATABASE_URL_DEMO"} nije postavljen.`)
    process.exit(1)
  }
  zahtijevajCilj(url, prod ? "prod" : "demo", "audit:sql")

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    if (!pisi) {
      await client.query("BEGIN")
      await client.query("SET TRANSACTION READ ONLY")
    }
    const res = await client.query(sql)
    const rezultati = Array.isArray(res) ? res : [res]
    for (const r of rezultati) {
      if (r.rows?.length) console.log(JSON.stringify(r.rows, null, 2))
      else console.log(`(${r.rowCount ?? 0} redova, command=${r.command})`)
    }
    if (!pisi) await client.query("ROLLBACK")
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("GREŠKA:", e.message)
  process.exit(1)
})
