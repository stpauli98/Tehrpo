# Zaduženi prijedlozi po firmi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the `<datalist>` prijedlozi in the „Zaduženi" field (`ZaduzeniPolje`) to the korisnici who currently have access to the selected firma (admins, always, plus operateri/pregled with an explicit `korisnik_klijent` dodjela) instead of every active korisnik in the system.

**Architecture:** New `security definer` RPC `get_zaduzeni_dodjele()` returns flat `(klijent_id, ime)` rows for that access set. A pure function groups the rows into `Record<klijent_id, string[]>` once per page load; the map is threaded through the existing prop chain (mirrors the `lokacijeByFirma` pattern already used in `NoviTerminButton`). `NoviTerminButton` and `TerminSheet` each pick their own slice out of the map — by the locally-selected `klijentId` (new termin) or by `termin.klijent_id` (existing termin).

**Tech Stack:** Next.js 16 App Router, Supabase/Postgres (SQL migration + RLS-bypassing `security definer` RPC), `@supabase/supabase-js`, Vitest (unit + `pg` integration gated on `TEST_DATABASE_URL`), pnpm.

## Global Constraints

- Domain language is Bosnian/Serbian (latinica) — identifiers, comments, and strings match existing style.
- `korisnici` RLS is self-select — any new server-side read of `korisnici` beyond the caller's own row MUST go through a `security definer` RPC (never `from("korisnici")` directly from request-path code).
- `db/types.ts` is auto-generated — never hand-edit; regenerate with `pnpm db:types` after the migration is applied to the local stack.
- The migration is NOT applied to cloud (DEMO/PROD) by the agent — that is a separate, user-run step (`pnpm db:apply-cloud --demo ...` then `--prod` after DEMO verification), per the DEMO/PROD lockstep rule.
- Backend testing goes through the local Docker Supabase stack (`supabase start`), never a live cloud DB.
- `termini.zaduzeni` stays free text — this plan changes only the suggestion list, not validation.
- `get_aktivni_korisnici()` (existing RPC) is NOT touched — it's still used by `aktivnost/page.tsx` and `KlijentPodsjetniciTab.tsx` for unrelated purposes.

**Reference spec:** `docs/superpowers/specs/2026-07-29-zaduzeni-po-firmi-design.md`

---

### Task 1: `get_zaduzeni_dodjele()` RPC

**Files:**
- Create: `supabase/migrations/20260729130000_get_zaduzeni_dodjele_rpc.sql`
- Create: `lib/queries/zaduzeniDodjele.integration.test.ts`

**Interfaces:**
- Produces: Postgres function `get_zaduzeni_dodjele() returns table (klijent_id uuid, ime text)`, callable via `supabase.rpc("get_zaduzeni_dodjele")` once `db/types.ts` is regenerated (this task's last step).

- [ ] **Step 1: Write the failing integration test**

Create `lib/queries/zaduzeniDodjele.integration.test.ts`:

```ts
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

  async function noviKlijent(naziv = "ITEST firma"): Promise<string> {
    const r = await db.query("insert into klijenti (naziv) values ($1) returning id", [naziv])
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
```

- [ ] **Step 2: Confirm the local stack is up and run the test to verify it fails**

Run: `supabase status` (confirm it's running; if not, run `supabase start` from the project root first).

Run:
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/queries/zaduzeniDodjele.integration.test.ts
```
Expected: FAIL — `function get_zaduzeni_dodjele() does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260729130000_get_zaduzeni_dodjele_rpc.sql`:

```sql
-- supabase/migrations/20260729130000_get_zaduzeni_dodjele_rpc.sql
-- Firma-scoped prijedlozi za polje "Zaduženi"
-- (docs/superpowers/specs/2026-07-29-zaduzeni-po-firmi-design.md).
--
-- get_aktivni_korisnici() (20260726122000) vraća SVE aktivne korisnike bez obzira na firmu —
-- prejednostavno za operatera koji radi samo par klijenata. Ovaj RPC vraća parove
-- (klijent_id, ime) za korisnike koji TRENUTNO IMAJU PRISTUP toj firmi — ista logika kao
-- ima_pristup_klijentu() (20260626210000): admin (uvijek, sve firme) union operater/pregled
-- sa eksplicitnom dodjelom u korisnik_klijent (dodjelu uređuje admin u
-- Postavke → Korisnici, KorisniciTab/KorisniciTabela).
--
-- SECURITY DEFINER iz istog razloga kao get_aktivni_korisnici: RLS polisa `korisnici_sel`
-- je self-select — direktan upit sa klijenta bi operateru vratio samo njega samog.
-- PII minimizacija, isti princip kao get_aktivni_korisnici: samo klijent_id (uuid,
-- potreban za grupisanje na klijentu) i ime — NIKAD email/uloga/id korisnika.
--
-- `set search_path = public` je obavezna definer higijena (spriječava schema injection
-- preko search_path pozivaoca).
create or replace function get_zaduzeni_dodjele()
returns table (klijent_id uuid, ime text)
language sql
stable
security definer
set search_path = public
as $$
  select kl.id, k.ime
  from klijenti kl
  cross join korisnici k
  where k.aktivan and k.uloga = 'admin'
  union
  select kk.klijent_id, k.ime
  from korisnik_klijent kk
  join korisnici k on k.id = kk.korisnik_id
  where k.aktivan
  order by 1, 2;
$$;

-- Definer funkcija koja probija RLS → nikad anon; samo prijavljeni korisnici.
revoke execute on function get_zaduzeni_dodjele() from public;
grant execute on function get_zaduzeni_dodjele() to authenticated;
```

- [ ] **Step 4: Apply the migration to the local stack and run the test to verify it passes**

Run: `pnpm db:reset`

Run:
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/queries/zaduzeniDodjele.integration.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Regenerate `db/types.ts`**

Run: `pnpm db:types`

Confirm `db/types.ts` now has a `get_zaduzeni_dodjele` entry under `Database["public"]["Functions"]` (grep for it: `grep -n "get_zaduzeni_dodjele" db/types.ts`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729130000_get_zaduzeni_dodjele_rpc.sql lib/queries/zaduzeniDodjele.integration.test.ts db/types.ts
git commit -m "feat: dodaj get_zaduzeni_dodjele RPC za firma-scoped Zaduženi prijedloge"
```

---

### Task 2: Grouping function + server query wrapper

**Files:**
- Modify: `lib/queries/aktivni-korisnici.ts`
- Modify: `lib/queries/aktivni-korisnici.test.ts`

**Interfaces:**
- Consumes: `supabase.rpc("get_zaduzeni_dodjele")` (Task 1) via `createServerSupabaseClient()` from `@/lib/supabase/server`.
- Produces: `grupisiPrijedlogeByFirma(redovi): Record<string, string[]>` (pure, exported) and `dohvatiZaduzeniPrijedlogeByFirma(): Promise<Record<string, string[]>>` (server-only, exported) — both consumed by Task 3.

- [ ] **Step 1: Write the failing unit tests**

Add to the top of `lib/queries/aktivni-korisnici.test.ts` (alongside the existing `import`):

```ts
import { describe, it, expect } from "vitest"
import { imenaZaPrijedloge, grupisiPrijedlogeByFirma } from "./aktivni-korisnici"
```

Append at the end of the file (after the existing `describe("imenaZaPrijedloge", ...)` block):

```ts

describe("grupisiPrijedlogeByFirma", () => {
  it("prazan/nedostajući ulaz → prazan objekat", () => {
    expect(grupisiPrijedlogeByFirma(null)).toEqual({})
    expect(grupisiPrijedlogeByFirma(undefined)).toEqual({})
    expect(grupisiPrijedlogeByFirma([])).toEqual({})
  })

  it("grupiše po klijent_id, izbacuje redove bez firme ili imena", () => {
    expect(
      grupisiPrijedlogeByFirma([
        { klijent_id: "k1", ime: "Ana" },
        { klijent_id: "k1", ime: "Marko" },
        { klijent_id: "k2", ime: "Ana" },
        { klijent_id: null, ime: "Bez firme" },
        { klijent_id: "k1", ime: "" },
      ]),
    ).toEqual({
      k1: ["Ana", "Marko"],
      k2: ["Ana"],
    })
  })

  it("dedup unutar iste firme (trim), sortira po lokalnom poretku", () => {
    expect(
      grupisiPrijedlogeByFirma([
        { klijent_id: "k1", ime: "Marko" },
        { klijent_id: "k1", ime: " Marko " },
        { klijent_id: "k1", ime: "Ana" },
        { klijent_id: "k1", ime: "Čedo" },
      ]),
    ).toEqual({ k1: ["Ana", "Čedo", "Marko"] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/queries/aktivni-korisnici.test.ts`
Expected: FAIL — `grupisiPrijedlogeByFirma is not a function` (or unresolved import).

- [ ] **Step 3: Implement**

Append to `lib/queries/aktivni-korisnici.ts` (after the existing `dohvatiImenaAktivnihKorisnika` function, end of file):

```ts

/**
 * Prijedlozi za polje „Zaduženi" ograničeni na firmu (docs/superpowers/specs/
 * 2026-07-29-zaduzeni-po-firmi-design.md). Izvor je RPC `get_zaduzeni_dodjele()`
 * (SECURITY DEFINER, v. `20260729130000_get_zaduzeni_dodjele_rpc.sql`) — isti razlog
 * kao gore: RLS polisa `korisnici_sel` je self-select.
 */

/** Čist dio: (klijent_id, ime) parovi → mapa firma→imena (bez praznih, bez duplikata, sortirano). */
export function grupisiPrijedlogeByFirma(
  redovi: { klijent_id?: string | null; ime?: string | null }[] | null | undefined,
): Record<string, string[]> {
  const poFirmi = new Map<string, Set<string>>()
  for (const red of redovi ?? []) {
    const klijentId = (red.klijent_id ?? "").trim()
    const ime = (red.ime ?? "").trim()
    if (klijentId === "" || ime === "") continue
    if (!poFirmi.has(klijentId)) poFirmi.set(klijentId, new Set())
    poFirmi.get(klijentId)!.add(ime)
  }
  const rezultat: Record<string, string[]> = {}
  for (const [klijentId, imena] of poFirmi) {
    rezultat[klijentId] = [...imena].sort((a, b) => a.localeCompare(b))
  }
  return rezultat
}

/**
 * Server-only: prijedlozi za „Zaduženi" grupisani po firmi.
 *
 * Na grešku vraća prazan objekat umjesto da baca — prijedlozi su sporedni UX sloj i
 * ne smiju oboriti ekran (isti princip kao `dohvatiImenaAktivnihKorisnika`).
 */
export async function dohvatiZaduzeniPrijedlogeByFirma(): Promise<Record<string, string[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_zaduzeni_dodjele")
  if (error) return {}
  return grupisiPrijedlogeByFirma(data)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/queries/aktivni-korisnici.test.ts`
Expected: PASS, 7 tests (4 existing `imenaZaPrijedloge` + 3 new `grupisiPrijedlogeByFirma`).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (confirms `supabase.rpc("get_zaduzeni_dodjele")` resolves against the regenerated `db/types.ts` from Task 1).

- [ ] **Step 6: Commit**

```bash
git add lib/queries/aktivni-korisnici.ts lib/queries/aktivni-korisnici.test.ts
git commit -m "feat: grupisiPrijedlogeByFirma + dohvatiZaduzeniPrijedlogeByFirma"
```

---

### Task 3: Wire `plan-aktivnosti` page + views to the per-firma map, retire the old global list

**Files:**
- Modify: `app/(dashboard)/plan-aktivnosti/page.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/lista.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx`
- Modify: `lib/queries/aktivni-korisnici.ts` (remove now-dead code)
- Modify: `lib/queries/aktivni-korisnici.test.ts` (remove now-dead tests)
- Modify: `components/domain/ZaduzeniPolje.tsx` (doc comment only)

**Interfaces:**
- Consumes: `dohvatiZaduzeniPrijedlogeByFirma()` (Task 2).
- Produces: `zaduzeniPrijedloziByFirma: Record<string, string[]>` prop, threaded from `page.tsx` down through the three views to `NoviTerminButton`/`TerminSheet` — this is the prop name Tasks 4 and 5 receive.

- [ ] **Step 1: Swap the fetch in `page.tsx`**

In `app/(dashboard)/plan-aktivnosti/page.tsx`, change the import:

```ts
import { dohvatiImenaAktivnihKorisnika } from "@/lib/queries/aktivni-korisnici"
```
to:
```ts
import { dohvatiZaduzeniPrijedlogeByFirma } from "@/lib/queries/aktivni-korisnici"
```

Change the fetch block:
```ts
  const [godine, zaduzeniPrijedlozi] = await Promise.all([
    dohvatiGodineTermina(),
    dohvatiImenaAktivnihKorisnika(),
  ])
```
to:
```ts
  const [godine, zaduzeniPrijedloziByFirma] = await Promise.all([
    dohvatiGodineTermina(),
    dohvatiZaduzeniPrijedlogeByFirma(),
  ])
```

Update the three JSX usages (`zaduzeniPrijedlozi={zaduzeniPrijedlozi}` → `zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma}`) for `ListaView`, `KalendarView`, `MatricaView`.

- [ ] **Step 2: Update the three view prop signatures**

In `app/(dashboard)/plan-aktivnosti/_views/lista.tsx`, change:
```ts
export function ListaView({
  godine,
  zaduzeniPrijedlozi,
}: {
  godine: number[]
  zaduzeniPrijedlozi: string[]
}) {
```
to:
```ts
export function ListaView({
  godine,
  zaduzeniPrijedloziByFirma,
}: {
  godine: number[]
  zaduzeniPrijedloziByFirma: Record<string, string[]>
}) {
```

And its two pass-through usages further down (`<NoviTerminButton ... zaduzeniPrijedlozi={zaduzeniPrijedlozi} />` and `<TerminSheet ... zaduzeniPrijedlozi={zaduzeniPrijedlozi} />`) both become `zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma}`.

Apply the same signature rename (destructure + type) in `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx` and `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx`, and rename their single `<TerminSheet ... zaduzeniPrijedlozi={zaduzeniPrijedlozi} />` pass-through the same way.

- [ ] **Step 3: Remove the now-dead global list code**

`dohvatiImenaAktivnihKorisnika` and `imenaZaPrijedloge` in `lib/queries/aktivni-korisnici.ts` have no remaining callers after Step 1 (`grep -rn "dohvatiImenaAktivnihKorisnika\|imenaZaPrijedloge" app components lib --include="*.ts" --include="*.tsx"` should only show the definitions themselves after this step). Delete both functions and the file's original top-of-file doc comment block that describes them, replacing it with a short pointer to the new one already added in Task 2 (avoid a duplicate/contradictory header). The file should read:

```ts
import { createServerSupabaseClient } from "@/lib/supabase/server"

/**
 * Prijedlozi za polje „Zaduženi" ograničeni na firmu (docs/superpowers/specs/
 * 2026-07-29-zaduzeni-po-firmi-design.md). Izvor je RPC `get_zaduzeni_dodjele()`
 * (SECURITY DEFINER, v. `20260729130000_get_zaduzeni_dodjele_rpc.sql`) — RLS polisa
 * `korisnici_sel` je self-select, pa direktan `from("korisnici")` vrati operateru
 * samo njega samog (tiha regresija koju admin-testiranje ne otkriva).
 *
 * `termini.zaduzeni` je i dalje SLOBODAN TEKST (nije FK) — polje ostaje otvoreno za
 * unos, prijedlozi su UX sloj.
 */

/** Čist dio: (klijent_id, ime) parovi → mapa firma→imena (bez praznih, bez duplikata, sortirano). */
export function grupisiPrijedlogeByFirma(
  redovi: { klijent_id?: string | null; ime?: string | null }[] | null | undefined,
): Record<string, string[]> {
  const poFirmi = new Map<string, Set<string>>()
  for (const red of redovi ?? []) {
    const klijentId = (red.klijent_id ?? "").trim()
    const ime = (red.ime ?? "").trim()
    if (klijentId === "" || ime === "") continue
    if (!poFirmi.has(klijentId)) poFirmi.set(klijentId, new Set())
    poFirmi.get(klijentId)!.add(ime)
  }
  const rezultat: Record<string, string[]> = {}
  for (const [klijentId, imena] of poFirmi) {
    rezultat[klijentId] = [...imena].sort((a, b) => a.localeCompare(b))
  }
  return rezultat
}

/**
 * Server-only: prijedlozi za „Zaduženi" grupisani po firmi.
 *
 * Na grešku vraća prazan objekat umjesto da baca — prijedlozi su sporedni UX sloj i
 * ne smiju oboriti ekran (isti princip kao `dohvatiGodineTermina`).
 */
export async function dohvatiZaduzeniPrijedlogeByFirma(): Promise<Record<string, string[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_zaduzeni_dodjele")
  if (error) return {}
  return grupisiPrijedlogeByFirma(data)
}
```

In `lib/queries/aktivni-korisnici.test.ts`, delete the `describe("imenaZaPrijedloge", ...)` block and its now-unused `imenaZaPrijedloge` import (keep the `grupisiPrijedlogeByFirma` import and its `describe` block from Task 2).

- [ ] **Step 4: Update the stale doc comment in `ZaduzeniPolje.tsx`**

In `components/domain/ZaduzeniPolje.tsx`, change:
```tsx
 * Imena stižu propom iz server komponente (`dohvatiImenaAktivnihKorisnika`) —
 * nikad direktnim `from("korisnici")` upitom (RLS self-select bi operateru dao
 * samo njega samog).
```
to:
```tsx
 * Imena stižu propom iz server komponente (`dohvatiZaduzeniPrijedlogeByFirma`) —
 * nikad direktnim `from("korisnici")` upitom (RLS self-select bi operateru dao
 * samo njega samog).
```
(`ZaduzeniPolje`'s own code/props are unchanged — this is a comment-only edit.)

- [ ] **Step 5: Verify nothing else references the removed names**

Run: `grep -rn "dohvatiImenaAktivnihKorisnika\|imenaZaPrijedloge" app components lib --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: errors in `NoviTerminButton.tsx` and `TerminSheet.tsx` (`zaduzeniPrijedlozi` prop no longer provided by their callers) — this is expected; Tasks 4 and 5 fix them. Confirm the errors are ONLY in those two files (no stray references left from Steps 1-4).

- [ ] **Step 7: Commit**

```bash
git add app/\(dashboard\)/plan-aktivnosti/page.tsx app/\(dashboard\)/plan-aktivnosti/_views/lista.tsx app/\(dashboard\)/plan-aktivnosti/_views/kalendar.tsx app/\(dashboard\)/plan-aktivnosti/_views/matrica.tsx lib/queries/aktivni-korisnici.ts lib/queries/aktivni-korisnici.test.ts components/domain/ZaduzeniPolje.tsx
git commit -m "feat: provuci zaduzeniPrijedloziByFirma kroz plan-aktivnosti, ukloni stari globalni izvor"
```

---

### Task 4: `NoviTerminButton` — prijedlozi po izabranoj firmi

**Files:**
- Modify: `components/domain/NoviTerminButton.tsx`

**Interfaces:**
- Consumes: `zaduzeniPrijedloziByFirma: Record<string, string[]>` prop (Task 3), local `klijentId` state (already exists in the component).

- [ ] **Step 1: Rename the prop and derive the firma-scoped list**

In `components/domain/NoviTerminButton.tsx`, change the prop destructure/type:
```ts
export function NoviTerminButton({
  klijenti,
  vrste,
  lokacijeByFirma,
  zaduzeniPrijedlozi,
}: {
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
  /** S8.6: imena aktivnih korisnika iz `get_aktivni_korisnici()` (prijedlozi, ne ograničenje). */
  zaduzeniPrijedlozi: string[]
}) {
```
to:
```ts
export function NoviTerminButton({
  klijenti,
  vrste,
  lokacijeByFirma,
  zaduzeniPrijedloziByFirma,
}: {
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
  /** Imena korisnika koji imaju pristup toj firmi (prijedlozi, ne ograničenje) — vidi
   * docs/superpowers/specs/2026-07-29-zaduzeni-po-firmi-design.md. */
  zaduzeniPrijedloziByFirma: Record<string, string[]>
}) {
```

Right after the existing `const lokacije = klijentId ? lokacijeByFirma[klijentId] ?? [] : []` line, add:
```ts
  // Prazno dok firma nije izabrana — najjasnije ponašanje (potvrđeno u dizajnu), nema
  // fallback-a na globalnu listu.
  const zaduzeniPrijedlozi = klijentId ? zaduzeniPrijedloziByFirma[klijentId] ?? [] : []
```

The existing `<ZaduzeniPolje prijedlozi={zaduzeniPrijedlozi} .../>` JSX below needs NO change — the local variable name is preserved.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors in `NoviTerminButton.tsx` (its share of the Task 3 typecheck failure is now resolved).

- [ ] **Step 3: Commit**

```bash
git add components/domain/NoviTerminButton.tsx
git commit -m "feat: NoviTerminButton koristi zaduzeniPrijedloziByFirma po izabranoj firmi"
```

---

### Task 5: `TerminSheet` — prijedlozi po firmi postojećeg termina

**Files:**
- Modify: `components/domain/TerminSheet.tsx`

**Interfaces:**
- Consumes: `zaduzeniPrijedloziByFirma: Record<string, string[]>` prop (Task 3), `termin.klijent_id` (already present on `TerminRow`, confirmed via `db/types.ts` `termini_view`).

- [ ] **Step 1: Rename the prop and derive the firma-scoped list**

In `components/domain/TerminSheet.tsx`, change:
```ts
export function TerminSheet({
  termin,
  istorija,
  dokumenti,
  closeHref,
  zaduzeniPrijedlozi,
}: {
  termin: TerminRow
  istorija: TerminRow[]
  dokumenti: Database["public"]["Tables"]["dokumenti"]["Row"][]
  closeHref: string
  /** S8.6: imena aktivnih korisnika iz `get_aktivni_korisnici()` (prijedlozi, ne ograničenje). */
  zaduzeniPrijedlozi: string[]
}) {
```
to:
```ts
export function TerminSheet({
  termin,
  istorija,
  dokumenti,
  closeHref,
  zaduzeniPrijedloziByFirma,
}: {
  termin: TerminRow
  istorija: TerminRow[]
  dokumenti: Database["public"]["Tables"]["dokumenti"]["Row"][]
  closeHref: string
  /** Imena korisnika koji imaju pristup toj firmi (prijedlozi, ne ograničenje) — vidi
   * docs/superpowers/specs/2026-07-29-zaduzeni-po-firmi-design.md. */
  zaduzeniPrijedloziByFirma: Record<string, string[]>
}) {
```

Right after the function's opening (alongside the other `const ... = useTranslations(...)` / hook declarations near the top of the function body, before the JSX `return`), add:
```ts
  const zaduzeniPrijedlozi = zaduzeniPrijedloziByFirma[termin.klijent_id] ?? []
```

The existing `<ZaduzeniPolje prijedlozi={zaduzeniPrijedlozi} .../>` JSX needs NO change.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors anywhere in the project (this resolves the remaining half of the Task 3 typecheck failure).

- [ ] **Step 3: Commit**

```bash
git add components/domain/TerminSheet.tsx
git commit -m "feat: TerminSheet koristi zaduzeniPrijedloziByFirma po firmi termina"
```

---

### Task 6: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `pnpm test:unit`
Expected: all pass, including the 7 tests in `lib/queries/aktivni-korisnici.test.ts` and (if `TEST_DATABASE_URL` is set per Task 1) the 4 in `lib/queries/zaduzeniDodjele.integration.test.ts`.

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Manual check in the browser**

Run: `pnpm dev` (boots on port 3000 with `--webpack`), sign in, go to Plan aktivnosti → „Novi termin". Pick a firma with no `korisnik_klijent` dodjele for the logged-in operater — confirm the „Zaduženi" field shows no datalist suggestions (still freely typeable). Pick a firma the current user (or an admin) is assigned to — confirm the datalist now shows only admins + that firma's assigned korisnici, not the full company roster. Open an existing termin (edit sheet) and confirm the same scoping applies there.

- [ ] **Step 4: Check existing e2e specs that touch `novi-zaduzeni` / `edit-zaduzeni` / `zaduzeni-prijedlozi`**

Run: `grep -rln "novi-zaduzeni\|edit-zaduzeni\|zaduzeni-prijedlozi" tests/e2e`

For each matching spec, read the assertion around that testId. If a spec picks a firma with no dodjela and asserts the datalist is non-empty (relying on the old global-list behavior), that assertion is now wrong by design (per the spec's Testiranje section) — fix the spec's fixture data (assign the acting user to that firma via `korisnik_klijent` in the fixture, or assert emptiness) rather than reverting the feature. Do not add new e2e specs beyond what's needed to keep the existing suite accurate.

- [ ] **Step 5: Note the cloud migration step for the user**

This plan does NOT apply `20260729130000_get_zaduzeni_dodjele_rpc.sql` to DEMO or PROD — tell the user it's ready for `pnpm db:apply-cloud --demo supabase/migrations/20260729130000_get_zaduzeni_dodjele_rpc.sql`, verify on DEMO, then `POTVRDI_PROD=da pnpm db:apply-cloud --prod ...`.
