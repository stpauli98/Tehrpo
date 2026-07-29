import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import {
  definerSearchPathViolations,
  DEFINER_FUNCTIONS_SQL,
  type FunctionRow,
} from "./definerSearchPath"

const URL = process.env.TEST_DATABASE_URL

// Gate-uje se na TEST_DATABASE_URL da `pnpm test:unit` bez lokalnog DB i dalje prolazi.
describe.skipIf(!URL)("definer search_path (integracija, stvarni DB)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  it("svaka security definer funkcija u public ima pg_temp u search_path-u", async () => {
    const functions = (await db.query(DEFINER_FUNCTIONS_SQL)).rows as FunctionRow[]
    const violations = definerSearchPathViolations(functions)
    expect(
      violations,
      `definer funkcije bez pg_temp u search_path-u — podmetanje pg_temp tabele ih probija: ${JSON.stringify(violations)}`,
    ).toEqual([])
  })
})
