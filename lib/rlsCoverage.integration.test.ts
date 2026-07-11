import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import {
  rlsCoverageViolations,
  RLS_TABLES_SQL,
  RLS_POLICIES_SQL,
  type TableRow,
  type PolicyRow,
} from "./rlsCoverage"

const URL = process.env.TEST_DATABASE_URL

// Gate-uje se na TEST_DATABASE_URL da `pnpm test:unit` bez lokalnog DB i dalje prolazi.
describe.skipIf(!URL)("RLS pokrivenost (integracija, stvarni DB)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  it("svaka public tabela ima RLS uključen i bar jednu politiku (osim allowlist-a)", async () => {
    const tables = (await db.query(RLS_TABLES_SQL)).rows as TableRow[]
    const policies = (await db.query(RLS_POLICIES_SQL)).rows as PolicyRow[]
    const violations = rlsCoverageViolations(tables, policies)
    // Poruka ispisuje tačno koje tabele i zašto, radi brze dijagnoze u CI-u.
    expect(violations, `RLS prekršaji: ${JSON.stringify(violations)}`).toEqual([])
  })
})
