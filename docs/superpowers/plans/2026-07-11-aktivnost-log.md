# Aktivnost log (admin nadzor) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adminu dati zaseban ekran "Aktivnost" koji prikazuje jedinstveni tok događaja — promjene u bazi + otvaranje ekrana/zapisa + prijava/odjava + filteri — vidljiv samo adminu.

**Architecture:** Pristup A — proširujemo postojeći `audit_log` (nova `detalji jsonb` kolona + UI glagoli u `akcija`). DB promjene i dalje bilježi `tg_audit()` trigger; UI događaje upisuje `security definer` batch RPC pozvan iz klijentskog `<AktivnostTracker>` (baferovanje + sendBeacon). Admin ekran čita preko `aktivnost_view` + `get_aktivnost` RPC. Retencija 90 dana preko cron rute.

**Tech Stack:** Next.js 16 (App Router, `--webpack`), Supabase (Postgres + RLS), TypeScript, Vitest (unit), Playwright (E2E), next-intl, pnpm.

## Global Constraints

- Package manager: **pnpm** (nikad npm/yarn).
- Next.js 16: middleware je **`proxy.ts`** (ne `middleware.ts`). `next dev` uvijek sa `--webpack`.
- Tri supabase klijenta: **SSR** (`lib/supabase/server.ts`) u `app/`/`components/` request putanji; **admin** (`lib/supabase/admin.ts`) SAMO u `scripts/` i cron handlerima. Nikad admin klijent u request putanji.
- Domenski jezik: bosanski/srpski (latinica) — tabele, kolone, rute, identifikatori.
- Migracije: `supabase/migrations/*.sql` je izvor istine; `db/types.ts` je AUTO-GENERISAN (`pnpm db:types`), nikad ručno.
- Cloud migracije: jedna po jedna preko `pnpm db:apply-cloud <file>` (Supabase MCP NE dohvata cloud). PROD = `fqtqkehjidkzeasiegnq`, DEMO = `mtwwotmwrasozmcgqwhc`. E2E i lokalni dev rade protiv **DEMO**.
- Views moraju imati **`security_invoker = on`** ili zaobiđu RLS. Nova tabela bez policy → 0 redova (cloud event-trigger auto-enable RLS).
- i18n: next-intl tipizira ključeve prema literalnom JSON union-u — svaki novi ključ dodati u `messages/{sr,en,de}.json` u ISTOJ izmjeni, na paritetu. **Bez ICU `one` plural kategorije za `sr`.**
- Tailwind: bez `sm:`/`md:` breakpointa (lint zabrana) — koristiti `lg:`/`xl:`/`2xl:`. `no-await-in-loop: error` (osim `scripts/`).
- Uloge: `mozeUrediti` = admin||operater; `pregled` je read-only. Gate write kontrole. Ovaj ekran je **admin-only**.

---

## File Structure

**Kreirati:**
- `supabase/migrations/20260711130000_aktivnost_log.sql` — kolona, indeksi, RPC-ovi, view.
- `lib/aktivnost/tipovi.ts` — dijeljeni tipovi (`Akcija`, `DogadjajUnos`).
- `lib/aktivnost/mapiranje.ts` — čisto: ruta→događaj, filter→događaj.
- `lib/aktivnost/mapiranje.test.ts` — unit.
- `lib/aktivnost/bafer.ts` — čisto: bafer + dedup.
- `lib/aktivnost/bafer.test.ts` — unit.
- `app/api/aktivnost/route.ts` — POST batch endpoint (SSR klijent → RPC).
- `components/domain/AktivnostTracker.tsx` — klijentski tracker.
- `app/(dashboard)/aktivnost/page.tsx` — admin ekran.
- `components/domain/AktivnostFilteri.tsx` — filter traka (client).
- `components/domain/AktivnostTabela.tsx` — tabela + diff prikaz (server-renderable).
- `lib/queries/aktivnost.ts` — tipizirani wrapper za `get_aktivnost`.
- `app/api/cron/ciscenje-audita/route.ts` — cleanup cron.
- `tests/e2e/30-aktivnost.spec.ts` — E2E.

**Mijenjati:**
- `app/(dashboard)/layout.tsx` — montirati `<AktivnostTracker/>`.
- `app/prijava/actions.ts` — LOGIN log.
- `app/(dashboard)/odjava/actions.ts` — LOGOUT log.
- `components/shell/Sidebar.tsx` — admin-only nav stavka "Aktivnost".
- `i18n/routes.ts` — dodati `aktivnost` u `ROUTE_MAP`.
- `messages/sr.json`, `messages/en.json`, `messages/de.json` — `shell.nav.aktivnost` + `aktivnost` namespace.
- `db/types.ts` — regenerisati (`pnpm db:types`) nakon migracije.

---

## Task 1: DB migracija — kolona, indeksi, RPC-ovi, view

**Files:**
- Create: `supabase/migrations/20260711130000_aktivnost_log.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces:
  - `zabiljezi_dogadjaje(p_dogadjaji jsonb) → void` — upisuje UI događaje kao `auth.uid()`.
  - `aktivnost_view` — kolone: `id, vrijeme, korisnik_id, akcija, entitet, entitet_id, staro, novo, detalji, korisnik_ime, korisnik_email`.
  - `get_aktivnost(p_od,p_do,p_korisnik,p_akcija,p_entitet,p_pretraga,p_limit,p_offset)` → tabela (gornje kolone + `ukupno bigint`).
  - `obrisi_stare_dogadjaje() → integer` — briše `vrijeme < now()-90d`, vraća broj obrisanih.
  - Kolona `audit_log.detalji jsonb`.

- [ ] **Step 1: Napiši migraciju**

Create `supabase/migrations/20260711130000_aktivnost_log.sql`:

```sql
-- Aktivnost log (admin nadzor): proširuje audit_log u jedinstveni tok DB+UI događaja.
-- akcija dobija UI glagole: NAVIGATE, VIEW, LOGIN, LOGOUT, FILTER (pored INSERT/UPDATE/DELETE).

-- 1) UI kontekst (labela ekrana, filter parametri). Za UI redove staro/novo = null.
alter table audit_log add column if not exists detalji jsonb;

-- 2) Indeksi za filtriranje na admin ekranu (postoje već: vrijeme desc, entitet+entitet_id).
create index if not exists idx_audit_korisnik on audit_log (korisnik_id);
create index if not exists idx_audit_akcija   on audit_log (akcija);

-- 3) Batch upis UI događaja kao trenutni korisnik. Korisnik ne može lažirati tuđi id.
create or replace function zabiljezi_dogadjaje(p_dogadjaji jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into audit_log (korisnik_id, akcija, entitet, entitet_id, detalji)
  select auth.uid(),
         e->>'akcija',
         nullif(e->>'entitet', ''),
         nullif(e->>'entitet_id', ''),
         e->'detalji'
  from jsonb_array_elements(coalesce(p_dogadjaji, '[]'::jsonb)) as e
  where e->>'akcija' in ('NAVIGATE','VIEW','LOGIN','LOGOUT','FILTER');
end; $$;

grant execute on function zabiljezi_dogadjaje(jsonb) to authenticated;

-- 4) Read model: log + ime aktera. security_invoker=on da poštuje audit_log admin-only RLS.
create or replace view aktivnost_view
with (security_invoker = on) as
select a.id, a.vrijeme, a.korisnik_id, a.akcija, a.entitet, a.entitet_id,
       a.staro, a.novo, a.detalji,
       k.ime   as korisnik_ime,
       k.email as korisnik_email
from audit_log a
left join korisnici k on k.id = a.korisnik_id;

-- 5) Paginirano + filtrirano čitanje u jednom round-tripu. security invoker → RLS admin-only važi.
create or replace function get_aktivnost(
  p_od       timestamptz default null,
  p_do       timestamptz default null,
  p_korisnik uuid        default null,
  p_akcija   text        default null,
  p_entitet  text        default null,
  p_pretraga text        default null,
  p_limit    int         default 50,
  p_offset   int         default 0
)
returns table (
  id             bigint,
  vrijeme        timestamptz,
  korisnik_id    uuid,
  korisnik_ime   text,
  korisnik_email text,
  akcija         text,
  entitet        text,
  entitet_id     text,
  staro          jsonb,
  novo           jsonb,
  detalji        jsonb,
  ukupno         bigint
)
language sql stable security invoker set search_path = public as $$
  with f as (
    select *
    from aktivnost_view a
    where (p_od is null or a.vrijeme >= p_od)
      and (p_do is null or a.vrijeme <  p_do)
      and (p_korisnik is null or a.korisnik_id = p_korisnik)
      and (p_akcija  is null or a.akcija  = p_akcija)
      and (p_entitet is null or a.entitet = p_entitet)
      and (p_pretraga is null or (
           coalesce(a.entitet,'')      ilike '%'||p_pretraga||'%'
        or coalesce(a.entitet_id,'')   ilike '%'||p_pretraga||'%'
        or coalesce(a.korisnik_ime,'') ilike '%'||p_pretraga||'%'))
  )
  select f.id, f.vrijeme, f.korisnik_id, f.korisnik_ime, f.korisnik_email,
         f.akcija, f.entitet, f.entitet_id, f.staro, f.novo, f.detalji,
         count(*) over () as ukupno
  from f
  order by f.vrijeme desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function get_aktivnost(timestamptz,timestamptz,uuid,text,text,text,int,int) to authenticated;

-- 6) Retencija: briši starije od 90 dana. security definer (poziva se iz cron admin konteksta).
create or replace function obrisi_stare_dogadjaje()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_broj integer;
begin
  delete from audit_log where vrijeme < now() - interval '90 days';
  get diagnostics v_broj = row_count;
  return v_broj;
end; $$;
```

- [ ] **Step 2: Primijeni na DEMO (dev/E2E baza)**

Ref-guard NIJE potreban za DEMO. Primijeni:

Run: `pnpm db:apply-cloud supabase/migrations/20260711130000_aktivnost_log.sql`
(Podrazumijeva PROD preko `DATABASE_URL`; za DEMO koristi `DATABASE_URL_DEMO`. Provjeri README skripte — ako `db:apply-cloud` cilja PROD, primijeni na DEMO tako što privremeno pokažeš na `DATABASE_URL_DEMO`, ili primijeni lokalno preko `pnpm db:reset` ako je lokalni stack u upotrebi.)
Expected: `CREATE FUNCTION` / `ALTER TABLE` / `CREATE VIEW` bez greške.

- [ ] **Step 3: Verifikuj objekte (SQL smoke)**

Run (psql/pooler):
```sql
select column_name from information_schema.columns
  where table_name='audit_log' and column_name='detalji';
select proname from pg_proc
  where proname in ('zabiljezi_dogadjaje','get_aktivnost','obrisi_stare_dogadjaje');
select count(*) from get_aktivnost();
```
Expected: `detalji` postoji; sve tri funkcije izlistane; `get_aktivnost()` vraća redove bez greške (0+).

- [ ] **Step 4: Regeneriši tipove**

Run: `pnpm db:types`
Expected: `db/types.ts` sadrži `zabiljezi_dogadjaje`, `get_aktivnost`, `obrisi_stare_dogadjaje` u `Functions` i `detalji` u `audit_log` Row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260711130000_aktivnost_log.sql db/types.ts
git commit -m "feat(db): aktivnost log — detalji kolona, RPC upis/citanje, retencija"
```

---

## Task 2: Dijeljeni tipovi + mapiranje rute→događaj

**Files:**
- Create: `lib/aktivnost/tipovi.ts`
- Create: `lib/aktivnost/mapiranje.ts`
- Test: `lib/aktivnost/mapiranje.test.ts`

**Interfaces:**
- Produces:
  - `type Akcija = "INSERT"|"UPDATE"|"DELETE"|"NAVIGATE"|"VIEW"|"LOGIN"|"LOGOUT"|"FILTER"`
  - `type AkcijaUI = "NAVIGATE"|"VIEW"|"LOGIN"|"LOGOUT"|"FILTER"`
  - `interface DogadjajUnos { akcija: AkcijaUI; entitet: string|null; entitet_id: string|null; detalji: Record<string,unknown>|null }`
  - `dogadjajZaRutu(pathname: string): DogadjajUnos | null`
  - `dogadjajZaFilter(pathname: string, params: Record<string,string>): DogadjajUnos | null`

- [ ] **Step 1: Napiši tipove**

Create `lib/aktivnost/tipovi.ts`:
```ts
export type AkcijaUI = "NAVIGATE" | "VIEW" | "LOGIN" | "LOGOUT" | "FILTER"
export type Akcija = "INSERT" | "UPDATE" | "DELETE" | AkcijaUI

export interface DogadjajUnos {
  akcija: AkcijaUI
  entitet: string | null
  entitet_id: string | null
  detalji: Record<string, unknown> | null
}
```

- [ ] **Step 2: Napiši failing test**

Create `lib/aktivnost/mapiranje.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { dogadjajZaRutu, dogadjajZaFilter } from "./mapiranje"

describe("dogadjajZaRutu", () => {
  it("NAVIGATE za ekran bez id-a", () => {
    expect(dogadjajZaRutu("/klijenti")).toEqual({
      akcija: "NAVIGATE", entitet: "klijenti", entitet_id: null,
      detalji: { ekran: "Klijenti" },
    })
  })
  it("VIEW za rutu sa id-om zapisa", () => {
    expect(dogadjajZaRutu("/klijenti/abc-123")).toEqual({
      akcija: "VIEW", entitet: "klijenti", entitet_id: "abc-123", detalji: null,
    })
  })
  it("null za prazan pathname", () => {
    expect(dogadjajZaRutu("/")).toBeNull()
  })
  it("NAVIGATE fallback labela za nepoznat segment", () => {
    expect(dogadjajZaRutu("/nepoznato")).toEqual({
      akcija: "NAVIGATE", entitet: "nepoznato", entitet_id: null,
      detalji: { ekran: "nepoznato" },
    })
  })
})

describe("dogadjajZaFilter", () => {
  it("FILTER samo za dozvoljene ključeve", () => {
    expect(dogadjajZaFilter("/termini", { status: "kasni", tajni: "x" })).toEqual({
      akcija: "FILTER", entitet: "termini", entitet_id: null,
      detalji: { filteri: { status: "kasni" } },
    })
  })
  it("null kad nema aktivnih filtera", () => {
    expect(dogadjajZaFilter("/termini", {})).toBeNull()
  })
  it("null za ekran bez filter allowliste", () => {
    expect(dogadjajZaFilter("/pregled", { q: "x" })).toBeNull()
  })
})
```

- [ ] **Step 3: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/aktivnost/mapiranje.test.ts`
Expected: FAIL ("Cannot find module './mapiranje'").

- [ ] **Step 4: Implementiraj `mapiranje.ts`**

Create `lib/aktivnost/mapiranje.ts`:
```ts
import type { DogadjajUnos } from "./tipovi"

// Fizički (srpski) segment → labela ekrana za NAVIGATE. Fallback: sam segment.
// Napomena: na en/de deploymentu usePathname vraća lokalizovan segment; tada labela
// pada na raw segment (svjesno ograničenje MVP-a — entitet nosi lokalizovan naziv).
const EKRAN_LABELE: Record<string, string> = {
  pregled: "Pregled",
  "plan-aktivnosti": "Plan aktivnosti",
  obilasci: "Obilasci",
  klijenti: "Klijenti",
  asistent: "Asistent",
  zapisnici: "Zapisnici",
  postavke: "Postavke",
  aktivnost: "Aktivnost",
  termini: "Termini",
  dokumenti: "Dokumenti",
}

// Rute čiji drugi segment je id konkretnog zapisa → VIEW.
const ENTITET_RUTE = new Set(["klijenti", "zapisnici", "termini", "obilasci", "dokumenti"])

// Per-ekran allowlist filter ključeva iz searchParams.
const FILTER_KLJUCEVI: Record<string, string[]> = {
  termini: ["status", "vrsta", "klijent", "q"],
  klijenti: ["q", "grad", "status"],
  obilasci: ["mjesec", "klijent", "q"],
  "plan-aktivnosti": ["view", "od", "do", "status"],
}

export function segmenti(pathname: string): string[] {
  return pathname.split("/").filter(Boolean)
}

export function dogadjajZaRutu(pathname: string): DogadjajUnos | null {
  const segs = segmenti(pathname)
  if (segs.length === 0) return null
  const [prvi, drugi] = segs
  if (drugi && ENTITET_RUTE.has(prvi)) {
    return { akcija: "VIEW", entitet: prvi, entitet_id: drugi, detalji: null }
  }
  return {
    akcija: "NAVIGATE",
    entitet: prvi,
    entitet_id: null,
    detalji: { ekran: EKRAN_LABELE[prvi] ?? prvi },
  }
}

export function dogadjajZaFilter(
  pathname: string,
  params: Record<string, string>,
): DogadjajUnos | null {
  const [prvi] = segmenti(pathname)
  const dozvoljeni = FILTER_KLJUCEVI[prvi]
  if (!dozvoljeni) return null
  const filteri: Record<string, string> = {}
  for (const k of dozvoljeni) {
    if (params[k]) filteri[k] = params[k]
  }
  if (Object.keys(filteri).length === 0) return null
  return { akcija: "FILTER", entitet: prvi, entitet_id: null, detalji: { filteri } }
}
```

- [ ] **Step 5: Pokreni test — mora proći**

Run: `pnpm vitest run lib/aktivnost/mapiranje.test.ts`
Expected: PASS (7 testova).

- [ ] **Step 6: Commit**

```bash
git add lib/aktivnost/tipovi.ts lib/aktivnost/mapiranje.ts lib/aktivnost/mapiranje.test.ts
git commit -m "feat(aktivnost): mapiranje rute/filtera u dogadjaje (cista logika + testovi)"
```

---

## Task 3: Bafer + dedup

**Files:**
- Create: `lib/aktivnost/bafer.ts`
- Test: `lib/aktivnost/bafer.test.ts`

**Interfaces:**
- Consumes: `DogadjajUnos` iz `lib/aktivnost/tipovi.ts`.
- Produces:
  - `interface BaferStanje { redovi: DogadjajUnos[]; zadnjiKljuc: string | null }`
  - `noviBafer(): BaferStanje`
  - `dodaj(stanje: BaferStanje, d: DogadjajUnos): boolean` — dedup uzastopnog istog, vraća da li dodan.
  - `isprazni(stanje: BaferStanje): DogadjajUnos[]` — vrati i očisti redove (zadrži `zadnjiKljuc`).

- [ ] **Step 1: Napiši failing test**

Create `lib/aktivnost/bafer.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { noviBafer, dodaj, isprazni } from "./bafer"
import type { DogadjajUnos } from "./tipovi"

const nav = (e: string): DogadjajUnos => ({
  akcija: "NAVIGATE", entitet: e, entitet_id: null, detalji: { ekran: e },
})

describe("bafer", () => {
  it("dodaje različite događaje", () => {
    const b = noviBafer()
    expect(dodaj(b, nav("klijenti"))).toBe(true)
    expect(dodaj(b, nav("termini"))).toBe(true)
    expect(b.redovi).toHaveLength(2)
  })
  it("dedup uzastopnog istog", () => {
    const b = noviBafer()
    expect(dodaj(b, nav("klijenti"))).toBe(true)
    expect(dodaj(b, nav("klijenti"))).toBe(false)
    expect(b.redovi).toHaveLength(1)
  })
  it("isprazni vraća i čisti, ali dedup preživi flush", () => {
    const b = noviBafer()
    dodaj(b, nav("klijenti"))
    expect(isprazni(b)).toHaveLength(1)
    expect(b.redovi).toHaveLength(0)
    expect(dodaj(b, nav("klijenti"))).toBe(false) // isti kao prije flush-a
    expect(dodaj(b, nav("termini"))).toBe(true)
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/aktivnost/bafer.test.ts`
Expected: FAIL ("Cannot find module './bafer'").

- [ ] **Step 3: Implementiraj `bafer.ts`**

Create `lib/aktivnost/bafer.ts`:
```ts
import type { DogadjajUnos } from "./tipovi"

export interface BaferStanje {
  redovi: DogadjajUnos[]
  zadnjiKljuc: string | null
}

export function noviBafer(): BaferStanje {
  return { redovi: [], zadnjiKljuc: null }
}

function kljuc(d: DogadjajUnos): string {
  return `${d.akcija}:${d.entitet ?? ""}:${d.entitet_id ?? ""}:${JSON.stringify(d.detalji ?? {})}`
}

/** Dodaj uz dedup uzastopnog identičnog događaja. Vraća true ako je dodan. */
export function dodaj(stanje: BaferStanje, d: DogadjajUnos): boolean {
  const k = kljuc(d)
  if (k === stanje.zadnjiKljuc) return false
  stanje.redovi.push(d)
  stanje.zadnjiKljuc = k
  return true
}

/** Vrati skupljene redove i očisti bafer (zadnjiKljuc ostaje radi dedupa preko flush-a). */
export function isprazni(stanje: BaferStanje): DogadjajUnos[] {
  const out = stanje.redovi
  stanje.redovi = []
  return out
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/aktivnost/bafer.test.ts`
Expected: PASS (3 testa).

- [ ] **Step 5: Commit**

```bash
git add lib/aktivnost/bafer.ts lib/aktivnost/bafer.test.ts
git commit -m "feat(aktivnost): bafer sa dedupom (cista logika + testovi)"
```

---

## Task 4: API ruta za upis (`POST /api/aktivnost`)

**Files:**
- Create: `app/api/aktivnost/route.ts`

**Interfaces:**
- Consumes: RPC `zabiljezi_dogadjaje` (Task 1), SSR klijent `createServerSupabaseClient`.
- Produces: HTTP endpoint `POST /api/aktivnost` sa telom `{ dogadjaji: DogadjajUnos[] }`.

- [ ] **Step 1: Implementiraj rutu**

Create `app/api/aktivnost/route.ts`:
```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const AKCIJE = ["NAVIGATE", "VIEW", "LOGIN", "LOGOUT", "FILTER"] as const

const dogadjajSchema = z.object({
  akcija: z.enum(AKCIJE),
  entitet: z.string().max(100).nullable(),
  entitet_id: z.string().max(200).nullable(),
  detalji: z.record(z.string(), z.unknown()).nullable(),
})

const bodySchema = z.object({
  dogadjaji: z.array(dogadjajSchema).min(1).max(50),
})

export async function POST(req: Request) {
  let telo
  try {
    telo = bodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("zabiljezi_dogadjaje", { p_dogadjaji: telo.dogadjaji })
  if (error) return NextResponse.json({ ok: false }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Provjeri build/tip**

Run: `pnpm typecheck`
Expected: bez grešaka (RPC `zabiljezi_dogadjaje` postoji u `db/types.ts` iz Task 1).

- [ ] **Step 3: Ručni smoke (dev server pokrenut)**

Run:
```bash
curl -s -X POST http://localhost:3000/api/aktivnost \
  -H 'content-type: application/json' \
  -d '{"dogadjaji":[{"akcija":"NAVIGATE","entitet":"klijenti","entitet_id":null,"detalji":{"ekran":"Klijenti"}}]}'
```
Expected: bez prijave `{"ok":false}` (401/500 zavisno od cookie-ja) — sa prijavljenom sesijom `{"ok":true}`. (Puna provjera u E2E, Task 11.)

- [ ] **Step 4: Commit**

```bash
git add app/api/aktivnost/route.ts
git commit -m "feat(aktivnost): POST /api/aktivnost batch upis preko SSR RPC"
```

---

## Task 5: Klijentski `<AktivnostTracker>` + montiranje u layout

**Files:**
- Create: `components/domain/AktivnostTracker.tsx`
- Modify: `app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `dogadjajZaRutu`, `dogadjajZaFilter` (Task 2); `noviBafer`, `dodaj`, `isprazni`, `BaferStanje` (Task 3); endpoint `/api/aktivnost` (Task 4).
- Produces: `<AktivnostTracker/>` (render `null`, side-effect only).

- [ ] **Step 1: Implementiraj tracker**

Create `components/domain/AktivnostTracker.tsx`:
```tsx
"use client"
import { useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { dogadjajZaRutu, dogadjajZaFilter } from "@/lib/aktivnost/mapiranje"
import { noviBafer, dodaj, isprazni, type BaferStanje } from "@/lib/aktivnost/bafer"
import type { DogadjajUnos } from "@/lib/aktivnost/tipovi"

const FLUSH_MS = 5000

function posalji(redovi: DogadjajUnos[], beacon: boolean) {
  if (redovi.length === 0) return
  const telo = JSON.stringify({ dogadjaji: redovi })
  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/aktivnost", new Blob([telo], { type: "application/json" }))
    return
  }
  void fetch("/api/aktivnost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: telo,
    keepalive: true,
  }).catch(() => {})
}

export function AktivnostTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const baferRef = useRef<BaferStanje>(noviBafer())

  // Zabilježi navigaciju/pregled + filter na promjenu rute ili parametara.
  useEffect(() => {
    const b = baferRef.current
    const ruta = dogadjajZaRutu(pathname)
    if (ruta) dodaj(b, ruta)
    const params = Object.fromEntries(searchParams.entries())
    const filter = dogadjajZaFilter(pathname, params)
    if (filter) dodaj(b, filter)
  }, [pathname, searchParams])

  // Periodičan flush.
  useEffect(() => {
    const id = setInterval(() => posalji(isprazni(baferRef.current), false), FLUSH_MS)
    return () => clearInterval(id)
  }, [])

  // Flush na napuštanje/sakrivanje stranice (pouzdano preko sendBeacon).
  useEffect(() => {
    const bafer = baferRef.current
    const onHide = () => posalji(isprazni(bafer), true)
    const onVis = () => {
      if (document.visibilityState === "hidden") onHide()
    }
    document.addEventListener("visibilitychange", onVis)
    window.addEventListener("pagehide", onHide)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("pagehide", onHide)
    }
  }, [])

  return null
}
```

- [ ] **Step 2: Montiraj u dashboard layout**

Modify `app/(dashboard)/layout.tsx` — dodaj import i renderuj `<AktivnostTracker/>` unutar postojećeg providera (uz `TopBar`/`Sidebar`). Nađi mjesto gdje se renderuje shell i dodaj:
```tsx
import { AktivnostTracker } from "@/components/domain/AktivnostTracker"
// ... unutar JSX-a, npr. odmah nakon otvaranja provider wrappera:
<AktivnostTracker />
```

- [ ] **Step 3: Provjeri tip/build**

Run: `pnpm typecheck && pnpm lint`
Expected: bez grešaka.

- [ ] **Step 4: Ručna provjera (dev server, prijavljen)**

Otvori više ekrana (Klijenti → jedan klijent → Termini), sačekaj ~6s, pa u bazi:
```sql
select akcija, entitet, entitet_id, detalji, vrijeme
from audit_log where akcija in ('NAVIGATE','VIEW','FILTER') order by vrijeme desc limit 10;
```
Expected: redovi za NAVIGATE/VIEW koji odgovaraju kretanju; nema uzastopnih duplikata.

- [ ] **Step 5: Commit**

```bash
git add components/domain/AktivnostTracker.tsx app/\(dashboard\)/layout.tsx
git commit -m "feat(aktivnost): klijentski tracker (baferovanje + sendBeacon) u dashboard layoutu"
```

---

## Task 6: Prijava/odjava logovanje

**Files:**
- Modify: `app/prijava/actions.ts`
- Modify: `app/(dashboard)/odjava/actions.ts`

**Interfaces:**
- Consumes: RPC `zabiljezi_dogadjaje` (Task 1), SSR klijent (već korišten u obje akcije).

- [ ] **Step 1: LOGIN u `prijaviSe`**

Modify `app/prijava/actions.ts` — nakon uspješnog `signInWithPassword` (tj. nakon `if (error) return ...`), prije `revalidatePath`:
```ts
  await supabase.rpc("zabiljezi_dogadjaje", {
    p_dogadjaji: [{ akcija: "LOGIN", entitet: null, entitet_id: null, detalji: null }],
  })
```
(Sesija je već postavljena na `supabase` instanci → `auth.uid()` je dostupan u RPC-u.)

- [ ] **Step 2: LOGOUT u `odjaviSe`**

Modify `app/(dashboard)/odjava/actions.ts` — prije `await supabase.auth.signOut()`:
```ts
  await supabase.rpc("zabiljezi_dogadjaje", {
    p_dogadjaji: [{ akcija: "LOGOUT", entitet: null, entitet_id: null, detalji: null }],
  })
```

- [ ] **Step 3: Provjeri tip**

Run: `pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 4: Ručna provjera**

Odjavi se pa prijavi; u bazi:
```sql
select akcija, korisnik_id, vrijeme from audit_log
where akcija in ('LOGIN','LOGOUT') order by vrijeme desc limit 5;
```
Expected: LOGOUT pa LOGIN redovi sa ispravnim `korisnik_id`.

- [ ] **Step 5: Commit**

```bash
git add app/prijava/actions.ts app/\(dashboard\)/odjava/actions.ts
git commit -m "feat(aktivnost): logovanje prijave i odjave"
```

---

## Task 7: Tipizirani read-fetcher (`lib/queries/aktivnost.ts`)

**Files:**
- Create: `lib/queries/aktivnost.ts`

**Interfaces:**
- Consumes: RPC `get_aktivnost` (Task 1), SSR klijent.
- Produces:
  - `interface AktivnostFilter { od?: string; do?: string; korisnik?: string; akcija?: string; entitet?: string; pretraga?: string; limit?: number; offset?: number }`
  - `interface AktivnostRed { id: number; vrijeme: string; korisnik_id: string|null; korisnik_ime: string|null; korisnik_email: string|null; akcija: string; entitet: string|null; entitet_id: string|null; staro: unknown; novo: unknown; detalji: unknown; ukupno: number }`
  - `async function dohvatiAktivnost(f: AktivnostFilter): Promise<{ redovi: AktivnostRed[]; ukupno: number }>`

- [ ] **Step 1: Implementiraj fetcher**

Create `lib/queries/aktivnost.ts`:
```ts
import { createServerSupabaseClient } from "@/lib/supabase/server"

export interface AktivnostFilter {
  od?: string
  do?: string
  korisnik?: string
  akcija?: string
  entitet?: string
  pretraga?: string
  limit?: number
  offset?: number
}

export interface AktivnostRed {
  id: number
  vrijeme: string
  korisnik_id: string | null
  korisnik_ime: string | null
  korisnik_email: string | null
  akcija: string
  entitet: string | null
  entitet_id: string | null
  staro: unknown
  novo: unknown
  detalji: unknown
  ukupno: number
}

export async function dohvatiAktivnost(
  f: AktivnostFilter,
): Promise<{ redovi: AktivnostRed[]; ukupno: number }> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_aktivnost", {
    p_od: f.od ?? null,
    p_do: f.do ?? null,
    p_korisnik: f.korisnik ?? null,
    p_akcija: f.akcija ?? null,
    p_entitet: f.entitet ?? null,
    p_pretraga: f.pretraga ?? null,
    p_limit: f.limit ?? 50,
    p_offset: f.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const redovi = (data ?? []) as AktivnostRed[]
  return { redovi, ukupno: redovi[0]?.ukupno ?? 0 }
}
```

- [ ] **Step 2: Provjeri tip**

Run: `pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 3: Commit**

```bash
git add lib/queries/aktivnost.ts
git commit -m "feat(aktivnost): tipizirani fetcher get_aktivnost"
```

---

## Task 8: Sidebar nav + i18n rute + prevodi

**Files:**
- Modify: `components/shell/Sidebar.tsx`
- Modify: `i18n/routes.ts`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Produces: admin-only nav stavka na `href("/aktivnost")`; prevodivi ključevi `shell.nav.aktivnost` + `aktivnost.*`.

- [ ] **Step 1: Dodaj rutu u mapu**

Modify `i18n/routes.ts` — u `ROUTE_MAP` dodaj:
```ts
  "aktivnost": { en: "activity", de: "aktivitaet" },
```

- [ ] **Step 2: Dodaj nav stavku (admin-only)**

Modify `components/shell/Sidebar.tsx`:
- U import iz `"lucide-react"` dodaj `ScrollText`.
- U `NAV_ITEMS` dodaj (nakon `zapisnici`):
```ts
  { href: href("/aktivnost"), labelKey: "aktivnost", icon: ScrollText },
```
- Zamijeni postojeću liniju filtriranja (`const navItems = uloga === "pregled" ? ...`) sa:
```ts
  let navItems = NAV_ITEMS
  if (uloga === "pregled") navItems = navItems.filter((i) => i.href !== href("/asistent"))
  if (uloga !== "admin") navItems = navItems.filter((i) => i.href !== href("/aktivnost"))
```

- [ ] **Step 3: Dodaj prevode (paritet sr/en/de)**

Modify `messages/sr.json` — u `shell.nav` dodaj `"aktivnost": "Aktivnost"`; na vrhu (uz druge namespace-ove) dodaj:
```json
  "aktivnost": {
    "naslov": "Aktivnost",
    "opis": "Pregled svih događaja u aplikaciji — ko je šta promijenio, otvorio ili filtrirao.",
    "kolone": {
      "vrijeme": "Vrijeme",
      "korisnik": "Korisnik",
      "akcija": "Akcija",
      "cilj": "Cilj",
      "detalji": "Detalji"
    },
    "akcije": {
      "INSERT": "Kreirano",
      "UPDATE": "Izmijenjeno",
      "DELETE": "Obrisano",
      "NAVIGATE": "Otvorio ekran",
      "VIEW": "Pogledao zapis",
      "LOGIN": "Prijava",
      "LOGOUT": "Odjava",
      "FILTER": "Filtrirao"
    },
    "filteri": {
      "korisnik": "Korisnik",
      "akcija": "Tip akcije",
      "svi": "Svi",
      "od": "Od",
      "do": "Do",
      "pretraga": "Pretraga",
      "primijeni": "Primijeni",
      "ocisti": "Očisti"
    },
    "prazno": "Nema zabilježenih događaja za odabrane filtere.",
    "sistemski": "Sistem"
  }
```
Modify `messages/en.json` i `messages/de.json` — dodaj iste ključeve, prevedene (en: "Activity"/"Created"/"Updated"/"Deleted"/"Opened screen"/"Viewed record"/"Login"/"Logout"/"Filtered"; de: "Aktivität"/"Erstellt"/"Geändert"/"Gelöscht"/"Bildschirm geöffnet"/"Datensatz angesehen"/"Anmeldung"/"Abmeldung"/"Gefiltert"), plus `shell.nav.aktivnost` ("Activity"/"Aktivität").

- [ ] **Step 4: Provjeri tip/lint (ključevi moraju postojati u sva 3 kataloga)**

Run: `pnpm typecheck && pnpm lint`
Expected: bez grešaka (next-intl bi oborio tsc ako ključ fali u nekom katalogu).

- [ ] **Step 5: Commit**

```bash
git add components/shell/Sidebar.tsx i18n/routes.ts messages/sr.json messages/en.json messages/de.json
git commit -m "feat(aktivnost): admin nav stavka + i18n rute i prevodi"
```

---

## Task 9: Admin ekran (filteri + tabela + diff)

**Files:**
- Create: `app/(dashboard)/aktivnost/page.tsx`
- Create: `components/domain/AktivnostFilteri.tsx`
- Create: `components/domain/AktivnostTabela.tsx`

**Interfaces:**
- Consumes: `dohvatiAktivnost`, `AktivnostRed` (Task 7); `getTrenutniKorisnik` (`lib/auth/current-user.ts`); prevodi `aktivnost.*` (Task 8).
- Produces: ruta `/aktivnost` (admin-only server komponenta) sa paginacijom preko `searchParams`.

- [ ] **Step 1: Napiši tabelu (prezentacija + diff)**

Create `components/domain/AktivnostTabela.tsx`:
```tsx
import { getTranslations } from "next-intl/server"
import type { AktivnostRed } from "@/lib/queries/aktivnost"

// Izvuci izmijenjena polja za UPDATE (staro→novo), inače čitljiv opis iz detalji.
function opisDetalja(red: AktivnostRed): string {
  if (red.akcija === "UPDATE" && red.staro && red.novo) {
    const staro = red.staro as Record<string, unknown>
    const novo = red.novo as Record<string, unknown>
    const promjene = Object.keys(novo)
      .filter((k) => JSON.stringify(staro[k]) !== JSON.stringify(novo[k]))
      .map((k) => `${k}: ${JSON.stringify(staro[k])} → ${JSON.stringify(novo[k])}`)
    return promjene.join(", ") || "—"
  }
  const d = red.detalji as Record<string, unknown> | null
  if (!d) return "—"
  if (d.ekran) return String(d.ekran)
  if (d.filteri) return Object.entries(d.filteri as Record<string, string>)
    .map(([k, v]) => `${k}=${v}`).join(", ")
  return JSON.stringify(d)
}

export async function AktivnostTabela({ redovi }: { redovi: AktivnostRed[] }) {
  const t = await getTranslations("aktivnost")
  if (redovi.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("prazno")}</p>
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2">{t("kolone.vrijeme")}</th>
            <th className="px-3 py-2">{t("kolone.korisnik")}</th>
            <th className="px-3 py-2">{t("kolone.akcija")}</th>
            <th className="px-3 py-2">{t("kolone.cilj")}</th>
            <th className="px-3 py-2">{t("kolone.detalji")}</th>
          </tr>
        </thead>
        <tbody>
          {redovi.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-3 py-2 whitespace-nowrap">
                {new Date(r.vrijeme).toLocaleString("sr-Latn")}
              </td>
              <td className="px-3 py-2">{r.korisnik_ime ?? t("sistemski")}</td>
              <td className="px-3 py-2">{t(`akcije.${r.akcija}` as never)}</td>
              <td className="px-3 py-2">
                {r.entitet ?? "—"}{r.entitet_id ? ` #${r.entitet_id}` : ""}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{opisDetalja(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Napiši filter-traku**

Create `components/domain/AktivnostFilteri.tsx` (client, upisuje u URL searchParams — server komponenta re-fetchuje):
```tsx
"use client"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useTranslations } from "next-intl"

const AKCIJE = ["INSERT","UPDATE","DELETE","NAVIGATE","VIEW","LOGIN","LOGOUT","FILTER"] as const

export function AktivnostFilteri() {
  const t = useTranslations("aktivnost")
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  function postavi(kljuc: string, vrijednost: string) {
    const p = new URLSearchParams(sp.toString())
    if (vrijednost) p.set(kljuc, vrijednost)
    else p.delete(kljuc)
    p.delete("strana") // reset paginacije pri promjeni filtera
    router.push(`${pathname}?${p.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.akcija")}
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          defaultValue={sp.get("akcija") ?? ""}
          onChange={(e) => postavi("akcija", e.target.value)}
        >
          <option value="">{t("filteri.svi")}</option>
          {AKCIJE.map((a) => (
            <option key={a} value={a}>{t(`akcije.${a}` as never)}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.pretraga")}
        <input
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          defaultValue={sp.get("q") ?? ""}
          onBlur={(e) => postavi("q", e.target.value.trim())}
          placeholder="…"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.od")}
        <input type="date" className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          defaultValue={sp.get("od") ?? ""} onChange={(e) => postavi("od", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {t("filteri.do")}
        <input type="date" className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          defaultValue={sp.get("do") ?? ""} onChange={(e) => postavi("do", e.target.value)} />
      </label>
      <button
        className="rounded-md border border-input px-3 py-1 text-sm"
        onClick={() => router.push(pathname)}
      >
        {t("filteri.ocisti")}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Napiši stranicu (admin gate + fetch + paginacija)**

Create `app/(dashboard)/aktivnost/page.tsx`:
```tsx
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { dohvatiAktivnost } from "@/lib/queries/aktivnost"
import { AktivnostFilteri } from "@/components/domain/AktivnostFilteri"
import { AktivnostTabela } from "@/components/domain/AktivnostTabela"

const PO_STRANI = 50

export default async function AktivnostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") notFound()

  const t = await getTranslations("aktivnost")
  const sp = await searchParams
  const jedan = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const strana = Math.max(1, Number(jedan(sp.strana) ?? "1") || 1)
  const od = jedan(sp.od)
  const doDatum = jedan(sp.do)

  const { redovi, ukupno } = await dohvatiAktivnost({
    akcija: jedan(sp.akcija),
    pretraga: jedan(sp.q),
    od: od ? `${od}T00:00:00` : undefined,
    do: doDatum ? `${doDatum}T23:59:59` : undefined,
    limit: PO_STRANI,
    offset: (strana - 1) * PO_STRANI,
  })

  const straneUkupno = Math.max(1, Math.ceil(ukupno / PO_STRANI))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      <AktivnostFilteri />
      <AktivnostTabela redovi={redovi} />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{ukupno}</span>
        <span>{strana} / {straneUkupno}</span>
      </div>
    </div>
  )
}
```
(Paginacija: linkove za prethodnu/sljedeću stranu dodati preko `?strana=N` — minimalno; može se proširiti kasnije. Za MVP prikaz brojača strana je dovoljan; ako želiš dugmad, dodaj `<Link>` sa izračunatim `strana±1`.)

- [ ] **Step 4: Provjeri tip/lint**

Run: `pnpm typecheck && pnpm lint`
Expected: bez grešaka. (Ako `t(`akcije.${a}`)` pravi problem next-intl tipizaciji, ostavljen je `as never` cast — prihvatljivo za dinamički ključ.)

- [ ] **Step 5: Ručna provjera (dev, admin nalog)**

Otvori `/aktivnost` kao admin → vidi tabelu i filtere; promijeni filter akcije → lista se suzi. Otvori kao `operater` → `notFound` (404).

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/aktivnost/page.tsx components/domain/AktivnostFilteri.tsx components/domain/AktivnostTabela.tsx
git commit -m "feat(aktivnost): admin ekran — filteri, tabela, staro-novo diff"
```

---

## Task 10: Cron ruta za retenciju (90 dana)

**Files:**
- Create: `app/api/cron/ciscenje-audita/route.ts`

**Interfaces:**
- Consumes: RPC `obrisi_stare_dogadjaje` (Task 1), admin klijent, `isCronAuthorized` (`lib/reminders/cronAuth.ts`), `env.CRON_SECRET`.
- Napomena: `/api/cron` je već u `PUBLIC` allowlisti u `proxy.ts` — nova ruta pod tim prefiksom ne treba izmjenu proxyja.

- [ ] **Step 1: Implementiraj cron rutu**

Create `app/api/cron/ciscenje-audita/route.ts`:
```ts
import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase.rpc("obrisi_stare_dogadjaje")
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, obrisano: data })
}

export const GET = handle
export const POST = handle
```

- [ ] **Step 2: Provjeri tip**

Run: `pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 3: Ručni smoke**

Run (dev server, sa `CRON_SECRET` iz env-a):
```bash
curl -s -X POST http://localhost:3000/api/cron/ciscenje-audita \
  -H "authorization: Bearer $CRON_SECRET"
```
Expected: `{"ok":true,"obrisano":0}` (0 dok nema starih zapisa). Bez headera → 401.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/ciscenje-audita/route.ts
git commit -m "feat(aktivnost): cron ruta za 90-dnevnu retenciju logova"
```

> **Napomena za deploy (van koda):** `vercel.json` još nema `crons` niz (isto kao reminders). Zakačinjanje rasporeda (npr. dnevno) je zaseban korak — ruta radi i na ručni poziv.

---

## Task 11: E2E test

**Files:**
- Create: `tests/e2e/30-aktivnost.spec.ts`

**Interfaces:**
- Consumes: postojeći E2E setup (`auth.setup.ts`, `storageState`), radi protiv cloud DEMO.

- [ ] **Step 1: Napiši E2E**

Create `tests/e2e/30-aktivnost.spec.ts` (uskladi importe/helpere sa postojećim specovima — vidi `tests/e2e/18-auth-rls.spec.ts` za obrazac prijave kao različite uloge):
```ts
import { test, expect } from "@playwright/test"

// Admin vidi Aktivnost tab i tabelu; navigacija generiše bar jedan zapis.
test("admin vidi Aktivnost ekran", async ({ page }) => {
  await page.goto("/aktivnost")
  await expect(page.getByRole("heading", { name: "Aktivnost" })).toBeVisible()
  // Kroz par navigacija tracker upiše događaje; osvježi i očekuj redove ili prazno stanje bez greške.
  await page.goto("/klijenti")
  await page.goto("/aktivnost")
  await expect(page.getByRole("heading", { name: "Aktivnost" })).toBeVisible()
})
```
(Ako postoji helper za prijavu kao `operater`/`pregled`, dodaj test da `/aktivnost` vrati 404/redirect za ne-admina. Prati obrazac iz `18-auth-rls.spec.ts`.)

- [ ] **Step 2: Pokreni E2E**

Run: `pnpm exec playwright test tests/e2e/30-aktivnost.spec.ts`
Expected: PASS (chromium + webkit).

- [ ] **Step 3: Očisti test podatke**

Run: `pnpm cleanup:test-data`
Expected: bez greške.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/30-aktivnost.spec.ts
git commit -m "test(aktivnost): E2E admin pristup ekranu Aktivnost"
```

---

## Task 12: Finalna verifikacija

- [ ] **Step 1: Puni check**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: sve PASS.

- [ ] **Step 2: Pregled diffa**

Run: `git log --oneline feat/aktivnost-log ^main` i `git diff main...feat/aktivnost-log --stat`
Expected: očekivani fajlovi izmijenjeni; nema slučajnih izmjena.

---

## Self-Review (izvršeno pri pisanju plana)

**Spec coverage:**
- Model podataka (kolona, indeksi, glagoli) → Task 1 ✅
- Batch RPC upis bez admin klijenta → Task 1 (RPC) + Task 4 (endpoint) ✅
- Klijentsko hvatanje (navigacija/view/filter, bafer, sendBeacon, dedup) → Task 2,3,5 ✅
- Prijava/odjava → Task 6 ✅
- View + get_aktivnost + admin ekran (tabela, diff, filteri, paginacija) → Task 1,7,9 ✅
- Retencija 90 dana → Task 1 (funkcija) + Task 10 (cron) ✅
- RLS (admin-only SELECT, security_invoker view, RPC-only insert) → Task 1 ✅
- i18n paritet + nav stavka → Task 8 ✅
- Testovi (unit pure logika, E2E admin pristup) → Task 2,3,11 ✅
- Van obima (particionisanje, ne-URL filteri, realtime, export) — svjesno izostavljeno ✅

**Placeholder scan:** nema TBD/TODO; svaki korak ima konkretan kod/komandu.

**Type consistency:** `DogadjajUnos`/`AkcijaUI` dosljedni kroz Task 2→3→4→5→6; `AktivnostRed`/`AktivnostFilter` dosljedni Task 7→9; RPC imena (`zabiljezi_dogadjaje`, `get_aktivnost`, `obrisi_stare_dogadjaje`) ista u svim taskovima.
