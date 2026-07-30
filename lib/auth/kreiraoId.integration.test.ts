import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// kreirao_id (20260730150000) — BEFORE INSERT trigger upisuje auth.uid() kad kolona nije
// eksplicitno zadana. Potrebno za dozvolu "operater briše samo svoje unose" (Task 2).
// Gate na TEST_DATABASE_URL da `pnpm test:unit` bez lokalnog DB i dalje prolazi.
describe.skipIf(!URL)("kreirao_id (integracija, lokalni DB)", () => {
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

  async function createUser(uloga: string, ime: string): Promise<string> {
    const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
    const id = u.rows[0].id as string
    await db.query(
      "insert into korisnici (id, ime, email, uloga, aktivan) values ($1,$2,$3,$4,true)",
      [id, ime, `itest-${id}@x.com`, uloga],
    )
    return id
  }

  async function kaoKorisnik(uid: string): Promise<void> {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ])
    await db.query("set local role authenticated")
  }

  it("upisuje auth.uid() u kreirao_id pri insertu klijenta", async () => {
    await withTx(async () => {
      const uid = await createUser("operater", "ITEST Operater")
      await kaoKorisnik(uid)
      const r = await db.query(
        "insert into klijenti (naziv) values ($1) returning kreirao_id",
        [`ITEST firma ${crypto.randomUUID()}`],
      )
      expect(r.rows[0].kreirao_id).toBe(uid)
    })
  })

  it("service-role insert (bez auth.uid()) ostavlja kreirao_id null", async () => {
    await withTx(async () => {
      const r = await db.query(
        "insert into klijenti (naziv) values ($1) returning kreirao_id",
        [`ITEST firma ${crypto.randomUUID()}`],
      )
      expect(r.rows[0].kreirao_id).toBeNull()
    })
  })

  it("eksplicitno zadan kreirao_id se ne prepisuje", async () => {
    await withTx(async () => {
      const autor = await createUser("operater", "ITEST Autor")
      const drugi = await createUser("operater", "ITEST Drugi")
      await kaoKorisnik(drugi)
      const r = await db.query(
        "insert into klijenti (naziv, kreirao_id) values ($1,$2) returning kreirao_id",
        [`ITEST firma ${crypto.randomUUID()}`, autor],
      )
      expect(r.rows[0].kreirao_id).toBe(autor)
    })
  })
})
