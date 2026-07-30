# Uloge i ovlaštenja — dovršetak modela — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gaps between the client-confirmed permission model (30.07.2026.) and the shipped one: per-korisnik delete switches for `operater`, a hard ban on downloading/exporting for `pregled`, and a gate that stops an activity being closed as `izvrseno` without an attached nalaz.

**Architecture:** Four boolean columns on `korisnici` carry the switches; `admin` implicitly has all of them and `pregled` implicitly none, so the columns are only ever consulted for `operater`. „Own vs. someone else's entry" needs record ownership, which the schema does not have yet — a new `kreirao_id` column on the five deletable tables, defaulted from `auth.uid()` by a trigger and backfilled from the existing `audit_log` INSERT rows. Enforcement is authoritative in Postgres (RLS delete policies + a BEFORE UPDATE trigger); the app layer only adds friendly messages and hides dead controls. The `pregled` download ban cannot live in storage RLS because document I/O runs through the service-role client — it goes in the three request-path routes.

**Tech Stack:** Next.js 16 App Router (`proxy.ts`, Server Actions), Supabase/Postgres (SQL migrations, RLS, `security definer` helpers), `@supabase/supabase-js`, Vitest (unit + `pg` integration gated on `TEST_DATABASE_URL`), Playwright, next-intl, pnpm.

## Global Constraints

- Domain language is Bosnian/Serbian (latinica) — table names, columns, identifiers, comments, and UI strings all match existing style.
- Package manager is **`pnpm`**. `pnpm dev` is `next dev --webpack` — never plain `next dev` (Turbopack panics on the space in the project path).
- Backend testing goes through the **local Docker Supabase stack** (`supabase start`), never a live cloud DB. `pnpm db:reset` reapplies migrations locally.
- The agent does **not** apply migrations to cloud. DEMO then PROD is a separate, user-run step: `pnpm db:apply-cloud --demo <file>`, then `POTVRDI_PROD=da pnpm db:apply-cloud --prod <file>`.
- `db/types.ts` is auto-generated — never hand-edit. Run `pnpm db:types` after each migration is applied to the local stack.
- **No dummy/mock data.** The `kreirao_id` backfill reads real authorship out of `audit_log`; rows with no audit trace stay `null` (treated as „not mine").
- **Never use the admin/service-role client in the `app/` or `components/` request path.** Routes use `createServerSupabaseClient()`.
- next-intl type-checks namespaces/keys against the literal JSON union — every new key must land in **all three** of `messages/{sr,en,de}.json` in the same change that uses it. Do **not** use the ICU `one` plural category for `sr`.
- No `sm:` / `md:` Tailwind breakpoints (lint error) — desktop-only; use `lg:`/`xl:`/`2xl:`.
- `pregled` gating in the UI is a convenience layer **on top of** RLS/route guards, never the only check. Hide the write/export control, never the read view. `if (!x) return null` goes **after** all hook calls.
- Migration timestamps start at `20260730150000` so they sort after the unmerged `20260730120000` (PR #80) regardless of merge order.

**Base branch:** `worktree-uloge-ovlastenja`, cut from `origin/main` at `ab791c7` (PR #78). PR #79 and #80 are not in this tree; no file overlap is expected.

**Confirmed spec (client, 30.07.2026.):**
- More than one `admin`; every admin may assign roles and firms. Admin has all firms by default, deletes everything, is the only one who reads `audit_log`, changes periodics, reminder settings and templates.
- `operater` sees and edits **only assigned firms** — the central plan is filtered down to them. Deletes only what the admin has switched on.
- `pregled` is literally read-only: no writes, **no downloads, no exports**.
- The four operater switches: delete own entries / delete other people's entries on own firms / delete klijent, ugovor, lokacija / close an activity as `izvrseno` with no nalaz attached.

**Already shipped — do not rebuild:** `korisnik_uloga` enum, `korisnik_klijent` assignment, `ima_pristup_klijentu()` / `je_admin()` / `je_pregled()`, RLS across the client-scoped tables, `audit_log` (admin-read only), the admin UI actions `postaviUlogu` / `postaviAktivan` / `postaviDodjele` / `kreirajKorisnika` with last-admin and self-demotion guards.

---

### Task 1: Vlasništvo zapisa (`kreirao_id`)

Adds the ownership column the „own vs. other people's entries" switch needs. No behaviour change yet — the column is written and backfilled, nothing reads it until Task 2.

**Files:**
- Create: `supabase/migrations/20260730150000_kreirao_id.sql`
- Create: `lib/auth/kreiraoId.integration.test.ts`
- Modify: `db/types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: column `kreirao_id uuid references korisnici(id) on delete set null` on `klijenti`, `lokacije`, `ugovori`, `termini`, `dokumenti`; trigger function `tg_postavi_kreirao()` firing BEFORE INSERT on each of those five tables.

- [ ] **Step 1: Write the failing integration test**

Create `lib/auth/kreiraoId.integration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/auth/kreiraoId.integration.test.ts`
Expected: FAIL with `column "kreirao_id" of relation "klijenti" does not exist`.

(If every test reports as skipped, the local stack is not up — run `supabase start` first.)

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260730150000_kreirao_id.sql`:

```sql
-- Vlasništvo zapisa (2026-07-30): ko je unio red.
-- Potrebno za potvrđenu dozvolu "operater briše SVOJE unose" vs "TUĐE unose" (20260730151000).
-- Nullable je namjerno: service-role putevi (cron, seed, import) nemaju auth.uid(), a stari
-- redovi bez audit traga ostaju null → tretiraju se kao "nije moje" (restriktivnije).
-- Re-run safe.

alter table klijenti  add column if not exists kreirao_id uuid references korisnici(id) on delete set null;
alter table lokacije  add column if not exists kreirao_id uuid references korisnici(id) on delete set null;
alter table ugovori   add column if not exists kreirao_id uuid references korisnici(id) on delete set null;
alter table termini   add column if not exists kreirao_id uuid references korisnici(id) on delete set null;
alter table dokumenti add column if not exists kreirao_id uuid references korisnici(id) on delete set null;

create index if not exists idx_klijenti_kreirao  on klijenti  (kreirao_id);
create index if not exists idx_lokacije_kreirao  on lokacije  (kreirao_id);
create index if not exists idx_ugovori_kreirao   on ugovori   (kreirao_id);
create index if not exists idx_termini_kreirao   on termini   (kreirao_id);
create index if not exists idx_dokumenti_kreirao on dokumenti (kreirao_id);

-- security definer: čita korisnici (RLS self-select) da FK ne padne za nepostojeći profil.
create or replace function tg_postavi_kreirao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.kreirao_id is null and auth.uid() is not null
     and exists (select 1 from korisnici k where k.id = auth.uid()) then
    NEW.kreirao_id := auth.uid();
  end if;
  return NEW;
end; $$;

drop trigger if exists postavi_kreirao on klijenti;
create trigger postavi_kreirao before insert on klijenti
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on lokacije;
create trigger postavi_kreirao before insert on lokacije
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on ugovori;
create trigger postavi_kreirao before insert on ugovori
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on termini;
create trigger postavi_kreirao before insert on termini
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on dokumenti;
create trigger postavi_kreirao before insert on dokumenti
  for each row execute function tg_postavi_kreirao();

-- ── Backfill iz audit_log ────────────────────────────────────────────────────
-- tg_audit() upisuje (korisnik_id, akcija=TG_OP, entitet=TG_TABLE_NAME, entitet_id=id::text).
-- Uzimamo NAJSTARIJI INSERT red po entitetu = stvarni autor. Bez izmišljanja podataka:
-- redovi bez audit traga (predaudit, seed, import) ostaju null.
update klijenti t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'klijenti' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;

update lokacije t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'lokacije' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;

update ugovori t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'ugovori' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;

update termini t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'termini' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;

update dokumenti t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'dokumenti' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm db:reset && TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/auth/kreiraoId.integration.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Regenerate types and typecheck**

Run: `pnpm db:types && pnpm typecheck`
Expected: `db/types.ts` now carries `kreirao_id` on the five tables; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260730150000_kreirao_id.sql lib/auth/kreiraoId.integration.test.ts db/types.ts
git commit -m "feat(db): kreirao_id na klijenti/lokacije/ugovori/termini/dokumenti + backfill iz audit_log"
```

---

### Task 2: Dozvole po korisniku + RLS brisanja

Adds the four switches and makes them authoritative for DELETE. Admin bypasses all four; `pregled` is refused by all four.

**Files:**
- Create: `supabase/migrations/20260730151000_dozvole_brisanja.sql`
- Create: `lib/auth/dozvole.ts`
- Create: `lib/auth/dozvole.test.ts`
- Create: `lib/auth/dozvoleRls.integration.test.ts`
- Modify: `db/types.ts` (regenerated)

**Interfaces:**
- Consumes: `kreirao_id` (Task 1).
- Produces:
  - Columns on `korisnici`: `smije_brisati_svoje boolean not null default true`, `smije_brisati_tudje boolean not null default false`, `smije_brisati_klijente boolean not null default false`, `smije_zatvoriti_bez_nalaza boolean not null default false`.
  - Postgres helpers `smije_brisati_zapis(p_kreirao uuid) returns boolean`, `smije_brisati_klijente() returns boolean`, `smije_zatvoriti_bez_nalaza() returns boolean`.
  - TS mirror `lib/auth/dozvole.ts`: `export type Dozvole = { smije_brisati_svoje: boolean; smije_brisati_tudje: boolean; smije_brisati_klijente: boolean; smije_zatvoriti_bez_nalaza: boolean }`, `export const PRAZNE_DOZVOLE: Dozvole`, `export function efektivneDozvole(uloga: Uloga, d: Dozvole): Dozvole`.

- [ ] **Step 1: Write the failing unit test for the TS mirror**

Create `lib/auth/dozvole.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { efektivneDozvole, PRAZNE_DOZVOLE, type Dozvole } from "./dozvole"

const SVE: Dozvole = {
  smije_brisati_svoje: true,
  smije_brisati_tudje: true,
  smije_brisati_klijente: true,
  smije_zatvoriti_bez_nalaza: true,
}

describe("efektivneDozvole", () => {
  it("admin ima sve bez obzira na kolone", () => {
    expect(efektivneDozvole("admin", PRAZNE_DOZVOLE)).toEqual(SVE)
  })

  it("pregled nema nijednu bez obzira na kolone", () => {
    expect(efektivneDozvole("pregled", SVE)).toEqual(PRAZNE_DOZVOLE)
  })

  it("operater dobija tačno ono što je upisano", () => {
    const d: Dozvole = { ...PRAZNE_DOZVOLE, smije_brisati_svoje: true }
    expect(efektivneDozvole("operater", d)).toEqual(d)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/auth/dozvole.test.ts`
Expected: FAIL — `Failed to resolve import "./dozvole"`.

- [ ] **Step 3: Write the TS mirror**

Create `lib/auth/dozvole.ts`:

```ts
import type { Uloga } from "./roles"

/**
 * Četiri prekidača koje admin pali/gasi po operateru (potvrđeno 30.07.2026.).
 * Izvor istine je Postgres (RLS + trigeri) — ovo je ogledalo za UI i poruke.
 */
export type Dozvole = {
  /** briše redove koje je sam unio */
  smije_brisati_svoje: boolean
  /** briše tuđe redove na firmama koje su mu dodijeljene */
  smije_brisati_tudje: boolean
  /** briše klijenta, ugovor i lokaciju */
  smije_brisati_klijente: boolean
  /** označava aktivnost kao izvršenu bez priloženog nalaza */
  smije_zatvoriti_bez_nalaza: boolean
}

export const PRAZNE_DOZVOLE: Dozvole = {
  smije_brisati_svoje: false,
  smije_brisati_tudje: false,
  smije_brisati_klijente: false,
  smije_zatvoriti_bez_nalaza: false,
}

const SVE_DOZVOLE: Dozvole = {
  smije_brisati_svoje: true,
  smije_brisati_tudje: true,
  smije_brisati_klijente: true,
  smije_zatvoriti_bez_nalaza: true,
}

/** admin → sve; pregled → ništa; operater → kolone kakve jesu. */
export function efektivneDozvole(uloga: Uloga, d: Dozvole): Dozvole {
  if (uloga === "admin") return SVE_DOZVOLE
  if (uloga === "pregled") return PRAZNE_DOZVOLE
  return {
    smije_brisati_svoje: d.smije_brisati_svoje,
    smije_brisati_tudje: d.smije_brisati_tudje,
    smije_brisati_klijente: d.smije_brisati_klijente,
    smije_zatvoriti_bez_nalaza: d.smije_zatvoriti_bez_nalaza,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/auth/dozvole.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing RLS integration test**

Create `lib/auth/dozvoleRls.integration.test.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/auth/dozvoleRls.integration.test.ts`
Expected: FAIL with `column "smije_brisati_svoje" of relation "korisnici" does not exist`.

- [ ] **Step 7: Write the migration**

Create `supabase/migrations/20260730151000_dozvole_brisanja.sql`:

```sql
-- Dozvole brisanja po korisniku (potvrđeno sa naručiocem 30.07.2026.).
-- admin: sve, uvijek (prekidači se ne konsultuju).  pregled: ništa, uvijek.
-- operater: po prekidačima, i UVIJEK ograničen na dodijeljene firme (ima_pristup_klijentu).
-- Defaults su namjerno restriktivni osim `svoje` — operater smije ispraviti vlastitu grešku
-- bez posebnog odobrenja; sve ostalo admin pali svjesno.
-- Re-run safe.

alter table korisnici
  add column if not exists smije_brisati_svoje        boolean not null default true,
  add column if not exists smije_brisati_tudje        boolean not null default false,
  add column if not exists smije_brisati_klijente     boolean not null default false,
  add column if not exists smije_zatvoriti_bez_nalaza boolean not null default false;

comment on column korisnici.smije_brisati_svoje is 'Operater briše redove koje je sam unio (kreirao_id = auth.uid()).';
comment on column korisnici.smije_brisati_tudje is 'Operater briše tuđe redove na dodijeljenim firmama.';
comment on column korisnici.smije_brisati_klijente is 'Operater briše klijenta, ugovor i lokaciju.';
comment on column korisnici.smije_zatvoriti_bez_nalaza is 'Operater zatvara aktivnost kao izvršenu bez priloženog nalaza.';

-- ── Helperi ──────────────────────────────────────────────────────────────────
-- security definer: čitaju korisnici, koji ima self-select RLS.
create or replace function smije_brisati_zapis(p_kreirao uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when je_admin() then true
    when je_pregled() then false
    else exists (
      select 1 from korisnici k
      where k.id = auth.uid() and k.aktivan
        and case when p_kreirao is not distinct from auth.uid()
                 then k.smije_brisati_svoje
                 else k.smije_brisati_tudje end)
  end;
$$;

create or replace function smije_brisati_klijente() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when je_admin() then true
    when je_pregled() then false
    else exists (select 1 from korisnici k
                 where k.id = auth.uid() and k.aktivan and k.smije_brisati_klijente)
  end;
$$;

create or replace function smije_zatvoriti_bez_nalaza() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when je_admin() then true
    when je_pregled() then false
    else exists (select 1 from korisnici k
                 where k.id = auth.uid() and k.aktivan and k.smije_zatvoriti_bez_nalaza)
  end;
$$;

-- ── DELETE politike ──────────────────────────────────────────────────────────
-- termini/lokacije/ugovori/kontakt_osobe/klijent_provjere su do sada imali `for all`
-- politiku koja je pokrivala i DELETE. Razbijamo je na ins/upd (nepromijenjena semantika)
-- + zaseban del (novi uslov). Isti obrazac koji je 20260703100000 primijenio na dokumenti.

-- termini
drop policy if exists termini_wr on termini;
drop policy if exists termini_ins on termini;
drop policy if exists termini_upd on termini;
drop policy if exists termini_del on termini;
create policy termini_ins on termini for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy termini_upd on termini for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy termini_del on termini for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_zapis(kreirao_id) );

-- lokacije (dio "klijent, ugovor i lokacija" prekidača)
drop policy if exists lokacije_wr on lokacije;
drop policy if exists lokacije_ins on lokacije;
drop policy if exists lokacije_upd on lokacije;
drop policy if exists lokacije_del on lokacije;
create policy lokacije_ins on lokacije for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy lokacije_upd on lokacije for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy lokacije_del on lokacije for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );

-- ugovori (dio istog prekidača)
drop policy if exists ugovori_wr on ugovori;
drop policy if exists ugovori_ins on ugovori;
drop policy if exists ugovori_upd on ugovori;
drop policy if exists ugovori_del on ugovori;
create policy ugovori_ins on ugovori for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy ugovori_upd on ugovori for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy ugovori_del on ugovori for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );

-- klijenti
drop policy if exists klijenti_del on klijenti;
create policy klijenti_del on klijenti for delete
  using ( ima_pristup_klijentu(id) and smije_brisati_klijente() );

-- kontakt_osobe: vezane za klijenta, prate isti prekidač
drop policy if exists kontakt_wr on kontakt_osobe;
drop policy if exists kontakt_ins on kontakt_osobe;
drop policy if exists kontakt_upd on kontakt_osobe;
drop policy if exists kontakt_del on kontakt_osobe;
create policy kontakt_ins on kontakt_osobe for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy kontakt_upd on kontakt_osobe for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy kontakt_del on kontakt_osobe for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );

-- klijent_provjere: veza klijent↔usluga, nije "zapis" ni "klijent" — prati brisanje zapisa
-- po vlasništvu bi tražilo kreirao_id i na njoj; drži se prekidača za klijente (uža kapija).
drop policy if exists kp_wr on klijent_provjere;
drop policy if exists kp_ins on klijent_provjere;
drop policy if exists kp_upd on klijent_provjere;
drop policy if exists kp_del on klijent_provjere;
create policy kp_ins on klijent_provjere for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy kp_upd on klijent_provjere for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
create policy kp_del on klijent_provjere for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );

-- dokumenti: 20260703100000 je DELETE svela na je_admin(). Naručilac je 30.07.2026. potvrdio
-- da operater smije brisati po prekidačima → proširujemo na isti helper (admin i dalje prolazi).
drop policy if exists dokumenti_del on dokumenti;
create policy dokumenti_del on dokumenti for delete
  using ( ima_pristup_klijentu(klijent_id) and smije_brisati_zapis(kreirao_id) );
```

- [ ] **Step 8: Apply locally and run both tests**

Run: `pnpm db:reset && TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/auth/`
Expected: PASS — 3 (`kreiraoId`) + 3 (`dozvole`) + 7 (`dozvoleRls`) + the existing `roles`/`lozinka` tests.

- [ ] **Step 9: Regenerate types, lint, typecheck**

Run: `pnpm db:types && pnpm lint && pnpm typecheck`
Expected: all clean; `korisnici` Row in `db/types.ts` carries the four booleans.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260730151000_dozvole_brisanja.sql lib/auth/dozvole.ts lib/auth/dozvole.test.ts lib/auth/dozvoleRls.integration.test.ts db/types.ts
git commit -m "feat(auth): četiri prekidača dozvola po korisniku + RLS delete politike"
```

---

### Task 3: Gate za zatvaranje aktivnosti bez nalaza

`markIzvrseno` currently sets `status = 'izvrseno'` with no check that a nalaz is attached. The gate is a BEFORE UPDATE trigger (authoritative, catches every path) plus a friendly message in the action.

**Files:**
- Create: `supabase/migrations/20260730152000_zatvaranje_bez_nalaza.sql`
- Create: `lib/auth/zatvaranjeGate.integration.test.ts`
- Modify: `app/(dashboard)/termini/actions.ts` (`markIzvrseno`, around line 206)
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `smije_zatvoriti_bez_nalaza()` (Task 2).
- Produces: trigger function `tg_zatvaranje_trazi_nalaz()` on `termini`; raises `SQLSTATE '23514'` with message `nalaz_obavezan` when refused. `markIzvrseno` maps that to the i18n string `termini.nalazObavezan`.

- [ ] **Step 1: Write the failing integration test**

Create `lib/auth/zatvaranjeGate.integration.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/auth/zatvaranjeGate.integration.test.ts`
Expected: FAIL — the first test resolves instead of rejecting (no gate yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260730152000_zatvaranje_bez_nalaza.sql`:

```sql
-- Zatvaranje aktivnosti bez nalaza (potvrđeno 30.07.2026.).
-- Aktivnost se smije označiti kao izvršena bez ijednog priloženog dokumenta samo ako je
-- korisnik admin ili operater sa smije_zatvoriti_bez_nalaza.
-- Trigger, ne CHECK constraint: uslov zavisi od auth.uid() (nije immutable) i od druge tabele.
-- Re-run safe.

create or replace function tg_zatvaranje_trazi_nalaz() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Zanima nas samo PRELAZAK u 'izvrseno'. Update-i unutar istog statusa prolaze.
  if NEW.status is distinct from 'izvrseno' or OLD.status = 'izvrseno' then
    return NEW;
  end if;
  -- Service-role putevi (cron, seed, import) nemaju auth.uid() → ne diramo ih.
  if auth.uid() is null then
    return NEW;
  end if;
  if smije_zatvoriti_bez_nalaza() then
    return NEW;
  end if;
  if not exists (select 1 from dokumenti d where d.termin_id = NEW.id) then
    raise exception 'nalaz_obavezan' using errcode = '23514';
  end if;
  return NEW;
end; $$;

drop trigger if exists zatvaranje_trazi_nalaz on termini;
create trigger zatvaranje_trazi_nalaz before update on termini
  for each row execute function tg_zatvaranje_trazi_nalaz();
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm db:reset && TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/auth/zatvaranjeGate.integration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the i18n key to all three catalogs**

In `messages/sr.json`, under the `termini` namespace, add:

```json
"nalazObavezan": "Aktivnost se ne može zatvoriti bez priloženog nalaza. Priložite dokument ili tražite dozvolu od administratora."
```

In `messages/en.json`, same namespace:

```json
"nalazObavezan": "The activity cannot be closed without an attached report. Attach a document or ask an administrator for permission."
```

In `messages/de.json`, same namespace:

```json
"nalazObavezan": "Die Aktivität kann ohne beigefügten Bericht nicht abgeschlossen werden. Fügen Sie ein Dokument bei oder bitten Sie einen Administrator um die Berechtigung."
```

- [ ] **Step 6: Map the DB error in `markIzvrseno`**

In `app/(dashboard)/termini/actions.ts`, replace the error branch of `markIzvrseno`:

```ts
  if (error) return { ok: false, message: friendlyDbError(error) }
```

with:

```ts
  if (error) {
    // tg_zatvaranje_trazi_nalaz (20260730152000) diže 23514 sa porukom `nalaz_obavezan`.
    if (error.message.includes("nalaz_obavezan")) {
      return { ok: false, message: t("nalazObavezan") }
    }
    return { ok: false, message: friendlyDbError(error) }
  }
```

- [ ] **Step 7: Verify the whole unit suite, lint and typecheck**

Run: `pnpm test:unit && pnpm lint && pnpm typecheck`
Expected: all pass. (`pnpm test:unit` without `TEST_DATABASE_URL` skips the integration files by design.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260730152000_zatvaranje_bez_nalaza.sql lib/auth/zatvaranjeGate.integration.test.ts "app/(dashboard)/termini/actions.ts" messages/sr.json messages/en.json messages/de.json
git commit -m "feat(termini): zabrani zatvaranje aktivnosti bez nalaza osim uz dozvolu"
```

---

### Task 4: `pregled` bez preuzimanja i izvoza

Storage RLS cannot carry this — `lib/supabase/storage.ts` signs URLs with the service-role client, so the policies added in `20260703100000` never fire on the app path. The ban goes in the three request-path routes, plus the buttons get hidden.

**Assumption (stated for the reviewer):** on-screen preview (`/api/dokumenti/[id]/pregled`) stays open to `pregled` — that is reading, which the role is for. Only the download endpoint and the plan export are blocked. Residual gap: the preview route hands the browser a signed URL for PDFs/images, so a determined `pregled` user can still save that file from the viewer. Closing that would mean proxying preview bytes through the app; out of scope here, flagged in the ADR step.

**Files:**
- Modify: `lib/auth/roles.ts`
- Modify: `lib/auth/roles.test.ts`
- Modify: `app/api/dokumenti/[id]/route.ts`
- Modify: `app/api/plan-aktivnosti/izvoz/route.ts`
- Modify: `providers/korisnik-provider.tsx`
- Modify: `components/domain/PreuzmiDokumentButton.tsx`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`
- Create: `docs/adr/2026-07-30-pregled-bez-preuzimanja.md`

**Interfaces:**
- Produces: `export function smijePreuzeti(uloga: Uloga): boolean` in `lib/auth/roles.ts`; `export function useSmijePreuzeti(): boolean` in `providers/korisnik-provider.tsx`. Both routes return `403` with `{ error: <i18n string> }` — the same envelope the routes already use.

- [ ] **Step 1: Write the failing unit test**

Append to `lib/auth/roles.test.ts`:

```ts
describe("smijePreuzeti", () => {
  it("admin i operater smiju preuzimati i izvoziti", () => {
    expect(smijePreuzeti("admin")).toBe(true)
    expect(smijePreuzeti("operater")).toBe(true)
  })

  it("pregled ne smije — uloga je čisto čitanje na ekranu", () => {
    expect(smijePreuzeti("pregled")).toBe(false)
  })
})
```

Add `smijePreuzeti` to the existing import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/auth/roles.test.ts`
Expected: FAIL — `smijePreuzeti is not a function`.

- [ ] **Step 3: Implement the helper**

Append to `lib/auth/roles.ts`:

```ts
/**
 * Smije li uloga iznositi podatke iz sistema (preuzimanje dokumenta, izvoz plana)?
 * Naručilac je 30.07.2026. potvrdio da `pregled` smije SAMO čitati na ekranu.
 * Odvojeno od `mozeUrediti` namjerno — to je pitanje pisanja, ovo je pitanje iznošenja.
 */
export function smijePreuzeti(uloga: Uloga): boolean {
  return uloga !== "pregled"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/auth/roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Guard the download route**

In `app/api/dokumenti/[id]/route.ts`, add the imports:

```ts
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { smijePreuzeti } from "@/lib/auth/roles"
```

and insert at the top of the `GET` body, before `const supabase = ...`:

```ts
  // `pregled` je čisto čitanje na ekranu — bez iznošenja fajlova (potvrđeno 30.07.2026.).
  const ja = await getTrenutniKorisnik()
  if (!ja || !smijePreuzeti(ja.uloga)) {
    return NextResponse.json({ error: t("preuzimanjeNijeDozvoljeno") }, { status: 403 })
  }
```

- [ ] **Step 6: Guard the export route**

In `app/api/plan-aktivnosti/izvoz/route.ts`, add the imports:

```ts
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { smijePreuzeti } from "@/lib/auth/roles"
```

and insert in `GET`, immediately after the `parsed.ok` check:

```ts
  const ja = await getTrenutniKorisnik()
  if (!ja || !smijePreuzeti(ja.uloga)) {
    return NextResponse.json({ error: tCommon("izvozNijeDozvoljen") }, { status: 403 })
  }
```

- [ ] **Step 7: Add the i18n keys to all three catalogs**

`messages/sr.json` — under `dokumenti`: `"preuzimanjeNijeDozvoljeno": "Vaša uloga nema pravo preuzimanja dokumenata."`; under `common`: `"izvozNijeDozvoljen": "Vaša uloga nema pravo izvoza podataka."`

`messages/en.json` — under `dokumenti`: `"preuzimanjeNijeDozvoljeno": "Your role is not allowed to download documents."`; under `common`: `"izvozNijeDozvoljen": "Your role is not allowed to export data."`

`messages/de.json` — under `dokumenti`: `"preuzimanjeNijeDozvoljeno": "Ihre Rolle darf keine Dokumente herunterladen."`; under `common`: `"izvozNijeDozvoljen": "Ihre Rolle darf keine Daten exportieren."`

- [ ] **Step 8: Expose the hook and hide the buttons**

Append to `providers/korisnik-provider.tsx`:

```ts
/** true ako tekuća uloga smije preuzimati/izvoziti; null/pregled → false. */
export function useSmijePreuzeti(): boolean {
  const u = useUloga()
  return u ? smijePreuzeti(u) : false
}
```

and extend the existing import to `import { mozeUrediti, smijePreuzeti } from "@/lib/auth/roles"`.

In `components/domain/PreuzmiDokumentButton.tsx`, call `useSmijePreuzeti()` with the other hooks and return `null` when it is false — **placed after every hook call** (Rules of Hooks). Then run

```bash
grep -rn "plan-aktivnosti/izvoz" components app --include=*.tsx
```

and apply the same gate to each component that triggers the export, hiding only the export control, never the surrounding read view.

- [ ] **Step 9: Write the ADR**

Create `docs/adr/2026-07-30-pregled-bez-preuzimanja.md` recording: why the ban lives in the routes and not in storage RLS (service-role I/O bypasses the policies); that on-screen preview stays allowed; and the residual gap that a previewed PDF's signed URL can still be saved from the browser viewer, with proxying preview bytes named as the fix if the client wants it closed.

- [ ] **Step 10: Lint, typecheck, unit suite**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add lib/auth/roles.ts lib/auth/roles.test.ts "app/api/dokumenti/[id]/route.ts" app/api/plan-aktivnosti/izvoz/route.ts providers/korisnik-provider.tsx components/domain/ messages/ docs/adr/2026-07-30-pregled-bez-preuzimanja.md
git commit -m "feat(auth): pregled ne smije preuzimati dokumente ni izvoziti plan"
```

---

### Task 5: Admin UI za prekidače dozvola

Four switches per user in the existing `KorisniciTab`, saved by one new admin-only server action.

**Files:**
- Modify: `app/(dashboard)/postavke/actions.ts`
- Modify: `components/domain/KorisniciTab.tsx`
- Create: `components/domain/DozvoleKorisnika.tsx`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `Dozvole` and `efektivneDozvole` from `lib/auth/dozvole.ts` (Task 2).
- Produces: `export async function postaviDozvolu(korisnikId: string, kljuc: keyof Dozvole, vrijednost: boolean): Promise<ActionResult>` in `app/(dashboard)/postavke/actions.ts`. (`keyof Dozvole` and the action's `(typeof DOZVOLE_KLJUCEVI)[number]` are the same four literals — the runtime array exists so the action can reject anything else before it reaches the update.)

- [ ] **Step 1: Write the server action**

Append to `app/(dashboard)/postavke/actions.ts`, following the shape of the neighbouring `postaviPrimaPodsjetnike`:

```ts
const DOZVOLE_KLJUCEVI = [
  "smije_brisati_svoje",
  "smije_brisati_tudje",
  "smije_brisati_klijente",
  "smije_zatvoriti_bez_nalaza",
] as const

/**
 * Prekidači dozvola po korisniku (potvrđeno 30.07.2026.). Ima smisla samo za operatera —
 * admin ionako smije sve, pregled ništa (vidi efektivneDozvole / SQL helpere).
 * SSR (RLS) klijent: korisnici_wr = je_admin(), a auth.uid() je postavljen pa audit
 * trigger zabilježi aktera.
 */
export async function postaviDozvolu(
  korisnikId: string,
  kljuc: (typeof DOZVOLE_KLJUCEVI)[number],
  vrijednost: boolean,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  if (!DOZVOLE_KLJUCEVI.includes(kljuc)) return { ok: false, message: t("nepoznataDozvola") }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("korisnici").update({ [kljuc]: vrijednost }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}
```

- [ ] **Step 2: Add the i18n keys to all three catalogs**

Under the namespace `KorisniciTab` already uses, add in `messages/sr.json`:

```json
"dozvole": "Dozvole",
"dozvoleSamoOperater": "Administrator smije sve, pregled ništa — prekidači vrijede za operatera.",
"smijeBrisatiSvoje": "Briše svoje unose",
"smijeBrisatiTudje": "Briše tuđe unose na svojim firmama",
"smijeBrisatiKlijente": "Briše klijenta, ugovor i lokaciju",
"smijeZatvoritiBezNalaza": "Zatvara aktivnost bez nalaza",
"nepoznataDozvola": "Nepoznata dozvola."
```

`messages/en.json`:

```json
"dozvole": "Permissions",
"dozvoleSamoOperater": "Administrators may do everything and viewers nothing — these switches apply to operators.",
"smijeBrisatiSvoje": "Delete own entries",
"smijeBrisatiTudje": "Delete other people's entries on assigned firms",
"smijeBrisatiKlijente": "Delete client, contract and location",
"smijeZatvoritiBezNalaza": "Close an activity without a report",
"nepoznataDozvola": "Unknown permission."
```

`messages/de.json`:

```json
"dozvole": "Berechtigungen",
"dozvoleSamoOperater": "Administratoren dürfen alles, Betrachter nichts — diese Schalter gelten für Operatoren.",
"smijeBrisatiSvoje": "Eigene Einträge löschen",
"smijeBrisatiTudje": "Fremde Einträge in zugewiesenen Firmen löschen",
"smijeBrisatiKlijente": "Kunde, Vertrag und Standort löschen",
"smijeZatvoritiBezNalaza": "Aktivität ohne Bericht abschließen",
"nepoznataDozvola": "Unbekannte Berechtigung."
```

- [ ] **Step 3: Build the switch group component**

Create `components/domain/DozvoleKorisnika.tsx` — same shape as the existing `components/domain/PrimaPodsjetnikeToggle.tsx` (optimistic `useState` + `useTransition`, `toastRezultat`, revert on `{ ok: false }`):

```tsx
"use client"
import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { postaviDozvolu } from "@/app/(dashboard)/postavke/actions"
import { toastRezultat } from "@/components/akcija-toast"
import { Checkbox } from "@/components/ui/checkbox"
import { efektivneDozvole, type Dozvole } from "@/lib/auth/dozvole"
import type { Uloga } from "@/lib/auth/roles"

const STAVKE: { kljuc: keyof Dozvole; labela: string }[] = [
  { kljuc: "smije_brisati_svoje", labela: "smijeBrisatiSvoje" },
  { kljuc: "smije_brisati_tudje", labela: "smijeBrisatiTudje" },
  { kljuc: "smije_brisati_klijente", labela: "smijeBrisatiKlijente" },
  { kljuc: "smije_zatvoriti_bez_nalaza", labela: "smijeZatvoritiBezNalaza" },
]

function JedanPrekidac({
  korisnikId, kljuc, labela, pocetno, onemoguceno, razlog,
}: {
  korisnikId: string
  kljuc: keyof Dozvole
  labela: string
  pocetno: boolean
  onemoguceno: boolean
  razlog?: string
}) {
  const t = useTranslations("postavke.korisnici")
  const [checked, setChecked] = useState(pocetno)
  const [pending, start] = useTransition()
  const ime = t(labela)
  // Isti razlog kao u PrimaPodsjetnikeToggle: disabled checkbox ne prima fokus, pa
  // objašnjenje mora i u pristupačno ime, ne samo u tooltip.
  const opis = razlog ? `${ime} — ${razlog}` : ime

  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        disabled={pending || onemoguceno}
        data-testid={`dozvola-${kljuc}-${korisnikId}`}
        aria-label={opis}
        title={onemoguceno ? razlog : ime}
        onCheckedChange={(next) => {
          setChecked(next)
          start(async () => {
            const r = toastRezultat(await postaviDozvolu(korisnikId, kljuc, next), {
              uspjeh: t("dozvolaSacuvana"),
              greska: t("dozvolaGreska"),
            })
            if (!r.ok) setChecked(!next) // brana odbila → vrati na stvarno stanje
          })
        }}
      />
      <span>{ime}</span>
    </label>
  )
}

/**
 * Četiri prekidača dozvola za jednog korisnika. Za admina i pregled su zaključani i
 * prikazuju IZVEDENU vrijednost (admin sve, pregled ništa) — inače bi admin red izgledao
 * nepodešeno iako mu kolone ništa ne znače.
 */
export function DozvoleKorisnika({
  korisnikId, uloga, dozvole,
}: { korisnikId: string; uloga: Uloga; dozvole: Dozvole }) {
  const t = useTranslations("postavke.korisnici")
  const zakljucano = uloga !== "operater"
  const efektivne = efektivneDozvole(uloga, dozvole)

  return (
    <div className="flex flex-col gap-1">
      {STAVKE.map((s) => (
        <JedanPrekidac
          key={s.kljuc}
          korisnikId={korisnikId}
          kljuc={s.kljuc}
          labela={s.labela}
          pocetno={efektivne[s.kljuc]}
          onemoguceno={zakljucano}
          razlog={zakljucano ? t("dozvoleSamoOperater") : undefined}
        />
      ))}
    </div>
  )
}
```

Add the two extra i18n keys this uses — `dozvolaSacuvana` and `dozvolaGreska` — to all three catalogs alongside the keys from Step 2 (sr: `"Dozvola sačuvana."` / `"Čuvanje dozvole nije uspjelo."`; en: `"Permission saved."` / `"Saving the permission failed."`; de: `"Berechtigung gespeichert."` / `"Speichern der Berechtigung fehlgeschlagen."`).

If the actual namespace in `KorisniciTab.tsx` is not `postavke.korisnici`, use whatever `useTranslations(...)` that file already passes and put the keys there instead — the namespace must match an existing one or `tsc` fails on the literal union.

- [ ] **Step 4: Wire it into `KorisniciTab`**

Extend the `korisnici` select in `components/domain/KorisniciTab.tsx` to include the four new columns, and render `<DozvoleKorisnika />` in each user's row.

- [ ] **Step 5: Verify in the running app**

Run: `pnpm dev` and open `http://localhost:3000/postavke` as an admin. Toggle each switch on an operater, reload, and confirm the value persisted. Confirm the switches read as all-on and disabled for an admin row, all-off and disabled for a `pregled` row.

- [ ] **Step 6: Lint, typecheck, unit suite**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/postavke/actions.ts" components/domain/KorisniciTab.tsx components/domain/DozvoleKorisnika.tsx messages/
git commit -m "feat(postavke): prekidači dozvola po korisniku u administraciji korisnika"
```

---

### Task 6: E2E dokaz scopinga i ograničenja

Proves the two claims that currently rest on reading the RLS policies rather than on a test: an operater's central plan really is filtered to assigned firms, and a `pregled` user really cannot download or export.

**Files:**
- Create: `tests/e2e/26-uloge-ovlastenja.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5, plus the existing E2E helpers `ensureKorisnik`, `injectSessionFor`, `insertKlijent`, `assignKlijent`, `clearDodjele`, `deleteKlijentByNaziv`, `deleteKorisnikByEmail`, `insertTermin`, `firstActiveVrstaId`.

**No `auth.setup.ts` / `playwright.config.ts` changes are needed.** `tests/e2e/db.ts` already exports `ensureKorisnik(email, lozinka, ime, uloga)` covering `pregled`, and `18-auth-rls.spec.ts` already establishes the pattern for acting as a non-admin: opt out of the shared admin state with `test.use({ storageState: { cookies: [], origins: [] } })` and call `injectSessionFor(context, email, lozinka)` per test. File number 26 — 19 through 25 are taken.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/26-uloge-ovlastenja.spec.ts`:

```ts
// tests/e2e/26-uloge-ovlastenja.spec.ts
// Potvrđeni model uloga (30.07.2026.): operaterov centralni plan je filtriran na dodijeljene
// firme, a `pregled` ne smije preuzimati dokumente ni izvoziti plan (pregled na ekranu ostaje).
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import {
  db,
  ensureKorisnik,
  assignKlijent,
  clearDodjele,
  insertKlijent,
  insertTermin,
  firstActiveVrstaId,
  deleteKlijentByNaziv,
  deleteKorisnikByEmail,
} from "./db"

const OP_EMAIL = "e2e-uloge-operater@tehpro.test"
const OP_LOZINKA = "E2eUloge2026!"
const PREGLED_EMAIL = "e2e-uloge-pregled@tehpro.test"
const PREGLED_LOZINKA = "E2eUlogePregled2026!"
const FIRMA_MOJA = "E2E Uloge Moja DOO"
const FIRMA_TUDJA = "E2E Uloge Tudja DOO"

test.use({ storageState: { cookies: [], origins: [] } })

test.describe("Uloge i ovlaštenja", () => {
  let opId = ""
  let pregledId = ""
  let mojaId = ""
  let dokumentId = ""

  test.beforeAll(async () => {
    opId = await ensureKorisnik(OP_EMAIL, OP_LOZINKA, "E2E Uloge Operater", "operater")
    pregledId = await ensureKorisnik(PREGLED_EMAIL, PREGLED_LOZINKA, "E2E Uloge Pregled", "pregled")
    await deleteKlijentByNaziv(FIRMA_MOJA).catch(() => {})
    await deleteKlijentByNaziv(FIRMA_TUDJA).catch(() => {})
    mojaId = await insertKlijent(FIRMA_MOJA)
    await insertKlijent(FIRMA_TUDJA)

    // Termin na svakoj firmi da obje imaju red u centralnom planu.
    const vrstaId = await firstActiveVrstaId()
    const terminId = await insertTermin({ klijentId: mojaId, vrstaId, rok: "2026-08-15" })

    // Dokument na terminu — meta za test preuzimanja. Storage objekat ne treba: ruta pada
    // na 403 prije nego dođe do potpisivanja URL-a, a to je upravo ono što se provjerava.
    const { data, error } = await db
      .from("dokumenti")
      .insert({
        klijent_id: mojaId,
        termin_id: terminId,
        naziv: "e2e-uloge-nalaz.pdf",
        storage_path: `termini/${terminId}/e2e-uloge-nalaz.pdf`,
      })
      .select("id")
      .single()
    if (error) throw new Error(`insert dokumenta: ${error.message}`)
    dokumentId = data.id as string

    await clearDodjele(opId)
    await clearDodjele(pregledId)
    await assignKlijent(opId, mojaId) // NAMJERNO bez FIRMA_TUDJA
    await assignKlijent(pregledId, mojaId)
  })

  test.afterAll(async () => {
    await clearDodjele(opId).catch(() => {})
    await clearDodjele(pregledId).catch(() => {})
    await deleteKlijentByNaziv(FIRMA_MOJA).catch(() => {})
    await deleteKlijentByNaziv(FIRMA_TUDJA).catch(() => {})
    await deleteKorisnikByEmail(OP_EMAIL).catch(() => {})
    await deleteKorisnikByEmail(PREGLED_EMAIL).catch(() => {})
  })

  test("operaterov centralni plan prikazuje samo dodijeljene firme", async ({ page, context }) => {
    await injectSessionFor(context, OP_EMAIL, OP_LOZINKA)
    await page.goto("/plan-aktivnosti")
    await expect(page.getByText(FIRMA_MOJA).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(FIRMA_TUDJA)).toHaveCount(0)
  })

  test("pregled ne smije izvesti plan (403)", async ({ context }) => {
    await injectSessionFor(context, PREGLED_EMAIL, PREGLED_LOZINKA)
    const res = await context.request.get("/api/plan-aktivnosti/izvoz?format=xlsx&opseg=sve&period=tekuci")
    expect(res.status()).toBe(403)
  })

  test("pregled ne smije preuzeti dokument (403), ali ga smije pogledati (200)", async ({ context }) => {
    await injectSessionFor(context, PREGLED_EMAIL, PREGLED_LOZINKA)
    const preuzimanje = await context.request.get(`/api/dokumenti/${dokumentId}`)
    expect(preuzimanje.status()).toBe(403)
    const pregledOdgovor = await context.request.get(`/api/dokumenti/${dokumentId}/pregled`)
    expect(pregledOdgovor.status()).toBe(200)
  })

  test("operater i dalje smije preuzeti dokument (200)", async ({ context }) => {
    await injectSessionFor(context, OP_EMAIL, OP_LOZINKA)
    const res = await context.request.get(`/api/dokumenti/${dokumentId}`)
    expect(res.status()).toBe(200)
  })
})
```

If `insertTermin`'s parameter names differ from `{ klijentId, vrstaId, rok }`, read its signature at `tests/e2e/db.ts:77` and match it — do not change the helper.

- [ ] **Step 2: Confirm the DEMO guard before running**

Run: `grep -c mtwwotmwrasozmcgqwhc .env.development.local`
Expected: `1` or more. The `globalSetup` guard refuses to run against anything but the DEMO ref — if it aborts, the worktree is missing `.env.development.local` and would otherwise have fallen back to PROD.

- [ ] **Step 3: Run the new spec**

Run: `pnpm exec playwright test tests/e2e/26-uloge-ovlastenja.spec.ts`
Expected: PASS in chromium and webkit — 4 tests per browser.

- [ ] **Step 4: Run the full E2E suite for regressions**

Run: `pnpm test:e2e`
Expected: PASS. The delete-policy rewrite in Task 2 touches `termini`, `lokacije`, `ugovori`, `kontakt_osobe`, `klijent_provjere` and `dokumenti` — any spec that deletes one of those as a non-admin will surface here.

Then: `pnpm cleanup:test-data`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/26-uloge-ovlastenja.spec.ts
git commit -m "test(e2e): scoping operatera po firmama + pregled bez preuzimanja i izvoza"
```

---

## Nakon plana — koraci koje pokreće korisnik, ne agent

1. `pnpm db:apply-cloud --demo supabase/migrations/20260730150000_kreirao_id.sql` (then `151000`, then `152000`, in order).
2. Verify on DEMO: a `pregled` user gets 403 on download/export; an operater's plan is filtered; the switches persist.
3. `POTVRDI_PROD=da pnpm db:apply-cloud --prod <each file, same order>`.
4. Merge to `main` — that is a production deploy to all three Vercel projects at once.
5. On PROD, review the backfill result before trusting the „own entries" switch:
   `select count(*) filter (where kreirao_id is null) as bez_autora, count(*) from termini;`
   Rows predating the audit log have no author and behave as „not mine" — an operater with only `smije_brisati_svoje` will not be able to delete them. If that count is large, decide with the client whether those legacy rows should be attributed to someone.

## Otvoreno pitanje za naručioca (ne blokira plan)

`get_zaduzeni_dodjele()`, `get_aktivni_korisnici()` and `get_admini()` are `security definer` and therefore bypass RLS — they expose the list of colleagues, and in the first case who is assigned to which firm, to every logged-in user including `pregled`. This is user metadata, not client data, and the „Zaduženi" suggestion field needs it. Worth confirming it is acceptable; tightening it is a separate change.
