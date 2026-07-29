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
import {
  definerSearchPathViolations,
  DEFINER_FUNCTIONS_SQL,
  DEFINER_SEARCH_PATH_ALLOWLIST,
  type FunctionRow,
} from "../lib/definerSearchPath"

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
    // NB: nema ranog `return` — obje provjere moraju odraditi svoj ispis i
    // svaka svoj exitCode, inače čista RLS pokrivenost sakrije pad search_path-a.
    if (violations.length === 0) {
      console.log("✅ RLS pokrivenost OK — sve public tabele imaju RLS + politiku (ili su na allowlist-u).")
    } else {
      console.error(`❌ ${violations.length} RLS prekršaj(a):`)
      for (const v of violations) {
        const opis = v.kind === "rls_disabled" ? "RLS ISKLJUČEN" : "RLS uključen ali BEZ politike (tiho 0 redova)"
        console.error(`   • ${v.table}: ${opis}`)
      }
      process.exitCode = 1
    }

    // Druga provjera: definer funkcije bez pg_temp u search_path-u. Bez ovoga je
    // cijela RLS konstrukcija probojna — polise zovu `je_admin()`, a ona se može
    // preusmjeriti podmetanjem `pg_temp.korisnici`. V. lib/definerSearchPath.ts.
    const functions = (await client.query(DEFINER_FUNCTIONS_SQL)).rows as FunctionRow[]
    const spViolations = definerSearchPathViolations(functions)
    console.log(
      `\nProvjereno security definer funkcija: ${functions.length} | allowlist: ${DEFINER_SEARCH_PATH_ALLOWLIST.join(", ") || "-"}`,
    )
    if (spViolations.length === 0) {
      console.log("✅ search_path OK — svaka definer funkcija eksplicitno navodi pg_temp.")
    } else {
      console.error(`❌ ${spViolations.length} definer funkcija probojna preko pg_temp:`)
      for (const v of spViolations) {
        const opis =
          v.kind === "nema_search_path"
            ? "nema search_path uopšte"
            : "search_path bez pg_temp (pg_temp se onda pretražuje PRVI)"
        console.error(`   • ${v.fn}: ${opis}`)
      }
      process.exitCode = 1
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
