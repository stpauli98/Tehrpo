import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

/** SQL izraz za zidni "danas" u Europe/Belgrade (APP_TIME_ZONE) — parnjak `todayIso()` iz lib/date.ts. */
const DANAS_SQL = "(now() at time zone 'Europe/Belgrade')::date"

describe.skipIf(!URL)("get_post_due_termine + claim_post_due (integracija, lokalni DB)", () => {
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
      const k = await db.query("insert into klijenti (naziv) values ('ITEST klijent') returning id")
      const v = await db.query("insert into vrste_provjera (naziv) values ('ITEST vrsta') returning id")
      await fn({ klijent: k.rows[0].id as string, vrsta: v.rows[0].id as string })
    } finally {
      await db.query("rollback")
    }
  }

  // datum_zadnjeg ostaje null → tg_compute_rok NE prepisuje rok_dospijeca.
  async function addTermin(
    ids: { klijent: string; vrsta: string },
    rokOffset: number,
    zakazanOffset: number | null = null,
  ) {
    const r = await db.query(
      `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, datum_zakazan, status)
       values ($1, $2, ${DANAS_SQL} + $3::int,
               case when $4::int is null then null else ${DANAS_SQL} + $4::int end,
               'planirano')
       returning id`,
      [ids.klijent, ids.vrsta, rokOffset, zakazanOffset],
    )
    return r.rows[0].id as string
  }

  type Row = {
    termin_id: string; ciklus_rok: string; dana_do_ciklusa: number
    treba_interni: boolean; treba_firma: boolean
  }
  async function postDue(terminId: string): Promise<Row[]> {
    const r = await db.query("select * from get_post_due_termine() where termin_id = $1", [terminId])
    return r.rows as Row[]
  }

  async function claim(terminId: string, ciklus: string, kanal: string): Promise<string | null> {
    const r = await db.query("select claim_post_due($1, $2::date, $3) as id", [terminId, ciklus, kanal])
    return (r.rows[0]?.id as string | null) ?? null
  }

  it("termin sa isteklim rokom je u alarmu; oba kanala otvorena, dana_do_ciklusa negativan", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const rows = await postDue(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dana_do_ciklusa).toBe(-5)
      expect(rows[0]!.treba_interni).toBe(true)
      expect(rows[0]!.treba_firma).toBe(true)
    })
  })

  it("termin sa rokom u budućnosti i propuštenim datum_zakazan NIJE u alarmu", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 40, -3)
      expect(await postDue(t)).toHaveLength(0)
    })
  })

  it("termin sa isteklim rokom i zakazanim datumom u budućnosti NIJE u alarmu", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -20, 7)
      expect(await postDue(t)).toHaveLength(0)
    })
  })

  it("ciklus je datum_zakazan kad je i on prošao", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -20, -2)
      const rows = await postDue(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dana_do_ciklusa).toBe(-2)
    })
  })

  it("poslat trag zatvara samo svoj kanal", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      const id = await claim(t, ciklus, "interni")
      expect(id).not.toBeNull()
      await db.query("update post_due_obavijesti set stanje = 'poslato' where id = $1", [id])
      const rows = await postDue(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.treba_interni).toBe(false)
      expect(rows[0]!.treba_firma).toBe(true)
    })
  })

  it("kad su oba kanala zatvorena, termin izlazi iz RPC-a", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      for (const kanal of ["interni", "firma"]) {
        // eslint-disable-next-line no-await-in-loop -- jedan pg.Client, sekvencijalno po dizajnu testa
        const id = await claim(t, ciklus, kanal)
        // eslint-disable-next-line no-await-in-loop -- isti razlog kao gore
        await db.query("update post_due_obavijesti set stanje = 'poslato' where id = $1", [id])
      }
      expect(await postDue(t)).toHaveLength(0)
    })
  })

  it("preskoceno zatvara kanal isto kao poslato", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      const id = await claim(t, ciklus, "firma")
      await db.query(
        "update post_due_obavijesti set stanje = 'preskoceno', razlog = 'nema_primalaca' where id = $1",
        [id],
      )
      expect((await postDue(t))[0]!.treba_firma).toBe(false)
    })
  })

  it("svjež u_toku claim drži kanal zatvorenim, a drugi claim vraća null", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      expect(await claim(t, ciklus, "interni")).not.toBeNull()
      expect((await postDue(t))[0]!.treba_interni).toBe(false)
      expect(await claim(t, ciklus, "interni")).toBeNull()
    })
  })

  it("zaglavljen u_toku claim stariji od 15 min ponovo otvara kanal i može se preuzeti", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      const id = await claim(t, ciklus, "interni")
      await db.query(
        "update post_due_obavijesti set claimed_at = now() - interval '20 minutes' where id = $1",
        [id],
      )
      expect((await postDue(t))[0]!.treba_interni).toBe(true)
      expect(await claim(t, ciklus, "interni")).toBe(id)
    })
  })

  // REGRESIJA na kritičnu grešku revizije 2. Tamo je dedup ključ bio broj dana kašnjenja,
  // pa je termin sa pomjerenim rokom koji opet istekne sa ISTIM brojem dana kašnjenja
  // udarao u postojeći red, mejl je već bio otišao, a trag se gubio. Ovdje je ključ
  // ciklus (datum), pa isti broj dana kašnjenja ne znači isti ključ.
  it("pomjeranje roka otvara novi ciklus i kad je broj dana kašnjenja isti", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus1 = (await postDue(t))[0]!.ciklus_rok
      for (const kanal of ["interni", "firma"]) {
        // eslint-disable-next-line no-await-in-loop -- jedan pg.Client, sekvencijalno po dizajnu testa
        const id = await claim(t, ciklus1, kanal)
        // eslint-disable-next-line no-await-in-loop -- isti razlog kao gore
        await db.query("update post_due_obavijesti set stanje = 'poslato' where id = $1", [id])
      }
      expect(await postDue(t)).toHaveLength(0)

      // Rok pomjeren naprijed pa opet istekao — novi datum, dakle novi ciklus.
      await db.query(`update termini set rok_dospijeca = ${DANAS_SQL} - 3 where id = $1`, [t])
      const rows = await postDue(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.ciklus_rok).not.toBe(ciklus1)
      expect(rows[0]!.treba_interni).toBe(true)
      expect(rows[0]!.treba_firma).toBe(true)
      expect(await claim(t, rows[0]!.ciklus_rok, "interni")).not.toBeNull()

      // Kontrola: povratak na PRVI ciklus mora ostati zatvoren — dokaz da ključ
      // nosi datum, a ne broj dana kašnjenja niti puko "termin je već javljen".
      await db.query("update termini set rok_dospijeca = $2::date where id = $1", [t, ciklus1])
      expect(await postDue(t)).toHaveLength(0)
    })
  })
})
