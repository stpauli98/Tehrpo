import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// Gate-uje se na TEST_DATABASE_URL da `pnpm test:unit` bez lokalnog DB i dalje prolazi.
describe.skipIf(!URL)("get_due_podsjetnici (integracija, lokalni DB)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  // Svaki slučaj radi u transakciji koja se ROLLBACK-uje → ne prlja DB.
  async function withSeed(fn: (ids: { klijent: string; vrsta: string }) => Promise<void>) {
    await db.query("begin")
    try {
      const k = await db.query("insert into klijenti (naziv) values ('ITEST klijent') returning id")
      const v = await db.query("insert into vrste_provjera (naziv) values ('ITEST vrsta') returning id")
      await fn({ klijent: k.rows[0].id as string, vrsta: v.rows[0].id as string })
    } finally {
      await db.query("rollback")
    }
  }

  // datum_zadnjeg ostaje null → tg_compute_rok NE prepisuje rok_dospijeca.
  async function addTermin(ids: { klijent: string; vrsta: string }, offsetDana: number) {
    const r = await db.query(
      `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status)
       values ($1, $2, current_date + $3::int, 'planirano') returning id`,
      [ids.klijent, ids.vrsta, offsetDana],
    )
    return r.rows[0].id as string
  }

  type Row = { termin_id: string; dana_prije: number; dana_do_roka: number }
  async function due(dana: number[]): Promise<Row[]> {
    const r = await db.query("select * from get_due_podsjetnici($1::int[])", [dana])
    return r.rows as Row[]
  }

  it("pre-due: termin +30 dobije prag 30; +61 ništa (prozor 60 nije ušao)", async () => {
    await withSeed(async (ids) => {
      const t30 = await addTermin(ids, 30)
      const t61 = await addTermin(ids, 61)
      const rows = await due([60, 30, 15, 7])
      expect(rows.filter((x) => x.termin_id === t30).map((x) => x.dana_prije)).toEqual([30])
      expect(rows.filter((x) => x.termin_id === t61)).toHaveLength(0)
    })
  })

  it("catch-up: termin +50 (propušten 60-dan) dobije SAMO prag 60", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 50)
      const rows = (await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dana_prije).toBe(60)
      expect(rows[0]!.dana_do_roka).toBe(50)
    })
  })

  it("idempotencija: kad postoji podsjetnik za prag, prag se ne vraća", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 7)
      await db.query("insert into podsjetnici (termin_id, dana_prije, poslat_na) values ($1, 7, '{a@x.com}')", [t])
      const rows = (await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)
      expect(rows).toHaveLength(0)
    })
  })

  it("negativni post-due marker ne blokira pre-due prag za isti termin (reschedule)", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 30) // rok +30 → pre-due prag 30 treba okidati
      // Simulacija starog post-due markera (rok bio prošao, termin reschedulan)
      await db.query(
        "insert into podsjetnici (termin_id, dana_prije, poslat_na) values ($1, -5, '{a@x.com}')",
        [t],
      )
      const rows = (await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dana_prije).toBe(30)
    })
  })

  it("izvršen termin se ignoriše (ni pre-due ni post-due)", async () => {
    await withSeed(async (ids) => {
      const r = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status, datum_izvrsenja)
         values ($1,$2, current_date - 1, 'izvrseno', current_date - 1) returning id`,
        [ids.klijent, ids.vrsta],
      )
      const t = r.rows[0].id as string
      expect((await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)).toHaveLength(0)
    })
  })
})
