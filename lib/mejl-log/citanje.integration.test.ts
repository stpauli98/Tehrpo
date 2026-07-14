import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { withTx, createUser, asUser, noviKlijent, dodijeli } from "./itest-helpers"

const URL = process.env.TEST_DATABASE_URL

// Gate na TEST_DATABASE_URL (lokalni Docker stack) — isti obrazac kao rls.integration.test.ts.
describe.skipIf(!URL)("mejl_log read-model + bedž + pregled (integracija)", () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: URL }); await db.connect() })
  afterAll(async () => { if (db) await db.end() })

  async function seedGreska(k: string | null): Promise<string> {
    const r = await db.query(
      `insert into mejl_log (tip, primaoci, subject, klijent_id, status, greska)
       values ('podsjetnik_interni','{a@x.com}','ITEST',$1,'greska_slanja','x') returning id`,
      [k],
    )
    return r.rows[0].id as string
  }
  async function bedz(uid: string): Promise<number> {
    return asUser(db, uid, async () => (await db.query("select get_mejl_greske_broj() c")).rows[0].c as number)
  }

  it("bedž je RLS-skopiran: admin broji sve greške (i bez firme); operater samo svoje", async () => {
    await withTx(db, async () => {
      const admin = await createUser(db, "admin")
      const op = await createUser(db, "operater")
      const kA = await noviKlijent(db, "ITEST firma A")
      const kB = await noviKlijent(db, "ITEST firma B")
      await dodijeli(db, op, kA)
      await seedGreska(kA)
      await seedGreska(kB)
      await seedGreska(null)
      expect(await bedz(admin)).toBe(3)
      expect(await bedz(op)).toBe(1) // samo firma A
    })
  })

  it("oznaci_mejl_pregledan: ovlašteni čisti; neovlašteni je no-op", async () => {
    await withTx(db, async () => {
      const op = await createUser(db, "operater")
      const kA = await noviKlijent(db, "ITEST firma A")
      const kB = await noviKlijent(db, "ITEST firma B")
      await dodijeli(db, op, kA)
      const gA = await seedGreska(kA)
      const gB = await seedGreska(kB)
      await asUser(db, op, () => db.query("select oznaci_mejl_pregledan($1)", [gA]))
      await asUser(db, op, () => db.query("select oznaci_mejl_pregledan($1)", [gB])) // nema pristup
      const rA = await db.query("select pregledano_at from mejl_log where id=$1", [gA])
      const rB = await db.query("select pregledano_at from mejl_log where id=$1", [gB])
      expect(rA.rows[0].pregledano_at).not.toBeNull()
      expect(rB.rows[0].pregledano_at).toBeNull()
    })
  })

  it("get_poslati_mejlovi vraća ukupno + poštuje p_samo_greske; view je RLS-skopiran", async () => {
    await withTx(db, async () => {
      const op = await createUser(db, "operater")
      const kA = await noviKlijent(db, "ITEST firma A")
      const kB = await noviKlijent(db, "ITEST firma B")
      await dodijeli(db, op, kA)
      await seedGreska(kA)
      await seedGreska(kB)
      const rows = await asUser(db, op, async () =>
        (await db.query("select * from get_poslati_mejlovi(null,null,null,null,true,false,50,0)")).rows)
      expect(rows.length).toBe(1) // vidi samo firmu A
      expect(Number(rows[0].ukupno)).toBe(1)
    })
  })
})
