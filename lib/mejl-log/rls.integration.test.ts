import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { withTx, createUser, asUser, noviKlijent, dodijeli } from "./itest-helpers"

const URL = process.env.TEST_DATABASE_URL

// Gate na TEST_DATABASE_URL (lokalni Docker stack) — isti obrazac kao dueRpc.integration.test.ts.
describe.skipIf(!URL)("mejl_log RLS — tri nivoa SELECT (integracija)", () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: URL }); await db.connect() })
  afterAll(async () => { if (db) await db.end() })

  // Seed reda kao vlasnik tabele (upisni RPC dolazi u Task 2). RLS ne vrijedi za vlasnika.
  async function seedRed(klijentId: string | null): Promise<string> {
    const r = await db.query(
      `insert into mejl_log (tip, primaoci, subject, klijent_id, status)
       values ('podsjetnik_interni', '{a@x.com}', 'ITEST', $1, 'poslato') returning id`,
      [klijentId],
    )
    return r.rows[0].id as string
  }
  async function vidljiviIds(uid: string): Promise<string[]> {
    return asUser(db, uid, async () => {
      const r = await db.query("select id from mejl_log")
      return r.rows.map((x) => x.id as string)
    })
  }

  it("(a) admin vidi sve, uključujući red bez firme", async () => {
    await withTx(db, async () => {
      const admin = await createUser(db, "admin")
      const kA = await noviKlijent(db, "A")
      const rA = await seedRed(kA)
      const rNull = await seedRed(null)
      const vid = await vidljiviIds(admin)
      expect(vid).toContain(rA)
      expect(vid).toContain(rNull)
    })
  })

  it("(b) korisnik vidi samo dodijeljenu firmu; ne drugu firmu ni red bez firme", async () => {
    await withTx(db, async () => {
      const op = await createUser(db, "operater")
      const kA = await noviKlijent(db, "A")
      const kB = await noviKlijent(db, "B")
      await dodijeli(db, op, kA)
      const rA = await seedRed(kA)
      const rB = await seedRed(kB)
      const rNull = await seedRed(null)
      const vid = await vidljiviIds(op)
      expect(vid).toContain(rA)
      expect(vid).not.toContain(rB)
      expect(vid).not.toContain(rNull)
    })
  })
})
