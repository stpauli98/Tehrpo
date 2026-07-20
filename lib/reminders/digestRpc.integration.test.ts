import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("get_istekli_termini + claim_digest (integracija, lokalni DB)", () => {
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
      const k = await db.query("insert into klijenti (naziv) values ('ITEST digest klijent') returning id")
      const v = await db.query("insert into vrste_provjera (naziv) values ('ITEST digest vrsta') returning id")
      await fn({ klijent: k.rows[0].id as string, vrsta: v.rows[0].id as string })
    } finally {
      await db.query("rollback")
    }
  }

  async function addTermin(
    ids: { klijent: string; vrsta: string },
    rokOffset: number,
    zakazanOffset: number | null = null,
  ) {
    const r = await db.query(
      `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, datum_zakazan, status)
       values ($1, $2, current_date + $3::int,
               case when $4::int is null then null else current_date + $4::int end,
               'planirano')
       returning id`,
      [ids.klijent, ids.vrsta, rokOffset, zakazanOffset],
    )
    return r.rows[0].id as string
  }

  type Row = { termin_id: string; ciklus_rok: string; dana_do_ciklusa: number }
  async function istekli(terminId: string, danas = "current_date"): Promise<Row[]> {
    const r = danas === "current_date"
      ? await db.query("select * from get_istekli_termini(current_date) where termin_id = $1", [terminId])
      : await db.query("select * from get_istekli_termini($2::date) where termin_id = $1", [terminId, danas])
    return r.rows as Row[]
  }

  async function claim(email: string, datum: string): Promise<string | null> {
    const r = await db.query("select claim_digest($1, $2::date) as id", [email, datum])
    return (r.rows[0]?.id as string | null) ?? null
  }

  it("termin u alarmu je u listi, sa negativnim dana_do_ciklusa", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      const rows = await istekli(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dana_do_ciklusa).toBe(-9)
    })
  })

  it("termin sa rokom u budućnosti i propuštenim zakazanim datumom NIJE u listi", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 30, -4)
      expect(await istekli(t)).toHaveLength(0)
    })
  })

  it("termin sa isteklim rokom i zakazanim datumom u budućnosti NIJE u listi", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -30, 5)
      expect(await istekli(t)).toHaveLength(0)
    })
  })

  it("ciklus je datum_zakazan kad je i on prošao", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -30, -3)
      expect((await istekli(t))[0]!.dana_do_ciklusa).toBe(-3)
    })
  })

  it("termin koji je DANAS dobio pojedinačnu obavijest ispada iz digesta", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      await db.query(
        `insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, poslat_at)
         values ($1, current_date - 9, 'interni', 'poslato', now())`,
        [t],
      )
      expect(await istekli(t)).toHaveLength(0)
    })
  })

  it("termin koji je danas PRESKOČEN (nema primalaca) OSTAJE u digestu", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      await db.query(
        `insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, razlog)
         values ($1, current_date - 9, 'firma', 'preskoceno', 'nema_primalaca')`,
        [t],
      )
      expect(await istekli(t)).toHaveLength(1)
    })
  })

  it("obavijest poslata JUČE ne izbacuje termin iz današnjeg digesta", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      await db.query(
        `insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, poslat_at)
         values ($1, current_date - 9, 'interni', 'poslato', now() - interval '1 day')`,
        [t],
      )
      expect(await istekli(t)).toHaveLength(1)
    })
  })

  it("claim_digest: prvi poziv daje id, drugi null", async () => {
    await withSeed(async () => {
      const d = "2026-07-20"
      const id = await claim("a@x.com", d)
      expect(id).not.toBeNull()
      expect(await claim("a@x.com", d)).toBeNull()
    })
  })

  it("claim_digest: zaglavljen u_toku stariji od 15 min se preuzima, mlađi ne", async () => {
    await withSeed(async () => {
      const d = "2026-07-20"
      const id = await claim("b@x.com", d)
      expect(await claim("b@x.com", d)).toBeNull()
      await db.query("update digest_slanja set claimed_at = now() - interval '20 minutes' where id = $1", [id])
      expect(await claim("b@x.com", d)).toBe(id)
    })
  })

  it("claim_digest: 'poslato' se ne preuzima ni poslije 15 min", async () => {
    await withSeed(async () => {
      const d = "2026-07-20"
      const id = await claim("c@x.com", d)
      await db.query(
        "update digest_slanja set stanje = 'poslato', claimed_at = now() - interval '2 hours' where id = $1",
        [id],
      )
      expect(await claim("c@x.com", d)).toBeNull()
    })
  })

  it("claim_digest: različiti dani su nezavisni", async () => {
    await withSeed(async () => {
      expect(await claim("d@x.com", "2026-07-20")).not.toBeNull()
      expect(await claim("d@x.com", "2026-07-21")).not.toBeNull()
    })
  })
})
