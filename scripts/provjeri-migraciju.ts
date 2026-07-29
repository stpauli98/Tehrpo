// Pusti navedene migracije u JEDNOJ transakciji na cloud DEMO, pa uvijek rollback.
// Baza ostaje netaknuta — ovo je provjera sintakse i ponašanja, ne apply.
// Upotreba: pnpm exec tsx --env-file=.env.development.local scripts/provjeri-migraciju.ts <fajl.sql> [...]
import { readFileSync } from "node:fs"
import { Client } from "pg"

const DEMO_REF = "mtwwotmwrasozmcgqwhc"

async function main() {
  const fajlovi = process.argv.slice(2)
  if (fajlovi.length === 0) {
    throw new Error("Navedi bar jednu .sql migraciju")
  }
  const url = process.env.DATABASE_URL_DEMO
  if (!url) throw new Error("DATABASE_URL_DEMO nije postavljen")
  if (!url.includes(DEMO_REF)) throw new Error(`Connection string nije DEMO (${DEMO_REF}) — prekid`)

  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    await c.query("begin")
    for (const f of fajlovi) {
      const sql = readFileSync(f, "utf8")
      const t = Date.now()
      await c.query(sql)
      console.log(`OK  ${f}  (${Date.now() - t} ms)`)
    }
    console.log("\nSve migracije prošle. Radim rollback — baza je netaknuta.")
  } finally {
    await c.query("rollback").catch(() => {})
    await c.end()
  }
}

main().catch((e) => {
  console.error("PAD:", e.message)
  process.exit(1)
})
