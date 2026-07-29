import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// get_zaduzeni_dodjele() (20260729130000) — vraća (klijent_id, ime) parove za korisnike koji
// TRENUTNO IMAJU PRISTUP toj firmi (ista logika kao ima_pristup_klijentu): admin uvijek, za sve
// firme; operater/pregled samo ako imaju dodjelu u korisnik_klijent. Gate-uje se na
// TEST_DATABASE_URL da `pnpm test:unit` bez lokalnog DB i dalje prolazi (isti obrazac kao
// lib/podsjetnici/podsjetnikEmailRpc.integration.test.ts).
describe.skipIf(!URL)("get_zaduzeni_dodjele (integracija, lokalni DB)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  // Svaki test slučaj radi u transakciji koja se ROLLBACK-uje → ne prlja DB.
  async function withTx(fn: () => Promise<void>) {
    await db.query("begin")
    try {
      await fn()
    } finally {
      await db.query("rollback")
    }
  }

  async function createUser(uloga: string, ime: string, aktivan = true): Promise<string> {
    const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
    const id = u.rows[0].id as string
    await db.query(
      "insert into korisnici (id, ime, email, uloga, aktivan) values ($1,$2,$3,$4,$5)",
      [id, ime, `itest-${id}@x.com`, uloga, aktivan],
    )
    return id
  }

  // naziv je unique u klijenti (20260620210000) — default generiše jedinstveno ime po pozivu,
  // jer neki testovi zovu noviKlijent() više puta (k1, k2) unutar iste transakcije.
  async function noviKlijent(naziv?: string): Promise<string> {
    const r = await db.query("insert into klijenti (naziv) values ($1) returning id", [
      naziv ?? `ITEST firma ${crypto.randomUUID()}`,
    ])
    return r.rows[0].id as string
  }

  async function dodijeli(uid: string, klijentId: string): Promise<void> {
    await db.query(
      "insert into korisnik_klijent (korisnik_id, klijent_id) values ($1,$2)",
      [uid, klijentId],
    )
  }

  async function dodjele(klijentId: string): Promise<string[]> {
    const r = await db.query("select ime from get_zaduzeni_dodjele() where klijent_id = $1", [klijentId])
    return r.rows.map((row) => row.ime as string)
  }

  it("admin se pojavljuje za SVAKU firmu, bez eksplicitne dodjele", async () => {
    await withTx(async () => {
      const k1 = await noviKlijent()
      const k2 = await noviKlijent()
      await createUser("admin", "Admin Ana")
      expect(await dodjele(k1)).toEqual(["Admin Ana"])
      expect(await dodjele(k2)).toEqual(["Admin Ana"])
    })
  })

  it("operater SA dodjelom: pojavljuje se SAMO za dodijeljenu firmu", async () => {
    await withTx(async () => {
      const k1 = await noviKlijent()
      const k2 = await noviKlijent()
      const op = await createUser("operater", "Operater Ozren")
      await dodijeli(op, k1)
      expect(await dodjele(k1)).toEqual(["Operater Ozren"])
      expect(await dodjele(k2)).toEqual([])
    })
  })

  it("operater BEZ dodjele: ne pojavljuje se ni za jednu firmu", async () => {
    await withTx(async () => {
      const k1 = await noviKlijent()
      await createUser("operater", "Operater Bez Dodjele")
      expect(await dodjele(k1)).toEqual([])
    })
  })

  it("neaktivan korisnik se ne pojavljuje, ni kao admin ni sa dodjelom", async () => {
    await withTx(async () => {
      const k1 = await noviKlijent()
      await createUser("admin", "Neaktivni Admin", false)
      const opNeaktivan = await createUser("operater", "Neaktivni Operater", false)
      await dodijeli(opNeaktivan, k1)
      expect(await dodjele(k1)).toEqual([])
    })
  })
})
