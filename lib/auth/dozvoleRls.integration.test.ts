import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// Dozvole brisanja (20260730151000) — RLS delete politike konsultuju kolone na korisnici.
// admin briše sve; pregled ništa; operater po prekidačima, i uvijek samo na dodijeljenoj firmi.
describe.skipIf(!URL)("dozvole brisanja (integracija, lokalni DB)", () => {
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

  async function createUser(uloga: string, dozvole: Record<string, boolean> = {}): Promise<string> {
    const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
    const id = u.rows[0].id as string
    await db.query(
      `insert into korisnici (id, ime, email, uloga, aktivan,
         smije_brisati_svoje, smije_brisati_tudje, smije_brisati_klijente, smije_zatvoriti_bez_nalaza)
       values ($1,$2,$3,$4,true,$5,$6,$7,$8)`,
      [
        id,
        `ITEST ${uloga}`,
        `itest-${id}@x.com`,
        uloga,
        dozvole.svoje ?? false,
        dozvole.tudje ?? false,
        dozvole.klijenti ?? false,
        dozvole.zatvaranje ?? false,
      ],
    )
    return id
  }

  async function kaoKorisnik(uid: string): Promise<void> {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ])
    await db.query("set local role authenticated")
  }

  async function kaoServisni(): Promise<void> {
    await db.query("reset role")
    await db.query("select set_config('request.jwt.claims', null, true)")
  }

  // vrste_provjera NIJE seedovana nijednom migracijom — poslije `pnpm db:reset` je prazna,
  // pa svaki test pravi svoju vrstu. `naziv` je unique → uuid u imenu.
  async function novaVrsta(): Promise<string> {
    const r = await db.query("insert into vrste_provjera (naziv) values ($1) returning id", [
      `ITEST vrsta ${crypto.randomUUID()}`,
    ])
    return r.rows[0].id as string
  }

  /** Vrati (klijentId, terminId) sa terminom koji je unio `autor`. */
  async function firmaSaTerminom(autor: string): Promise<{ klijentId: string; terminId: string }> {
    const k = await db.query("insert into klijenti (naziv) values ($1) returning id", [
      `ITEST firma ${crypto.randomUUID()}`,
    ])
    const klijentId = k.rows[0].id as string
    const t = await db.query(
      "insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, kreirao_id) values ($1,$2,current_date,$3) returning id",
      [klijentId, await novaVrsta(), autor],
    )
    return { klijentId, terminId: t.rows[0].id as string }
  }

  async function dodijeli(uid: string, klijentId: string): Promise<void> {
    await db.query("insert into korisnik_klijent (korisnik_id, klijent_id) values ($1,$2)", [uid, klijentId])
  }

  async function obrisiTermin(id: string): Promise<number> {
    const r = await db.query("delete from termini where id = $1", [id])
    return r.rowCount ?? 0
  }

  it("operater bez ijednog prekidača ne briše ni svoj termin", async () => {
    await withTx(async () => {
      const uid = await createUser("operater")
      const { klijentId, terminId } = await firmaSaTerminom(uid)
      await dodijeli(uid, klijentId)
      await kaoKorisnik(uid)
      expect(await obrisiTermin(terminId)).toBe(0)
    })
  })

  it("smije_brisati_svoje briše vlastiti termin, ali ne tuđi", async () => {
    await withTx(async () => {
      const ja = await createUser("operater", { svoje: true })
      const drugi = await createUser("operater")
      const moj = await firmaSaTerminom(ja)
      const tudji = await firmaSaTerminom(drugi)
      await dodijeli(ja, moj.klijentId)
      await dodijeli(ja, tudji.klijentId)
      await kaoKorisnik(ja)
      expect(await obrisiTermin(moj.terminId)).toBe(1)
      expect(await obrisiTermin(tudji.terminId)).toBe(0)
    })
  })

  it("smije_brisati_tudje briše tuđi termin na dodijeljenoj firmi", async () => {
    await withTx(async () => {
      const ja = await createUser("operater", { tudje: true })
      const drugi = await createUser("operater")
      const { klijentId, terminId } = await firmaSaTerminom(drugi)
      await dodijeli(ja, klijentId)
      await kaoKorisnik(ja)
      expect(await obrisiTermin(terminId)).toBe(1)
    })
  })

  it("dozvola ne probija dodjelu — nedodijeljena firma ostaje nedodirljiva", async () => {
    await withTx(async () => {
      const ja = await createUser("operater", { svoje: true, tudje: true })
      const { terminId } = await firmaSaTerminom(ja)
      // NEMA dodjele
      await kaoKorisnik(ja)
      expect(await obrisiTermin(terminId)).toBe(0)
    })
  })

  it("pregled ne briše ni sa svim prekidačima upaljenim", async () => {
    await withTx(async () => {
      const ja = await createUser("pregled", { svoje: true, tudje: true, klijenti: true })
      const { klijentId, terminId } = await firmaSaTerminom(ja)
      await dodijeli(ja, klijentId)
      await kaoKorisnik(ja)
      expect(await obrisiTermin(terminId)).toBe(0)
    })
  })

  it("admin briše bez ijednog prekidača i bez dodjele", async () => {
    await withTx(async () => {
      const drugi = await createUser("operater")
      const admin = await createUser("admin")
      const { terminId } = await firmaSaTerminom(drugi)
      await kaoKorisnik(admin)
      expect(await obrisiTermin(terminId)).toBe(1)
    })
  })

  it("smije_brisati_klijente upravlja brisanjem klijenta, odvojeno od termina", async () => {
    await withTx(async () => {
      const bez = await createUser("operater", { svoje: true })
      const k = await db.query("insert into klijenti (naziv, kreirao_id) values ($1,$2) returning id", [
        `ITEST firma ${crypto.randomUUID()}`,
        bez,
      ])
      const klijentId = k.rows[0].id as string
      await dodijeli(bez, klijentId)
      await kaoKorisnik(bez)
      let r = await db.query("delete from klijenti where id = $1", [klijentId])
      expect(r.rowCount ?? 0).toBe(0)

      await kaoServisni()
      const sa = await createUser("operater", { klijenti: true })
      await dodijeli(sa, klijentId)
      await kaoKorisnik(sa)
      r = await db.query("delete from klijenti where id = $1", [klijentId])
      expect(r.rowCount ?? 0).toBe(1)
    })
  })
})
