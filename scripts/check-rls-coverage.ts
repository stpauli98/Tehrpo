/**
 * Provjera RLS pokrivenosti nad JEDNOM bazom. Eksplicitan URL preko RLS_CHECK_URL
 * (bez default-a na .env — da se ne pogodi PROD slučajno).
 *
 * Primjeri:
 *   RLS_CHECK_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm rls:check   # lokalni
 *   RLS_CHECK_URL="$(grep -E '^DATABASE_URL_DEMO=' .env.development.local | cut -d= -f2- | tr -d '\"')" pnpm rls:check  # DEMO
 *
 * Exit 0 = čisto; exit 1 = ima prekršaja (pogodno za CI).
 */
import { Client } from "pg"
import {
  rlsCoverageViolations,
  RLS_TABLES_SQL,
  RLS_POLICIES_SQL,
  RLS_INTENTIONAL_POLICYLESS,
  type TableRow,
  type PolicyRow,
} from "../lib/rlsCoverage"

async function main() {
  const url = process.env.RLS_CHECK_URL
  if (!url) {
    console.error("❌ RLS_CHECK_URL nije postavljen. Vidi header skripte za primjere.")
    process.exit(2)
  }
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const tables = (await client.query(RLS_TABLES_SQL)).rows as TableRow[]
    const policies = (await client.query(RLS_POLICIES_SQL)).rows as PolicyRow[]
    const violations = rlsCoverageViolations(tables, policies)
    console.log(`Provjereno public tabela: ${tables.length} | allowlist (namjerno bez politike): ${RLS_INTENTIONAL_POLICYLESS.join(", ") || "-"}`)
    if (violations.length === 0) {
      console.log("✅ RLS pokrivenost OK — sve public tabele imaju RLS + politiku (ili su na allowlist-u).")
      return
    }
    console.error(`❌ ${violations.length} RLS prekršaj(a):`)
    for (const v of violations) {
      const opis = v.kind === "rls_disabled" ? "RLS ISKLJUČEN" : "RLS uključen ali BEZ politike (tiho 0 redova)"
      console.error(`   • ${v.table}: ${opis}`)
    }
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
