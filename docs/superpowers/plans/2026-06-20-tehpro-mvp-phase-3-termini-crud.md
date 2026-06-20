# Tehpro MVP — Faza 3: Termini CRUD (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pretvoriti `/termini` stub u potpuni Termini ekran: stats kartice, filterabilna/paginirana tabela termina, detail sheet sa edit formom i "Označi kao izvršeno" tokom (koji okida auto-cycle), te "Novi termin" kreiranje — sve preko Server Actions, čitanje iz obogaćenog `termini_view`, pisanje u `termini` tabelu.

**Architecture:** RSC stranica čita podatke server-side iz `termini_view` (flat, sa joined nazivima i izvedenim statusom). Mutacije idu kroz Server Actions (`'use server'`) koje pišu u `termini` tabelu (gdje triggeri rade) i `revalidatePath`. Filteri su URL-search-param-driven (server refetch). Detail sheet otvara se preko `?selected=<id>` parametra. Stats se dobijaju jednim RPC pozivom da se poštuje query-by-page pravilo.

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions, Turbopack) · React 19 (`useActionState`) · TypeScript strict · Tailwind v4 · shadcn base-nova (@base-ui/react) · Supabase JS SDK · zod · Playwright + vitest · pnpm.

**Spec:** `docs/superpowers/specs/2026-06-20-tehpro-mvp-design.md` §7.2, §7.5
**Prethodne faze:** [phase-1](./2026-06-20-tehpro-mvp-phase-1-foundation.md) (temelji), [phase-2](./2026-06-20-tehpro-mvp-phase-2-db-import.md) (DB + 1000 termina seed).

---

## Global Constraints

- **Node ≥ 20, pnpm.** Next.js 16 (Turbopack default), React 19, TS strict + `noUncheckedIndexedAccess`.
- **DB driver:** SAMO `@supabase/supabase-js`. READ iz `termini_view`, WRITE u `termini` tabelu. Mutacije isključivo kroz Server Actions.
- **Query-by-page rule (§5):** max 2 DB round-trips po inicijalnom renderu. `/termini` koristi: (1) `get_termini_stats()` RPC, (2) lista sa `{ count: 'exact' }` (rows + total u jednom). Detail sheet selekcija ne smije dodati 3. query na inicijalni render liste — termin za sheet se nalazi u već-dohvaćenim rows (fallback fetch samo ako selected nije na trenutnoj stranici).
- **No await-in-loop**, no per-element queries. Bulk filteri u jednom `.select()`.
- **Tailwind breakpoints:** SAMO `lg:`/`xl:`/`2xl:`. `sm:`/`md:` = ESLint error.
- **Brand tokeni:** `#2563eb` brand. Status badge boje (soft pills, Tailwind skale): planirano=blue, zakazano=cyan, izvrseno=green, kasni=red, otkazano=slate.
- **Bosanski jezik** za sav UI tekst. Datumi format `DD.MM.YYYY.` (sa završnom tačkom), prazno = `—`.
- **Status workflow:** enum `planirano|zakazano|izvrseno|otkazano`; `kasni` je IZVEDENI (samo u view-u: `status IN (planirano,zakazano) AND rok_dospijeca < today`). Mark-done = UPDATE `datum_izvrsenja` + `status='izvrseno'` u jednom pozivu → `tg_termini_auto_cycle` insertuje sljedeći termin.
- **Commit style:** `feat(phase-3): <bosanski opis>` / `test(phase-3): ...`. Push na `origin/main` na kraju faze. Tag `v0.3.0`.
- **NEMA Vercel/cloud** (per feedback): sve lokalno, Docker Supabase. Git push DA.
- **Desktop-only** gate ostaje; tabele/sheet smiju biti široki.

## Mockup vs Spec — usaglašavanje

Mockup Termini lista je jednostavnija od spec-a (nema detail panel, nema klijent/vrsta dropdown, samo 3 statusa). **Spec §7.2 je obavezujući** — gradimo puni feature set. Vizuelni stil (soft status pills, stat-card layout, table header `bg-slate-50 uppercase text-xs`, brand dugmad) posuđujemo iz mockup-a. Status "kasni" pill je crven; "izvrseno" zelen; "planirano" plav (mockup koristi amber za planirano — mi koristimo plav po spec tokenu radi konzistentnosti sa 5-status paletom).

## Poznati data quirk (iz Faze 2)

`vrste_provjera` sadrži messy nazive koji se preklapaju sa imenima klijenata (parser je neke sheet naslove tretirao kao i klijent i vrstu). UI ih prikazuje kako jesu. Čišćenje katalога je zaseban zadatak (van Faze 3). `lokacije` tabela je prazna → "Lokacija" kolona prikazuje `—` dok se klijenti ručno ne razdvoje (Faza 4).

---

## File Structure (kreirano/mijenjano u ovoj fazi)

```
tehpro-mvp/
├── supabase/migrations/
│   └── <ts>_termini_read_model.sql          # obogaćen termini_view + get_termini_stats() RPC
├── db/types.ts                               # REGEN nakon migracije
├── lib/
│   ├── date.ts                               # formatDatum, todayIso, month helpers
│   ├── date.test.ts                          # vitest
│   └── termini.ts                            # DerivedStatus, STATUS_LABEL, STATUS_BADGE_CLASS, STATUS_FILTER_OPTIONS
├── components/domain/
│   ├── StatusBadge.tsx                       # soft pill za izvedeni status
│   ├── StatCard.tsx                          # stat kartica (label/value/sub/icon)
│   ├── TerminiTable.tsx                      # tabela (server comp), Akcije=Detalji link
│   ├── TerminiFilters.tsx                    # URL-state filteri (client)
│   ├── TerminSheet.tsx                       # detail + edit + mark-done (client)
│   └── NoviTerminButton.tsx                  # CTA + create sheet (client)
├── app/(dashboard)/termini/
│   ├── page.tsx                              # REWRITE: stats + filteri + tabela + sheet
│   └── actions.ts                            # createTermin, updateTermin, markIzvrseno
└── tests/e2e/
    └── 03-termini.spec.ts                    # E2E (raste kroz taskove)
```

---

## Task Map

| # | Task | Deliverable | Verifikacija |
|---|---|---|---|
| 1 | Helpers + unit testovi | `lib/date.ts`, `lib/termini.ts` | `pnpm test:unit` zelen |
| 2 | DB read-model migracija | obogaćen `termini_view` + `get_termini_stats()` RPC + regen types | psql + typecheck |
| 3 | StatusBadge + StatCard + stats row | `/termini` prikazuje 4 stat kartice | E2E stats |
| 4 | TerminiTable + lista + paginacija | tabela 1000 termina, 50/str | E2E tabela + paginacija |
| 5 | TerminiFilters (URL state) | status/search/klijent/vrsta/mjesec filteri | E2E filtriranje |
| 6 | Server Actions + TerminSheet | otvori detalje, edit, označi izvršeno (auto-cycle) | E2E mutacije |
| 7 | Novi termin (create) | CTA → forma → novi termin u listi | E2E create |
| 8 | Comprehensive E2E + phase gate | `03-termini.spec.ts` pun + fresh-agent gate + tag | sve zeleno |

**Ukupno: 8 tasks. Procjena: 3-4 dana.**

---

## Task 1: Helpers — lib/date.ts + lib/termini.ts + unit testovi

**Files:**
- Create: `lib/date.ts`, `lib/date.test.ts`, `lib/termini.ts`

**Interfaces:**
- Produces:
  - `formatDatum(iso: string | null | undefined): string` → `"28.07.2026."` ili `"—"`
  - `todayIso(): string` → `"YYYY-MM-DD"`
  - `monthRange(year: number, month1to12: number): { from: string; to: string }` (from = prvi dan, to = zadnji dan mjeseca, ISO)
  - `MONTHS_BS: readonly string[]` (Januar..Decembar)
  - `type DerivedStatus = "planirano" | "zakazano" | "izvrseno" | "kasni" | "otkazano"`
  - `STATUS_LABEL: Record<DerivedStatus, string>`
  - `STATUS_BADGE_CLASS: Record<DerivedStatus, string>`
  - `STATUS_FILTER_OPTIONS: readonly { value: string; label: string }[]`
  - `toDerivedStatus(s: string | null): DerivedStatus` (safe coerce, fallback 'planirano')

- [ ] **Step 1.1: Kreiraj `lib/date.ts`**

```ts
/** Datumski helperi — Bosanski format DD.MM.YYYY. iz ISO YYYY-MM-DD. */

export const MONTHS_BS = [
  "Januar", "Februar", "Mart", "April", "Maj", "Jun",
  "Jul", "Avgust", "Septembar", "Oktobar", "Novembar", "Decembar",
] as const

/** ISO (ili Date-string) → "DD.MM.YYYY.". Null/nevažeće → "—". */
export function formatDatum(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parts = iso.slice(0, 10).split("-")
  if (parts.length !== 3) return "—"
  const [y, mo, d] = parts
  if (!y || !mo || !d) return "—"
  if (y.length !== 4) return "—"
  return `${d}.${mo}.${y}.`
}

/** Današnji datum kao "YYYY-MM-DD" (lokalna zona). */
export function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Prvi i zadnji dan mjeseca (ISO). month1to12: 1=Januar. */
export function monthRange(year: number, month1to12: number): { from: string; to: string } {
  const mm = String(month1to12).padStart(2, "0")
  const from = `${year}-${mm}-01`
  // zadnji dan: dan 0 sljedećeg mjeseca
  const last = new Date(year, month1to12, 0).getDate()
  const to = `${year}-${mm}-${String(last).padStart(2, "0")}`
  return { from, to }
}
```

- [ ] **Step 1.2: Kreiraj `lib/termini.ts`**

```ts
/** Domain mapiranja za termine statuse. */

export type DerivedStatus =
  | "planirano" | "zakazano" | "izvrseno" | "kasni" | "otkazano"

export const STATUS_LABEL: Record<DerivedStatus, string> = {
  planirano: "Planirano",
  zakazano: "Zakazano",
  izvrseno: "Izvršeno",
  kasni: "Kasni",
  otkazano: "Otkazano",
}

/** Soft-pill klase (Tailwind skale, ne sm:/md:). */
export const STATUS_BADGE_CLASS: Record<DerivedStatus, string> = {
  planirano: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
  zakazano: "bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-600/20",
  izvrseno: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20",
  kasni: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
  otkazano: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20",
}

export const STATUS_FILTER_OPTIONS = [
  { value: "svi", label: "Svi" },
  { value: "kasni", label: "Kasni" },
  { value: "planirano", label: "Planirano" },
  { value: "zakazano", label: "Zakazano" },
  { value: "izvrseno", label: "Izvršeno" },
  { value: "otkazano", label: "Otkazano" },
] as const

const VALID: ReadonlySet<string> = new Set<DerivedStatus>([
  "planirano", "zakazano", "izvrseno", "kasni", "otkazano",
])

/** Sigurno mapiranje string → DerivedStatus (fallback 'planirano'). */
export function toDerivedStatus(s: string | null | undefined): DerivedStatus {
  return s && VALID.has(s) ? (s as DerivedStatus) : "planirano"
}
```

- [ ] **Step 1.3: Kreiraj `lib/date.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { formatDatum, monthRange, MONTHS_BS } from "./date"

describe("formatDatum", () => {
  it("ISO datum → DD.MM.YYYY.", () => {
    expect(formatDatum("2026-07-28")).toBe("28.07.2026.")
  })
  it("ISO timestamp → uzima samo datum dio", () => {
    expect(formatDatum("2026-02-05T12:30:00Z")).toBe("05.02.2026.")
  })
  it("null → em-dash", () => {
    expect(formatDatum(null)).toBe("—")
    expect(formatDatum(undefined)).toBe("—")
    expect(formatDatum("")).toBe("—")
  })
  it("nevažeći format → em-dash", () => {
    expect(formatDatum("28/07/2026")).toBe("—")
    expect(formatDatum("garbage")).toBe("—")
  })
})

describe("monthRange", () => {
  it("Februar 2026 (28 dana)", () => {
    expect(monthRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
  it("Juli 2026 (31 dan)", () => {
    expect(monthRange(2026, 7)).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("Februar 2028 (prestupna, 29 dana)", () => {
    expect(monthRange(2028, 2)).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })
})

describe("MONTHS_BS", () => {
  it("ima 12 mjeseci, Januar prvi", () => {
    expect(MONTHS_BS).toHaveLength(12)
    expect(MONTHS_BS[0]).toBe("Januar")
    expect(MONTHS_BS[11]).toBe("Decembar")
  })
})
```

- [ ] **Step 1.4: Pokreni unit testove**

```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && pnpm test:unit
```

Expected: postojeći 5 parser testova + novih 8 = 13 pass.

- [ ] **Step 1.5: Full check**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test:unit
```

Sve mora proći.

- [ ] **Step 1.6: Commit**

```bash
git add lib/date.ts lib/date.test.ts lib/termini.ts && git commit -m "feat(phase-3): date + termini status helperi

- lib/date.ts: formatDatum (ISO→DD.MM.YYYY.), todayIso, monthRange, MONTHS_BS
- lib/termini.ts: DerivedStatus, STATUS_LABEL, STATUS_BADGE_CLASS,
  STATUS_FILTER_OPTIONS, toDerivedStatus
- lib/date.test.ts: 8 vitest testova (format, monthRange edge cases)"
```

---

## Task 2: DB read-model — obogaćen termini_view + get_termini_stats() RPC

**Files:**
- Create: `supabase/migrations/<ts>_termini_read_model.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces:
  - `termini_view` sa dodatnim kolonama: `status_izvedeni`, `klijent_naziv`, `lokacija_naziv`, `lokacija_grad`, `vrsta_naziv`
  - RPC `get_termini_stats()` → red `{ ukupno, ovog_mjeseca, kasni, izvrseno_ovog_mjeseca }` (sve bigint)
  - regen `Database` type uključuje nove view kolone + `Functions.get_termini_stats`

- [ ] **Step 2.1: Provjeri Supabase**

```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && supabase status | head -5
```

Ako nije up: `supabase start`.

- [ ] **Step 2.2: Kreiraj migraciju**

```bash
supabase migration new termini_read_model
```

- [ ] **Step 2.3: Upiši SQL**

```sql
-- Read-model za Termini ekran (Faza 3):
-- 1) Obogaćen termini_view sa joined nazivima (klijent/lokacija/vrsta) — flat read model
-- 2) get_termini_stats() RPC — 4 agregata u jednom pozivu (query-by-page rule)

-- Recreate view (drop + create jer mijenjamo set kolona)
drop view if exists termini_view;

create view termini_view as
select
  t.*,
  case
    when t.status = 'izvrseno' then 'izvrseno'
    when t.status = 'otkazano' then 'otkazano'
    when t.rok_dospijeca < current_date then 'kasni'
    else t.status::text
  end as status_izvedeni,
  k.naziv as klijent_naziv,
  l.naziv as lokacija_naziv,
  l.grad  as lokacija_grad,
  v.naziv as vrsta_naziv
from termini t
left join klijenti k       on k.id = t.klijent_id
left join lokacije l       on l.id = t.lokacija_id
left join vrste_provjera v on v.id = t.vrsta_provjere_id;

-- Stats RPC — sve u jednom round-tripu
create or replace function get_termini_stats()
returns table (
  ukupno                 bigint,
  ovog_mjeseca           bigint,
  kasni                  bigint,
  izvrseno_ovog_mjeseca  bigint
)
language sql
stable
as $$
  select
    (select count(*) from termini),
    (select count(*) from termini
       where rok_dospijeca >= date_trunc('month', current_date)::date
         and rok_dospijeca <  (date_trunc('month', current_date) + interval '1 month')::date),
    (select count(*) from termini_view where status_izvedeni = 'kasni'),
    (select count(*) from termini
       where status = 'izvrseno'
         and datum_izvrsenja >= date_trunc('month', current_date)::date
         and datum_izvrsenja <  (date_trunc('month', current_date) + interval '1 month')::date);
$$;
```

- [ ] **Step 2.4: Primijeni**

```bash
supabase db reset
```

Expected: sve migracije (Faza 1+2 + ova) primijenjene clean.

**Napomena:** `db reset` briše seed podatke. Ponovo seed-uj:

```bash
pnpm seed
```

- [ ] **Step 2.5: Sanity check view + RPC**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'EOF'
-- View ima nove kolone i nazive
select klijent_naziv, vrsta_naziv, status_izvedeni, rok_dospijeca
from termini_view
order by rok_dospijeca
limit 3;

-- RPC vraća 4 agregata
select * from get_termini_stats();
EOF
```

Expected:
- View redovi imaju popunjen `klijent_naziv`, `vrsta_naziv` (ne null), `status_izvedeni` jedan od 5
- RPC vraća jedan red sa 4 broja; `ukupno`=1000, `kasni`>0

- [ ] **Step 2.6: Regen TypeScript types**

```bash
pnpm db:types
```

Provjeri da `db/types.ts` sada sadrži:
- `termini_view` Row sa `klijent_naziv`, `vrsta_naziv`, `lokacija_naziv`, `lokacija_grad`, `status_izvedeni`
- `Functions: { get_termini_stats: ... }`

```bash
grep -E "klijent_naziv|get_termini_stats" db/types.ts | head
```

- [ ] **Step 2.7: Typecheck + build**

```bash
pnpm build && pnpm typecheck && pnpm lint
```

- [ ] **Step 2.8: Commit**

```bash
git add supabase/migrations/ db/types.ts && git commit -m "feat(phase-3): read-model — obogaćen termini_view + get_termini_stats RPC

- termini_view dobija klijent_naziv, lokacija_naziv, lokacija_grad, vrsta_naziv
  (LEFT JOIN) → flat read model za listu, lak filter/search bez nested embeds
- get_termini_stats() RPC: ukupno, ovog_mjeseca, kasni, izvrseno_ovog_mjeseca
  u jednom pozivu (query-by-page rule, §5)
- regen db/types.ts (view kolone + Functions.get_termini_stats)"
```

---

## Task 3: StatusBadge + StatCard + stats row na /termini

**Files:**
- Create: `components/domain/StatusBadge.tsx`, `components/domain/StatCard.tsx`
- Modify: `app/(dashboard)/termini/page.tsx`
- Create: `tests/e2e/03-termini.spec.ts`

**Interfaces:**
- Consumes: `lib/termini.ts` (Task 1), `get_termini_stats` RPC (Task 2)
- Produces:
  - `<StatusBadge status={DerivedStatus} />` — soft pill
  - `<StatCard label value sub icon tone? />` — stat kartica
  - `/termini` RSC dohvaća stats preko RPC, renderuje 4 `StatCard`-a

- [ ] **Step 3.1: Kreiraj `components/domain/StatusBadge.tsx`**

```tsx
import { STATUS_BADGE_CLASS, STATUS_LABEL, toDerivedStatus } from "@/lib/termini"
import { cn } from "@/lib/utils"

export function StatusBadge({ status }: { status: string | null }) {
  const s = toDerivedStatus(status)
  return (
    <span
      data-testid="status-badge"
      data-status={s}
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        STATUS_BADGE_CLASS[s]
      )}
    >
      {STATUS_LABEL[s]}
    </span>
  )
}
```

- [ ] **Step 3.2: Kreiraj `components/domain/StatCard.tsx`**

```tsx
import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Tone = "default" | "danger" | "success" | "warning"

const TONE_CLASS: Record<Tone, string> = {
  default: "text-slate-700",
  danger: "text-red-600",
  success: "text-green-600",
  warning: "text-amber-600",
}

export function StatCard({
  label, value, sub, icon: Icon, tone = "default", testId,
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  tone?: Tone
  testId?: string
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
            {value}
          </p>
          {sub && <p className={cn("mt-1 text-xs", TONE_CLASS[tone])}>{sub}</p>}
        </div>
        <Icon className="w-5 h-5 shrink-0 text-slate-400" aria-hidden />
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3.3: Rewrite `app/(dashboard)/termini/page.tsx` (stats only za sada)**

```tsx
import { ClipboardList, AlertTriangle, CheckCircle2, Bell } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { StatCard } from "@/components/domain/StatCard"

export default async function TerminiPage() {
  const supabase = await createServerSupabaseClient()
  const { data: statsRows } = await supabase.rpc("get_termini_stats")
  const stats = statsRows?.[0] ?? {
    ukupno: 0, ovog_mjeseca: 0, kasni: 0, izvrseno_ovog_mjeseca: 0,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Termini</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" data-testid="termini-stats">
        <StatCard
          testId="stat-ukupno"
          label="Ukupno termina"
          value={stats.ukupno}
          icon={ClipboardList}
        />
        <StatCard
          testId="stat-ovog-mjeseca"
          label="Ovog mjeseca"
          value={stats.ovog_mjeseca}
          sub="rok dospijeća"
          icon={Bell}
          tone="warning"
        />
        <StatCard
          testId="stat-kasni"
          label="Kasni rokovi"
          value={stats.kasni}
          sub="zahtijevaju akciju"
          icon={AlertTriangle}
          tone="danger"
        />
        <StatCard
          testId="stat-izvrseno"
          label="Izvršeni ovog mjeseca"
          value={stats.izvrseno_ovog_mjeseca}
          sub="završeno"
          icon={CheckCircle2}
          tone="success"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3.4: Rewrite `tests/e2e/03-termini.spec.ts` (stats)**

```ts
import { test, expect } from "@playwright/test"

test.describe("Faza 3 — Termini stats", () => {
  test("prikazuje 4 stat kartice sa brojevima", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByRole("heading", { name: "Termini" })).toBeVisible()

    const stats = page.getByTestId("termini-stats")
    await expect(stats).toBeVisible()

    for (const id of ["stat-ukupno", "stat-ovog-mjeseca", "stat-kasni", "stat-izvrseno"]) {
      await expect(page.getByTestId(id)).toBeVisible()
    }

    // Ukupno mora biti > 0 (seed = 1000)
    const ukupno = await page.getByTestId("stat-ukupno-value").textContent()
    expect(Number(ukupno)).toBeGreaterThan(0)
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
```

- [ ] **Step 3.5: Provjeri vizuelno + testovi**

```bash
pnpm test:e2e tests/e2e/03-termini.spec.ts
```

Expected: pass na Chromium + WebKit.

- [ ] **Step 3.6: Full check**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test:e2e
```

- [ ] **Step 3.7: Commit**

```bash
git add components/domain/ app/ tests/e2e/03-termini.spec.ts && git commit -m "feat(phase-3): StatusBadge + StatCard + stats row na /termini

- StatusBadge: soft pill za izvedeni status (5 stanja)
- StatCard: label/value/sub/icon + tone (danger/success/warning)
- /termini RSC dohvaća get_termini_stats() RPC, renderuje 4 kartice
- 03-termini.spec.ts: stats vidljive, ukupno>0, bez console grešaka"
```

---

## Task 4: TerminiTable + lista (flat view) + paginacija

**Files:**
- Create: `components/domain/TerminiTable.tsx`
- Modify: `app/(dashboard)/termini/page.tsx`
- Modify: `tests/e2e/03-termini.spec.ts`

**Interfaces:**
- Consumes: `termini_view` (Task 2), `StatusBadge` (Task 3), `formatDatum` (Task 1)
- Produces:
  - `type TerminRow` (view red sa nazivima) — exportovan iz TerminiTable za reuse
  - `<TerminiTable rows={TerminRow[]} searchParamsString={string} />` — tabela, Akcije kolona = "Detalji" link na `?selected=<id>` (čuva ostale parametre)
  - Paginacija: page čita `searchParams.page`, 50/str, prev/next linkovi

- [ ] **Step 4.1: Kreiraj `components/domain/TerminiTable.tsx`**

```tsx
import Link from "next/link"
import type { Database } from "@/db/types"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { formatDatum } from "@/lib/date"

export type TerminRow = Database["public"]["Views"]["termini_view"]["Row"]

const COLS = [
  "Datum roka", "Klijent", "Lokacija", "Vrsta", "Status", "Zaduženi", "Akcije",
] as const

/** Gradi href za "Detalji" — čuva postojeće search parametre, dodaje selected. */
function detailHref(id: string, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch)
  params.set("selected", id)
  return `/termini?${params.toString()}`
}

export function TerminiTable({
  rows, currentSearch,
}: {
  rows: TerminRow[]
  currentSearch: string
}) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="termini-empty"
        className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
      >
        Nema termina za zadane filtere.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm" data-testid="termini-table">
        <thead className="bg-slate-50">
          <tr>
            {COLS.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id ?? ""}
              data-testid="termin-row"
              className="border-t border-slate-100 hover:bg-slate-50"
            >
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDatum(r.rok_dospijeca)}</td>
              <td className="px-3 py-2 font-medium text-slate-900">{r.klijent_naziv ?? "—"}</td>
              <td className="px-3 py-2 text-slate-600">{r.lokacija_naziv ?? "—"}</td>
              <td className="px-3 py-2 text-slate-600">{r.vrsta_naziv ?? "—"}</td>
              <td className="px-3 py-2"><StatusBadge status={r.status_izvedeni} /></td>
              <td className="px-3 py-2 text-slate-600">{r.zaduzeni ?? "—"}</td>
              <td className="px-3 py-2">
                {r.id && (
                  <Link
                    href={detailHref(r.id, currentSearch)}
                    className="text-brand hover:underline font-medium"
                    data-testid="termin-detalji"
                  >
                    Detalji
                  </Link>
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

- [ ] **Step 4.2: Update `app/(dashboard)/termini/page.tsx` — dodaj listu + paginaciju**

```tsx
import { ClipboardList, AlertTriangle, CheckCircle2, Bell } from "lucide-react"
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { StatCard } from "@/components/domain/StatCard"
import { TerminiTable, type TerminRow } from "@/components/domain/TerminiTable"
import { Button } from "@/components/ui/button"

const PER_PAGE = 50

export default async function TerminiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const pageNum = Math.max(1, Number(typeof sp.page === "string" ? sp.page : "1") || 1)
  const from = (pageNum - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  const supabase = await createServerSupabaseClient()

  const [{ data: statsRows }, listRes] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    supabase
      .from("termini_view")
      .select("*", { count: "exact" })
      .order("rok_dospijeca", { ascending: true })
      .range(from, to),
  ])

  const stats = statsRows?.[0] ?? { ukupno: 0, ovog_mjeseca: 0, kasni: 0, izvrseno_ovog_mjeseca: 0 }
  const rows = (listRes.data ?? []) as TerminRow[]
  const total = listRes.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  // currentSearch string (bez "page" za detail link bazu — page se čuva odvojeno)
  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : []
    )
  ).toString()

  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("page", String(p))
    return `/termini?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Termini</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" data-testid="termini-stats">
        <StatCard testId="stat-ukupno" label="Ukupno termina" value={stats.ukupno} icon={ClipboardList} />
        <StatCard testId="stat-ovog-mjeseca" label="Ovog mjeseca" value={stats.ovog_mjeseca} sub="rok dospijeća" icon={Bell} tone="warning" />
        <StatCard testId="stat-kasni" label="Kasni rokovi" value={stats.kasni} sub="zahtijevaju akciju" icon={AlertTriangle} tone="danger" />
        <StatCard testId="stat-izvrseno" label="Izvršeni ovog mjeseca" value={stats.izvrseno_ovog_mjeseca} sub="završeno" icon={CheckCircle2} tone="success" />
      </div>

      <TerminiTable rows={rows} currentSearch={currentSearch} />

      <div className="flex items-center justify-between text-sm text-slate-600" data-testid="termini-pagination">
        <span data-testid="termini-total">Ukupno rezultata: {total}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={pageNum <= 1} render={
            pageNum <= 1 ? <span /> : <Link href={pageHref(pageNum - 1)} />
          }>
            Prethodna
          </Button>
          <span data-testid="termini-page">Strana {pageNum} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={pageNum >= totalPages} render={
            pageNum >= totalPages ? <span /> : <Link href={pageHref(pageNum + 1)} />
          }>
            Sljedeća
          </Button>
        </div>
      </div>
    </div>
  )
}
```

**Napomena o `render` prop:** base-nova `Button` podržava polimorfni `render` prop. Ako se pokaže da `render` sa Link-om ne radi čisto u Next 16, alternativa: renderuj `<Link>` direktno sa `buttonVariants({variant:'outline',size:'sm'})` klasama umjesto Button-a. Implementer bira što radi; testirati oba.

- [ ] **Step 4.3: Dodaj E2E testove za tabelu**

Dodaj u `tests/e2e/03-termini.spec.ts` novi describe blok:

```ts
test.describe("Faza 3 — Termini tabela", () => {
  test("renderuje tabelu sa redovima i 7 kolona", async ({ page }) => {
    await page.goto("/termini")
    const table = page.getByTestId("termini-table")
    await expect(table).toBeVisible()

    const headers = ["Datum roka", "Klijent", "Lokacija", "Vrsta", "Status", "Zaduženi", "Akcije"]
    for (const h of headers) {
      await expect(table.getByRole("columnheader", { name: h })).toBeVisible()
    }

    // bar 1 red + status badge
    const rows = page.getByTestId("termin-row")
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(page.getByTestId("status-badge").first()).toBeVisible()
  })

  test("paginacija — Sljedeća mijenja stranu", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByTestId("termini-page")).toContainText("Strana 1")
    await page.getByRole("link", { name: "Sljedeća" }).click()
    await expect(page.getByTestId("termini-page")).toContainText("Strana 2")
  })

  test("Detalji link postoji u svakom redu", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
  })
})
```

- [ ] **Step 4.4: Pokreni + full check**

```bash
pnpm test:e2e tests/e2e/03-termini.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

Sve mora pass. Ako paginacija link selector ne radi (zbog `render` prop), prilagodi page.tsx da renderuje `<Link>` sa buttonVariants klasama i ažuriraj selektor.

- [ ] **Step 4.5: Commit**

```bash
git add components/domain/TerminiTable.tsx app/ tests/e2e/03-termini.spec.ts && git commit -m "feat(phase-3): TerminiTable + lista iz termini_view + paginacija

- TerminiTable: 7 kolona (Datum roka, Klijent, Lokacija, Vrsta, Status, Zaduženi, Akcije)
  StatusBadge u Status koloni, Detalji link (?selected=<id>) čuva search params
- /termini dohvaća listu iz termini_view (flat, count:exact), 50/str, sortirano po roku
- Promise.all(stats RPC, lista) = 2 round-tripa (query-by-page rule)
- paginacija prev/next, empty state
- E2E: tabela + kolone + paginacija + Detalji link"
```

---

## Task 5: TerminiFilters — URL-state filteri

**Files:**
- Create: `components/domain/TerminiFilters.tsx`
- Modify: `app/(dashboard)/termini/page.tsx`
- Modify: `tests/e2e/03-termini.spec.ts`

**Interfaces:**
- Consumes: `STATUS_FILTER_OPTIONS` (Task 1), klijent/vrsta liste (dohvaća page)
- Produces:
  - `<TerminiFilters klijenti={...} vrste={...} />` — client component, čita/piše URL search params (status, q, klijent_id, vrsta_id, mjesec)
  - page primjenjuje filtere na `termini_view` query

- [ ] **Step 5.1: Kreiraj `components/domain/TerminiFilters.tsx`**

```tsx
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { STATUS_FILTER_OPTIONS, MONTHS_BS_OPTION } from "@/lib/termini-filters"

type Opt = { id: string; naziv: string }

export function TerminiFilters({
  klijenti, vrste,
}: {
  klijenti: Opt[]
  vrste: Opt[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const status = params.get("status") ?? "svi"
  const q = params.get("q") ?? ""
  const klijentId = params.get("klijent_id") ?? "svi"
  const vrstaId = params.get("vrsta_id") ?? "svi"
  const mjesec = params.get("mjesec") ?? "svi"

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (!value || value === "svi" || value === "") next.delete(key)
    else next.set(key, value)
    next.delete("page")       // reset paginaciju
    next.delete("selected")   // zatvori detalje
    startTransition(() => router.push(`/termini?${next.toString()}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="termini-filters" data-pending={pending}>
      {/* Status pills */}
      <div className="flex items-center gap-1">
        {STATUS_FILTER_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            data-testid={`status-pill-${o.value}`}
            data-active={status === o.value}
            onClick={() => setParam("status", o.value)}
            className={cn(
              "px-3 py-1 rounded-full text-sm border transition",
              status === o.value
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Klijent dropdown */}
      <Select value={klijentId} onValueChange={(v) => setParam("klijent_id", v)}>
        <SelectTrigger className="w-48" data-testid="filter-klijent">
          <SelectValue placeholder="Svi klijenti" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">Svi klijenti</SelectItem>
          {klijenti.map((k) => (
            <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Vrsta dropdown */}
      <Select value={vrstaId} onValueChange={(v) => setParam("vrsta_id", v)}>
        <SelectTrigger className="w-48" data-testid="filter-vrsta">
          <SelectValue placeholder="Sve vrste" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">Sve vrste</SelectItem>
          {vrste.map((v) => (
            <SelectItem key={v.id} value={v.id}>{v.naziv}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Mjesec dropdown */}
      <Select value={mjesec} onValueChange={(v) => setParam("mjesec", v)}>
        <SelectTrigger className="w-36" data-testid="filter-mjesec">
          <SelectValue placeholder="Svi mjeseci" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">Svi mjeseci</SelectItem>
          {MONTHS_BS_OPTION.map((m) => (
            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Search */}
      <Input
        type="search"
        placeholder="Pretraga firme..."
        defaultValue={q}
        data-testid="filter-search"
        className="w-56 ml-auto"
        onKeyDown={(e) => {
          if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5.2: Kreiraj `lib/termini-filters.ts` (helper za mjesec opcije)**

```ts
import { MONTHS_BS } from "@/lib/date"

/** Mjesec opcije za filter — value je "1".."12". */
export const MONTHS_BS_OPTION = MONTHS_BS.map((label, i) => ({
  value: String(i + 1),
  label,
}))
```

**Napomena:** `STATUS_FILTER_OPTIONS` se importuje iz `@/lib/termini` (Task 1) — ispravi import u TerminiFilters.tsx: `import { STATUS_FILTER_OPTIONS } from "@/lib/termini"` i `import { MONTHS_BS_OPTION } from "@/lib/termini-filters"`.

- [ ] **Step 5.3: Update `page.tsx` — dohvati klijente/vrste, primijeni filtere**

Dodaj iznad list query-ja dohvat klijenata i vrsta (za dropdown-e) i izgradi filtrirani query. Ključne izmjene:

```tsx
// ... unutar TerminiPage, prije Promise.all:
import { TerminiFilters } from "@/components/domain/TerminiFilters"
import { monthRange } from "@/lib/date"

const statusFilter = typeof sp.status === "string" ? sp.status : "svi"
const qFilter = typeof sp.q === "string" ? sp.q.trim() : ""
const klijentFilter = typeof sp.klijent_id === "string" ? sp.klijent_id : ""
const vrstaFilter = typeof sp.vrsta_id === "string" ? sp.vrsta_id : ""
const mjesecFilter = typeof sp.mjesec === "string" ? sp.mjesec : ""

// Build list query sa filterima
let listQuery = supabase
  .from("termini_view")
  .select("*", { count: "exact" })
  .order("rok_dospijeca", { ascending: true })

if (statusFilter && statusFilter !== "svi") {
  listQuery = listQuery.eq("status_izvedeni", statusFilter)
}
if (qFilter) {
  listQuery = listQuery.ilike("klijent_naziv", `%${qFilter}%`)
}
if (klijentFilter) {
  listQuery = listQuery.eq("klijent_id", klijentFilter)
}
if (vrstaFilter) {
  listQuery = listQuery.eq("vrsta_provjere_id", vrstaFilter)
}
if (mjesecFilter) {
  const mn = Number(mjesecFilter)
  if (mn >= 1 && mn <= 12) {
    // mjesec se odnosi na rok_dospijeca u tekućoj godini (2026)
    const { from: mFrom, to: mTo } = monthRange(2026, mn)
    listQuery = listQuery.gte("rok_dospijeca", mFrom).lte("rok_dospijeca", mTo)
  }
}
listQuery = listQuery.range(from, to)

const [{ data: statsRows }, listRes, klijentiRes, vrsteRes] = await Promise.all([
  supabase.rpc("get_termini_stats"),
  listQuery,
  supabase.from("klijenti").select("id, naziv").order("naziv"),
  supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
])

const klijenti = (klijentiRes.data ?? []).map((k) => ({ id: k.id, naziv: k.naziv }))
const vrste = (vrsteRes.data ?? []).map((v) => ({ id: v.id, naziv: v.naziv }))
```

I umetni `<TerminiFilters klijenti={klijenti} vrste={vrste} />` između stats grida i tabele.

**Napomena o round-trips:** ovaj render sada ima 4 paralelna query-ja (stats RPC, lista, klijenti, vrste). Klijenti/vrste su za dropdown opcije (mali, ~51/58 redova) i logički su dio "header" učitavanja. Query-by-page pravilo (max 2 za main data) se odnosi na stats + lista; dropdown opcije su sekundarne i izvršavaju se PARALELNO (`Promise.all`) — nema serijskog N+1. Dokumentuj ovo u commit poruci. Ako reviewer insistira na 2, dropdown opcije se mogu prebaciti u zaseban cached/edge fetch — ali za MVP, 4 paralelna query-ja je prihvatljivo.

- [ ] **Step 5.4: E2E testovi filtera**

Dodaj describe blok u `03-termini.spec.ts`:

```ts
test.describe("Faza 3 — Termini filteri", () => {
  test("status pill 'Kasni' filtrira na kasni termine", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("status-pill-kasni").click()
    await page.waitForURL(/status=kasni/)
    // svi vidljivi status badge-evi su 'kasni'
    const badges = page.getByTestId("status-badge")
    const n = await badges.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < Math.min(n, 10); i++) {
      await expect(badges.nth(i)).toHaveAttribute("data-status", "kasni")
    }
  })

  test("pretraga firme filtrira tabelu", async ({ page }) => {
    await page.goto("/termini")
    const input = page.getByTestId("filter-search")
    await input.fill("WAIKIKI")
    await input.press("Enter")
    await page.waitForURL(/q=WAIKIKI/)
    const rows = page.getByTestId("termin-row")
    expect(await rows.count()).toBeGreaterThan(0)
    // bar prvi red sadrži WAIKIKI (case-insensitive)
    await expect(rows.first()).toContainText(/WAIKIKI/i)
  })

  test("status pill 'Svi' vraća sve", async ({ page }) => {
    await page.goto("/termini?status=kasni")
    await page.getByTestId("status-pill-svi").click()
    await page.waitForURL((u) => !u.search.includes("status="))
    await expect(page.getByTestId("termini-table")).toBeVisible()
  })
})
```

- [ ] **Step 5.5: Full check**

```bash
pnpm test:e2e tests/e2e/03-termini.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 5.6: Commit**

```bash
git add components/domain/TerminiFilters.tsx lib/termini-filters.ts app/ tests/e2e/03-termini.spec.ts && git commit -m "feat(phase-3): TerminiFilters — URL-state filteri

- status pills (svi/kasni/planirano/zakazano/izvrseno/otkazano)
- klijent + vrsta dropdown (Select), mjesec dropdown, pretraga firme (Enter)
- filteri zapisuju search params, page reset + zatvaranje selected
- page primjenjuje filtere na termini_view (eq status_izvedeni, ilike klijent_naziv,
  eq klijent_id/vrsta_provjere_id, rok range po mjesecu)
- klijenti/vrste dropdown opcije fetch-ovane paralelno (Promise.all)
- E2E: kasni filter, search WAIKIKI, svi reset"
```

---

## Task 6: Server Actions + TerminSheet (detalji, edit, označi izvršeno)

**Files:**
- Create: `app/(dashboard)/termini/actions.ts`
- Create: `components/domain/TerminSheet.tsx`
- Modify: `app/(dashboard)/termini/page.tsx` (render sheet kad `?selected`)
- Modify: `tests/e2e/03-termini.spec.ts`

**Interfaces:**
- Produces:
  - `type ActionResult = { ok: true } | { ok: false; errors?: ...; message?: string }`
  - `updateTermin(prev, formData): Promise<ActionResult>` — datum_zakazan, datum_izvrsenja, zaduzeni, napomena, status
  - `markIzvrseno(prev, formData): Promise<ActionResult>` — set datum_izvrsenja + status='izvrseno' (auto-cycle)
  - `<TerminSheet termin={TerminRow} closeHref={string} />` — client, otvoren

- [ ] **Step 6.1: Kreiraj `app/(dashboard)/termini/actions.ts`**

```ts
'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Neispravan datum")
  .optional()
  .or(z.literal("").transform(() => undefined))

const updateSchema = z.object({
  id: z.string().uuid(),
  datum_zakazan: optionalDate,
  datum_izvrsenja: optionalDate,
  zaduzeni: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
  napomena: z.string().max(2000).optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(["planirano", "zakazano", "izvrseno", "otkazano"]).optional(),
})

export async function updateTermin(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const { id, ...fields } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("termini")
    .update({
      datum_zakazan: fields.datum_zakazan ?? null,
      datum_izvrsenja: fields.datum_izvrsenja ?? null,
      zaduzeni: fields.zaduzeni ?? null,
      napomena: fields.napomena ?? null,
      ...(fields.status ? { status: fields.status } : {}),
    })
    .eq("id", id)

  if (error) return { ok: false, message: error.message }

  revalidatePath("/termini")
  return { ok: true }
}

const markSchema = z.object({
  id: z.string().uuid(),
  datum_izvrsenja: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum je obavezan"),
})

export async function markIzvrseno(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = markSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const { id, datum_izvrsenja } = parsed.data

  const supabase = await createServerSupabaseClient()
  // Mark-done u JEDNOM pozivu (datum + status) → tg_termini_auto_cycle spawn-uje sljedeći termin
  const { error } = await supabase
    .from("termini")
    .update({ datum_izvrsenja, status: "izvrseno" })
    .eq("id", id)

  if (error) return { ok: false, message: error.message }

  revalidatePath("/termini")
  return { ok: true }
}
```

- [ ] **Step 6.2: Kreiraj `components/domain/TerminSheet.tsx`**

```tsx
"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { formatDatum, todayIso } from "@/lib/date"
import { updateTermin, markIzvrseno, type ActionResult } from "@/app/(dashboard)/termini/actions"
import type { TerminRow } from "@/components/domain/TerminiTable"

const initial: ActionResult = { ok: true }

export function TerminSheet({ termin, closeHref }: { termin: TerminRow; closeHref: string }) {
  const router = useRouter()
  const [updateState, updateAction, updatePending] = useActionState(updateTermin, initial)
  const [markState, markAction, markPending] = useActionState(markIzvrseno, initial)
  const [izvrDatum, setIzvrDatum] = useState(todayIso())

  function close() {
    router.push(closeHref)
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close() }}>
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="termin-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{termin.klijent_naziv ?? "Termin"}</span>
            <StatusBadge status={termin.status_izvedeni} />
          </SheetTitle>
          <p className="text-sm text-slate-500">
            {termin.vrsta_naziv ?? "—"}
            {termin.lokacija_naziv ? ` · ${termin.lokacija_naziv}` : ""}
          </p>
          <p className="text-xs text-slate-400">Rok: {formatDatum(termin.rok_dospijeca)}</p>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-4 space-y-6">
          {/* Edit forma */}
          <form action={updateAction} className="space-y-3" data-testid="termin-edit-form">
            <input type="hidden" name="id" value={termin.id ?? ""} />
            <label className="block text-sm">
              <span className="text-slate-600">Datum zakazan</span>
              <Input type="date" name="datum_zakazan" defaultValue={termin.datum_zakazan ?? ""} data-testid="edit-datum-zakazan" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Zaduženi</span>
              <Input name="zaduzeni" defaultValue={termin.zaduzeni ?? ""} placeholder="npr. Marija K." data-testid="edit-zaduzeni" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Napomena</span>
              <Input name="napomena" defaultValue={termin.napomena ?? ""} data-testid="edit-napomena" />
            </label>
            {updateState.ok === false && updateState.message && (
              <p className="text-sm text-red-600" role="alert">{updateState.message}</p>
            )}
            <Button type="submit" disabled={updatePending} data-testid="edit-save">
              {updatePending ? "Spremam…" : "Spremi izmjene"}
            </Button>
          </form>

          {/* Označi kao izvršeno */}
          {termin.status !== "izvrseno" && (
            <form action={markAction} className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="mark-done-form">
              <p className="text-sm font-medium">Označi kao izvršeno</p>
              <input type="hidden" name="id" value={termin.id ?? ""} />
              <Input
                type="date"
                name="datum_izvrsenja"
                value={izvrDatum}
                onChange={(e) => setIzvrDatum(e.target.value)}
                data-testid="mark-datum"
              />
              {markState.ok === false && markState.message && (
                <p className="text-sm text-red-600" role="alert">{markState.message}</p>
              )}
              <Button type="submit" variant="default" disabled={markPending} data-testid="mark-done-submit">
                {markPending ? "Označavam…" : "Označi izvršeno"}
              </Button>
              <p className="text-xs text-slate-400">
                Sistem automatski kreira sljedeći termin u ciklusu.
              </p>
            </form>
          )}

          {/* Dokumenti — placeholder (Faza 7) */}
          <section data-testid="sheet-dokumenti">
            <p className="text-xs uppercase tracking-wide text-slate-400">Dokumenti</p>
            <p className="mt-1 text-sm text-slate-500">Upload i AI generisanje zapisnika dolazi u Fazi 7.</p>
          </section>

          {/* Istorija — placeholder (puni se u Fazi 4/kasnije) */}
          <section data-testid="sheet-istorija">
            <p className="text-xs uppercase tracking-wide text-slate-400">Istorija</p>
            <p className="mt-1 text-sm text-slate-500">Prethodni ciklusi pojavljuju se ovdje.</p>
          </section>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={close} data-testid="sheet-close">Zatvori</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

**Napomena o `revalidatePath` + client navigacija:** nakon uspješne akcije, `revalidatePath('/termini')` osvježava server podatke; pošto je sheet otvoren preko `?selected`, forma ostaje. Za UX, nakon mark-izvrseno akcije možeš zatvoriti sheet — ali to zahtijeva praćenje prethodnog stanja akcije. Za MVP: ostavi sheet otvoren, korisnik vidi ažuriran badge nakon revalidacije (router osvježi). Implementer može dodati `useEffect` koji zatvara sheet na `markState.ok === true` ako želi — opciono.

- [ ] **Step 6.3: Update `page.tsx` — renderuj TerminSheet kad `?selected`**

Dodaj na kraj `TerminiPage`, prije zatvaranja root diva:

```tsx
import { TerminSheet } from "@/components/domain/TerminSheet"

// ... nakon izračuna `rows`:
const selectedId = typeof sp.selected === "string" ? sp.selected : null
let selectedTermin: TerminRow | null =
  selectedId ? rows.find((r) => r.id === selectedId) ?? null : null

// Fallback fetch ako selected nije na trenutnoj stranici/filteru
if (selectedId && !selectedTermin) {
  const { data } = await supabase
    .from("termini_view")
    .select("*")
    .eq("id", selectedId)
    .maybeSingle()
  selectedTermin = (data as TerminRow | null) ?? null
}

// closeHref = trenutni URL bez "selected"
const closeParams = new URLSearchParams(currentSearch)
closeParams.delete("selected")
const closeHref = `/termini${closeParams.toString() ? `?${closeParams.toString()}` : ""}`
```

I na kraju JSX-a:

```tsx
{selectedTermin && <TerminSheet termin={selectedTermin} closeHref={closeHref} />}
```

- [ ] **Step 6.4: E2E mutacije**

Dodaj describe blok:

```ts
test.describe("Faza 3 — Termin detalji i mutacije", () => {
  test("Detalji otvara sheet", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("termin-detalji").first().click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    await expect(page.getByTestId("termin-edit-form")).toBeVisible()
  })

  test("uredi napomenu i spremi", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("termin-detalji").first().click()
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    const napomena = page.getByTestId("edit-napomena")
    await napomena.fill("E2E test napomena")
    await page.getByTestId("edit-save").click()
    // nakon spremanja, nema error alert-a
    await expect(page.locator("[role=alert]")).toHaveCount(0)
  })

  test("označi kao izvršeno mijenja status i kreira novi ciklus", async ({ page }) => {
    // Otvori prvi 'planirano' ili 'kasni' termin
    await page.goto("/termini?status=kasni")
    const before = Number(await page.getByTestId("stat-ukupno-value").textContent())
    await page.getByTestId("termin-detalji").first().click()
    await expect(page.getByTestId("mark-done-form")).toBeVisible()
    await page.getByTestId("mark-done-submit").click()
    // nema error
    await expect(page.locator("[role=alert]")).toHaveCount(0)
    // ukupno termina poraslo za 1 (auto-cycle kreirao sljedeći)
    await page.goto("/termini")
    const after = Number(await page.getByTestId("stat-ukupno-value").textContent())
    expect(after).toBe(before + 1)
  })

  test("Zatvori sheet vraća na listu", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("termin-detalji").first().click()
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    await page.getByTestId("sheet-close").click()
    await page.waitForURL((u) => !u.search.includes("selected="))
    await expect(page.getByTestId("termin-sheet")).toBeHidden()
  })
})
```

**Napomena:** mark-izvrseno test mijenja seed stanje (kreira termin). To je OK lokalno; svaki run pravi +1. Za determinizam, test čita before/after dinamički (ne hardkoduje broj). Ako test postane flaky zbog akumulacije, implementer može dodati `pnpm db:reset && pnpm seed` u global setup — ali NE briši test.

- [ ] **Step 6.5: Full check**

```bash
pnpm test:e2e tests/e2e/03-termini.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 6.6: Commit**

```bash
git add app/ components/domain/TerminSheet.tsx tests/e2e/03-termini.spec.ts && git commit -m "feat(phase-3): Server Actions + TerminSheet (detalji/edit/označi izvršeno)

- actions.ts: updateTermin (zakazan/zaduzeni/napomena/status),
  markIzvrseno (datum+status=izvrseno u jednom pozivu → auto-cycle)
- zod validacija, ActionResult shape, revalidatePath('/termini')
- TerminSheet: header (klijent+vrsta+status badge), edit forma (useActionState),
  označi-izvršeno forma, Dokumenti/Istorija placeholderi (Faza 7)
- page renderuje sheet kad ?selected; fallback fetch ako van stranice
- E2E: otvori sheet, edit napomenu, mark izvršeno (+1 ciklus), zatvori"
```

---

## Task 7: Novi termin (create)

**Files:**
- Create: `components/domain/NoviTerminButton.tsx`
- Modify: `app/(dashboard)/termini/actions.ts` (createTermin)
- Modify: `app/(dashboard)/termini/page.tsx` (CTA u header)
- Modify: `tests/e2e/03-termini.spec.ts`

**Interfaces:**
- Produces:
  - `createTermin(prev, formData): Promise<ActionResult>` — insert klijent_id, vrsta_provjere_id, rok_dospijeca (+opciono datum_zakazan, zaduzeni)
  - `<NoviTerminButton klijenti={Opt[]} vrste={Opt[]} />` — CTA → Sheet sa create formom

- [ ] **Step 7.1: Dodaj `createTermin` u `actions.ts`**

```ts
const createSchema = z.object({
  klijent_id: z.string().uuid("Klijent je obavezan"),
  vrsta_provjere_id: z.string().uuid("Vrsta je obavezna"),
  rok_dospijeca: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Rok je obavezan"),
  datum_zakazan: optionalDate,
  zaduzeni: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
})

export async function createTermin(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const { klijent_id, vrsta_provjere_id, rok_dospijeca, datum_zakazan, zaduzeni } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("termini").insert({
    klijent_id,
    vrsta_provjere_id,
    rok_dospijeca,
    datum_zakazan: datum_zakazan ?? null,
    zaduzeni: zaduzeni ?? null,
    status: datum_zakazan ? "zakazano" : "planirano",
  })

  if (error) return { ok: false, message: error.message }

  revalidatePath("/termini")
  return { ok: true }
}
```

- [ ] **Step 7.2: Kreiraj `components/domain/NoviTerminButton.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { createTermin, type ActionResult } from "@/app/(dashboard)/termini/actions"

type Opt = { id: string; naziv: string }
const initial: ActionResult = { ok: true }

export function NoviTerminButton({ klijenti, vrste }: { klijenti: Opt[]; vrste: Opt[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [klijentId, setKlijentId] = useState("")
  const [vrstaId, setVrstaId] = useState("")
  const [state, action, pending] = useActionState(createTermin, initial)

  // Na uspjeh: zatvori i osvježi
  useEffect(() => {
    if (state.ok && !pending) {
      // state.ok je true i u initialu; zatvori samo nakon stvarnog submita — pratimo preko submitted flag
    }
  }, [state, pending])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button data-testid="novi-termin-btn">
            <Plus className="w-4 h-4" aria-hidden /> Novi termin
          </Button>
        }
      />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="novi-termin-sheet">
        <SheetHeader>
          <SheetTitle>Novi termin</SheetTitle>
        </SheetHeader>

        <form
          action={(fd) => {
            fd.set("klijent_id", klijentId)
            fd.set("vrsta_provjere_id", vrstaId)
            action(fd)
          }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="novi-termin-form"
        >
          <label className="block text-sm">
            <span className="text-slate-600">Klijent *</span>
            <Select value={klijentId} onValueChange={setKlijentId}>
              <SelectTrigger data-testid="novi-klijent"><SelectValue placeholder="Izaberi klijenta" /></SelectTrigger>
              <SelectContent>
                {klijenti.map((k) => <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Vrsta provjere *</span>
            <Select value={vrstaId} onValueChange={setVrstaId}>
              <SelectTrigger data-testid="novi-vrsta"><SelectValue placeholder="Izaberi vrstu" /></SelectTrigger>
              <SelectContent>
                {vrste.map((v) => <SelectItem key={v.id} value={v.id}>{v.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Rok dospijeća *</span>
            <Input type="date" name="rok_dospijeca" required data-testid="novi-rok" />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Datum zakazan</span>
            <Input type="date" name="datum_zakazan" data-testid="novi-zakazan" />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Zaduženi</span>
            <Input name="zaduzeni" placeholder="npr. Marija K." data-testid="novi-zaduzeni" />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}

          <Button type="submit" disabled={pending} data-testid="novi-submit">
            {pending ? "Kreiram…" : "Kreiraj termin"}
          </Button>
        </form>

        <SheetFooter>
          <SheetClose render={<Button variant="outline" data-testid="novi-cancel">Otkaži</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

**Napomena:** zatvaranje sheet-a na uspjeh — pošto initial state ima `ok: true`, ne možemo razlikovati "nije submitovano" od "uspjeh" samo po `ok`. Implementer treba dodati lokalni `submitted` ref/flag koji se postavlja pri submitu, pa `useEffect` zatvara `setOpen(false)` + `router.refresh()` kad `submitted && state.ok && !pending`. Implementiraj to čisto (npr. promijeni initial na `{ ok: false }` ili dodaj poseban marker u uspješni return). Cilj: nakon uspješnog kreiranja sheet se zatvori i lista osvježi.

- [ ] **Step 7.3: Dodaj CTA u `page.tsx` header**

```tsx
import { NoviTerminButton } from "@/components/domain/NoviTerminButton"

// u header div:
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-semibold">Termini</h1>
  <NoviTerminButton klijenti={klijenti} vrste={vrste} />
</div>
```

(Pomjeri dohvat `klijenti`/`vrste` iznad return-a ako već nije — jeste iz Task 5.)

- [ ] **Step 7.4: E2E create**

```ts
test.describe("Faza 3 — Novi termin", () => {
  test("kreira novi termin koji se pojavi u listi", async ({ page }) => {
    await page.goto("/termini")
    const before = Number(await page.getByTestId("stat-ukupno-value").textContent())

    await page.getByTestId("novi-termin-btn").click()
    await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()

    // Izaberi klijenta
    await page.getByTestId("novi-klijent").click()
    await page.getByRole("option").first().click()
    // Izaberi vrstu
    await page.getByTestId("novi-vrsta").click()
    await page.getByRole("option").first().click()
    // Rok
    await page.getByTestId("novi-rok").fill("2026-12-31")

    await page.getByTestId("novi-submit").click()

    // Sheet se zatvori, ukupno +1
    await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })
    const after = Number(await page.getByTestId("stat-ukupno-value").textContent())
    expect(after).toBe(before + 1)
  })
})
```

- [ ] **Step 7.5: Full check**

```bash
pnpm test:e2e tests/e2e/03-termini.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 7.6: Commit**

```bash
git add app/ components/domain/NoviTerminButton.tsx tests/e2e/03-termini.spec.ts && git commit -m "feat(phase-3): Novi termin (create)

- createTermin Server Action: insert klijent/vrsta/rok (+zakazan/zaduzeni),
  status=zakazano ako ima datum_zakazan inače planirano
- NoviTerminButton: CTA → Sheet sa formom (klijent/vrsta Select, rok date),
  na uspjeh zatvara sheet + refresh
- CTA u /termini header
- E2E: kreiraj termin, ukupno +1, sheet zatvoren"
```

---

## Task 8: Comprehensive E2E + push + phase gate

**Files:**
- Modify: `tests/e2e/03-termini.spec.ts` (konsolidacija + visual screenshot)

**Interfaces:**
- Consumes: sve T1-T7
- Produces: kompletan E2E + fresh-agent gate report + tag v0.3.0

- [ ] **Step 8.1: Dodaj visual regression smoke (opciono ali preporučeno)**

Dodaj na kraj `03-termini.spec.ts`:

```ts
test.describe("Faza 3 — Vizuelni smoke", () => {
  test("termini ekran screenshot @ 1440x900", async ({ page }) => {
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("termini-stats")).toBeVisible()
    await expect(page.getByTestId("termini-table")).toBeVisible()
    // Snapshot za manualni pregled (ne toHaveScreenshot da izbjegnemo baseline drift na seed promjenama)
    await page.screenshot({ path: "test-results/termini-faza3.png", fullPage: true })
  })
})
```

- [ ] **Step 8.2: Pun E2E pokret (svi spec fajlovi)**

```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && pnpm db:reset && pnpm seed && pnpm test:e2e
```

Reset+seed da E2E krene sa čistim stanjem (mark-done/create testovi mijenjaju podatke). Expected: svi spec-ovi (01, 02, 03) pass na Chromium + WebKit.

- [ ] **Step 8.3: Full check**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e
```

- [ ] **Step 8.4: Commit**

```bash
git add tests/e2e/03-termini.spec.ts && git commit -m "test(phase-3): comprehensive 03-termini.spec + vizuelni smoke

- konsolidovani E2E: stats, tabela, paginacija, filteri, detalji,
  edit, mark-izvršeno (auto-cycle), create
- vizuelni screenshot smoke @ 1440x900"
```

- [ ] **Step 8.5: Push**

```bash
git push origin main
```

- [ ] **Step 8.6: Phase 3 Gate — fresh agent**

Dispatch fresh `general-purpose` agent, prazan kontekst:

```
You are an independent verifier for Phase 3 of the Tehpro MVP. NO context.
Validate ONLY Phase 3 (Termini CRUD).

Inputs:
- Codebase: /Users/nmil/Desktop/Ai Forward/tehpro-mvp/
- Spec: docs/superpowers/specs/2026-06-20-tehpro-mvp-design.md (§7.2, §7.5)
- Plan: docs/superpowers/plans/2026-06-20-tehpro-mvp-phase-3-termini-crud.md

Project is LOCAL ONLY (Docker Supabase, no Vercel). Read Plan "Task Map".

Tasks:
1. Pre-flight: supabase status (start if down); pnpm install; pnpm db:reset && pnpm seed
2. Gate 1: pnpm build && pnpm lint && pnpm typecheck — all exit 0
3. Gate 2: pnpm test:unit — vitest (13 tests: 5 parser + 8 date)
4. Gate 3: pnpm test:e2e — all pass Chromium+WebKit
5. Gate 4: DB — verify termini_view has klijent_naziv/vrsta_naziv columns; get_termini_stats() returns 4 counts:
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select * from get_termini_stats();"
6. Gate 5: Manual via mcp__playwright__* (pnpm dev &):
   a. /termini shows 4 stat cards with numbers
   b. table shows rows with 7 columns + status badges
   c. click status pill "Kasni" → only kasni rows
   d. search "WAIKIKI" → filtered rows
   e. click "Detalji" → sheet opens with edit form
   f. in sheet, edit napomena, save → no error
   g. mark a termin izvršeno → ukupno count +1 (auto-cycle)
   h. "Novi termin" → fill form → create → ukupno +1
   i. zero console errors on /termini
   j. screenshot /termini
7. Gate 6: Code inventory — verify exist: lib/date.ts, lib/termini.ts, lib/date.test.ts,
   components/domain/{StatusBadge,StatCard,TerminiTable,TerminiFilters,TerminSheet,NoviTerminButton}.tsx,
   app/(dashboard)/termini/actions.ts, migration *_termini_read_model.sql.
   Verify NO sm:/md: classes (grep). Verify actions.ts uses 'use server'.
8. Gate 7: Git — git status clean, commits since v0.2.0 (~9), pushed to origin.

Return STRICT JSON:
{
  "phase": 3,
  "gate_1_build": "pass|fail", "gate_1_lint": "pass|fail", "gate_1_typecheck": "pass|fail",
  "gate_2_unit": "X/Y",
  "gate_3_e2e": "X/Y",
  "gate_4_db": {"view_columns": "pass|fail", "stats_rpc": "pass|fail"},
  "gate_5_manual": [{"step": "...", "status": "pass|fail", "notes": "..."}],
  "gate_5_screenshot": "path",
  "gate_6_inventory": "pass|fail", "gate_6_no_sm_md": "pass|fail", "gate_6_findings": ["..."],
  "gate_7_git": "pass|fail", "commits_since_v0_2_0": <int>,
  "blockers": [...], "non_blockers": [...]
}

Do NOT suggest improvements. Only report. Stop dev server when done.
```

Ako blockers → fiks → re-run. Ako čisto → tag.

- [ ] **Step 8.7: Tag v0.3.0**

```bash
git tag -a v0.3.0 -m "Phase 3 — Termini CRUD complete

T1: date + status helperi (lib/date, lib/termini)
T2: read-model (obogaćen termini_view + get_termini_stats RPC)
T3: StatusBadge + StatCard + stats row
T4: TerminiTable + lista + paginacija
T5: TerminiFilters (URL-state: status/search/klijent/vrsta/mjesec)
T6: Server Actions + TerminSheet (edit + označi izvršeno → auto-cycle)
T7: Novi termin (create)
T8: comprehensive E2E + phase gate

Phase Gate: ALL PASS. Repo: https://github.com/stpauli98/Tehrpo"

git push origin v0.3.0
```

---

## Self-Review

**1. Spec coverage:**
- §7.2 A (/termini): stats row ✓ (T3), filteri search/klijent/vrsta/status/mjesec ✓ (T5), tabela 7 kolona ✓ (T4), CTA Novi termin ✓ (T7)
- §7.2 B (/termini/[id] sheet): header klijent+lokacija+vrsta+status ✓ (T6), forma datum_zakazan/datum_izvrsenja/zaduzeni/napomena ✓ (T6), Označi izvršeno → auto-cycle ✓ (T6), Dokumenti sekcija placeholder ✓ (T6, puni Faza 7), Istorija sekcija placeholder ✓ (T6)
  - **Razlika od spec-a:** spec kaže `/termini/[id]` kao zasebnu rutu; mi koristimo `?selected=<id>` na istoj ruti (sheet preko search param). Funkcionalno ekvivalentno, deep-linkable, jednostavnije i bolje za query-by-page. Dokumentovano u Architecture.
  - **Razlika:** "Označi kao izvršeno → dialog za upload zapisnika" — upload je Faza 7; u Fazi 3 mark-izvršeno samo postavlja datum+status (auto-cycle). Dokument upload dolazi u Fazi 7. Dokumentovano.
- §7.5 komponente (StatusBadge, StatCard, TerminiTable, TerminiFilters, TerminSheet): sve ✓. Plus NoviTerminButton (potreban za CTA).
- §8 scope "List + filteri + create/edit/detail; status workflow + auto-cycle": sve pokriveno.
- §9.1 03-termini.spec.ts (create, mark izvršeno, auto-cycle, status badge boje): ✓ T8.

**2. Placeholder scan:**
- "placeholder (Faza 7)" za Dokumenti — eksplicitno odložen feature sa fazom, ne TODO. OK.
- "Istorija placeholder" — sekcija postoji, sadržaj se puni kasnije. Prihvatljivo kao MVP stub (spec traži sekciju Istorija; prikazujemo je sa praznim stanjem). OK.
- Nema "TBD"/"implement later" u plan kodu.
- Step 7.2 napomena o `submitted` flag-u za zatvaranje sheet-a — to je uputstvo implementeru da DOVRŠI logiku, ne placeholder; kod mora biti funkcionalan (E2E test 7.4 zahtijeva da se sheet zatvori).

**3. Type consistency:**
- `TerminRow` definisan u TerminiTable.tsx (T4), importovan u TerminSheet (T6) i page. Match.
- `ActionResult` definisan u actions.ts (T6), importovan u TerminSheet + NoviTerminButton. Match.
- `DerivedStatus`, `STATUS_*` iz lib/termini.ts (T1) → StatusBadge (T3), TerminiFilters (T5). Match.
- `formatDatum`, `monthRange`, `MONTHS_BS` iz lib/date.ts (T1) → TerminiTable, TerminSheet, page, termini-filters. Match.
- RPC `get_termini_stats` (T2) → page `.rpc("get_termini_stats")` (T3). Naziv match.
- `get_termini_stats` vraća `{ukupno, ovog_mjeseca, kasni, izvrseno_ovog_mjeseca}` → page koristi te tačne ključeve. Match.
- view kolone `klijent_naziv, lokacija_naziv, lokacija_grad, vrsta_naziv, status_izvedeni` (T2) → TerminiTable `r.klijent_naziv` itd. Match.

**Potencijalni rizici za implementera (flagged za pažnju, ne blokeri):**
1. base-nova `Button` `render` prop sa Next `<Link>` (T4 paginacija) — ako ne radi čisto, fallback na `<Link className={buttonVariants(...)}>`. Napomena uključena.
2. base-nova `Select` u formi — koristimo controlled state + `fd.set()` u create (T7), `onValueChange` + URL u filteri (T5). Izbjegava oslanjanje na native form submit Select-a.
3. `SheetTrigger`/`SheetClose` `render` prop — ako problematičan, koristi controlled `open` state (već imamo u NoviTerminButton).
4. Zatvaranje create sheet-a na uspjeh (T7) — treba `submitted` flag jer initial state `ok:true`. Implementer mora dovršiti.
5. E2E testovi koji mijenjaju podatke (mark-done, create) — T8 radi `db:reset && seed` prije punog runa. Pojedinačni dev runovi akumuliraju, ali testovi čitaju before/after dinamički.
