import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

/** SQL izraz za zidni "danas" u Europe/Belgrade (APP_TIME_ZONE) — parnjak `todayIso()` iz lib/date.ts. */
const DANAS_SQL = "(now() at time zone 'Europe/Belgrade')::date"

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
       values ($1, $2, ${DANAS_SQL} + $3::int,
               case when $4::int is null then null else ${DANAS_SQL} + $4::int end,
               'planirano')
       returning id`,
      [ids.klijent, ids.vrsta, rokOffset, zakazanOffset],
    )
    return r.rows[0].id as string
  }

  type Row = { termin_id: string; ciklus_rok: string; dana_do_ciklusa: number }
  async function istekli(terminId: string, danas = DANAS_SQL): Promise<Row[]> {
    const r = danas === DANAS_SQL
      ? await db.query(`select * from get_istekli_termini(${DANAS_SQL}) where termin_id = $1`, [terminId])
      : await db.query("select * from get_istekli_termini($2::date) where termin_id = $1", [terminId, danas])
    return r.rows as Row[]
  }

  async function claim(email: string, datum: string): Promise<string | null> {
    const r = await db.query("select claim_digest($1, $2::date) as id", [email, datum])
    return (r.rows[0]?.id as string | null) ?? null
  }

  /** Beogradski "danas" (Europe/Belgrade) pomjeren za offsetDana, kao ISO datum — izračunato u bazi da izbjegnemo TZ zamke u Node-u. */
  async function pomjerenDanas(offsetDana: number): Promise<string> {
    const r = await db.query(`select to_char(${DANAS_SQL} + $1::int, 'YYYY-MM-DD') as d`, [offsetDana])
    return r.rows[0]!.d as string
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
         values ($1, ${DANAS_SQL} - 9, 'interni', 'poslato', now())`,
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
         values ($1, ${DANAS_SQL} - 9, 'firma', 'preskoceno', 'nema_primalaca')`,
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
         values ($1, ${DANAS_SQL} - 9, 'interni', 'poslato', now() - interval '1 day')`,
        [t],
      )
      expect(await istekli(t)).toHaveLength(1)
    })
  })

  it("p_danas ≠ beogradski danas: obavijest poslata danas ostaje bez efekta kad se preda juče", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      await db.query(
        `insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, poslat_at)
         values ($1, ${DANAS_SQL} - 9, 'interni', 'poslato', now())`,
        [t],
      )
      const juce = await pomjerenDanas(-1)
      // Suppression gleda predani dan (juce), ne stvarni beogradski "danas" — obavijest
      // poslata danas ga ne pogađa, pa termin ostaje u listi.
      expect(await istekli(t, juce)).toHaveLength(1)
    })
  })

  it("p_danas pomjeren u prošlost mijenja predikat alarma, ne samo suppression", async () => {
    await withSeed(async (ids) => {
      // Istekao prije 3 dana (od stvarnog danas) — u alarmu je danas, ali NIJE u alarmu
      // kad se preda p_danas od prije 5 dana (rok_dospijeca tada još nije bio prošao).
      const t = await addTermin(ids, -3)
      const petDanaRanije = await pomjerenDanas(-5)
      expect(await istekli(t, petDanaRanije)).toHaveLength(0)
    })
  })

  it("dana_do_ciklusa se računa u odnosu na predani p_danas, ne na stvarni danas", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -30)
      const petDanaRanije = await pomjerenDanas(-5)
      const rows = await istekli(t, petDanaRanije)
      expect(rows).toHaveLength(1)
      // ciklus (danas-30) - p_danas (danas-5) = -25, a ne -30 (što bi dao stvarni danas).
      expect(rows[0]!.dana_do_ciklusa).toBe(-25)
    })
  })

  it("vraća najveće kašnjenje prvo (tri termina različitog kašnjenja)", async () => {
    await withSeed(async (ids) => {
      const blago = await addTermin(ids, -2)
      const najkasni = await addTermin(ids, -30)
      const srednje = await addTermin(ids, -10)
      const r = await db.query(
        `select termin_id, dana_do_ciklusa from get_istekli_termini(${DANAS_SQL}) where termin_id = any($1::uuid[])`,
        [[blago, najkasni, srednje]],
      )
      expect(r.rows.map((row) => row.termin_id as string)).toEqual([najkasni, srednje, blago])
    })
  })

  it("claim_digest: dvije istovremene konekcije daju tačno jedan id i jedan null, jedan red u ledgeru", async () => {
    const email = "concurrent-itest@x.com"
    const datum = "2026-07-22"
    const c1 = new Client({ connectionString: URL })
    const c2 = new Client({ connectionString: URL })
    await c1.connect()
    await c2.connect()
    try {
      const [r1, r2] = await Promise.all([
        c1.query("select claim_digest($1, $2::date) as id", [email, datum]),
        c2.query("select claim_digest($1, $2::date) as id", [email, datum]),
      ])
      const ids = [
        (r1.rows[0]?.id as string | null) ?? null,
        (r2.rows[0]?.id as string | null) ?? null,
      ]
      expect(ids.filter((x) => x !== null)).toHaveLength(1)
      expect(ids.filter((x) => x === null)).toHaveLength(1)

      const count = await db.query(
        "select count(*)::int as n from digest_slanja where primalac_email = $1 and datum = $2::date",
        [email, datum],
      )
      expect(count.rows[0]!.n).toBe(1)
    } finally {
      await db.query("delete from digest_slanja where primalac_email = $1 and datum = $2::date", [email, datum])
      await c1.end()
      await c2.end()
    }
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
