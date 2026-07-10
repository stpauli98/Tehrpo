import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// RLS scoping za atomske RPC (dodaj_/ukloni_podsjetnik_email). Gate-uje se na TEST_DATABASE_URL
// da `pnpm test:unit` bez lokalnog DB prolazi (isti obrazac kao dueRpc.integration.test.ts).
// Dokazuje da `security invoker` odluka poštuje klijenti_upd RLS (ima_pristup_klijentu and not je_pregled).
describe.skipIf(!URL)("podsjetnik_email RPC — RLS scoping (integracija)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  // Svaki slučaj u transakciji koja se ROLLBACK-uje → ne prlja DB.
  async function withTx(fn: () => Promise<void>) {
    await db.query("begin")
    try { await fn() } finally { await db.query("rollback") }
  }

  // Kreiraj auth korisnika + korisnici red date uloge; vrati uuid.
  // (auth.users: `id` je jedina NOT NULL kolona bez defaulta — potvrđeno.)
  async function createUser(uloga: string): Promise<string> {
    const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
    const id = u.rows[0].id as string
    await db.query(
      "insert into korisnici (id, ime, email, uloga, aktivan) values ($1, 'ITEST', $2, $3, true)",
      [id, `itest-${id}@x.com`, uloga],
    )
    return id
  }

  // Izvrši fn kao autentifikovan korisnik (RLS vrijedi); vrati na superuser poslije.
  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ])
    await db.query("set local role authenticated")
    try { return await fn() } finally { await db.query("reset role") }
  }

  async function noviKlijent(): Promise<string> {
    const r = await db.query("insert into klijenti (naziv) values ('ITEST RLS') returning id")
    return r.rows[0].id as string
  }
  async function emails(klijentId: string): Promise<string[]> {
    const r = await db.query("select podsjetnik_emails from klijenti where id = $1", [klijentId])
    return (r.rows[0]?.podsjetnik_emails as string[]) ?? []
  }
  async function dodaj(uid: string, klijentId: string, email: string): Promise<string> {
    return asUser(uid, async () => {
      const r = await db.query("select dodaj_podsjetnik_email($1, $2) as st", [klijentId, email])
      return r.rows[0].st as string
    })
  }
  async function ukloni(uid: string, klijentId: string, email: string): Promise<void> {
    await asUser(uid, () => db.query("select ukloni_podsjetnik_email($1, $2)", [klijentId, email]))
  }
  async function dodijeli(uid: string, klijentId: string): Promise<void> {
    await db.query("insert into korisnik_klijent (korisnik_id, klijent_id) values ($1, $2)", [uid, klijentId])
  }

  it("operater SA dodjelom: dodaj → 'ok', mejl u nizu", async () => {
    await withTx(async () => {
      const k = await noviKlijent()
      const op = await createUser("operater")
      await dodijeli(op, k)
      expect(await dodaj(op, k, "x@y.com")).toBe("ok")
      expect(await emails(k)).toEqual(["x@y.com"])
    })
  })

  it("operater SA dodjelom: ukloni skine mejl", async () => {
    await withTx(async () => {
      const k = await noviKlijent()
      const op = await createUser("operater")
      await dodijeli(op, k)
      await db.query("update klijenti set podsjetnik_emails = '{x@y.com}' where id = $1", [k])
      await ukloni(op, k, "x@y.com")
      expect(await emails(k)).toEqual([])
    })
  })

  it("operater BEZ dodjele: dodaj → 'nedostupno', niz nepromijenjen", async () => {
    await withTx(async () => {
      const k = await noviKlijent()
      const op = await createUser("operater")
      expect(await dodaj(op, k, "x@y.com")).toBe("nedostupno")
      expect(await emails(k)).toEqual([])
    })
  })

  it("operater BEZ dodjele: ukloni je no-op (niz nepromijenjen)", async () => {
    await withTx(async () => {
      const k = await noviKlijent()
      const op = await createUser("operater")
      await db.query("update klijenti set podsjetnik_emails = '{x@y.com}' where id = $1", [k])
      await ukloni(op, k, "x@y.com")
      expect(await emails(k)).toEqual(["x@y.com"])
    })
  })

  it("pregled (sa dodjelom): dodaj → 'nedostupno' (not je_pregled blokira upd)", async () => {
    await withTx(async () => {
      const k = await noviKlijent()
      const pregled = await createUser("pregled")
      await dodijeli(pregled, k)
      expect(await dodaj(pregled, k, "x@y.com")).toBe("nedostupno")
      expect(await emails(k)).toEqual([])
    })
  })
})
