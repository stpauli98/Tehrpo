import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// Zatvaranje bez nalaza (20260730152000) — status → 'izvrseno' bez ijednog dokumenta na
// terminu prolazi samo za admina ili operatera sa smije_zatvoriti_bez_nalaza.
describe.skipIf(!URL)("zatvaranje aktivnosti bez nalaza (integracija, lokalni DB)", () => {
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

  async function createUser(uloga: string, zatvaranje = false): Promise<string> {
    const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
    const id = u.rows[0].id as string
    await db.query(
      `insert into korisnici (id, ime, email, uloga, aktivan, smije_zatvoriti_bez_nalaza)
       values ($1,$2,$3,$4,true,$5)`,
      [id, `ITEST ${uloga}`, `itest-${id}@x.com`, uloga, zatvaranje],
    )
    return id
  }

  async function kaoKorisnik(uid: string): Promise<void> {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ])
    await db.query("set local role authenticated")
  }

  // vrste_provjera NIJE seedovana migracijama — poslije `pnpm db:reset` je prazna.
  async function novaVrsta(): Promise<string> {
    const r = await db.query("insert into vrste_provjera (naziv) values ($1) returning id", [
      `ITEST vrsta ${crypto.randomUUID()}`,
    ])
    return r.rows[0].id as string
  }

  async function firmaSaTerminom(uid: string): Promise<{ klijentId: string; terminId: string }> {
    const k = await db.query("insert into klijenti (naziv) values ($1) returning id", [
      `ITEST firma ${crypto.randomUUID()}`,
    ])
    const klijentId = k.rows[0].id as string
    const t = await db.query(
      "insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca) values ($1,$2,current_date) returning id",
      [klijentId, await novaVrsta()],
    )
    await db.query("insert into korisnik_klijent (korisnik_id, klijent_id) values ($1,$2)", [uid, klijentId])
    return { klijentId, terminId: t.rows[0].id as string }
  }

  async function zatvori(terminId: string): Promise<void> {
    await db.query(
      "update termini set status = 'izvrseno', datum_izvrsenja = current_date where id = $1",
      [terminId],
    )
  }

  it("operater bez dozvole ne zatvara termin bez nalaza", async () => {
    await withTx(async () => {
      const uid = await createUser("operater")
      const { terminId } = await firmaSaTerminom(uid)
      await kaoKorisnik(uid)
      await expect(zatvori(terminId)).rejects.toThrow(/nalaz_obavezan/)
    })
  })

  it("operater bez dozvole zatvara termin KOJI IMA nalaz", async () => {
    await withTx(async () => {
      const uid = await createUser("operater")
      const { klijentId, terminId } = await firmaSaTerminom(uid)
      await db.query(
        "insert into dokumenti (klijent_id, termin_id, naziv, storage_path) values ($1,$2,$3,$4)",
        [klijentId, terminId, "nalaz.pdf", `termini/${terminId}/nalaz.pdf`],
      )
      await kaoKorisnik(uid)
      await expect(zatvori(terminId)).resolves.toBeUndefined()
    })
  })

  it("operater sa smije_zatvoriti_bez_nalaza zatvara prazan termin", async () => {
    await withTx(async () => {
      const uid = await createUser("operater", true)
      const { terminId } = await firmaSaTerminom(uid)
      await kaoKorisnik(uid)
      await expect(zatvori(terminId)).resolves.toBeUndefined()
    })
  })

  it("service-role put (cron/seed, bez auth.uid()) nije zahvaćen", async () => {
    await withTx(async () => {
      const uid = await createUser("admin")
      const { terminId } = await firmaSaTerminom(uid)
      await expect(zatvori(terminId)).resolves.toBeUndefined()
    })
  })

  // ── INSERT put (20260730153000) ────────────────────────────────────────────
  // Kapija je bila samo `before update`, pa je operater mogao INSERT-ovati termin odmah
  // u 'izvrseno' i tako je zaobići. Nije dohvatljivo kroz UI (createTermin izvodi status),
  // ali PostgREST jeste — a dizajn tvrdi da je Postgres autoritet.
  describe("INSERT odmah u 'izvrseno'", () => {
    /** Firma dodijeljena korisniku, bez termina — vraća (klijentId, vrstaId). */
    async function firmaBezTermina(uid: string): Promise<{ klijentId: string; vrstaId: string }> {
      const k = await db.query("insert into klijenti (naziv) values ($1) returning id", [
        `ITEST firma ${crypto.randomUUID()}`,
      ])
      const klijentId = k.rows[0].id as string
      await db.query("insert into korisnik_klijent (korisnik_id, klijent_id) values ($1,$2)", [uid, klijentId])
      return { klijentId, vrstaId: await novaVrsta() }
    }

    async function ubaciIzvrseno(klijentId: string, vrstaId: string): Promise<void> {
      await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status, datum_izvrsenja)
         values ($1,$2,current_date,'izvrseno',current_date)`,
        [klijentId, vrstaId],
      )
    }

    it("operater bez dozvole ne može ubaciti već zatvoren termin bez nalaza", async () => {
      await withTx(async () => {
        const uid = await createUser("operater")
        const { klijentId, vrstaId } = await firmaBezTermina(uid)
        await kaoKorisnik(uid)
        await expect(ubaciIzvrseno(klijentId, vrstaId)).rejects.toThrow(/nalaz_obavezan/)
      })
    })

    it("operater sa smije_zatvoriti_bez_nalaza smije ubaciti zatvoren termin", async () => {
      await withTx(async () => {
        const uid = await createUser("operater", true)
        const { klijentId, vrstaId } = await firmaBezTermina(uid)
        await kaoKorisnik(uid)
        await expect(ubaciIzvrseno(klijentId, vrstaId)).resolves.toBeUndefined()
      })
    })

    it("admin smije ubaciti zatvoren termin", async () => {
      await withTx(async () => {
        const uid = await createUser("admin")
        const { klijentId, vrstaId } = await firmaBezTermina(uid)
        await kaoKorisnik(uid)
        await expect(ubaciIzvrseno(klijentId, vrstaId)).resolves.toBeUndefined()
      })
    })

    it("INSERT u podrazumijevani status i dalje prolazi bez nalaza", async () => {
      await withTx(async () => {
        const uid = await createUser("operater")
        const { klijentId, vrstaId } = await firmaBezTermina(uid)
        await kaoKorisnik(uid)
        await expect(
          db.query(
            "insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca) values ($1,$2,current_date)",
            [klijentId, vrstaId],
          ),
        ).resolves.toBeTruthy()
      })
    })

    it("service-role INSERT u 'izvrseno' (cron/seed) nije zahvaćen", async () => {
      await withTx(async () => {
        const uid = await createUser("operater")
        const { klijentId, vrstaId } = await firmaBezTermina(uid)
        await expect(ubaciIzvrseno(klijentId, vrstaId)).resolves.toBeUndefined()
      })
    })
  })
})
