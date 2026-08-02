import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { withTx, createUser, asUser, noviKlijent, dodijeli } from "../mejl-log/itest-helpers"

const URL = process.env.TEST_DATABASE_URL

/**
 * B6 / migracija 20260802134500: `oznaci_mejl_pregledan` je jedini upisni put dostupan ulozi
 * `pregled`. Funkcija je SECURITY DEFINER, pa je RLS ne dodiruje — uslov je bio samo
 * `je_admin() or ima_pristup_klijentu(...)`, a nijedan ne isključuje read-only ulogu.
 *
 * Gate na TEST_DATABASE_URL (Docker stack sa primijenjenim migracijama) — isti obrazac
 * kao dozvoleRls.integration.test.ts i mejl-log/citanje.integration.test.ts.
 */
describe.skipIf(!URL)("oznaci_mejl_pregledan ne piše za ulogu pregled (integracija)", () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: URL }); await db.connect() })
  afterAll(async () => { if (db) await db.end() })

  async function seedGreska(k: string | null): Promise<string> {
    const r = await db.query(
      `insert into mejl_log (tip, primaoci, subject, klijent_id, status, greska)
       values ('podsjetnik_interni','{a@x.com}','ITEST B6',$1,'greska_slanja','x') returning id`,
      [k],
    )
    return r.rows[0].id as string
  }
  async function pregledanoAt(id: string): Promise<string | null> {
    const r = await db.query("select pregledano_at from mejl_log where id=$1", [id])
    return r.rows[0].pregledano_at
  }

  it("pregled sa dodijeljenom firmom NE gasi bedž", async () => {
    await withTx(db, async () => {
      const citalac = await createUser(db, "pregled")
      const k = await noviKlijent(db, `ITEST B6 ${crypto.randomUUID()}`)
      await dodijeli(db, citalac, k)
      const g = await seedGreska(k)
      await asUser(db, citalac, () => db.query("select oznaci_mejl_pregledan($1)", [g]))
      expect(await pregledanoAt(g)).toBeNull()
    })
  })

  it("pregled ne gasi ni red bez klijenta (globalna greška slanja)", async () => {
    await withTx(db, async () => {
      const citalac = await createUser(db, "pregled")
      const g = await seedGreska(null)
      await asUser(db, citalac, () => db.query("select oznaci_mejl_pregledan($1)", [g]))
      expect(await pregledanoAt(g)).toBeNull()
    })
  })

  it("operater sa dodjelom i admin i dalje gase bedž (gejt ne lomi normalan put)", async () => {
    await withTx(db, async () => {
      const op = await createUser(db, "operater")
      const admin = await createUser(db, "admin")
      const k = await noviKlijent(db, `ITEST B6 ${crypto.randomUUID()}`)
      await dodijeli(db, op, k)
      const gOp = await seedGreska(k)
      const gAdmin = await seedGreska(null)
      await asUser(db, op, () => db.query("select oznaci_mejl_pregledan($1)", [gOp]))
      await asUser(db, admin, () => db.query("select oznaci_mejl_pregledan($1)", [gAdmin]))
      expect(await pregledanoAt(gOp)).not.toBeNull()
      expect(await pregledanoAt(gAdmin)).not.toBeNull()
    })
  })
})
