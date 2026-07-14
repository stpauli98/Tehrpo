# Dnevnik mejlova + status dostave + bedž na greške — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dati adminu i korisnicima vidljivost i kontrolu nad automatskim mejlovima — jedinstveni dnevnik svakog poslatog mejla (uspjeh i greška), status dostave iz Resend webhooka, i crveni bedž na neriješenim greškama.

**Architecture:** Nova tabela `mejl_log` je observability read-model za sve što prođe kroz `lib/email/resend.ts` `sendEmail`. Troslojni RLS (admin=sve, korisnik=dodijeljene firme, red bez firme=admin) preko postojećih helpera `je_admin()`/`ima_pristup_klijentu()` i tabele `korisnik_klijent`. Upis ide isključivo kroz `SECURITY DEFINER` RPC (jer pravilo kodbaze zabranjuje service-role klijent u `app/` putanji). Resend webhook atomski napreduje `delivery_status` po monotonoj precedenci. UI ekran + nav bedž čitaju kroz `security_invoker` view/RPC pa se RLS primjenjuje automatski.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), Supabase/Postgres (RLS, `SECURITY DEFINER` RPC-ovi), Resend SDK 6.14 (`webhooks.verify`), next-intl (sr/en/de), Vitest (unit + pg integracija), Playwright (E2E), pnpm.

**Spec:** `docs/superpowers/specs/2026-07-13-mejl-log-nadzor-design.md` (referiraj sekcije §N za puni kontekst).

## Global Constraints

Svaki task implicitno uključuje ovo (vrijednosti doslovno iz spec-a / CLAUDE.md):

- **Package manager: `pnpm`** (nikad `npm`/`yarn`).
- **Domain jezik: bosanski/srpski (latinica)** — imena tabela, kolona, ruta, identifikatora i UI stringova.
- **Next.js 16** — `middleware`→`proxy.ts`; `searchParams`/`params` su `Promise` (await-uj); pročitaj `node_modules/next/dist/docs/` prije Next koda.
- **`next dev --webpack` je obavezan** (razmak u putanji `Ai Forward` ruši Turbopack). Playwright webServer već forsira `--webpack`.
- **Tri Supabase klijenta**: browser (anon), SSR server (`createServerSupabaseClient`, anon+cookie), admin (`createAdminSupabaseClient`, service-role, bypass RLS). **NIKAD admin/service-role klijent u `app/` ili `components/` request putanji.** Route handleri (`app/api/.../route.ts`, cron, webhook) NISU request putanja → smiju admin klijent.
- **Migracije su source of truth**, idempotentne. `db/types.ts` je auto-generisan (`pnpm db:types`) — nikad ručno. Cloud nije preko Supabase MCP; primjenjuj jedan fajl: `pnpm db:apply-cloud <file>`.
- **DEMO/PROD lockstep** — sheme uvijek identične. PROD=`fqtqkehjidkzeasiegnq` (`.env.local`), DEMO=`mtwwotmwrasozmcgqwhc` (`.env.development.local`). Ref-guard prije PROD upisa. Lokal/E2E gađaju DEMO.
- **SQL view MORA `security_invoker=on`** ili zaobilazi RLS. Nova tabela bez politike (cloud auto-enable RLS) tiho vraća 0 redova.
- **i18n**: dodaj ključ u **sva tri** `messages/{sr,en,de}.json` u **istoj** izmjeni, paritet ključeva; **bez ICU `one` kategorije za `sr`**. next-intl tsc pada na nepostojeći ključ.
- **Tailwind: bez `sm:`/`md:` breakpointa** (desktop-only; koristi `lg:`/`xl:`/`2xl:`). `no-await-in-loop` je error osim u `scripts/`.
- **UI**: shadcn `base-nova` (`components/ui/`) + Base UI + `lucide` ikone; domenske komponente u `components/domain/`, shell u `components/shell/`.
- **Backend/DB testovi idu preko Docker-a** (lokalni Supabase stack). Bez dummy podataka. E2E na DEMO, `--workers=1`, čišćenje poslije.
- **Merge u `main` = deploy** na tri Production projekta — ne pushuj `main` usput.

## Preduslovi (jednom, prije Task 1)

- [ ] Pokreni lokalni Supabase stack (Docker): `supabase start` (ako već nije). Provjeri `supabase status`.
- [ ] Eksportuj `TEST_DATABASE_URL` na lokalni stack (iz `supabase status` → "DB URL", npr. `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). Integracioni testovi se `skipIf(!TEST_DATABASE_URL)` — bez njega tiho preskaču (lažno zeleno).
- [ ] Potvrdi granu: `git branch --show-current` → `feat/mejl-log-nadzor` (kreiraj: `git checkout -b feat/mejl-log-nadzor` sa `main`, ili nastavi na `docs/mejl-log-nadzor` po dogovoru).

---

## Task 1: Migracija — enumi + tabela + indeksi + troslojni SELECT RLS

Uspostavlja `mejl_log` tabelu i **jedini** trenutno potreban RLS: troslojni SELECT. Upis u testu ide direktno kao vlasnik tabele (RLS vrijedi tek pod `set local role authenticated`).

**Files:**
- Create: `supabase/migrations/20260713120000_mejl_log.sql`
- Test: `lib/mejl-log/rls.integration.test.ts`

**Interfaces:**
- Consumes: postojeći helperi iz `20260626210000_auth_korisnici.sql` — `je_admin()`, `ima_pristup_klijentu(uuid)`; tabela dodjele `korisnik_klijent (korisnik_id, klijent_id)`; tabele `termini(id)`, `klijenti(id)`, `korisnici(id)`.
- Produces: tabela `mejl_log`, enumi `mejl_tip` / `mejl_status` / `mejl_dostava_status`, SELECT politika `mejl_log_sel`.

- [ ] **Step 1: Napiši padajući integracioni test**

Create `lib/mejl-log/rls.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// Gate na TEST_DATABASE_URL (lokalni Docker stack) — isti obrazac kao dueRpc.integration.test.ts.
describe.skipIf(!URL)("mejl_log RLS — tri nivoa SELECT (integracija)", () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: URL }); await db.connect() })
  afterAll(async () => { if (db) await db.end() })

  async function withTx(fn: () => Promise<void>) {
    await db.query("begin")
    try { await fn() } finally { await db.query("rollback") }
  }
  async function createUser(uloga: string): Promise<string> {
    const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
    const id = u.rows[0].id as string
    await db.query(
      "insert into korisnici (id, ime, email, uloga, aktivan) values ($1,'ITEST',$2,$3,true)",
      [id, `itest-${id}@x.com`, uloga],
    )
    return id
  }
  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ])
    await db.query("set local role authenticated")
    try { return await fn() } finally { await db.query("reset role") }
  }
  async function noviKlijent(naziv = "ITEST firma"): Promise<string> {
    const r = await db.query("insert into klijenti (naziv) values ($1) returning id", [naziv])
    return r.rows[0].id as string
  }
  async function dodijeli(uid: string, klijentId: string) {
    await db.query("insert into korisnik_klijent (korisnik_id, klijent_id) values ($1,$2)", [uid, klijentId])
  }
  // Seed reda kao vlasnik tabele (upisni RPC dolazi u Task 2). RLS ne vrijedi za vlasnika.
  async function seedRed(klijentId: string | null): Promise<string> {
    const r = await db.query(
      `insert into mejl_log (tip, primaoci, subject, klijent_id, status)
       values ('podsjetnik_interni', '{a@x.com}', 'ITEST', $1, 'poslato') returning id`,
      [klijentId],
    )
    return r.rows[0].id as string
  }
  async function vidljiviIds(uid: string): Promise<string[]> {
    return asUser(uid, async () => {
      const r = await db.query("select id from mejl_log")
      return r.rows.map((x) => x.id as string)
    })
  }

  it("(a) admin vidi sve, uključujući red bez firme", async () => {
    await withTx(async () => {
      const admin = await createUser("admin")
      const kA = await noviKlijent("A")
      const rA = await seedRed(kA)
      const rNull = await seedRed(null)
      const vid = await vidljiviIds(admin)
      expect(vid).toContain(rA)
      expect(vid).toContain(rNull)
    })
  })

  it("(b) korisnik vidi samo dodijeljenu firmu; ne drugu firmu ni red bez firme", async () => {
    await withTx(async () => {
      const op = await createUser("operater")
      const kA = await noviKlijent("A")
      const kB = await noviKlijent("B")
      await dodijeli(op, kA)
      const rA = await seedRed(kA)
      const rB = await seedRed(kB)
      const rNull = await seedRed(null)
      const vid = await vidljiviIds(op)
      expect(vid).toContain(rA)
      expect(vid).not.toContain(rB)
      expect(vid).not.toContain(rNull)
    })
  })
})
```

- [ ] **Step 2: Pokreni test da potvrdiš pad**

Run: `pnpm vitest run lib/mejl-log/rls.integration.test.ts`
Expected: FAIL — `relation "mejl_log" does not exist` (migracija još ne postoji).

- [ ] **Step 3: Napiši migraciju (enumi + tabela + indeksi + RLS)**

Create `supabase/migrations/20260713120000_mejl_log.sql`:

```sql
-- Dnevnik mejlova (observability). Vidi docs/superpowers/specs/2026-07-13-mejl-log-nadzor-design.md
-- Idempotentna migracija (DO-guard enumi, if not exists, create or replace, drop policy if exists).

-- 1) Enumi
do $$ begin
  create type mejl_tip as enum
    ('podsjetnik_interni','podsjetnik_firma','zakazano_nakon_roka','test');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mejl_status as enum ('poslato','greska_slanja');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mejl_dostava_status as enum
    ('nepoznato','delivered','opened','delivery_failed','bounced','complained');
exception when duplicate_object then null; end $$;

-- 2) Tabela
create table if not exists mejl_log (
  id              uuid                primary key default gen_random_uuid(),
  created_at      timestamptz         not null    default now(),
  tip             mejl_tip            not null,
  primaoci        text[]              not null    default '{}',
  subject         text                not null,
  termin_id       uuid                references termini(id)  on delete set null,
  klijent_id      uuid                references klijenti(id) on delete set null,
  resend_id       text,
  status          mejl_status         not null,
  greska          text,
  delivery_status mejl_dostava_status not null    default 'nepoznato',
  delivery_at     timestamptz,
  pregledano_at   timestamptz,
  pregledano_od   uuid                references korisnici(id) on delete set null
);

-- 3) Indeksi
create index if not exists idx_mejl_log_created  on mejl_log (created_at desc);
create index if not exists idx_mejl_log_klijent  on mejl_log (klijent_id);
create index if not exists idx_mejl_log_resend   on mejl_log (resend_id);
create index if not exists idx_mejl_log_nepregledano on mejl_log (created_at desc)
  where pregledano_at is null
    and (status = 'greska_slanja'
         or delivery_status in ('bounced','complained','delivery_failed'));

-- 4) RLS — troslojni SELECT
alter table mejl_log enable row level security;
grant select on mejl_log to authenticated;

drop policy if exists mejl_log_sel on mejl_log;
create policy mejl_log_sel on mejl_log for select using (
  je_admin()
  or ( klijent_id is not null and ima_pristup_klijentu(klijent_id) )
);
```

- [ ] **Step 4: Primijeni migraciju na lokalni stack**

Run: `pnpm db:reset`
Expected: `supabase db reset` prolazi bez greške; posljednja primijenjena migracija je `20260713120000_mejl_log`.

- [ ] **Step 5: Pokreni test da potvrdiš prolaz**

Run: `pnpm vitest run lib/mejl-log/rls.integration.test.ts`
Expected: PASS (oba `it`-a).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713120000_mejl_log.sql lib/mejl-log/rls.integration.test.ts
git commit -m "feat(mejl-log): migracija — mejl_log tabela + troslojni SELECT RLS"
```

---

## Task 2: Upisni RPC `zabiljezi_mejl_log`

Jedini upisni put (nema `authenticated` INSERT politike → direktan INSERT je default-denied). Validira troslojni pristup; service-role (cron) upisuje bez provjere.

**Files:**
- Modify: `supabase/migrations/20260713120000_mejl_log.sql` (dodaj funkciju na kraj)
- Test: `lib/mejl-log/upis.integration.test.ts`

**Interfaces:**
- Consumes: `mejl_log` tabela, `je_admin()`, `ima_pristup_klijentu(uuid)`, enumi `mejl_tip`/`mejl_status`.
- Produces: `zabiljezi_mejl_log(p_tip mejl_tip, p_primaoci text[], p_subject text, p_termin_id uuid, p_klijent_id uuid, p_resend_id text, p_status mejl_status, p_greska text) returns void`.

- [ ] **Step 1: Napiši padajući test**

Create `lib/mejl-log/upis.integration.test.ts` (ponovi `withTx`/`createUser`/`asUser`/`noviKlijent`/`dodijeli` helpere iz Task 1 — testovi se čitaju nezavisno):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("zabiljezi_mejl_log — upis + pristup (integracija)", () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: URL }); await db.connect() })
  afterAll(async () => { if (db) await db.end() })

  async function withTx(fn: () => Promise<void>) {
    await db.query("begin"); try { await fn() } finally { await db.query("rollback") }
  }
  async function createUser(uloga: string): Promise<string> {
    const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
    const id = u.rows[0].id as string
    await db.query("insert into korisnici (id, ime, email, uloga, aktivan) values ($1,'ITEST',$2,$3,true)",
      [id, `itest-${id}@x.com`, uloga])
    return id
  }
  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })])
    await db.query("set local role authenticated")
    try { return await fn() } finally { await db.query("reset role") }
  }
  async function noviKlijent(): Promise<string> {
    const r = await db.query("insert into klijenti (naziv) values ('ITEST firma') returning id")
    return r.rows[0].id as string
  }
  async function dodijeli(uid: string, klijentId: string) {
    await db.query("insert into korisnik_klijent (korisnik_id, klijent_id) values ($1,$2)", [uid, klijentId])
  }
  async function pozovi(k: string | null) {
    await db.query(
      "select zabiljezi_mejl_log('podsjetnik_interni','{a@x.com}','ITEST',null,$1,'rid_1','poslato',null)",
      [k],
    )
  }
  async function brojZa(k: string | null): Promise<number> {
    const r = k === null
      ? await db.query("select count(*)::int c from mejl_log where klijent_id is null and subject='ITEST'")
      : await db.query("select count(*)::int c from mejl_log where klijent_id=$1", [k])
    return r.rows[0].c as number
  }

  it("service-role (bez jwt) upisuje bez provjere", async () => {
    await withTx(async () => {
      const k = await noviKlijent()
      await pozovi(k) // pozvano kao vlasnik/superuser → auth.uid() null → trusted
      expect(await brojZa(k)).toBe(1)
    })
  })

  it("authenticated sa pristupom firmi A upisuje za A; bez pristupa (B) je no-op", async () => {
    await withTx(async () => {
      const op = await createUser("operater")
      const kA = await noviKlijent()
      const kB = await noviKlijent()
      await dodijeli(op, kA)
      await asUser(op, () => pozovi(kA))
      await asUser(op, () => pozovi(kB))
      expect(await brojZa(kA)).toBe(1)
      expect(await brojZa(kB)).toBe(0) // nema pristup → RPC tiho preskočio
    })
  })

  it("admin upisuje red bez firme (tip test)", async () => {
    await withTx(async () => {
      const admin = await createUser("admin")
      await asUser(admin, async () => {
        await db.query("select zabiljezi_mejl_log('test','{a@x.com}','ITEST',null,null,null,'poslato',null)")
      })
      expect(await brojZa(null)).toBe(1)
    })
  })

  it("direktan authenticated INSERT je odbijen (nema INSERT politike)", async () => {
    await withTx(async () => {
      const op = await createUser("operater")
      const kA = await noviKlijent()
      await dodijeli(op, kA)
      await expect(
        asUser(op, () =>
          db.query("insert into mejl_log (tip,primaoci,subject,klijent_id,status) values ('podsjetnik_interni','{a@x.com}','X',$1,'poslato')", [kA]),
        ),
      ).rejects.toThrow()
    })
  })
})
```

- [ ] **Step 2: Pokreni test — potvrdi pad**

Run: `pnpm vitest run lib/mejl-log/upis.integration.test.ts`
Expected: FAIL — `function zabiljezi_mejl_log(...) does not exist`.

- [ ] **Step 3: Dodaj RPC u migraciju**

Append u `supabase/migrations/20260713120000_mejl_log.sql`:

```sql
-- 5) Upisni put (jedini). Bez INSERT politike → direktan authenticated INSERT je odbijen.
create or replace function zabiljezi_mejl_log(
  p_tip        mejl_tip,
  p_primaoci   text[],
  p_subject    text,
  p_termin_id  uuid,
  p_klijent_id uuid,
  p_resend_id  text,
  p_status     mejl_status,
  p_greska     text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- service_role (cron): auth.uid() NULL → trusted server-context.
  -- authenticated: mora je_admin() ILI ima_pristup_klijentu(p_klijent_id).
  if auth.uid() is not null
     and not ( je_admin()
               or ( p_klijent_id is not null and ima_pristup_klijentu(p_klijent_id) ) )
  then
    return;  -- nema prava → tiho preskoči (best-effort; wrapper ne baca)
  end if;

  insert into mejl_log
    (tip, primaoci, subject, termin_id, klijent_id, resend_id, status, greska, delivery_status)
  values
    (p_tip, p_primaoci, p_subject, p_termin_id, p_klijent_id, p_resend_id, p_status, p_greska, 'nepoznato');
end; $$;

revoke execute on function zabiljezi_mejl_log(mejl_tip,text[],text,uuid,uuid,text,mejl_status,text)
  from public, anon;
grant  execute on function zabiljezi_mejl_log(mejl_tip,text[],text,uuid,uuid,text,mejl_status,text)
  to authenticated, service_role;
```

- [ ] **Step 4: Reapl migraciju**

Run: `pnpm db:reset`
Expected: prolazi bez greške.

- [ ] **Step 5: Pokreni test — potvrdi prolaz**

Run: `pnpm vitest run lib/mejl-log/upis.integration.test.ts`
Expected: PASS (sva 4 `it`-a).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713120000_mejl_log.sql lib/mejl-log/upis.integration.test.ts
git commit -m "feat(mejl-log): zabiljezi_mejl_log SECURITY DEFINER upisni RPC"
```

---

## Task 3: Delivery precedenca — `mejl_dostava_rang` + `azuriraj_mejl_dostavu`

Monotoni napredak `delivery_status` (kasniji/van-reda događaj ne degradira); eskalacija u gori error status resetuje `pregledano_at` (re-alarm).

**Files:**
- Modify: `supabase/migrations/20260713120000_mejl_log.sql`
- Test: `lib/mejl-log/dostava.integration.test.ts`

**Interfaces:**
- Consumes: `mejl_log`, enum `mejl_dostava_status`.
- Produces: `mejl_dostava_rang(mejl_dostava_status) returns int` (immutable); `azuriraj_mejl_dostavu(p_resend_id text, p_status mejl_dostava_status, p_at timestamptz) returns int` (broj ažuriranih redova).

- [ ] **Step 1: Napiši padajući test**

Create `lib/mejl-log/dostava.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("azuriraj_mejl_dostavu — precedenca + eskalacija (integracija)", () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: URL }); await db.connect() })
  afterAll(async () => { if (db) await db.end() })
  async function withTx(fn: () => Promise<void>) {
    await db.query("begin"); try { await fn() } finally { await db.query("rollback") }
  }
  async function seed(resendId: string): Promise<string> {
    const r = await db.query(
      `insert into mejl_log (tip, primaoci, subject, status, resend_id)
       values ('podsjetnik_interni','{a@x.com}','ITEST','poslato',$1) returning id`, [resendId])
    return r.rows[0].id as string
  }
  async function azuriraj(resendId: string, status: string): Promise<number> {
    const r = await db.query("select azuriraj_mejl_dostavu($1,$2,now()) c", [resendId, status])
    return r.rows[0].c as number
  }
  async function stanje(id: string) {
    const r = await db.query("select delivery_status, pregledano_at from mejl_log where id=$1", [id])
    return r.rows[0] as { delivery_status: string; pregledano_at: string | null }
  }

  it("opened prije delivered: opened ostaje; kasniji delivered je no-op", async () => {
    await withTx(async () => {
      const id = await seed("r1")
      expect(await azuriraj("r1", "opened")).toBe(1)
      expect(await azuriraj("r1", "delivered")).toBe(0)
      expect((await stanje(id)).delivery_status).toBe("opened")
    })
  })

  it("opened ne pregazi bounced", async () => {
    await withTx(async () => {
      const id = await seed("r2")
      await azuriraj("r2", "bounced")
      expect(await azuriraj("r2", "opened")).toBe(0)
      expect((await stanje(id)).delivery_status).toBe("bounced")
    })
  })

  it("duplikat događaja je idempotentan (0 redova)", async () => {
    await withTx(async () => {
      await seed("r3")
      expect(await azuriraj("r3", "delivered")).toBe(1)
      expect(await azuriraj("r3", "delivered")).toBe(0)
    })
  })

  it("nepoznat resend_id → 0 redova (bez greške)", async () => {
    await withTx(async () => {
      expect(await azuriraj("nema", "delivered")).toBe(0)
    })
  })

  it("eskalacija bounced→complained resetuje pregledano_at (re-alarm)", async () => {
    await withTx(async () => {
      const id = await seed("r4")
      await azuriraj("r4", "bounced")
      await db.query("update mejl_log set pregledano_at = now() where id=$1", [id])
      expect(await azuriraj("r4", "complained")).toBe(1)
      const s = await stanje(id)
      expect(s.delivery_status).toBe("complained")
      expect(s.pregledano_at).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Pokreni test — potvrdi pad**

Run: `pnpm vitest run lib/mejl-log/dostava.integration.test.ts`
Expected: FAIL — `function azuriraj_mejl_dostavu(...) does not exist`.

- [ ] **Step 3: Dodaj funkcije u migraciju**

Append u `supabase/migrations/20260713120000_mejl_log.sql`:

```sql
-- 6) Rang dostave + atomsko napredovanje statusa
create or replace function mejl_dostava_rang(s mejl_dostava_status)
returns int language sql immutable as $$
  select case s
    when 'nepoznato'       then 0
    when 'delivered'       then 1
    when 'opened'          then 2
    when 'delivery_failed' then 3
    when 'bounced'         then 4
    when 'complained'      then 5
  end;
$$;

create or replace function azuriraj_mejl_dostavu(
  p_resend_id text,
  p_status    mejl_dostava_status,
  p_at        timestamptz
) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update mejl_log
     set delivery_status = p_status,
         delivery_at     = p_at,
         pregledano_at   = case when p_status in ('bounced','complained','delivery_failed')
                                then null else pregledano_at end,
         pregledano_od   = case when p_status in ('bounced','complained','delivery_failed')
                                then null else pregledano_od end
   where resend_id = p_resend_id
     and mejl_dostava_rang(p_status) > mejl_dostava_rang(delivery_status);
  get diagnostics v = row_count;
  return v;  -- 0 = nepoznat id ILI niži/isti rang (oba OK)
end; $$;

revoke execute on function azuriraj_mejl_dostavu(text,mejl_dostava_status,timestamptz) from public, anon, authenticated;
grant  execute on function azuriraj_mejl_dostavu(text,mejl_dostava_status,timestamptz) to service_role;
```

- [ ] **Step 4: Reapl** — Run: `pnpm db:reset` — Expected: prolazi.

- [ ] **Step 5: Test — potvrdi prolaz**

Run: `pnpm vitest run lib/mejl-log/dostava.integration.test.ts`
Expected: PASS (svih 5).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713120000_mejl_log.sql lib/mejl-log/dostava.integration.test.ts
git commit -m "feat(mejl-log): delivery precedenca (mejl_dostava_rang + azuriraj_mejl_dostavu)"
```

---

## Task 4: Read/badge/pregled — `oznaci_mejl_pregledan`, `get_mejl_greske_broj`, `mejl_log_view`, `get_poslati_mejlovi` + regen types

Zaokružuje migraciju: pregled (čisti bedž), brojač bedža, read-model view + paginirani čitni RPC. Na kraju regeneriši `db/types.ts`.

**Files:**
- Modify: `supabase/migrations/20260713120000_mejl_log.sql`
- Modify: `db/types.ts` (auto-generisan)
- Test: `lib/mejl-log/citanje.integration.test.ts`

**Interfaces:**
- Consumes: `mejl_log`, `je_admin()`, `ima_pristup_klijentu(uuid)`, `klijenti(naziv)`, `korisnici(ime)`.
- Produces: `oznaci_mejl_pregledan(p_id uuid) returns void`; `get_mejl_greske_broj() returns int`; view `mejl_log_view`; `get_poslati_mejlovi(p_tip mejl_tip, p_status mejl_status, p_od timestamptz, p_do timestamptz, p_samo_greske boolean, p_samo_nepregledane boolean, p_limit int, p_offset int) returns table(... ukupno bigint)`.

- [ ] **Step 1: Napiši padajući test**

Create `lib/mejl-log/citanje.integration.test.ts` (ponovi helpere `withTx`/`createUser`/`asUser`/`noviKlijent`/`dodijeli` iz Task 1):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("mejl_log read-model + bedž + pregled (integracija)", () => {
  let db: Client
  beforeAll(async () => { db = new Client({ connectionString: URL }); await db.connect() })
  afterAll(async () => { if (db) await db.end() })
  async function withTx(fn: () => Promise<void>) { await db.query("begin"); try { await fn() } finally { await db.query("rollback") } }
  async function createUser(uloga: string): Promise<string> {
    const u = await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
    const id = u.rows[0].id as string
    await db.query("insert into korisnici (id, ime, email, uloga, aktivan) values ($1,'ITEST',$2,$3,true)", [id, `itest-${id}@x.com`, uloga])
    return id
  }
  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })])
    await db.query("set local role authenticated")
    try { return await fn() } finally { await db.query("reset role") }
  }
  async function noviKlijent(n = "ITEST"): Promise<string> {
    const r = await db.query("insert into klijenti (naziv) values ($1) returning id", [n]); return r.rows[0].id as string
  }
  async function dodijeli(uid: string, k: string) { await db.query("insert into korisnik_klijent (korisnik_id, klijent_id) values ($1,$2)", [uid, k]) }
  async function seedGreska(k: string | null): Promise<string> {
    const r = await db.query(
      `insert into mejl_log (tip, primaoci, subject, klijent_id, status, greska)
       values ('podsjetnik_interni','{a@x.com}','ITEST',$1,'greska_slanja','x') returning id`, [k])
    return r.rows[0].id as string
  }
  async function bedz(uid: string): Promise<number> {
    return asUser(uid, async () => (await db.query("select get_mejl_greske_broj() c")).rows[0].c as number)
  }

  it("bedž je RLS-skopiran: admin broji sve greške (i bez firme); operater samo svoje", async () => {
    await withTx(async () => {
      const admin = await createUser("admin")
      const op = await createUser("operater")
      const kA = await noviKlijent("A"); const kB = await noviKlijent("B")
      await dodijeli(op, kA)
      await seedGreska(kA); await seedGreska(kB); await seedGreska(null)
      expect(await bedz(admin)).toBe(3)
      expect(await bedz(op)).toBe(1) // samo firma A
    })
  })

  it("oznaci_mejl_pregledan: ovlašteni čisti; neovlašteni je no-op", async () => {
    await withTx(async () => {
      const op = await createUser("operater")
      const kA = await noviKlijent("A"); const kB = await noviKlijent("B")
      await dodijeli(op, kA)
      const gA = await seedGreska(kA); const gB = await seedGreska(kB)
      await asUser(op, () => db.query("select oznaci_mejl_pregledan($1)", [gA]))
      await asUser(op, () => db.query("select oznaci_mejl_pregledan($1)", [gB])) // nema pristup
      const rA = await db.query("select pregledano_at from mejl_log where id=$1", [gA])
      const rB = await db.query("select pregledano_at from mejl_log where id=$1", [gB])
      expect(rA.rows[0].pregledano_at).not.toBeNull()
      expect(rB.rows[0].pregledano_at).toBeNull()
    })
  })

  it("get_poslati_mejlovi vraća ukupno + poštuje p_samo_greske; view je RLS-skopiran", async () => {
    await withTx(async () => {
      const op = await createUser("operater")
      const kA = await noviKlijent("A"); const kB = await noviKlijent("B")
      await dodijeli(op, kA)
      await seedGreska(kA); await seedGreska(kB)
      const rows = await asUser(op, async () =>
        (await db.query("select * from get_poslati_mejlovi(null,null,null,null,true,false,50,0)")).rows)
      expect(rows.length).toBe(1)              // vidi samo firmu A
      expect(Number(rows[0].ukupno)).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Pokreni test — potvrdi pad**

Run: `pnpm vitest run lib/mejl-log/citanje.integration.test.ts`
Expected: FAIL — `function get_mejl_greske_broj() does not exist`.

- [ ] **Step 3: Dodaj pregled/badge/view/čitni RPC u migraciju**

Append u `supabase/migrations/20260713120000_mejl_log.sql`:

```sql
-- 7) "Označi pregledanim" (čisti bedž) — validira isti troslojni pristup
create or replace function oznaci_mejl_pregledan(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_klijent uuid;
begin
  if auth.uid() is null then return; end if;
  select klijent_id into v_klijent from mejl_log where id = p_id;
  if not ( je_admin() or ( v_klijent is not null and ima_pristup_klijentu(v_klijent) ) ) then
    return;  -- nema prava → tiho, bez izmjene
  end if;
  update mejl_log
     set pregledano_at = now(), pregledano_od = auth.uid()
   where id = p_id and pregledano_at is null;  -- idempotentno
end; $$;
revoke execute on function oznaci_mejl_pregledan(uuid) from public, anon;
grant  execute on function oznaci_mejl_pregledan(uuid) to authenticated;

-- 8) Bedž — brojač (RLS-skopiran preko security invoker)
create or replace function get_mejl_greske_broj()
returns int language sql stable security invoker set search_path = public as $$
  select count(*)::int from mejl_log
  where pregledano_at is null
    and ( status = 'greska_slanja'
          or delivery_status in ('bounced','complained','delivery_failed') );
$$;
grant execute on function get_mejl_greske_broj() to authenticated;

-- 9) Read-model view (OBAVEZNO security_invoker=on → nasljeđuje RLS bazne tabele)
create or replace view mejl_log_view
with (security_invoker = on) as
select m.id, m.created_at, m.tip, m.primaoci, m.subject,
       m.termin_id, m.klijent_id, kl.naziv as klijent_naziv,
       m.resend_id, m.status, m.greska,
       m.delivery_status, m.delivery_at,
       m.pregledano_at, m.pregledano_od, ko.ime as pregledao_ime
from mejl_log m
left join klijenti  kl on kl.id = m.klijent_id
left join korisnici ko on ko.id = m.pregledano_od;
grant select on mejl_log_view to authenticated;

-- 10) Paginirani čitni RPC (security invoker → RLS pozivaoca)
create or replace function get_poslati_mejlovi(
  p_tip               mejl_tip    default null,
  p_status            mejl_status default null,
  p_od                timestamptz default null,
  p_do                timestamptz default null,
  p_samo_greske       boolean     default false,
  p_samo_nepregledane boolean     default false,
  p_limit             int         default 50,
  p_offset            int         default 0
) returns table (
  id uuid, created_at timestamptz, tip mejl_tip, primaoci text[], subject text,
  termin_id uuid, klijent_id uuid, klijent_naziv text, resend_id text,
  status mejl_status, greska text, delivery_status mejl_dostava_status,
  delivery_at timestamptz, pregledano_at timestamptz, pregledao_ime text,
  ukupno bigint
) language sql stable security invoker set search_path = public as $$
  with f as (
    select * from mejl_log_view v
    where (p_tip    is null or v.tip = p_tip)
      and (p_status is null or v.status = p_status)
      and (p_od     is null or v.created_at >= p_od)
      and (p_do     is null or v.created_at <  p_do)
      and (not p_samo_greske
           or v.status = 'greska_slanja'
           or v.delivery_status in ('bounced','complained','delivery_failed'))
      and (not p_samo_nepregledane or v.pregledano_at is null)
  )
  select f.id, f.created_at, f.tip, f.primaoci, f.subject, f.termin_id, f.klijent_id,
         f.klijent_naziv, f.resend_id, f.status, f.greska, f.delivery_status,
         f.delivery_at, f.pregledano_at, f.pregledao_ime,
         count(*) over () as ukupno
  from f
  order by f.created_at desc
  limit greatest(p_limit,0) offset greatest(p_offset,0);
$$;
grant execute on function
  get_poslati_mejlovi(mejl_tip,mejl_status,timestamptz,timestamptz,boolean,boolean,int,int)
  to authenticated;
```

- [ ] **Step 4: Reapl + regeneriši tipove**

Run: `pnpm db:reset && pnpm db:types`
Expected: `db:reset` prolazi; `db/types.ts` sada sadrži `mejl_log`, enume `mejl_tip`/`mejl_status`/`mejl_dostava_status` i RPC potpise. Provjeri: `grep -c "mejl_log\|mejl_tip\|zabiljezi_mejl_log\|get_poslati_mejlovi" db/types.ts` → > 0.

- [ ] **Step 5: Test — potvrdi prolaz + typecheck**

Run: `pnpm vitest run lib/mejl-log/citanje.integration.test.ts`
Expected: PASS (sva 3).
Run: `pnpm typecheck`
Expected: bez grešaka (novi tipovi validni).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713120000_mejl_log.sql db/types.ts lib/mejl-log/citanje.integration.test.ts
git commit -m "feat(mejl-log): view + get_poslati_mejlovi + bedž brojač + oznaci_pregledan; regen types"
```

---

## Task 5: Wrapper `posaljiIzabiljezi` (+ unit)

Tanki best-effort wrapper oko `sendEmail`: na uspjeh (non-dry) i na grešku upisuje `mejl_log` preko RPC-a; re-throw čuva postojeće rukovanje greškom.

**Files:**
- Create: `lib/email/posaljiIzabiljezi.ts`
- Test: `lib/email/posaljiIzabiljezi.test.ts`

**Interfaces:**
- Consumes: `sendEmail`/`SendArgs`/`SendResult` iz `lib/email/resend.ts`; RPC `zabiljezi_mejl_log`; `Database["public"]["Enums"]["mejl_tip"]`.
- Produces: `posaljiIzabiljezi(supabase, args: SendArgs & { tip: MejlTip; terminId?: string|null; klijentId?: string|null }, send?) : Promise<SendResult>`.

- [ ] **Step 1: Napiši padajući unit test**

Create `lib/email/posaljiIzabiljezi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { posaljiIzabiljezi } from "./posaljiIzabiljezi"
import type { SendArgs, SendResult } from "./resend"

// Fake supabase koji hvata rpc pozive.
function fakeSupabase() {
  const calls: { fn: string; args: unknown }[] = []
  return {
    calls,
    rpc: vi.fn(async (fn: string, args: unknown) => { calls.push({ fn, args }); return { error: null } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}
const base: SendArgs & { tip: "podsjetnik_interni" } = {
  to: ["a@x.com"], bcc: ["b@x.com"], subject: "S", html: "<p>", tip: "podsjetnik_interni",
}

beforeEach(() => vi.restoreAllMocks())

describe("posaljiIzabiljezi", () => {
  it("uspjeh (non-dry): jedan rpc zabiljezi_mejl_log sa status=poslato; vraća res", async () => {
    const sb = fakeSupabase()
    const send = vi.fn(async (): Promise<SendResult> => ({ id: "abc", dryRun: false }))
    const res = await posaljiIzabiljezi(sb, { ...base, klijentId: "k1" }, send)
    expect(res).toEqual({ id: "abc", dryRun: false })
    expect(sb.calls).toHaveLength(1)
    const a = sb.calls[0].args as Record<string, unknown>
    expect(a.p_status).toBe("poslato")
    expect(a.p_resend_id).toBe("abc")
    expect(a.p_klijent_id).toBe("k1")
    expect(a.p_primaoci).toEqual(["a@x.com", "b@x.com"])
  })

  it("dry-run: nula rpc poziva; vraća res", async () => {
    const sb = fakeSupabase()
    const send = vi.fn(async (): Promise<SendResult> => ({ id: "dry-run", dryRun: true }))
    const res = await posaljiIzabiljezi(sb, base, send)
    expect(res.dryRun).toBe(true)
    expect(sb.calls).toHaveLength(0)
  })

  it("neuspjeh: rpc sa greska_slanja; funkcija re-throw-uje", async () => {
    const sb = fakeSupabase()
    const send = vi.fn(async (): Promise<SendResult> => { throw new Error("resend pao") })
    await expect(posaljiIzabiljezi(sb, base, send)).rejects.toThrow("resend pao")
    expect(sb.calls).toHaveLength(1)
    const a = sb.calls[0].args as Record<string, unknown>
    expect(a.p_status).toBe("greska_slanja")
    expect(a.p_greska).toBe("resend pao")
    expect(a.p_resend_id).toBeNull()
  })

  it("best-effort: rpc greška ne ruši uspjeh (loguje se)", async () => {
    const sb = fakeSupabase()
    sb.rpc = vi.fn(async () => ({ error: { message: "db pao" } }))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const send = vi.fn(async (): Promise<SendResult> => ({ id: "abc", dryRun: false }))
    const res = await posaljiIzabiljezi(sb, base, send)
    expect(res.id).toBe("abc")
    expect(spy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Pokreni — potvrdi pad**

Run: `pnpm vitest run lib/email/posaljiIzabiljezi.test.ts`
Expected: FAIL — cannot find module `./posaljiIzabiljezi`.

- [ ] **Step 3: Implementiraj wrapper**

Create `lib/email/posaljiIzabiljezi.ts`:

```ts
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]

export async function posaljiIzabiljezi(
  supabase: SupabaseClient<Database>,
  args: SendArgs & { tip: MejlTip; terminId?: string | null; klijentId?: string | null },
  send: (a: SendArgs) => Promise<SendResult> = sendEmail,
): Promise<SendResult> {
  const { tip, terminId = null, klijentId = null, ...sendArgs } = args
  const primaoci = [...(sendArgs.to ?? []), ...(sendArgs.bcc ?? [])]
  try {
    const res = await send(sendArgs)
    if (!res.dryRun) {
      await zabiljeziMejlLog(supabase, {
        tip, terminId, klijentId, primaoci, subject: sendArgs.subject,
        resendId: res.id, status: "poslato", greska: null,
      })
    }
    return res
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await zabiljeziMejlLog(supabase, {
      tip, terminId, klijentId, primaoci, subject: sendArgs.subject,
      resendId: null, status: "greska_slanja", greska: message,
    })
    throw e // RE-THROW: čuva postojeće rukovanje greškom na pozivnim mjestima
  }
}

async function zabiljeziMejlLog(
  supabase: SupabaseClient<Database>,
  row: {
    tip: MejlTip; terminId: string | null; klijentId: string | null
    primaoci: string[]; subject: string; resendId: string | null
    status: "poslato" | "greska_slanja"; greska: string | null
  },
): Promise<void> {
  try {
    const { error } = await supabase.rpc("zabiljezi_mejl_log", {
      p_tip: row.tip, p_termin_id: row.terminId, p_klijent_id: row.klijentId,
      p_primaoci: row.primaoci, p_subject: row.subject, p_resend_id: row.resendId,
      p_status: row.status, p_greska: row.greska,
    })
    if (error) console.error("[mejl_log] upis nije uspio:", error.message)
  } catch (e) {
    console.error("[mejl_log] upis bacio:", e instanceof Error ? e.message : String(e))
  }
}
```

- [ ] **Step 4: Pokreni — potvrdi prolaz + typecheck**

Run: `pnpm vitest run lib/email/posaljiIzabiljezi.test.ts`
Expected: PASS (sva 4).
Run: `pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 5: Commit**

```bash
git add lib/email/posaljiIzabiljezi.ts lib/email/posaljiIzabiljezi.test.ts
git commit -m "feat(mejl-log): posaljiIzabiljezi best-effort wrapper oko sendEmail"
```

---

## Task 6: Ožičiti wrapper na 4 pozivna mjesta + `klijent_id` u zakazano select

Ubaci `posaljiIzabiljezi` na 4 mjesta gdje se šalje mejl, čuvajući `send` seam (test/dry-run) i postojeće rukovanje greškom.

**Files:**
- Modify: `lib/reminders/runReminders.ts` (helper `posalji`, ~`:114-130`)
- Modify: `lib/reminders/zakazanoNakonRoka.ts` (`:26` send seam; `:31-32` select — dodaj `klijent_id`)
- Modify: `app/(dashboard)/postavke/actions.ts` (~`:268` test-mejl)
- Test: postojeći `lib/reminders/runReminders.test.ts`, `lib/reminders/zakazanoNakonRoka.test.ts` (moraju ostati zeleni)

**Interfaces:**
- Consumes: `posaljiIzabiljezi` (Task 5).
- Produces: (nema novih javnih simbola; ponašanje slanja nepromijenjeno, dodat log upis).

> **Napomena:** wrapper prima **klijentov `supabase`** koji je na svakom mjestu već u opsegu (cron: service-role admin klijent; zakazano/test: SSR user). Upis ide kroz RPC — nikad admin klijent u `app/` putanji.

- [ ] **Step 1: Ožiči `runReminders` (kanali interni + firma)**

U `lib/reminders/runReminders.ts`, unutar helpera `posalji(kanal, args)`, zamijeni `const res = await send(args)` pozivom wrappera (prosljeđujući `send` kao 3. arg da se čuva dry-run/test seam):

```ts
// prije: const res = await send(args)
const res = await posaljiIzabiljezi(
  supabase,
  { ...args, tip: kanal === "interni" ? "podsjetnik_interni" : "podsjetnik_firma",
    terminId: r.termin_id!, klijentId: r.klijent_id },
  send,
)
```

Dodaj import na vrh: `import { posaljiIzabiljezi } from "@/lib/email/posaljiIzabiljezi"`. Ostatak `posalji` (uspjeh → `podsjetnici` insert i dedup; greška → `catch → {kind:"err"}`) ostaje nepromijenjen: wrapper vraća `res` na uspjeh i re-throw-uje na grešci.

- [ ] **Step 2: Ožiči `zakazanoNakonRoka` + dodaj `klijent_id` u select**

U `lib/reminders/zakazanoNakonRoka.ts`:
1. U čitanju `termini_view` (`:31-32`) dodaj `klijent_id` u `.select(...)`: `.select("klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, rok_dospijeca")`.
2. Zamijeni poziv `send({...})` (`:26` seam) sa:

```ts
const res = await posaljiIzabiljezi(
  supabase,
  { to, subject, html, tip: "zakazano_nakon_roka", terminId: args.terminId, klijentId: red.klijent_id },
  send,
)
```

Dodaj import `posaljiIzabiljezi`. Claim-before-send (`zabiljezi_zakazano_obavijest`, `:41`) **ostaje ispred** slanja — ne mijenjaj redoslijed.

- [ ] **Step 3: Ožiči test-mejl u `postavke/actions.ts`**

U `app/(dashboard)/postavke/actions.ts` (~`:268`), zamijeni `sendEmail({...})` sa `posaljiIzabiljezi(supabase, { ...istiArgs, tip: "test" })` (bez `klijentId` → `null`; `supabase` je SSR admin klijent iz `zahtijevajAdmina`). Zadrži postojeći `try/catch` + `objasniEmailGresku` — wrapper re-throw-uje isti `Error`. Dodaj import.

- [ ] **Step 4: Pokreni postojeće unit testove**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts lib/reminders/zakazanoNakonRoka.test.ts`
Expected: PASS (dry-run putanja ne upisuje log; postojeće asertacije o slanju/dedup-u nepromijenjene). Ako neki test mock-uje `send` i sada padne na tipu, ažuriraj mock da vrati `{ id, dryRun }` — ne mijenjaj očekivanja ponašanja.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: bez grešaka (posebno `no-await-in-loop` — wrapper poziv je unutar postojeće `Promise.all`/map strukture, ne novi `for`-await).

- [ ] **Step 6: Commit**

```bash
git add lib/reminders/runReminders.ts lib/reminders/zakazanoNakonRoka.ts "app/(dashboard)/postavke/actions.ts"
git commit -m "feat(mejl-log): ožiči posaljiIzabiljezi na 4 pozivna mjesta (+ klijent_id u zakazano select)"
```

---

## Task 7: `mapirajDostavu` (+ unit)

Čista, testabilna mapa Resend event-type → `delivery_status` (izdvojena iz rute).

**Files:**
- Create: `lib/email/webhookDostava.ts`
- Test: `lib/email/webhookDostava.test.ts`

**Interfaces:**
- Consumes: `Database["public"]["Enums"]["mejl_dostava_status"]`.
- Produces: `mapirajDostavu(type: string): MejlDostavaStatus | undefined`.

- [ ] **Step 1: Napiši padajući test**

Create `lib/email/webhookDostava.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { mapirajDostavu } from "./webhookDostava"

describe("mapirajDostavu", () => {
  it("mapira poznate event-tipove", () => {
    expect(mapirajDostavu("email.delivered")).toBe("delivered")
    expect(mapirajDostavu("email.opened")).toBe("opened")
    expect(mapirajDostavu("email.failed")).toBe("delivery_failed")
    expect(mapirajDostavu("email.bounced")).toBe("bounced")
    expect(mapirajDostavu("email.complained")).toBe("complained")
  })
  it("vraća undefined za tranzijentne/ignorisane", () => {
    for (const t of ["email.sent", "email.scheduled", "email.clicked", "email.delivery_delayed", "domain.created", "contact.updated", "smeće"]) {
      expect(mapirajDostavu(t)).toBeUndefined()
    }
  })
})
```

- [ ] **Step 2: Pokreni — potvrdi pad**

Run: `pnpm vitest run lib/email/webhookDostava.test.ts`
Expected: FAIL — cannot find module `./webhookDostava`.

- [ ] **Step 3: Implementiraj**

Create `lib/email/webhookDostava.ts`:

```ts
import type { Database } from "@/db/types"

type MejlDostavaStatus = Database["public"]["Enums"]["mejl_dostava_status"]

const MAPA: Record<string, MejlDostavaStatus> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.failed": "delivery_failed",
  "email.bounced": "bounced",
  "email.complained": "complained",
}

/** Resend event tip → delivery_status. undefined = ignoriši (bez izmjene statusa). */
export function mapirajDostavu(type: string): MejlDostavaStatus | undefined {
  return MAPA[type]
}
```

- [ ] **Step 4: Pokreni — potvrdi prolaz**

Run: `pnpm vitest run lib/email/webhookDostava.test.ts`
Expected: PASS (oba).

- [ ] **Step 5: Commit**

```bash
git add lib/email/webhookDostava.ts lib/email/webhookDostava.test.ts
git commit -m "feat(mejl-log): mapirajDostavu (event → delivery_status)"
```

---

## Task 8: Webhook ruta + env `RESEND_WEBHOOK_SECRET` + proxy PUBLIC (+ unit potpisa)

Prima Resend webhook, verifikuje potpis (fail-closed 401), napreduje `delivery_status` preko `azuriraj_mejl_dostavu`.

**Files:**
- Create: `app/api/webhooks/resend/route.ts`
- Modify: `lib/env.ts` (dodaj `RESEND_WEBHOOK_SECRET`)
- Modify: `proxy.ts:15` (dodaj rutu u `PUBLIC`)
- Test: `lib/email/webhookPotpis.test.ts`

**Interfaces:**
- Consumes: `mapirajDostavu` (Task 7); RPC `azuriraj_mejl_dostavu`; `createAdminSupabaseClient`; `env.RESEND_WEBHOOK_SECRET`/`env.RESEND_API_KEY`; Resend SDK `webhooks.verify`.
- Produces: `POST /api/webhooks/resend`.

- [ ] **Step 1: Dodaj env varijablu**

U `lib/env.ts`:
- U `envSchema` (uz `CRON_SECRET`, ~`:17`): `RESEND_WEBHOOK_SECRET: optionalSecret,`
- U `safeParse({...})` mapiranju (~`:41`): `RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,`
- Dodaj komentarisanu liniju u `.env.local.example` uz `CRON_SECRET` (ako fajl postoji): `# RESEND_WEBHOOK_SECRET=whsec_...`

- [ ] **Step 2: Napiši padajući test potpisa**

Create `lib/email/webhookPotpis.test.ts` (verifikacija protiv STVARNOG Resend verifikatora; fixture ručno potpisan `node:crypto`-om u `standardwebhooks` formatu — bez importa `standardwebhooks`):

```ts
import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"
import { Resend } from "resend"

const WHSEC = "whsec_" + Buffer.from("tajna-kljuc-1234567890").toString("base64")

function potpisi(whsec: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(whsec.replace(/^whsec_/, ""), "base64")
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`
}
function verify(body: string, headers: { id: string; timestamp: string; signature: string }) {
  return new Resend("re_placeholder").webhooks.verify({ payload: body, headers, webhookSecret: WHSEC })
}

describe("Resend webhooks.verify (ugrađeni verifikator)", () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } })
  const id = "msg_1"
  const ts = () => Math.floor(Date.now() / 1000).toString()

  it("validan potpis prolazi i vraća parsiran event", () => {
    const t = ts()
    const ev = verify(body, { id, timestamp: t, signature: potpisi(WHSEC, id, t, body) }) as { type: string }
    expect(ev.type).toBe("email.delivered")
  })
  it("izmijenjeno tijelo → throw", () => {
    const t = ts()
    const sig = potpisi(WHSEC, id, t, body)
    expect(() => verify(body + "x", { id, timestamp: t, signature: sig })).toThrow()
  })
  it("pogrešna tajna → throw", () => {
    const t = ts()
    const bad = potpisi("whsec_" + Buffer.from("druga-tajna").toString("base64"), id, t, body)
    expect(() => verify(body, { id, timestamp: t, signature: bad })).toThrow()
  })
})
```

- [ ] **Step 3: Pokreni — potvrdi (test služi kao izvršni ugovor SDK-a)**

Run: `pnpm vitest run lib/email/webhookPotpis.test.ts`
Expected: PASS. (Ako padne na importu `standardwebhooks` unutar `resend`, to znači da transitivna zavisnost nije instalirana — pokreni `pnpm install` pa ponovo. Ne dodaji `standardwebhooks` kao direktnu zavisnost.)

- [ ] **Step 4: Implementiraj rutu**

Create `app/api/webhooks/resend/route.ts`:

```ts
import { Resend } from "resend"
import { env } from "@/lib/env"
import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { mapirajDostavu } from "@/lib/email/webhookDostava"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  if (!env.RESEND_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const rawBody = await req.text() // SIROVO tijelo prije JSON.parse (HMAC ulaz)

  const id        = req.headers.get("svix-id")        ?? req.headers.get("webhook-id")
  const timestamp = req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp")
  const signature = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature")
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "Missing headers" }, { status: 401 })
  }

  let event: { type: string; data?: { email_id?: string; created_at?: string }; created_at?: string }
  try {
    event = new Resend(env.RESEND_API_KEY ?? "re_placeholder").webhooks.verify({
      payload: rawBody,
      headers: { id, timestamp, signature }, // Resend lokalni Headers interfejs (NE WHATWG)
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const status = mapirajDostavu(event.type)
  if (status && event.data?.email_id) {
    const supabase = createAdminSupabaseClient() // service-role: ruta NIJE app request-path
    await supabase.rpc("azuriraj_mejl_dostavu", {
      p_resend_id: event.data.email_id,
      p_status: status,
      p_at: event.data.created_at ?? event.created_at ?? new Date().toISOString(),
    })
  }
  return NextResponse.json({ ok: true }) // uvijek 200 za validan potpis
}
```

- [ ] **Step 5: Dodaj rutu u `proxy.ts` PUBLIC (OBAVEZNO)**

U `proxy.ts:15` dodaj tačnu putanju (ne prefiks), inače neautentifikovan Resend POST dobija redirect na `/prijava`:

```ts
const PUBLIC = [href("/prijava"), href("/zaboravljena-lozinka"), "/auth", "/api/cron", "/api/webhooks/resend"]
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint`
Expected: bez grešaka.
Run: `pnpm build`
Expected: build prolazi; ruta `/api/webhooks/resend` je u izlazu kao dinamička.

- [ ] **Step 7: Commit**

```bash
git add "app/api/webhooks/resend/route.ts" lib/env.ts proxy.ts lib/email/webhookPotpis.test.ts .env.local.example
git commit -m "feat(mejl-log): Resend webhook ruta + potpis + RESEND_WEBHOOK_SECRET + proxy PUBLIC"
```

---

## Task 9: i18n ključevi (sr/en/de) + route lokalizacija + nav labela

Dodaj sve ključeve koje UI (Task 10) i nav (Task 11) referenciraju. next-intl tsc pada na nepostojeći ključ, pa ovo mora prethoditi UI-ju.

**Files:**
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`
- Modify: `i18n/routes.ts` (ROUTE_MAP)

**Interfaces:**
- Produces: namespace `poslatiMejlovi.*` + `shell.nav.poslatiMejlovi`; ROUTE_MAP unos `poslati-mejlovi`.

- [ ] **Step 1: Dodaj ključeve u sva tri kataloga (paritet, bez ICU `one` za sr)**

U svakom od `messages/{sr,en,de}.json` dodaj `shell.nav.poslatiMejlovi` i novu top-level sekciju `poslatiMejlovi`. Struktura (popuni prevode po jeziku):

```jsonc
// shell.nav (dodaj ključ):
"poslatiMejlovi": "Poslati mejlovi"   // en: "Sent emails" · de: "Gesendete Mails"

// nova top-level sekcija:
"poslatiMejlovi": {
  "naslov": "Poslati mejlovi",
  "opis": "Dnevnik automatskih i ručnih mejlova sa statusom dostave.",
  "prazno": "Još nema poslatih mejlova.",
  "kolone": { "vrijeme":"Vrijeme","tip":"Tip","primaoci":"Primaoci","naslov":"Naslov",
              "slanje":"Slanje","dostava":"Dostava","greska":"Greška","klijent":"Klijent" },
  "tip": { "podsjetnikInterni":"Podsjetnik (interni)","podsjetnikFirma":"Podsjetnik (firma)",
           "zakazanoNakonRoka":"Zakazano nakon roka","test":"Test" },
  "status": { "poslato":"Poslato","greskaSlanja":"Greška slanja" },
  "dostava": { "nepoznato":"Nepoznato","delivered":"Isporučeno","opened":"Otvoreno",
               "deliveryFailed":"Neuspjela dostava","bounced":"Odbijeno","complained":"Prijava spama" },
  "filteri": { "tip":"Tip","status":"Slanje","od":"Od","do":"Do",
               "samoGreske":"Samo greške","samoNerijesene":"Samo neriješene","svi":"Svi" },
  "oznaciPregledanim": "Označi pregledanim",
  "bedzGreske": "Neriješene greške"
}
```

Prevedi vrijednosti za `en.json` i `de.json` (ključevi identični u sva tri).

- [ ] **Step 2: Dodaj route lokalizaciju**

U `i18n/routes.ts`, `ROUTE_MAP`, dodaj:

```ts
"poslati-mejlovi": { en: "sent-emails", de: "gesendete-mails" },
```

- [ ] **Step 3: Provjeri paritet + typecheck**

Run: `pnpm typecheck`
Expected: bez grešaka (next-intl validira uniju ključeva; nedostajući/nepariteni ključ = tsc greška).

- [ ] **Step 4: Commit**

```bash
git add messages/sr.json messages/en.json messages/de.json i18n/routes.ts
git commit -m "feat(mejl-log): i18n ključevi (sr/en/de) + route lokalizacija"
```

---

## Task 10: Query modul + UI ekran „Poslati mejlovi"

Server ekran vidljiv svim ulogovanim (redovi RLS-skopirani), tabela + filteri (server `<form method=get>`) + obojeni bedž dostave + crveni redovi grešaka + „označi pregledanim" server action.

**Files:**
- Create: `lib/queries/poslati-mejlovi.ts`
- Create: `app/(dashboard)/poslati-mejlovi/page.tsx`
- Create: `app/(dashboard)/poslati-mejlovi/loading.tsx`
- Create: `app/(dashboard)/poslati-mejlovi/actions.ts` (server action za pregled)
- Create: `components/domain/PoslatiMejloviTabela.tsx`

**Interfaces:**
- Consumes: RPC `get_poslati_mejlovi`, `oznaci_mejl_pregledan`; `createServerSupabaseClient`; i18n `poslatiMejlovi.*`; `Database` enum tipovi.
- Produces: ruta `/poslati-mejlovi`; `dohvatiPoslateMejlove(filteri)` u query modulu.

> **Napomena o gating-u (§6.1):** NIJE admin-only. **NE** dodavati `notFound()` po ulozi. Uzor je `klijenti/page.tsx` (SSR anon klijent, RLS radi posao). `proxy.ts` već blokira neautentifikovane.

- [ ] **Step 1: Query modul**

Create `lib/queries/poslati-mejlovi.ts`:

```ts
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { Database } from "@/db/types"

export type PoslatiMejlFilteri = {
  tip?: Database["public"]["Enums"]["mejl_tip"] | null
  status?: Database["public"]["Enums"]["mejl_status"] | null
  od?: string | null
  do?: string | null
  samoGreske?: boolean
  samoNepregledane?: boolean
  limit?: number
  offset?: number
}

export async function dohvatiPoslateMejlove(f: PoslatiMejlFilteri) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_poslati_mejlovi", {
    p_tip: f.tip ?? null,
    p_status: f.status ?? null,
    p_od: f.od ?? null,
    p_do: f.do ?? null,
    p_samo_greske: f.samoGreske ?? false,
    p_samo_nepregledane: f.samoNepregledane ?? false,
    p_limit: f.limit ?? 50,
    p_offset: f.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const redovi = data ?? []
  const ukupno = redovi.length > 0 ? Number(redovi[0].ukupno) : 0
  return { redovi, ukupno }
}
```

- [ ] **Step 2: Server action (označi pregledanim)**

Create `app/(dashboard)/poslati-mejlovi/actions.ts`:

```ts
"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function oznaciPregledanim(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase.rpc("oznaci_mejl_pregledan", { p_id: id })
  revalidatePath("/poslati-mejlovi")
  revalidatePath("/", "layout") // osvježi nav bedž
}
```

- [ ] **Step 3: Tabela (server komponenta) sa enum→i18n mapama**

Create `components/domain/PoslatiMejloviTabela.tsx`:

```tsx
import { getTranslations } from "next-intl/server"
import type { Database } from "@/db/types"
import { Badge } from "@/components/ui/badge"
import { oznaciPregledanim } from "@/app/(dashboard)/poslati-mejlovi/actions"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]
type MejlStatus = Database["public"]["Enums"]["mejl_status"]
type MejlDostava = Database["public"]["Enums"]["mejl_dostava_status"]

const TIP_KEY = { podsjetnik_interni:"podsjetnikInterni", podsjetnik_firma:"podsjetnikFirma",
  zakazano_nakon_roka:"zakazanoNakonRoka", test:"test" } as const satisfies Record<MejlTip,string>
const STATUS_KEY = { poslato:"poslato", greska_slanja:"greskaSlanja" } as const satisfies Record<MejlStatus,string>
const DOSTAVA_KEY = { nepoznato:"nepoznato", delivered:"delivered", opened:"opened",
  delivery_failed:"deliveryFailed", bounced:"bounced", complained:"complained" } as const satisfies Record<MejlDostava,string>

const DOSTAVA_VARIJANTA: Record<MejlDostava, "secondary" | "default" | "destructive"> = {
  nepoznato: "secondary", delivered: "default", opened: "default",
  delivery_failed: "destructive", bounced: "destructive", complained: "destructive",
}

type Red = {
  id: string; created_at: string; tip: MejlTip; primaoci: string[]; subject: string
  klijent_naziv: string | null; status: MejlStatus; greska: string | null; delivery_status: MejlDostava
}

function jeGreska(r: Red) {
  return r.status === "greska_slanja" || ["bounced","complained","delivery_failed"].includes(r.delivery_status)
}

export async function PoslatiMejloviTabela({ redovi }: { redovi: Red[] }) {
  const t = await getTranslations("poslatiMejlovi")
  if (redovi.length === 0) return <p className="text-sm text-muted-foreground">{t("prazno")}</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="table w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2">{t("kolone.vrijeme")}</th>
            <th className="px-3 py-2">{t("kolone.tip")}</th>
            <th className="px-3 py-2">{t("kolone.primaoci")}</th>
            <th className="px-3 py-2">{t("kolone.naslov")}</th>
            <th className="px-3 py-2">{t("kolone.klijent")}</th>
            <th className="px-3 py-2">{t("kolone.slanje")}</th>
            <th className="px-3 py-2">{t("kolone.dostava")}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {redovi.map((r) => (
            <tr key={r.id} className={jeGreska(r) ? "border-t border-border bg-destructive/5" : "border-t border-border"}>
              <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString("sr-Latn")}</td>
              <td className="px-3 py-2">{t(`tip.${TIP_KEY[r.tip]}`)}</td>
              <td className="px-3 py-2">{r.primaoci.join(", ")}</td>
              <td className="px-3 py-2">{r.subject}</td>
              <td className="px-3 py-2">{r.klijent_naziv ?? "—"}</td>
              <td className="px-3 py-2">
                {t(`status.${STATUS_KEY[r.status]}`)}
                {r.greska && <span className="block text-xs text-destructive">{r.greska}</span>}
              </td>
              <td className="px-3 py-2">
                <Badge variant={DOSTAVA_VARIJANTA[r.delivery_status]}>{t(`dostava.${DOSTAVA_KEY[r.delivery_status]}`)}</Badge>
              </td>
              <td className="px-3 py-2">
                {jeGreska(r) && (
                  <form action={oznaciPregledanim.bind(null, r.id)}>
                    <button type="submit" className="text-xs underline hover:no-underline">{t("oznaciPregledanim")}</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

> Ako `Badge` nema `destructive` varijantu, koristi klasnu boju (`className="text-destructive"`) umjesto `variant`. Provjeri `components/ui/badge.tsx`.

- [ ] **Step 4: Stranica + filteri (server `<form method=get>`) + loading**

Create `app/(dashboard)/poslati-mejlovi/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server"
import { dohvatiPoslateMejlove } from "@/lib/queries/poslati-mejlovi"
import { PoslatiMejloviTabela } from "@/components/domain/PoslatiMejloviTabela"
import type { Database } from "@/db/types"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]
type MejlStatus = Database["public"]["Enums"]["mejl_status"]

export default async function PoslatiMejloviPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const t = await getTranslations("poslatiMejlovi")
  const { redovi } = await dohvatiPoslateMejlove({
    tip: (sp.tip as MejlTip) || null,
    status: (sp.status as MejlStatus) || null,
    od: sp.od || null,
    do: sp.do || null,
    samoGreske: sp.samo_greske === "1",
    samoNepregledane: sp.nepregledano === "1",
  })
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        {/* tip / status / od / do / samo_greske / nepregledano — kontrole (native select/input); dugme "Filtriraj" */}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="samo_greske" value="1" defaultChecked={sp.samo_greske === "1"} />
          {t("filteri.samoGreske")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="nepregledano" value="1" defaultChecked={sp.nepregledano === "1"} />
          {t("filteri.samoNerijesene")}
        </label>
        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          {t("filteri.svi")}
        </button>
      </form>
      <PoslatiMejloviTabela redovi={redovi} />
    </div>
  )
}
```

Create `app/(dashboard)/poslati-mejlovi/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return <div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>
}
```

> Filter kontrole za `tip`/`status` (native `<select>` sa opcijama iz enum→i18n mapa) i `od`/`do` (`<input type=date>`) dodaj po istom obrascu; drži sve kao server komponentu (`<form method=get>`) da se izbjegne `CLIENT_NAMESPACES` izmjena (§6.4).

- [ ] **Step 5: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: bez grešaka; ruta `/poslati-mejlovi` u izlazu builda.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/poslati-mejlovi.ts "app/(dashboard)/poslati-mejlovi" components/domain/PoslatiMejloviTabela.tsx
git commit -m "feat(mejl-log): ekran Poslati mejlovi (tabela + filteri + označi pregledanim)"
```

---

## Task 11: Nav bedž (Sidebar prop + layout fetch)

Registruj nav stavku i dodaj crveni bedž neriješenih grešaka (RLS-skopiran po korisniku).

**Files:**
- Modify: `components/shell/Sidebar.tsx` (NAV_ITEMS + prop `mejlGreske` + pill u renderItem)
- Modify: `app/(dashboard)/layout.tsx` (fetch brojača + prop)

**Interfaces:**
- Consumes: RPC `get_mejl_greske_broj`; i18n `shell.nav.poslatiMejlovi`; `createServerSupabaseClient`.
- Produces: nav stavka `/poslati-mejlovi` + bedž.

- [ ] **Step 1: Registruj nav stavku + primi prop + prikaži pill**

U `components/shell/Sidebar.tsx`:
1. Import `Mail` iz `lucide-react`.
2. U `NAV_ITEMS` dodaj (npr. poslije `klijenti`): `{ href: href("/poslati-mejlovi"), labelKey: "poslatiMejlovi", icon: Mail },`
3. Promijeni potpis: `export function Sidebar({ mejlGreske = 0 }: { mejlGreske?: number })`.
4. U `renderItem`, poslije `<span>{label}</span>`, dodaj crveni pill samo za tu stavku kad ima grešaka:

```tsx
{href === hrefFn("/poslati-mejlovi") && mejlGreske > 0 && !collapsed && (
  <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-xs font-medium text-white">
    {mejlGreske}
  </span>
)}
```

Gdje je `hrefFn` postojeći `href` helper (isti koji se koristi u `NAV_ITEMS`). Pošto se `href` unutar `renderItem` parametar zove `href`, referiši modulski helper pod njegovim import imenom (npr. `href` iz `@/i18n/routes` je vjerovatno shadow-ovan — preimenuj parametar destrukture u `{ href: itemHref, ... }` i koristi `itemHref === href("/poslati-mejlovi")`). Uskladi sa stvarnim importom u fajlu.

- [ ] **Step 2: Fetch brojača u layoutu i proslijedi**

U `app/(dashboard)/layout.tsx`, poslije `const korisnik = await getTrenutniKorisnik()`:

```tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"
// ...
const supabase = await createServerSupabaseClient()
const { data: mejlGreske } = await supabase.rpc("get_mejl_greske_broj")
// ...
<Sidebar mejlGreske={mejlGreske ?? 0} />
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: bez grešaka.

- [ ] **Step 4: Vizuelna provjera (opciono, brzo)**

Run: `pnpm dev` (koristi `--webpack`), otvori `/poslati-mejlovi`, potvrdi da se stavka i (ako ima grešaka u DEMO) bedž prikažu. Zaustavi dev server.

- [ ] **Step 5: Commit**

```bash
git add components/shell/Sidebar.tsx "app/(dashboard)/layout.tsx"
git commit -m "feat(mejl-log): nav stavka + bedž neriješenih grešaka"
```

---

## Task 12: E2E `32-poslati-mejlovi` + cleanup grana

End-to-end na DEMO: admin vidi sve (uklj. bez firme, crveni red), klik na bedž filtrira, „označi pregledanim" smanjuje bedž; običan korisnik vidi samo svoje. Relativne asertacije (DEMO je dijeljen, Resend uživo).

**Files:**
- Create: `tests/e2e/32-poslati-mejlovi.spec.ts`
- Modify: `scripts/cleanup-test-data.ts` (dodaj `mejl_log` granu po marker-regexu)

**Interfaces:**
- Consumes: `tests/e2e/db.ts` (service-role, DEMO-first env), `auth.setup.ts` storageState, RPC/tabela `mejl_log`.
- Produces: E2E pokrivenost + teardown.

- [ ] **Step 1: Dodaj cleanup granu (sigurnosna mreža)**

U `scripts/cleanup-test-data.ts`, po uzoru na postojeće `JUNK_*` regex grane, dodaj:

```ts
const JUNK_MEJL = /^\[E2E\] /
// ... u glavnoj cleanup rutini (service-role klijent):
await supabase.from("mejl_log").delete().like("subject", "[E2E] %")
```

(Uskladi sintaksu sa postojećim granama u fajlu — isti klijent, isti obrazac brisanja.)

- [ ] **Step 2: Napiši E2E spec (relativne asertacije)**

Create `tests/e2e/32-poslati-mejlovi.spec.ts` — obrazac iz `18-auth-rls.spec.ts` / `30-aktivnost.spec.ts`. Seed-uj redove **service-role** klijentom (`tests/e2e/db.ts`) sa jedinstvenim `subject` prefiksom `"[E2E] "` + nasumični sufiks, **hvataj vraćene id-jeve**, i:

```ts
import { test, expect } from "@playwright/test"
import { getDb } from "./db" // service-role, DEMO-first (uskladi sa stvarnim exportom u db.ts)

const MARK = `[E2E] ${Date.now()}-${Math.random().toString(36).slice(2)}`
let seededIds: string[] = []

test.afterAll(async () => {
  const db = await getDb()
  if (seededIds.length) await db.from("mejl_log").delete().in("id", seededIds)
})

test("admin vidi dnevnik: greška je crvena, bedž filtrira, pregled smanjuje", async ({ page }) => {
  const db = await getDb()
  // seed 1 greška bez firme (test tip) — vidljiva adminu
  const { data } = await db.from("mejl_log").insert({
    tip: "test", primaoci: ["a@x.com"], subject: `${MARK} greska`, status: "greska_slanja", greska: "boom",
  }).select("id")
  seededIds.push(...(data ?? []).map((r) => r.id))

  await page.goto("/poslati-mejlovi")
  const red = page.getByText(`${MARK} greska`)
  await expect(red).toBeVisible()
  // klik na "Označi pregledanim" u tom redu → nestane iz filtra neriješenih
  await page.goto("/poslati-mejlovi?samo_greske=1&nepregledano=1")
  await expect(page.getByText(`${MARK} greska`)).toBeVisible()
  await page.getByRole("row", { name: new RegExp(MARK) }).getByRole("button", { name: /Označi/ }).click()
  await expect(page.getByText(`${MARK} greska`)).toHaveCount(0)
})
```

Dodaj i scenario za **običnog dodijeljenog korisnika** (drugi storageState/projekat ako postoji u setup-u): vidi samo red svoje firme; ne vidi `test` (bez firme) red. Ako E2E setup nema ne-admin korisnika, dokumentuj to i pokrij ne-admin scoping integ-testom iz Task 4 (već pokriven) + ostavi admin E2E.

- [ ] **Step 3: Pokreni E2E**

Run: `pnpm exec playwright test tests/e2e/32-poslati-mejlovi.spec.ts`
Expected: PASS (chromium + webkit). Ako padne na selektorima, uskladi role/name lokatore sa stvarnim renderom tabele (Task 10).

- [ ] **Step 4: Očisti test podatke**

Run: `pnpm cleanup:test-data`
Expected: uklanja zaostale `[E2E] %` redove iz `mejl_log`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/32-poslati-mejlovi.spec.ts scripts/cleanup-test-data.ts
git commit -m "test(mejl-log): E2E dnevnik + bedž + pregled; cleanup grana za mejl_log"
```

---

## Task 13: Cloud migracija (DEMO → PROD lockstep) + Resend webhook konfiguracija

Primijeni migraciju na obje cloud baze i konfiguriši Resend webhook + Vercel env. **Ovo dira produkciju — radi tek kad je grana spremna za merge; korisnik pokreće/odobrava cloud apply i deploy.**

**Files:** (bez izmjena u repo — operativni koraci)

- [ ] **Step 1: Apply na DEMO**

Run (DEMO ref-guard): `pnpm db:apply-cloud supabase/migrations/20260713120000_mejl_log.sql` sa `DATABASE_URL` postavljenim na DEMO (`mtwwotmwrasozmcgqwhc`).
Expected: migracija prolazi; provjeri `mejl_log` + enume + RPC-ove na DEMO.

- [ ] **Step 2: Apply na PROD**

Ref-guard PROD (`fqtqkehjidkzeasiegnq`), zatim `pnpm db:apply-cloud supabase/migrations/20260713120000_mejl_log.sql`.
Expected: identična shema kao DEMO (lockstep).

- [ ] **Step 3: Resend webhook + Vercel env (po okruženju)**

- U Resend dashboardu kreiraj webhook endpoint po deploy domenu: `https://<domen>/api/webhooks/resend`.
- Pretplati se na: `email.delivered`, `email.bounced`, `email.complained`, `email.failed` (obavezno). `email.opened` opciono/isključeno; `email.delivery_delayed` NE.
- Kopiraj `whsec_…` svakog endpointa u `RESEND_WEBHOOK_SECRET` odgovarajućeg Vercel projekta (imena invertovana od uloge!). Ne dijeli tajnu između okruženja.

- [ ] **Step 4: Verifikacija uživo (po deployu)**

Pošalji test-mejl iz Postavki → provjeri `mejl_log` red (`tip='test'`) i, nakon Resend dostave, `delivery_status='delivered'` (webhook radi). Provjeri da neautentifikovan POST na `/api/webhooks/resend` bez potpisa vraća 401.

---

## Napomene o zavisnostima između taskova

- Task 1→4 grade **jedan** migracioni fajl inkrementalno; svaki `pnpm db:reset` reapl-uje cijeli fajl. `db:types` se pokreće tek na kraju Task 4.
- Task 5 (wrapper) zavisi od `db/types.ts` iz Task 4 (enum `mejl_tip`, rpc `zabiljezi_mejl_log`).
- Task 6 zavisi od Task 5. Task 8 zavisi od Task 7 + Task 4 (rpc `azuriraj_mejl_dostavu`).
- Task 9 (i18n) mora prethoditi Task 10/11 (next-intl tsc).
- Task 10 zavisi od Task 4 (view/rpc) + Task 9. Task 11 zavisi od Task 4 (bedž rpc) + Task 9.
- Task 12 zavisi od Task 10/11. Task 13 (cloud) je zadnji, ručno odobren.
