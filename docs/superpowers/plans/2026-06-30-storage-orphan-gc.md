# Storage Orphan GC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reconciliation (GC) job that finds and removes orphan files in the Storage bucket (files with no matching `dokumenti` row), running in dry-run by default.

**Architecture:** Pure diff logic lives in `lib/dokumenti-gc.ts` (unit-tested, deterministic — takes injected `sada`/`graceMs`). A thin I/O script `scripts/gc-orphan-dokumenti.ts` lists the bucket recursively, queries `dokumenti.storage_path`, calls the pure function, and reports orphans (dry-run) or deletes them (`--apply`). Files newer than a grace period are never deleted (protects in-flight uploads). Broken DB rows (row exists, file missing) are only reported, never auto-deleted.

**Tech Stack:** TypeScript, `tsx --env-file=.env.local`, Supabase service-role admin client (`lib/supabase/admin`), Supabase Storage JS API, Vitest.

## Global Constraints

- **Package manager: `pnpm`** (never npm/yarn).
- **Admin/service-role client only in `scripts/`** (this whole feature is a script + a pure lib helper — never imported by `app/` or `components/`).
- **`no-await-in-loop` is allowed in `scripts/`** (lint rule is disabled there); pure lib code must stay loop-await-free (it has no I/O anyway).
- **TZ-safe time:** the pure function takes `sada: number` (epoch ms) and `graceMs: number` as arguments — no `Date.now()` inside the pure module, so tests are deterministic.
- **Domain language is Bosnian/Serbian (latinica)** for identifiers and copy — match it (`analizirajOrphan`, `orphanFajlovi`, …).
- **Bucket name + path scopes are fixed:** bucket `tehpro-dokumenti` (`DOKUMENTI_BUCKET` from `lib/supabase/storage.ts`); object paths are `klijenti/<id>/<uuid>-<name>`, `ugovori/<id>/<uuid>-<name>`, `termini/<id>/<uuid>-<name>` (from `dokumentStoragePath` in `lib/dokumenti.ts`).
- **Default is dry-run.** Real deletion requires the explicit `--apply` flag. Broken DB rows are reported only — the GC never deletes `dokumenti` rows.

---

## File Structure

- **Create `lib/dokumenti-gc.ts`** — pure reconciliation logic. One export: `analizirajOrphan(...)` + the `StorageObjekat` / `GcRezultat` types. No I/O, no Supabase import.
- **Create `lib/dokumenti-gc.test.ts`** — Vitest unit tests for `analizirajOrphan` (orphan-old, orphan-fresh, has-row, broken-row, empty).
- **Create `scripts/gc-orphan-dokumenti.ts`** — I/O wrapper: recursive bucket listing + `dokumenti` query + call pure fn + report (dry-run) / delete (`--apply`).
- **Modify `package.json`** (scripts block, ~line 24) — add `"gc:dokumenti"`.

---

### Task 1: Pure reconciliation logic (`analizirajOrphan`)

**Files:**
- Create: `lib/dokumenti-gc.ts`
- Test: `lib/dokumenti-gc.test.ts`

**Interfaces:**
- Consumes: nothing (pure, standalone).
- Produces:
  - `type StorageObjekat = { path: string; updatedAt: string }` — one bucket file (full path + ISO timestamp).
  - `type GcRezultat = { orphanFajlovi: string[]; presvjeziOrphani: string[]; slomljeniRedovi: string[] }`.
  - `analizirajOrphan(args: { bucketObjekti: StorageObjekat[]; dbPutanje: string[]; sada: number; graceMs: number }): GcRezultat` — `orphanFajlovi` = in bucket, no DB row, age ≥ grace (deletable); `presvjeziOrphani` = orphan but age < grace (skip); `slomljeniRedovi` = DB path with no bucket file (report only).

- [ ] **Step 1: Write the failing test**

Create `lib/dokumenti-gc.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { analizirajOrphan } from "./dokumenti-gc"

const SADA = Date.parse("2026-06-30T12:00:00.000Z")
const GRACE = 24 * 60 * 60 * 1000 // 24h

describe("analizirajOrphan", () => {
  it("stari orphan fajl (nema red, ≥ grace) → kandidat za brisanje", () => {
    const r = analizirajOrphan({
      bucketObjekti: [{ path: "klijenti/k1/a.pdf", updatedAt: "2026-06-28T12:00:00.000Z" }],
      dbPutanje: [],
      sada: SADA,
      graceMs: GRACE,
    })
    expect(r.orphanFajlovi).toEqual(["klijenti/k1/a.pdf"])
    expect(r.presvjeziOrphani).toEqual([])
    expect(r.slomljeniRedovi).toEqual([])
  })

  it("svjež orphan (< grace) → preskočen", () => {
    const r = analizirajOrphan({
      bucketObjekti: [{ path: "klijenti/k1/b.pdf", updatedAt: "2026-06-30T11:30:00.000Z" }],
      dbPutanje: [],
      sada: SADA,
      graceMs: GRACE,
    })
    expect(r.orphanFajlovi).toEqual([])
    expect(r.presvjeziOrphani).toEqual(["klijenti/k1/b.pdf"])
  })

  it("fajl koji ima red u bazi → ignorisan", () => {
    const r = analizirajOrphan({
      bucketObjekti: [{ path: "klijenti/k1/c.pdf", updatedAt: "2026-06-01T00:00:00.000Z" }],
      dbPutanje: ["klijenti/k1/c.pdf"],
      sada: SADA,
      graceMs: GRACE,
    })
    expect(r.orphanFajlovi).toEqual([])
    expect(r.presvjeziOrphani).toEqual([])
    expect(r.slomljeniRedovi).toEqual([])
  })

  it("red u bazi bez fajla → slomljeni red (samo prijava)", () => {
    const r = analizirajOrphan({
      bucketObjekti: [],
      dbPutanje: ["klijenti/k1/d.pdf"],
      sada: SADA,
      graceMs: GRACE,
    })
    expect(r.slomljeniRedovi).toEqual(["klijenti/k1/d.pdf"])
    expect(r.orphanFajlovi).toEqual([])
  })

  it("prazni ulazi → prazan rezultat", () => {
    const r = analizirajOrphan({ bucketObjekti: [], dbPutanje: [], sada: SADA, graceMs: GRACE })
    expect(r).toEqual({ orphanFajlovi: [], presvjeziOrphani: [], slomljeniRedovi: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/dokumenti-gc.test.ts`
Expected: FAIL — `Failed to resolve import "./dokumenti-gc"` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/dokumenti-gc.ts`:

```ts
// Pure reconciliation: uparuje bucket fajlove i dokumenti.storage_path.
// Bez I/O — vrijeme i grace se INJEKTUJU radi determinističnih testova.

export type StorageObjekat = { path: string; updatedAt: string } // ISO timestamp

export type GcRezultat = {
  orphanFajlovi: string[] // u bucketu, nema reda, dovoljno star → za brisanje
  presvjeziOrphani: string[] // orphan ali mlađi od grace → preskoči (in-flight zaštita)
  slomljeniRedovi: string[] // dokumenti.storage_path bez fajla → SAMO prijava
}

export function analizirajOrphan(args: {
  bucketObjekti: StorageObjekat[]
  dbPutanje: string[]
  sada: number
  graceMs: number
}): GcRezultat {
  const dbSet = new Set(args.dbPutanje)
  const bucketSet = new Set(args.bucketObjekti.map((o) => o.path))

  const orphanFajlovi: string[] = []
  const presvjeziOrphani: string[] = []
  for (const o of args.bucketObjekti) {
    if (dbSet.has(o.path)) continue
    const starostMs = args.sada - Date.parse(o.updatedAt)
    if (starostMs >= args.graceMs) orphanFajlovi.push(o.path)
    else presvjeziOrphani.push(o.path)
  }

  const slomljeniRedovi = args.dbPutanje.filter((p) => !bucketSet.has(p))

  return { orphanFajlovi, presvjeziOrphani, slomljeniRedovi }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/dokumenti-gc.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors (warnings unrelated to these files are fine).

- [ ] **Step 6: Commit**

```bash
git add lib/dokumenti-gc.ts lib/dokumenti-gc.test.ts
git commit -m "feat(dokumenti): pure orphan reconciliation logic + tests"
```

---

### Task 2: GC script + `pnpm gc:dokumenti` (dry-run by default)

**Files:**
- Create: `scripts/gc-orphan-dokumenti.ts`
- Modify: `package.json` (scripts block, after the `seed:admin` line ~24)

**Interfaces:**
- Consumes: `analizirajOrphan`, `StorageObjekat` from `../lib/dokumenti-gc`; `createAdminSupabaseClient` from `../lib/supabase/admin`; `DOKUMENTI_BUCKET` from `../lib/supabase/storage`.
- Produces: CLI side-effects only (console report; bucket deletions when `--apply`). No exports.

- [ ] **Step 1: Write the script**

Create `scripts/gc-orphan-dokumenti.ts`:

```ts
/**
 * GC: čišćenje ORPHAN fajlova iz Storage bucketa (tehpro-dokumenti).
 * Orphan = fajl u bucketu bez reda u tabeli `dokumenti`.
 *
 * Default = DRY-RUN (samo izvještaj; ništa se ne briše).
 * Stvarno brisanje:        pnpm gc:dokumenti -- --apply
 * Grace (ne diraj svjež):  pnpm gc:dokumenti -- --grace-hours=24   (default 24)
 *
 * Slomljeni redovi (red u bazi, fajl fali) se SAMO prijavljuju — nikad ne brišu.
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { DOKUMENTI_BUCKET } from "../lib/supabase/storage"
import { analizirajOrphan, type StorageObjekat } from "../lib/dokumenti-gc"

const apply = process.argv.includes("--apply")
const graceArg = process.argv.find((a) => a.startsWith("--grace-hours="))
const graceHours = graceArg ? Number(graceArg.split("=")[1]) : 24
const graceMs = graceHours * 60 * 60 * 1000

type Sb = ReturnType<typeof createAdminSupabaseClient>
const PAGE = 100

// Rekurzivno izlistaj sve FAJLOVE ispod prefiksa. Folderi imaju id === null.
async function listajFajlove(sb: Sb, prefix: string): Promise<StorageObjekat[]> {
  const rezultat: StorageObjekat[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await sb.storage
      .from(DOKUMENTI_BUCKET)
      .list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`list "${prefix}": ${error.message}`)
    const stavke = data ?? []
    for (const s of stavke) {
      const puniPut = prefix ? `${prefix}/${s.name}` : s.name
      if (s.id === null) {
        const ugnijezdeni = await listajFajlove(sb, puniPut) // folder → rekurzija
        rezultat.push(...ugnijezdeni)
      } else {
        rezultat.push({
          path: puniPut,
          updatedAt: s.updated_at ?? s.created_at ?? new Date(0).toISOString(),
        })
      }
    }
    if (stavke.length < PAGE) break
    offset += PAGE
  }
  return rezultat
}

async function main() {
  const sb = createAdminSupabaseClient()

  // 1) svi fajlovi u bucketu (rekurzivno kroz klijenti/ ugovori/ termini/)
  const bucketObjekti = await listajFajlove(sb, "")

  // 2) sve putanje iz baze
  const { data: dok, error } = await sb.from("dokumenti").select("storage_path")
  if (error) throw new Error(`select dokumenti: ${error.message}`)
  const dbPutanje = (dok ?? []).map((d) => d.storage_path as string)

  // 3) analiza
  const r = analizirajOrphan({ bucketObjekti, dbPutanje, sada: Date.now(), graceMs })

  console.log(`Bucket fajlova: ${bucketObjekti.length} · DB redova: ${dbPutanje.length}`)
  console.log(`Orphan za brisanje (≥ ${graceHours}h): ${r.orphanFajlovi.length}`)
  console.log(`Svjež orphan, preskočen (< ${graceHours}h): ${r.presvjeziOrphani.length}`)
  console.log(`Slomljeni redovi (fajl fali — SAMO PRIJAVA): ${r.slomljeniRedovi.length}`)
  for (const p of r.slomljeniRedovi) console.warn(`  ⚠ slomljen red → ${p}`)

  if (!apply) {
    console.log("\nDRY-RUN — ništa nije obrisano. Za stvarno brisanje: pnpm gc:dokumenti -- --apply")
    for (const p of r.orphanFajlovi) console.log(`  bi obrisao → ${p}`)
    return
  }

  // 4) stvarno brisanje u batch-evima od 100
  let obrisano = 0
  for (let i = 0; i < r.orphanFajlovi.length; i += PAGE) {
    const grupa = r.orphanFajlovi.slice(i, i + PAGE)
    const { error: delErr } = await sb.storage.from(DOKUMENTI_BUCKET).remove(grupa)
    if (delErr) throw new Error(`remove batch: ${delErr.message}`)
    obrisano += grupa.length
  }
  console.log(`\nObrisano orphan fajlova: ${obrisano}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Add the `gc:dokumenti` script to `package.json`**

In `package.json`, the scripts block currently ends with the `seed:admin` line. Change:

```json
    "seed:admin": "tsx --env-file=.env.local scripts/seed-admin.ts"
```

to (add a comma and the new line):

```json
    "seed:admin": "tsx --env-file=.env.local scripts/seed-admin.ts",
    "gc:dokumenti": "tsx --env-file=.env.local scripts/gc-orphan-dokumenti.ts"
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors. (The script may use `await`-in-loop — allowed in `scripts/`.)

- [ ] **Step 4: Run the GC in DRY-RUN against the real DB/bucket**

Run: `pnpm gc:dokumenti`
Expected output shape (counts will vary):
```
Bucket fajlova: <N> · DB redova: <M>
Orphan za brisanje (≥ 24h): <k>
Svjež orphan, preskočen (< 24h): <j>
Slomljeni redovi (fajl fali — SAMO PRIJAVA): <i>
DRY-RUN — ništa nije obrisano. Za stvarno brisanje: pnpm gc:dokumenti -- --apply
  bi obrisao → klijenti/<id>/<uuid>-<naziv>
  ...
```
**STOP and review the printed orphan list with the user before any `--apply` run.** Confirm the listed paths are genuinely orphaned (deleted klijenti/termini) and that no current document appears.

- [ ] **Step 5: Commit**

```bash
git add scripts/gc-orphan-dokumenti.ts package.json
git commit -m "feat(scripts): gc:dokumenti — dry-run orphan storage reconciliation"
```

---

## Out of scope (follow-up, NOT in this plan)

These are deliberate next steps after the dry-run report is validated — do **not** build them here:

1. **Enable real deletion** — after the user reviews the dry-run list, run `pnpm gc:dokumenti -- --apply` (no code change; it's a flag).
2. **Scheduling** — wire a Vercel cron route (like the existing reminder cron) to run the GC on a schedule (e.g., nightly) once `--apply` is trusted.
3. **Queue-trigger for immediate cleanup** — a DB trigger on `dokumenti` DELETE that records `storage_path` into a `dokumenti_za_brisanje` table + an edge function that drains it. Catches cascade deletes promptly instead of waiting for the nightly GC. Separate plan.

---

## Self-Review

**1. Spec coverage:**
- "Find orphan files (bucket file, no DB row)" → Task 1 `orphanFajlovi` + Task 2 listing/query. ✓
- "Dry-run by default, real delete behind a flag" → Task 2 `--apply`. ✓
- "Don't delete in-flight uploads (grace period)" → Task 1 `presvjeziOrphani` + `--grace-hours`. ✓
- "Never auto-delete DB rows; report broken refs only" → Task 1 `slomljeniRedovi` (reported, never deleted in Task 2). ✓
- "Catch-all for all orphan causes (cascade/crash/partial-fail)" → GC compares full bucket vs full table, so cause-agnostic. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — all steps contain full code and exact commands. ✓

**3. Type consistency:** `StorageObjekat { path, updatedAt }` and `GcRezultat { orphanFajlovi, presvjeziOrphani, slomljeniRedovi }` are defined in Task 1 and consumed verbatim in Task 2 (`analizirajOrphan`, `StorageObjekat` import). Script field names (`orphanFajlovi`, `slomljeniRedovi`) match the type. ✓
