import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// Gate na TEST_DATABASE_URL → `pnpm test:unit` bez lokalnog DB i dalje prolazi.
describe.skipIf(!URL)("nacin_izvrsenja (integracija, lokalni DB)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  async function withSeed(fn: (ids: { klijent: string; vrsta: string }) => Promise<void>) {
    await db.query("begin")
    try {
      const k = await db.query("insert into klijenti (naziv) values ('ITEST nacin') returning id")
      const v = await db.query("insert into vrste_provjera (naziv) values ('ITEST nacin v') returning id")
      await fn({ klijent: k.rows[0].id as string, vrsta: v.rows[0].id as string })
    } finally {
      await db.query("rollback")
    }
  }

  it("termini_view izlaže nacin_izvrsenja; default je 'izvrsava'", async () => {
    await withSeed(async (ids) => {
      const t = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status)
         values ($1, $2, current_date + 30, 'planirano') returning id`,
        [ids.klijent, ids.vrsta],
      )
      const r = await db.query("select nacin_izvrsenja from termini_view where id = $1", [t.rows[0].id])
      expect(r.rows[0].nacin_izvrsenja).toBe("izvrsava")
    })
  })

  it("auto_cycle kopira nacin_izvrsenja='pracenje' na sljedeći termin", async () => {
    await withSeed(async (ids) => {
      const ins = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, interval_mjeseci, rok_dospijeca, status, nacin_izvrsenja)
         values ($1, $2, 12, current_date + 10, 'planirano', 'pracenje') returning id`,
        [ids.klijent, ids.vrsta],
      )
      const id = ins.rows[0].id as string
      // izvršenje termina → trigger umeće sljedeći
      await db.query(
        `update termini set status = 'izvrseno', datum_izvrsenja = current_date where id = $1`,
        [id],
      )
      const next = await db.query(
        `select nacin_izvrsenja, rok_dospijeca::text, datum_zadnjeg::text from termini
         where klijent_id = $1 and vrsta_provjere_id = $2 and id <> $3`,
        [ids.klijent, ids.vrsta, id],
      )
      expect(next.rows).toHaveLength(1)
      expect(next.rows[0].nacin_izvrsenja).toBe("pracenje")
      // rok_dospijeca = placeholder (datum_izvrsenja) koji tg_termini_compute_rok prepiše
      // na datum_zadnjeg + interval (12 mj) → mora biti STROGO veći (ISO datumi, leksikografski).
      expect(next.rows[0].rok_dospijeca > next.rows[0].datum_zadnjeg).toBe(true)
    })
  })

  it("re-fire guard: termin već 'izvrseno' (datum_izvrsenja kasnije popunjen) NE pravi duplikat ciklusa", async () => {
    await withSeed(async (ids) => {
      // termin već izvrseno ali bez datuma (status postavljen ranije, datum kasnije)
      const ins = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, interval_mjeseci, rok_dospijeca, status, datum_izvrsenja)
         values ($1, $2, 12, current_date + 10, 'izvrseno', null) returning id`,
        [ids.klijent, ids.vrsta],
      )
      const id = ins.rows[0].id as string
      // naknadno popunjavanje datuma — guard (old.status='izvrseno') mora spriječiti novi ciklus
      await db.query(`update termini set datum_izvrsenja = current_date where id = $1`, [id])
      const others = await db.query(
        `select id from termini where klijent_id = $1 and vrsta_provjere_id = $2 and id <> $3`,
        [ids.klijent, ids.vrsta, id],
      )
      expect(others.rows).toHaveLength(0)
    })
  })

  it("interval guard: termin bez intervala (i vrsta bez defaulta) NE pravi sljedeći termin", async () => {
    await withSeed(async (ids) => {
      const ins = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, interval_mjeseci, rok_dospijeca, status)
         values ($1, $2, null, current_date + 10, 'planirano') returning id`,
        [ids.klijent, ids.vrsta],
      )
      const id = ins.rows[0].id as string
      await db.query(
        `update termini set status = 'izvrseno', datum_izvrsenja = current_date where id = $1`,
        [id],
      )
      const others = await db.query(
        `select id from termini where klijent_id = $1 and vrsta_provjere_id = $2 and id <> $3`,
        [ids.klijent, ids.vrsta, id],
      )
      expect(others.rows).toHaveLength(0)
    })
  })
})
