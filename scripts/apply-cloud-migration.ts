/**
 * Primjenjuje JEDAN SQL migracioni fajl na cloud preko DATABASE_URL (session pooler).
 * Pokretanje: pnpm db:apply-cloud supabase/migrations/<fajl>.sql
 */
import { readFileSync } from "node:fs"
import { Client } from "pg"

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("Putanja do .sql fajla je obavezna")
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL nije postavljen")
  const sql = readFileSync(file, "utf8")
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(sql)
    console.log(`✅ Primijenjeno: ${file}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
