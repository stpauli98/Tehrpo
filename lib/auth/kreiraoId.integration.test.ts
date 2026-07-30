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
      const naziv = `ITEST firma ${crypto.randomUUID()}`
      // RETURNING se evaluira pod SELECT politikom prije nego što tg_klijent_auto_dodjela
      // kreira korisnik_klijent red (ima_pristup_klijentu bi vratio false). Umjesto toga:
      // insert kao authenticated, reset role, pa select nakon AFTER triggera.
      await db.query("insert into klijenti (naziv) values ($1)", [naziv])
      await db.query("reset role")
      const r = await db.query("select kreirao_id from klijenti where naziv = $1", [naziv])
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

  // 20260730154000: INSERT pin. Non-admin je više ne smije eksplicitno pripisati red nekom
  // drugom — kreirao_id se tiho prisiljava na auth.uid(). Ostaje samo za admina.
  it("admin zadrži eksplicitno zadan kreirao_id (re-atribucija)", async () => {
    await withTx(async () => {
      const autor = await createUser("operater", "ITEST Autor")
      const admin = await createUser("admin", "ITEST Admin")
      await kaoKorisnik(admin)
      const naziv = `ITEST firma ${crypto.randomUUID()}`
      // RETURNING se evaluira pod SELECT politikom prije nego što tg_klijent_auto_dodjela
      // kreira korisnik_klijent red (ima_pristup_klijentu bi vratio false). Umjesto toga:
      // insert kao authenticated, reset role, pa select nakon AFTER triggera.
      await db.query("insert into klijenti (naziv, kreirao_id) values ($1,$2)", [naziv, autor])
      await db.query("reset role")
      const r = await db.query("select kreirao_id from klijenti where naziv = $1", [naziv])
      expect(r.rows[0].kreirao_id).toBe(autor)
    })
  })

  it("operater sa eksplicitno tuđim kreirao_id na INSERT-u biva pripisan sebi", async () => {
    await withTx(async () => {
      const drugi = await createUser("operater", "ITEST Drugi")
      const ja = await createUser("operater", "ITEST Ja")
      await kaoKorisnik(ja)
      const naziv = `ITEST firma ${crypto.randomUUID()}`
      // Prije 20260730154000: kreirao_id bi ostao "drugi" — lažno pripisivanje reda kolegi.
      // Poslije: tiho pinovano na auth.uid() (ja), bez obzira šta je poslano.
      await db.query("insert into klijenti (naziv, kreirao_id) values ($1,$2)", [naziv, drugi])
      await db.query("reset role")
      const r = await db.query("select kreirao_id from klijenti where naziv = $1", [naziv])
      expect(r.rows[0].kreirao_id).toBe(ja)
      expect(r.rows[0].kreirao_id).not.toBe(drugi)
    })
  })

  it("service-role insert sa eksplicitno zadanim kreirao_id zadržava tu vrijednost", async () => {
    await withTx(async () => {
      const autor = await createUser("operater", "ITEST Autor SR")
      // Bez kaoKorisnik(): ostajemo na default (service) roli, auth.uid() je null.
      const r = await db.query(
        "insert into klijenti (naziv, kreirao_id) values ($1,$2) returning kreirao_id",
        [`ITEST firma ${crypto.randomUUID()}`, autor],
      )
      expect(r.rows[0].kreirao_id).toBe(autor)
    })
  })
})
