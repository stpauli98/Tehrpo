import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { withTx, createUser, asUser, noviKlijent, dodijeli } from "./itest-helpers"

const URL = process.env.TEST_DATABASE_URL

// Gate na TEST_DATABASE_URL (lokalni Docker stack) — isti obrazac kao rls.integration.test.ts.
describe.skipIf(!URL)("zabiljezi_mejl_log — upis + pristup (integracija)", () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: URL }); await db.connect() })
  afterAll(async () => { if (db) await db.end() })

  async function pozovi(k: string | null) {
    await db.query(
      "select zabiljezi_mejl_log('podsjetnik_interni','{a@x.com}','ITEST',null,$1,'rid_1','poslato',null)",
      [k],
    )
  }
  async function brojZa(k: string | null): Promise<number> {
    const r = k === null
      ? await db.query("select count(*)::int c from mejl_log where klijent_id is null and subject='ITEST'")
      : await db.query("select count(*)::int c from mejl_log where klijent_id=$1", [k])
    return r.rows[0].c as number
  }

  it("service-role (bez jwt) upisuje bez provjere", async () => {
    await withTx(db, async () => {
      const k = await noviKlijent(db)
      await pozovi(k) // pozvano kao vlasnik/superuser → auth.uid() null → trusted
      expect(await brojZa(k)).toBe(1)
    })
  })

  it("authenticated sa pristupom firmi A upisuje za A; bez pristupa (B) je no-op", async () => {
    await withTx(db, async () => {
      const op = await createUser(db, "operater")
      const kA = await noviKlijent(db, "ITEST firma A")
      const kB = await noviKlijent(db, "ITEST firma B")
      await dodijeli(db, op, kA)
      await asUser(db, op, () => pozovi(kA))
      await asUser(db, op, () => pozovi(kB))
      expect(await brojZa(kA)).toBe(1)
      expect(await brojZa(kB)).toBe(0) // nema pristup → RPC tiho preskočio
    })
  })

  it("admin upisuje red bez firme (tip test)", async () => {
    await withTx(db, async () => {
      const admin = await createUser(db, "admin")
      await asUser(db, admin, async () => {
        await db.query("select zabiljezi_mejl_log('test','{a@x.com}','ITEST',null,null,null,'poslato',null)")
      })
      expect(await brojZa(null)).toBe(1)
    })
  })

  it("direktan authenticated INSERT je odbijen (nema INSERT politike)", async () => {
    await withTx(db, async () => {
      const op = await createUser(db, "operater")
      const kA = await noviKlijent(db)
      await dodijeli(db, op, kA)
      await expect(
        asUser(db, op, () =>
          db.query("insert into mejl_log (tip,primaoci,subject,klijent_id,status) values ('podsjetnik_interni','{a@x.com}','X',$1,'poslato')", [kA]),
        ),
      ).rejects.toThrow()
    })
  })
})
