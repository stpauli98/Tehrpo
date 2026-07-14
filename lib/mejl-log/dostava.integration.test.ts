import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { withTx } from "./itest-helpers"

const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("azuriraj_mejl_dostavu — precedenca + eskalacija (integracija)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })
  async function seed(resendId: string): Promise<string> {
    const r = await db.query(
      `insert into mejl_log (tip, primaoci, subject, status, resend_id)
       values ('podsjetnik_interni','{a@x.com}','ITEST','poslato',$1) returning id`,
      [resendId],
    )
    return r.rows[0].id as string
  }
  async function azuriraj(resendId: string, status: string): Promise<number> {
    const r = await db.query("select azuriraj_mejl_dostavu($1,$2,now()) c", [resendId, status])
    return r.rows[0].c as number
  }
  async function stanje(id: string) {
    const r = await db.query("select delivery_status, pregledano_at from mejl_log where id=$1", [id])
    return r.rows[0] as { delivery_status: string; pregledano_at: string | null }
  }

  it("opened prije delivered: opened ostaje; kasniji delivered je no-op", async () => {
    await withTx(db, async () => {
      const id = await seed("r1")
      expect(await azuriraj("r1", "opened")).toBe(1)
      expect(await azuriraj("r1", "delivered")).toBe(0)
      expect((await stanje(id)).delivery_status).toBe("opened")
    })
  })

  it("opened ne pregazi bounced", async () => {
    await withTx(db, async () => {
      const id = await seed("r2")
      await azuriraj("r2", "bounced")
      expect(await azuriraj("r2", "opened")).toBe(0)
      expect((await stanje(id)).delivery_status).toBe("bounced")
    })
  })

  it("duplikat događaja je idempotentan (0 redova)", async () => {
    await withTx(db, async () => {
      await seed("r3")
      expect(await azuriraj("r3", "delivered")).toBe(1)
      expect(await azuriraj("r3", "delivered")).toBe(0)
    })
  })

  it("nepoznat resend_id → 0 redova (bez greške)", async () => {
    await withTx(db, async () => {
      expect(await azuriraj("nema", "delivered")).toBe(0)
    })
  })

  it("eskalacija bounced→complained resetuje pregledano_at (re-alarm)", async () => {
    await withTx(db, async () => {
      const id = await seed("r4")
      await azuriraj("r4", "bounced")
      await db.query("update mejl_log set pregledano_at = now() where id=$1", [id])
      expect(await azuriraj("r4", "complained")).toBe(1)
      const s = await stanje(id)
      expect(s.delivery_status).toBe("complained")
      expect(s.pregledano_at).toBeNull()
    })
  })
})
