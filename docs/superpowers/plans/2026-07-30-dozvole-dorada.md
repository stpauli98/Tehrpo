# Dorada uloga i ovlaštenja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every open item parked during the uloge-i-ovlaštenja work (PR #82, merged as `ce97819`) — one data-consistency hole, one storage-hygiene gap, one misleading error message, one latent write path, the missing DELETE test coverage, and four cosmetic nits — then prove the result with a full E2E regression run.

**Architecture:** Four of the fixes are additive and independent: a trigger widened to INSERT, a new cron route that sweeps orphaned storage objects, a pre-fetch in the five delete actions so „row missing" and „not permitted" stop sharing one message, and a schema narrowing that removes a write path no UI uses. The remaining work is test coverage and polish. Nothing here changes the permission model itself — it only closes the edges the model left open.

**Tech Stack:** Next.js 16 App Router (Route Handlers, Server Actions), Supabase/Postgres (SQL migration, RLS, triggers), `@supabase/supabase-js`, Vitest (unit + `pg` integration gated on `TEST_DATABASE_URL`), Playwright, next-intl, pnpm, Vercel Cron.

## Global Constraints

- Domain language is Bosnian/Serbian (latinica) — identifiers, comments, UI strings.
- Package manager is **pnpm**. `pnpm dev` is `next dev --webpack` — never plain `next dev`.
- Backend testing goes through the **local Docker Supabase stack** (already running): `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Never a cloud DB.
- **Do not run `pnpm db:reset`** — it wipes the user's local dev data. Apply new migrations with the `pg` client or `npx supabase migration up` (`psql` is not installed).
- The agent does **not** apply migrations to cloud. DEMO then PROD is a separate, user-run step: `pnpm db:apply-cloud --demo <file>`, then `POTVRDI_PROD=da pnpm db:apply-cloud --prod <file>`.
- `db/types.ts` is auto-generated — never hand-edit. This plan adds no columns, so it should not change; if `git status` shows it modified, inspect and revert.
- **Never use the admin/service-role Supabase client in the `app/` or `components/` request path.** The cron route is the documented exception (`app/api/cron/*` already uses it).
- next-intl type-checks namespaces and keys against the literal JSON union — every new key must land in **all three** of `messages/{sr,en,de}.json`, in the namespace the consuming translator is actually bound to. No ICU `one` plural for `sr`.
- Desktop-only: no `sm:` / `md:` Tailwind breakpoints (hard lint error).
- Rules of Hooks: any early `return null` sits after every hook call.
- No dummy/mock data.
- Migration timestamps start at `20260730170000` — later than every migration currently on `main` (`20260730161000`).

**Baseline on this branch** (`worktree-dozvole-dorada`, cut from `main` at `ce97819`): `pnpm test:unit` 915 passing / 97 skipped, `pnpm typecheck` clean, `pnpm lint` 0 errors + 11 pre-existing warnings.

**Explicitly out of scope:** attributing the author-less legacy rows (`kreirao_id is null`, e.g. 6/30 termina on PROD carry an author). Those rows behave as „someone else's", so an operater holding only `smije_brisati_svoje` cannot delete them. Deciding who should own them is the client's call, not an implementation detail — raise it, do not guess.

---

### Task 1: Auto-ciklus za termin zatvoren INSERT-om

`tg_termini_auto_cycle_au` is `after update on termini` only. A termin inserted directly at `status = 'izvrseno'` therefore spawns no next-cycle termin — the periodics silently stop for that service. The close-without-nalaz gate (`20260730152000`, widened in `20260730153000`) already covers INSERT, so this is the matching half.

**Files:**
- Create: `supabase/migrations/20260730170000_auto_cycle_na_insert.sql`
- Create: `lib/termini/autoCycleInsert.integration.test.ts`

**Interfaces:**
- Produces: trigger `tg_termini_auto_cycle_ai` (`after insert on termini`) calling the existing `tg_termini_auto_cycle()` function unchanged.

- [ ] **Step 1: Write the failing integration test**

Create `lib/termini/autoCycleInsert.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// tg_termini_auto_cycle je do 20260730170000 bio samo AFTER UPDATE, pa termin unesen
// odmah kao 'izvrseno' nije generisao sljedeći ciklus — periodika bi tiho stala.
describe.skipIf(!URL)("auto-ciklus na INSERT (integracija, lokalni DB)", () => {
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

  // vrste_provjera nije seedovana nijednom migracijom — svaki test pravi svoju vrstu.
  async function novaVrsta(): Promise<string> {
    const r = await db.query("insert into vrste_provjera (naziv) values ($1) returning id", [
      `ITEST vrsta ${crypto.randomUUID()}`,
    ])
    return r.rows[0].id as string
  }

  async function noviKlijent(): Promise<string> {
    const r = await db.query("insert into klijenti (naziv) values ($1) returning id", [
      `ITEST firma ${crypto.randomUUID()}`,
    ])
    return r.rows[0].id as string
  }

  async function brojTermina(klijentId: string): Promise<number> {
    const r = await db.query("select count(*)::int as n from termini where klijent_id = $1", [klijentId])
    return r.rows[0].n as number
  }

  it("INSERT sa status='izvrseno' i intervalom generiše sljedeći termin", async () => {
    await withTx(async () => {
      const klijentId = await noviKlijent()
      await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status, datum_izvrsenja, interval_mjeseci)
         values ($1,$2,current_date,'izvrseno',current_date,12)`,
        [klijentId, await novaVrsta()],
      )
      // 1 unesen + 1 koji je trigger generisao
      expect(await brojTermina(klijentId)).toBe(2)
    })
  })

  it("INSERT bez intervala ne generiše ništa (jednokratna aktivnost)", async () => {
    await withTx(async () => {
      const klijentId = await noviKlijent()
      await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status, datum_izvrsenja)
         values ($1,$2,current_date,'izvrseno',current_date)`,
        [klijentId, await novaVrsta()],
      )
      expect(await brojTermina(klijentId)).toBe(1)
    })
  })

  it("INSERT u statusu 'planirano' ne generiše ništa", async () => {
    await withTx(async () => {
      const klijentId = await noviKlijent()
      await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, interval_mjeseci)
         values ($1,$2,current_date,12)`,
        [klijentId, await novaVrsta()],
      )
      expect(await brojTermina(klijentId)).toBe(1)
    })
  })

  it("UPDATE putanja i dalje radi (regresija)", async () => {
    await withTx(async () => {
      const klijentId = await noviKlijent()
      const r = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, interval_mjeseci)
         values ($1,$2,current_date,12) returning id`,
        [klijentId, await novaVrsta()],
      )
      await db.query(
        "update termini set status='izvrseno', datum_izvrsenja=current_date where id=$1",
        [r.rows[0].id],
      )
      expect(await brojTermina(klijentId)).toBe(2)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/termini/autoCycleInsert.integration.test.ts`
Expected: the first test FAILS with `expected 1 to be 2`; the other three PASS. That exact split is the proof the gap is real and narrow.

- [ ] **Step 3: Read the existing trigger function before writing the migration**

Run: `sed -n '25,58p' supabase/migrations/20260620201630_triggers.sql`

Confirm which `NEW.` fields it reads and whether it references `OLD` anywhere. If it references `OLD`, the INSERT trigger must guard those references — report that in your report and handle it. If it only reads `NEW` and the `interval_mjeseci`/`status` condition, the function can be reused as-is.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260730170000_auto_cycle_na_insert.sql`:

```sql
-- Auto-ciklus i za termin unesen odmah kao 'izvrseno' (2026-07-30).
-- tg_termini_auto_cycle_au je AFTER UPDATE, pa INSERT sa status='izvrseno' nije generisao
-- sljedeći ciklus — periodika bi za tu uslugu tiho stala. Kapija za zatvaranje bez nalaza
-- (20260730153000) već pokriva INSERT; ovo je njena druga polovina.
-- Funkcija se ne mijenja — samo se veže i na INSERT. Re-run safe.

drop trigger if exists tg_termini_auto_cycle_ai on termini;
create trigger tg_termini_auto_cycle_ai
  after insert on termini
  for each row execute function tg_termini_auto_cycle();
```

- [ ] **Step 5: Apply locally and run the test**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/termini/autoCycleInsert.integration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole integration set for regressions**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/`
Expected: everything passes. The auto-cycle trigger now fires on INSERT in every test that inserts a closed termin — if a pre-existing test asserted a row count that this changes, it will surface here.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260730170000_auto_cycle_na_insert.sql lib/termini/autoCycleInsert.integration.test.ts
git commit -m "fix(termini): auto-ciklus se pokreće i za termin unesen kao izvršen"
```

---

### Task 2: Metenje osirotjelih storage objekata

`dokumenti_del` is switch-based since `20260730151000`, but `storage_dok_del` is still `je_admin()`. Widening it is the wrong fix — it would let any permitted operater delete arbitrary objects in the bucket, including ones whose `dokumenti` row they cannot see. The ADR (`docs/adr/2026-07-30-pregled-bez-preuzimanja.md`) records a periodic sweep as the remedy instead. A direct-PostgREST delete by a permitted operater removes the row and leaves the file; the sweep collects those.

**Files:**
- Create: `lib/dokumenti/sweep.ts`
- Create: `lib/dokumenti/sweep.test.ts`
- Create: `app/api/cron/ciscenje-storagea/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Produces: `export function osirotjeliObjekti(objekti: string[], putanjeUBazi: string[]): string[]` in `lib/dokumenti/sweep.ts` — pure set difference, the only part worth unit-testing.
- Produces: `GET|POST /api/cron/ciscenje-storagea` returning `{ ok: true, obrisano: number }`, guarded by `isCronAuthorized` exactly like `app/api/cron/ciscenje-audita/route.ts`.

- [ ] **Step 1: Write the failing unit test**

Create `lib/dokumenti/sweep.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { osirotjeliObjekti } from "./sweep"

describe("osirotjeliObjekti", () => {
  it("vraća objekte kojima nema reda u bazi", () => {
    expect(
      osirotjeliObjekti(["termini/a/x.pdf", "termini/b/y.pdf"], ["termini/a/x.pdf"]),
    ).toEqual(["termini/b/y.pdf"])
  })

  it("prazan storage → prazan rezultat", () => {
    expect(osirotjeliObjekti([], ["termini/a/x.pdf"])).toEqual([])
  })

  it("sve povezano → ništa za brisanje", () => {
    const p = ["termini/a/x.pdf", "termini/b/y.pdf"]
    expect(osirotjeliObjekti(p, p)).toEqual([])
  })

  it("red u bazi bez fajla se ignoriše (nije naš posao)", () => {
    expect(osirotjeliObjekti(["termini/a/x.pdf"], ["termini/a/x.pdf", "termini/c/z.pdf"])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/dokumenti/sweep.test.ts`
Expected: FAIL — `Failed to resolve import "./sweep"`.

- [ ] **Step 3: Write the pure helper**

Create `lib/dokumenti/sweep.ts`:

```ts
/**
 * Putanje objekata u bucketu kojima ne odgovara nijedan red u `dokumenti`.
 *
 * Nastaju kad se red obriše mimo aplikacije (direktan PostgREST DELETE): `dokumenti_del`
 * je po prekidaču od 20260730151000, a `storage_dok_del` je namjerno ostao admin-only —
 * širenje te politike bi dalo operateru brisanje proizvoljnih objekata u bucketu.
 * Zato se osirotjeli fajlovi skupljaju periodično umjesto da se politika olabavi.
 * Vidi docs/adr/2026-07-30-pregled-bez-preuzimanja.md.
 */
export function osirotjeliObjekti(objekti: string[], putanjeUBazi: string[]): string[] {
  const uBazi = new Set(putanjeUBazi)
  return objekti.filter((p) => !uBazi.has(p))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/dokumenti/sweep.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the cron route**

Create `app/api/cron/ciscenje-storagea/route.ts`, modelled on `app/api/cron/ciscenje-audita/route.ts` (read that file first and match its shape):

```ts
import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { osirotjeliObjekti } from "@/lib/dokumenti/sweep"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const BUCKET = "tehpro-dokumenti"

/** Rekurzivno pokupi sve putanje objekata u bucketu (folderi nemaju `id`, fajlovi ga imaju). */
async function sveObjekte(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  prefiks = "",
): Promise<string[]> {
  const out: string[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefiks, { limit: 100, offset })
    if (error) throw new Error(`list(${prefiks}): ${error.message}`)
    if (!data.length) break
    // eslint-disable-next-line no-await-in-loop -- rekurzija po folderima; dubina je mala (termini/<id>/)
    for (const it of data) {
      const put = prefiks ? `${prefiks}/${it.name}` : it.name
      if (it.id === null) out.push(...(await sveObjekte(supabase, put)))
      else out.push(put)
    }
    if (data.length < 100) break
    offset += 100
  }
  return out
}

async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const supabase = createAdminSupabaseClient()
  try {
    const objekti = await sveObjekte(supabase)
    const { data: redovi, error } = await supabase.from("dokumenti").select("storage_path")
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const zaBrisanje = osirotjeliObjekti(objekti, (redovi ?? []).map((r) => r.storage_path))
    if (!zaBrisanje.length) return NextResponse.json({ ok: true, obrisano: 0 })

    const { error: greska } = await supabase.storage.from(BUCKET).remove(zaBrisanje)
    if (greska) return NextResponse.json({ ok: false, error: greska.message }, { status: 500 })
    return NextResponse.json({ ok: true, obrisano: zaBrisanje.length })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
```

If the `no-await-in-loop` disable comment turns out to be unnecessary (lint reports it unused), remove it — an unused disable is itself a lint warning in this repo.

- [ ] **Step 6: Register the cron**

In `vercel.json`, add to the `crons` array, keeping the existing three untouched:

```json
{ "path": "/api/cron/ciscenje-storagea", "schedule": "30 4 * * *" }
```

30 minutes after `ciscenje-audita` (`0 4`), so the two nightly jobs do not overlap.

- [ ] **Step 7: Verify the route locally against the local stack**

Run `pnpm dev` in one shell, then in another:

```bash
curl -s -H "Authorization: Bearer $(grep -m1 '^CRON_SECRET=' .env.local | cut -d= -f2-)" \
  http://localhost:3000/api/cron/ciscenje-storagea
```

Expected: `{"ok":true,"obrisano":N}`. Also confirm the unauthorized path: the same request without the header returns `401`. Report both outputs.

- [ ] **Step 8: Lint, typecheck, unit suite**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add lib/dokumenti/sweep.ts lib/dokumenti/sweep.test.ts app/api/cron/ciscenje-storagea/route.ts vercel.json
git commit -m "feat(dokumenti): noćno metenje osirotjelih storage objekata"
```

---

### Task 3: „Red ne postoji" prestaje da glumi „nije dozvoljeno"

The five delete actions in `app/(dashboard)/klijenti/actions.ts` treat every zero-row delete as a permission refusal (`brisanjeNijeDozvoljeno`). A double-submit, a stale page, or an already-deleted row therefore blames the user's permissions. `deleteDokumentAction` in `app/(dashboard)/dokumenti/actions.ts` already distinguishes the two by pre-fetching the row — apply the same shape.

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts` (`deleteKlijent` ~:182, `deleteLokacija` ~:363, `deleteProfilProvjere` ~:461, `deleteUgovor` ~:558, `deleteKontakt` ~:662)
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: the existing `nijeObrisano(redovi)` helper at `app/(dashboard)/klijenti/actions.ts:28`.
- Produces: one new i18n key `zapisNePostoji` in the same namespace `brisanjeNijeDozvoljeno` already lives in — read the file's translator binding and match it.

- [ ] **Step 1: Read the reference implementation**

Run: `sed -n '174,215p' "app/(dashboard)/dokumenti/actions.ts"`

Note how it pre-fetches, returns a distinct „does not exist" message, then falls through to the row-count check for the permission case. Your five actions follow that order.

- [ ] **Step 2: Add the i18n key to all three catalogues**

Find the namespace first: `grep -n 'brisanjeNijeDozvoljeno' messages/sr.json` and use the same object.

`messages/sr.json`: `"zapisNePostoji": "Zapis više ne postoji — vjerovatno je već obrisan."`
`messages/en.json`: `"zapisNePostoji": "The record no longer exists — it was probably already deleted."`
`messages/de.json`: `"zapisNePostoji": "Der Datensatz existiert nicht mehr — er wurde vermutlich bereits gelöscht."`

- [ ] **Step 3: Add the pre-fetch to each of the five actions**

For each action, immediately before its `.delete()` call, add a existence check against the same table and id, e.g. for `deleteLokacija`:

```ts
  // Razlikuj „nema reda" od „RLS odbio": bez ovoga korisnik dobije poruku o dozvolama
  // i kad je red naprosto već obrisan (dupli submit, ustajala stranica).
  const { data: postoji } = await supabase
    .from("lokacije")
    .select("id")
    .eq("id", parsed.data.id)
    .maybeSingle()
  if (!postoji) return { ok: false, message: t("zapisNePostoji") }
```

Use the table and id-field each action already uses — do not change what any action deletes. Note that this SELECT is itself RLS-scoped: a row on an unassigned firm reads as „does not exist", which is the correct thing to tell that user anyway.

- [ ] **Step 4: Typecheck, lint, unit suite**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/klijenti/actions.ts" messages/sr.json messages/en.json messages/de.json
git commit -m "fix(klijenti): brisanje razlikuje nepostojeći zapis od odbijene dozvole"
```

---

### Task 4: `updateTermin` prestaje primati `status`

`updateTermin`'s patch schema accepts `status: z.enum([...]).optional()` (`app/(dashboard)/termini/actions.ts:121`), which is a write path into `termini.status` that no UI exposes — `TerminSheet` has no status field. Closing an activity has its own action (`markIzvrseno`), and cancelling has its own path (`:208`, `status: "otkazano"`). The DB trigger now guards the transition either way, so this is defence in depth, not the only barrier.

**Files:**
- Modify: `app/(dashboard)/termini/actions.ts`

- [ ] **Step 1: Confirm nothing sends `status` to `updateTermin`**

Run: `grep -rn 'name="status"' components app --include=*.tsx` and `grep -rn "updateTermin" components app --include=*.tsx`

If any caller does submit a `status` field, **stop and report NEEDS_CONTEXT** — removing it would break that caller, and the plan's premise is wrong. Otherwise continue.

- [ ] **Step 2: Remove the field from the patch schema**

At `app/(dashboard)/termini/actions.ts:121`, delete the `status:` line and leave a comment in its place:

```ts
  // `status` namjerno NIJE u patch šemi: zatvaranje ide kroz markIzvrseno (uz kapiju
  // tg_zatvaranje_trazi_nalaz), otkazivanje kroz vlastitu putanju nize. Nijedan UI ga ne šalje.
```

- [ ] **Step 3: Typecheck, lint, unit suite**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: all pass. `tsc` will surface any code that read `parsed.data.status` — if it does, remove that dead branch too and say so in your report.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/termini/actions.ts"
git commit -m "refactor(termini): updateTermin više ne prima status"
```

---

### Task 5: Namjenski DELETE testovi za preostale tabele

`lib/auth/dozvoleRls.integration.test.ts` covers `termini`, `klijenti` and (since the fix wave) `dokumenti`. `lokacije`, `ugovori`, `kontakt_osobe` and `klijent_provjere` are gated by the same `smije_brisati_klijente()` helper but have no test of their own — the deferred-minor list called this out and it is the gap that let the dead document-delete widening through unnoticed.

**Files:**
- Modify: `lib/auth/dozvoleRls.integration.test.ts`

- [ ] **Step 1: Read the existing dokumenti cases as the template**

Run: `grep -n "dokumenti" lib/auth/dozvoleRls.integration.test.ts`

Read the block they belong to. Your new cases mirror their structure exactly — same helpers, same `withTx` rollback, same „act as user" pattern.

- [ ] **Step 2: Add one describe block per table**

For each of `lokacije`, `ugovori`, `kontakt_osobe`, `klijent_provjere`, add three cases:

1. operater **without** `smije_brisati_klijente`, assigned to the firm → delete affects 0 rows
2. operater **with** `smije_brisati_klijente`, assigned → delete affects 1 row
3. operater **with** the switch but **not assigned** to that firm → delete affects 0 rows (the permission must never defeat assignment)

Create the fixture rows as `postgres` **before** switching into the user role — `insert ... RETURNING` as an authenticated non-admin fails 42501, because Postgres applies the SELECT policy to RETURNING rows and `tg_klijent_auto_dodjela` is an AFTER trigger that has not granted access yet. The existing cases already do this; keep the ordering.

Required (NOT NULL, no default) columns for the fixtures, verified against `db/types.ts`:

| tabela | obavezno |
|---|---|
| `lokacije` | `klijent_id`, `naziv` |
| `ugovori` | `klijent_id` |
| `kontakt_osobe` | `klijent_id`, `ime` |
| `klijent_provjere` | `klijent_id`, `vrsta_provjere_id` |

So the four inserts are:

```ts
await db.query("insert into lokacije (klijent_id, naziv) values ($1,$2) returning id", [klijentId, "ITEST lokacija"])
await db.query("insert into ugovori (klijent_id) values ($1) returning id", [klijentId])
await db.query("insert into kontakt_osobe (klijent_id, ime) values ($1,$2) returning id", [klijentId, "ITEST Kontakt"])
await db.query("insert into klijent_provjere (klijent_id, vrsta_provjere_id) values ($1,$2) returning id", [klijentId, await novaVrsta()])
```

`novaVrsta()` is the helper the file already has — `vrste_provjera` is not seeded by any migration, so each case makes its own.

- [ ] **Step 3: Run the integration suite**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/auth/`
Expected: PASS, 12 new cases on top of the existing ones.

- [ ] **Step 4: Prove the tests bite**

Temporarily change one policy's `smije_brisati_klijente()` to `true` in the local DB:

```sql
alter policy lokacije_del on lokacije using ( ima_pristup_klijentu(klijent_id) );
```

Re-run the suite — the „without the switch" case for `lokacije` must FAIL. Then restore it:

```sql
alter policy lokacije_del on lokacije using ( ima_pristup_klijentu(klijent_id) and smije_brisati_klijente() );
```

Re-run and confirm green again. Report both outputs. A test that passes with the guard removed is worthless, and this is the cheapest way to know.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/dozvoleRls.integration.test.ts
git commit -m "test(auth): DELETE pokrivenost za lokacije, ugovore, kontakte i profile provjera"
```

---

### Task 6: Sitnice iz odgođene liste

Four cosmetic items carried through the earlier reviews. Grouped into one task because each is a few lines and none carries its own test cycle.

**Files:**
- Create: `lib/auth/zahtijevaj-preuzimanje.ts`
- Modify: `app/api/dokumenti/[id]/route.ts`, `app/api/plan-aktivnosti/izvoz/route.ts`
- Modify: `components/domain/DozvoleKorisnika.tsx`
- Modify: `lib/auth/kreiraoId.integration.test.ts`
- Modify: `tests/e2e/27-uloge-ovlastenja.spec.ts`

- [ ] **Step 1: Extract the duplicated download/export guard**

The same four lines appear in both routes (`app/api/dokumenti/[id]/route.ts:28-31`, `app/api/plan-aktivnosti/izvoz/route.ts:63-66`). Create `lib/auth/zahtijevaj-preuzimanje.ts`:

```ts
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { smijePreuzeti } from "@/lib/auth/roles"

/**
 * Server-only guard: smije li tekući korisnik iznositi podatke (preuzimanje, izvoz)?
 * `pregled` smije SAMO čitati na ekranu — potvrđeno sa naručiocem 30.07.2026.
 * Vraća true/false umjesto da baca, jer svaka ruta ima svoj i18n tekst i status.
 */
export async function smijeTrenutniPreuzeti(): Promise<boolean> {
  const ja = await getTrenutniKorisnik()
  return !!ja && smijePreuzeti(ja.uloga)
}
```

Then in each route replace the inline check with:

```ts
  if (!(await smijeTrenutniPreuzeti())) {
    return NextResponse.json({ error: t("preuzimanjeNijeDozvoljeno") }, { status: 403 })
  }
```

keeping each route's own translator and message key (`t("preuzimanjeNijeDozvoljeno")` in the dokumenti route, `tCommon("izvozNijeDozvoljen")` in the izvoz route). Remove the now-unused `getTrenutniKorisnik` / `smijePreuzeti` imports from both routes — `tsc` will flag them if you miss one.

- [ ] **Step 2: Tooltip parity in `DozvoleKorisnika`**

`JedanPrekidac` uses the native `title` attribute for the disabled reason, while its sibling `PrimaPodsjetnikeToggle` is wrapped in the `<Tooltip>` component at its call site in `KorisniciTabela.tsx`. Read both, then make the disabled reason render through the same `<Tooltip>` component so the two controls in the same table row look alike. Keep the reason in `aria-label` as well — a disabled checkbox cannot take focus, so the accessible name must carry it regardless of the tooltip.

- [ ] **Step 3: `kaoKorisnik` gets the try/finally shape**

In `lib/auth/kreiraoId.integration.test.ts`, `kaoKorisnik(uid)` sets the role without restoring it. The repo's established idiom is `asUser<T>(uid, fn)` with try/finally — see `lib/podsjetnici/podsjetnikEmailRpc.integration.test.ts`. Harmless today because `withTx` rolls back, but match the idiom so the next reader is not taught the weaker pattern.

- [ ] **Step 4: Structurally valid placeholder PDF**

In `tests/e2e/27-uloge-ovlastenja.spec.ts` the placeholder buffer is `"%PDF-1.4 e2e uloge-ovlastenja placeholder"`, which is not a real PDF. No current test parses it, but replace it with a minimal valid one-page PDF so a future test that renders it does not fail mysteriously:

```ts
const MINIMALNI_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 9]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
)
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit` and
`TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/auth/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/zahtijevaj-preuzimanje.ts "app/api/dokumenti/[id]/route.ts" app/api/plan-aktivnosti/izvoz/route.ts components/domain/DozvoleKorisnika.tsx lib/auth/kreiraoId.integration.test.ts tests/e2e/27-uloge-ovlastenja.spec.ts
git commit -m "chore(dozvole): izdvojen guard za preuzimanje + sitnice iz odgođene liste"
```

---

### Task 7: Puni E2E regresijski run

The full suite was never run against a migrated DEMO — the earlier attempt was abandoned because several other sessions were running E2E against the same database, and only a focused subset was run afterwards. This task closes that.

**Files:** none (verification only)

- [ ] **Step 1: Confirm nobody else is using DEMO**

Run: `pgrep -fl "playwright test" || echo "SLOBODAN"`

If anything is running, **wait** and re-check — do not run concurrently. Two full suites against the same DEMO interfere: the specs share the global singleton `postavke` id=1, and `pnpm cleanup:test-data` from another run will delete rows out from under yours. A run under contention proves nothing.

- [ ] **Step 2: Confirm the DEMO guard**

Run: `grep -c mtwwotmwrasozmcgqwhc .env.development.local`
Expected: 1 or more. `globalSetup` refuses any target but the DEMO ref — a worktree missing this file silently falls back to `.env.local`, which is PROD.

- [ ] **Step 3: Confirm DEMO has this branch's migration**

Task 1 adds `20260730170000`. It is **not** applied to DEMO (cloud application is a user-run step). Decide and report: if no spec depends on auto-cycle-on-insert, run anyway and note the discrepancy; if one does, stop and report that DEMO needs the migration first.

- [ ] **Step 4: Run the full suite**

Run: `E2E_PORT=3600 pnpm test:e2e`
Expected: PASS. Then run `pnpm cleanup:test-data`.

- [ ] **Step 5: Triage every failure before reporting green**

For each failure, determine which of these it is, and say which in your report:
- a real regression from this branch,
- a cloud-schema difference (compare DEMO against the migrations before blaming the code — `information_schema.columns` over `DATABASE_URL_DEMO`; **and check `git log origin/main` for a migration that deliberately removed what appears to be „missing"**, because that mistake has already been made once on this project),
- flakiness (re-run that spec alone on an idle DEMO to confirm).

Do not report the suite as green while any failure is unexplained.

- [ ] **Step 6: Record the result**

No commit. Put the full outcome in your report: total passed/failed, and the classification of every failure.

---

## Nakon plana — koraci koje pokreće korisnik, ne agent

1. `pnpm db:apply-cloud --demo supabase/migrations/20260730170000_auto_cycle_na_insert.sql`
2. Verify on DEMO, then `POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/20260730170000_auto_cycle_na_insert.sql`
3. Merge to `main` — Vercel auto-deploys to all three production projects, which also registers the new cron from `vercel.json`.
4. After the first nightly run, check the sweep did something sane: `curl` the route manually with the cron secret, or read the Vercel cron logs; a first run deleting a large number of files is expected if orphans have accumulated, but confirm the count matches what an audit reports before trusting it.

## Otvoreno pitanje za naručioca

Legacy rows created before the audit log carry `kreirao_id = null` and therefore count as „someone else's" — an operater holding only `smije_brisati_svoje` cannot delete them. On PROD only 6 of 30 termina and 1 of 6 klijenata carry an author. If operateri are expected to manage those older records, someone must decide who owns them (the assigned „zaduženi" for the firm is the obvious candidate). Until then the restrictive behaviour stands, which is the safe default.
