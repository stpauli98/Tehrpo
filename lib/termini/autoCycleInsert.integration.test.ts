import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// tg_termini_auto_cycle je do 20260730170000 bio samo AFTER UPDATE, pa termin unesen
// odmah kao 'izvrseno' nije generisao sljedeći ciklus — periodika bi tiho stala.
describe.skipIf(!URL)("auto-ciklus na INSERT (integracija, lokalni DB)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  async function withTx(fn: () => Promise<void>) {
    await db.query("begin")
    try {
      await fn()
    } finally {
      await db.query("rollback")
    }
  }

  // vrste_provjera nije seedovana nijednom migracijom — svaki test pravi svoju vrstu.
  async function novaVrsta(): Promise<string> {
    const r = await db.query("insert into vrste_provjera (naziv) values ($1) returning id", [
      `ITEST vrsta ${crypto.randomUUID()}`,
    ])
    return r.rows[0].id as string
  }

  async function noviKlijent(): Promise<string> {
    const r = await db.query("insert into klijenti (naziv) values ($1) returning id", [
      `ITEST firma ${crypto.randomUUID()}`,
    ])
    return r.rows[0].id as string
  }

  async function brojTermina(klijentId: string): Promise<number> {
    const r = await db.query("select count(*)::int as n from termini where klijent_id = $1", [klijentId])
    return r.rows[0].n as number
  }

  it("INSERT sa status='izvrseno' i intervalom generiše sljedeći termin", async () => {
    await withTx(async () => {
      const klijentId = await noviKlijent()
      await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status, datum_izvrsenja, interval_mjeseci)
         values ($1,$2,current_date,'izvrseno',current_date,12)`,
        [klijentId, await novaVrsta()],
      )
      // 1 unesen + 1 koji je trigger generisao
      expect(await brojTermina(klijentId)).toBe(2)
    })
  })

  it("INSERT bez intervala ne generiše ništa (jednokratna aktivnost)", async () => {
    await withTx(async () => {
      const klijentId = await noviKlijent()
      await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status, datum_izvrsenja)
         values ($1,$2,current_date,'izvrseno',current_date)`,
        [klijentId, await novaVrsta()],
      )
      expect(await brojTermina(klijentId)).toBe(1)
    })
  })

  it("INSERT u statusu 'planirano' ne generiše ništa", async () => {
    await withTx(async () => {
      const klijentId = await noviKlijent()
      await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, interval_mjeseci)
         values ($1,$2,current_date,12)`,
        [klijentId, await novaVrsta()],
      )
      expect(await brojTermina(klijentId)).toBe(1)
    })
  })

  it("UPDATE putanja i dalje radi (regresija)", async () => {
    await withTx(async () => {
      const klijentId = await noviKlijent()
      const r = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, interval_mjeseci)
         values ($1,$2,current_date,12) returning id`,
        [klijentId, await novaVrsta()],
      )
      await db.query(
        "update termini set status='izvrseno', datum_izvrsenja=current_date where id=$1",
        [r.rows[0].id],
      )
      expect(await brojTermina(klijentId)).toBe(2)
    })
  })
})
