// Zajednički helperi za mejl_log integracione testove (lokalni Docker stack, pg klijent
// koji radi kao vlasnik tabele — RLS se testira eksplicitno kroz `asUser`).
// Isti obrazac kao lib/reminders/dueRpc.integration.test.ts i
// lib/podsjetnici/podsjetnikEmailRpc.integration.test.ts. Ne uvoditi nove helpere ovdje bez
// potrebe u više testova — čuvati modul tanak (samo ono što Task 2-4 dijele).
import type { Client } from "pg"

// Svaki test slučaj radi u transakciji koja se ROLLBACK-uje → ne prlja DB.
export async function withTx(db: Client, fn: () => Promise<void>) {
  await db.query("begin")
  try {
    await fn()
  } finally {
    await db.query("rollback")
  }
}

// Kreiraj auth korisnika + korisnici red date uloge; vrati uuid.
// (auth.users: `id` je jedina NOT NULL kolona bez defaulta — potvrđeno.)
export async function createUser(db: Client, uloga: string): Promise<string> {
  const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
  const id = u.rows[0].id as string
  await db.query(
    "insert into korisnici (id, ime, email, uloga, aktivan) values ($1,'ITEST',$2,$3,true)",
    [id, `itest-${id}@x.com`, uloga],
  )
  return id
}

// Izvrši fn kao autentifikovan korisnik (RLS vrijedi); vrati na superuser poslije.
export async function asUser<T>(db: Client, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ])
  await db.query("set local role authenticated")
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

export async function noviKlijent(db: Client, naziv = "ITEST firma"): Promise<string> {
  const r = await db.query("insert into klijenti (naziv) values ($1) returning id", [naziv])
  return r.rows[0].id as string
}

export async function dodijeli(db: Client, uid: string, klijentId: string): Promise<void> {
  await db.query("insert into korisnik_klijent (korisnik_id, klijent_id) values ($1,$2)", [uid, klijentId])
}
