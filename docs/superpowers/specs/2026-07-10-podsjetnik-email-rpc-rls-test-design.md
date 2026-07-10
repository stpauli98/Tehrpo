# RLS integracioni test za podsjetnik_email RPC — dizajn

**Datum:** 2026-07-10
**Grana:** `feat/podsjetnici-primaoci-iz-kontakata` (PR #22, nastavak)
**Status:** dizajn odobren; izvršenje kroz SDD
**Adresira:** issue #23 (opcioni follow-up iz final review-a: RLS scoping test za RPC)

## Cilj

Integracioni test koji dokazuje da atomske RPC funkcije `dodaj_podsjetnik_email` /
`ukloni_podsjetnik_email` (`security invoker`) **poštuju `klijenti_upd` RLS** za ne-admin uloge —
tj. da `security invoker` odluka (umjesto `definer`) stvarno sprječava izmjenu tuđe firme.

Trenutni e2e (`24-podsjetnici-primaoci`) ide kao **admin** i ne dokazuje RLS scoping eksplicitno.

## Pristup (validiran smoke-om)

`pg` integracioni test po uzoru na `lib/reminders/dueRpc.integration.test.ts`:
- `describe.skipIf(!process.env.TEST_DATABASE_URL)` → `pnpm test:unit` bez env-a i dalje prolazi
  (opt-in regres, kao `dueRpc`).
- `pg` Client (direktna konekcija = superuser); svaki slučaj u `begin`/`rollback` (ne prlja DB).
- **Simulacija autentifikovane uloge** (potvrđeno da radi na lokalnom stacku):
  ```ts
  await db.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: userId, role: "authenticated" })])
  await db.query("set local role authenticated")   // ... RPC ... pa: reset role
  ```
  `auth.uid()` čita `request.jwt.claims.sub`; `set local role authenticated` → RLS vrijedi za
  interne read/update RPC-a. `reset role` vraća na superuser za čitanje niza / cleanup.

`klijenti_upd = ima_pristup_klijentu(id) and not je_pregled()` (migr. `20260626211000_rls_enable.sql:29`).
Očekivano: operater-sa-dodjelom → `'ok'`; operater-bez-dodjele → `'nedostupno'`; `pregled` → `'nedostupno'`.

## Fajl

`lib/podsjetnici/podsjetnikEmailRpc.integration.test.ts`

**Pomoćne (unutar `describe`):**
- `withTx(fn)` — `begin` → `fn` → `finally rollback` (kao `withSeed` u dueRpc).
- `createUser(uloga)` → uuid: `insert into auth.users (id) values (gen_random_uuid()) returning id`
  (potvrđeno: `id` je jedina NOT NULL kolona bez defaulta) → `insert into korisnici (id, ime, email,
  uloga, aktivan) values ($1,'ITEST',$2,$3,true)`.
- `asUser(uid, fn)` — set jwt claims + `set local role authenticated` → `fn` → `finally reset role`.
- `emails(klijentId)` — (kao superuser) `select podsjetnik_emails from klijenti where id=$1`.

## Slučajevi (svaki u svojoj `withTx`)

1. **operater sa dodjelom → `dodaj` vrati `'ok'`, mejl u nizu.** Seed: klijent + operater +
   `korisnik_klijent`. `asUser(op, () => dodaj(k,'x@y.com'))` → `'ok'`; `emails(k)` = `['x@y.com']`.
2. **operater sa dodjelom → `ukloni` skine mejl.** Superuser seed `podsjetnik_emails='{x@y.com}'`;
   `asUser(op, () => ukloni(k,'x@y.com'))`; `emails(k)` = `[]`.
3. **operater BEZ dodjele → `dodaj` vrati `'nedostupno'`, niz nepromijenjen.** `emails(k)` = `[]`.
4. **operater BEZ dodjele → `ukloni` je no-op.** Seed `'{x@y.com}'`; poslije `ukloni` → `['x@y.com']`.
5. **`pregled` (sa dodjelom) → `dodaj` vrati `'nedostupno'`** (`not je_pregled()` blokira upd);
   `emails(k)` = `[]`.

`dodaj`/`ukloni` pozivi: `select dodaj_podsjetnik_email($1,$2) as st` / `select ukloni_podsjetnik_email($1,$2)`.

## Verifikacija

`TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:unit`
→ novi describe blok prolazi (5/5); bez env-a se preskače. `pnpm typecheck` clean.

## Van obima (YAGNI)

- Bez admin slučaja (admin zaobilazi — nije poenta).
- Bez `korisnik_klijent` self-select provjera (testira RPC, ne RLS helpere direktno).
- Test je opt-in (`TEST_DATABASE_URL`) — ne dodaje se u CI gate ovim PR-om.

## Rizici

- `auth.users` insert: potvrđeno da minimalni (`id`) radi lokalno; ako se schema promijeni → dodati
  kolone.
- Test ovisi o RLS migraciji `20260626211000` (primijenjena lokalno kroz `db:reset`).
