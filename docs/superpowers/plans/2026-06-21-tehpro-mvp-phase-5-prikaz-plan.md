# Tehpro MVP — Faza 5: Prikaz (matrix) + Mjesečni plan (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implementirati `/prikaz` (godišnja matrica po klijentu: vrste × 12 mjeseci, + "opterećenje po mjesecima" bar chart) i `/plan` (mjesečni kalendar sa terminima po danu + sidebar za izabrani dan). Klik na ćeliju/termin reuse-uje postojeći `TerminSheet` (Faza 3). Čitanje iz `termini_view`, pivot u memoriji.

**Architecture:** RSC stranice čitaju iz `termini_view` (filtrirano po klijentu+godini za matricu, po mjesecu za kalendar), grupišu u JS. `/prikaz` matrica je **per-klijent, redovi = vrste, kolone = 12 mjeseci** (Excel-matrica mental model). Chart su **čisti CSS/Tailwind barovi** (RSC-native, bez chart lib-a). Toggle/nav preko URL search params + tankih `'use client'` wrappera (kao KlijentTabs). `?selected=<id>` otvara reuse-ovani TerminSheet. Jedan mali RPC `get_opterecenje(godina)`.

**Tech Stack:** Next.js 16 (App Router, RSC) · React 19 · TS strict · Tailwind v4 · shadcn base-nova (Select/Tabs/Card) · Supabase JS · zod · Playwright + vitest · pnpm. **Bez Recharts** (vidi odluku ispod).

**Spec:** `docs/superpowers/specs/2026-06-20-tehpro-mvp-design.md` §7.2 C/D, §7.5
**Prethodne faze:** [phase-4](./2026-06-21-tehpro-mvp-phase-4-klijenti-lokacije.md) (v0.4.0). Reuse: TerminSheet (?selected), StatusBadge, lib/date (formatDatum/monthRange/currentYear/MONTHS_BS/todayIso), termini_view, NoviTerminButton.

---

## Ključne odluke (nakon understand faze)

### Odluka 1 — Matrix orijentacija: per-klijent vrsta × mjesec
Spec §7.2 C navodi "redovi: klijenti × lokacije, kolone: vrste". To je **netraktabilno** sa stvarnim podacima: 51 klijent × 58 vrsta = 2958 ćelija, 89% prazno (samo 330 (klijent,vrsta) parova ima termine). Lokacije su PRAZNE u seed-u → lokacija-bazirana matrica bi bila prazna.

**Realizacija:** `/prikaz` je **scope-ovan na jednog klijenta** (klijent picker). Za izabranog klijenta: **redovi = vrste provjera koje taj klijent ima, kolone = 12 mjeseci izabrane godine.** Ovo je tačno "Excel matrica" intent iz mockup-a (raspored jednog klijenta kroz godinu), tractable (WAIKIKI DELTA = 28 vrsta × 12 = 336 ćelija, popunjeno), i sa realnim podacima. **Dokumentovana svjesna divergencija od spec orijentacije.**

### Odluka 2 — Chart: čisti CSS/Tailwind barovi (NE Recharts)
Spec §3.1/§7.2 C pominje "Recharts". Ali: mockup koristi čiste CSS barove (flex + height %), Recharts traži `'use client'` + dodaje SSR/hydration rizik u Next 16 + bundle za JEDAN prost bar chart. **Odluka: čisti CSS/Tailwind barovi** — RSC-native, bez dependency-ja, vizuelno ekvivalentno. **Dokumentovana svjesna divergencija** (Recharts se dodaje kasnije ako zatreba interaktivnost). Posljedica: nema `pnpm add recharts`, nema chart client komponente.

### Odluka 3 — Cell click reuse
Matrica i kalendar reuse-uju `TerminSheet` preko `?selected=<id>` (Faza 3 pattern: fallback fetch + istorija + closeHref). Bez nove sheet infrastrukture.

---

## Global Constraints

- **Node ≥ 20, pnpm.** Next.js 16, React 19, TS strict + `noUncheckedIndexedAccess`.
- **DB driver:** SAMO `@supabase/supabase-js`. READ iz `termini_view`; nove agregacije preko RPC ili JS-pivota. Bez novih write tabela u Fazi 5 (matrica/kalendar su read; create reuse-uje postojeći createTermin).
- **Query-by-page (§5):** `/prikaz` max 2 round-tripa: (1) `get_opterecenje(godina)` RPC za chart, (2) matrix rows za izabranog klijenta. Plus pomoćni klijenti-lista za picker (paralelno, izuzet). `/plan`: 1 query (mjesec termini). Pivot u JS preko `Map` (O(1) lookup), NIKAD `.find()` u petlji.
- **No await-in-loop.** Bulk grupisanje u memoriji.
- **Tailwind breakpoints:** SAMO `lg:`/`xl:`/`2xl:`. `sm:`/`md:` = ESLint error.
- **Datumi/timezone:** koristi `lib/date` helpere. `todayIso()` je UTC — koristi ga za "danas" highlight (NE `new Date().toLocaleDateString()`). Kalendar grid dane gradi integer aritmetikom + `Date.UTC` samo za weekday.
- **Bosanski jezik.** Status boje ćelija: izvrseno=zelena, planirano/zakazano=plava/amber, kasni=crvena (mockup cell-done/cell-plan/cell-late).
- **base-ui testid:** Button/Input/SelectTrigger forward-uju; SelectItem/Tabs panel ne pouzdano → testovi `getByRole("option"/"tab")`.
- **Commit style:** `feat(phase-5): <bosanski>` / `test(phase-5): ...`. Push na `origin/main`. Tag `v0.5.0`.
- **NEMA Vercel/cloud** — lokalno, Docker Supabase. Git push DA. test:e2e `--workers=1`, spec ima `mode:serial`.

## Poznati podaci (iz Faze 2-4)

- `klijenti`: 51, `lokacije`: 0 (prazno), `termini`: 1000. Top: WAIKIKI BANJA LUKA - DELTA (194 termina, 28 vrsta), CARMEUSE (90).
- Status raspodjela (2026): mjesečno varira; npr. Jul 2026 = 132 planirano, Feb 2026 = 105 izvrseno + 91 kasni.
- termini_view kolone: id, klijent_id, klijent_naziv, vrsta_provjere_id, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, datum_zakazan, datum_izvrsenja, status, status_izvedeni, zaduzeni, napomena, interval_mjeseci.

---

## File Structure

```
tehpro-mvp/
├── supabase/migrations/
│   └── <ts>_opterecenje_rpc.sql              # get_opterecenje(godina) RPC
├── db/types.ts                                # REGEN
├── lib/
│   ├── calendar.ts                            # buildMonthGrid, prevMonth/nextMonth, monthLabel
│   └── calendar.test.ts                       # vitest
├── app/(dashboard)/
│   ├── prikaz/page.tsx                        # matrica + chart + klijent/godina picker + ?selected sheet
│   └── plan/page.tsx                          # kalendar + nav + dan sidebar + ?selected sheet
├── components/domain/
│   ├── OpterecenjeChart.tsx                   # CSS bar chart (server comp)
│   ├── PrikazToolbar.tsx                      # klijent picker + godina (client, URL nav)
│   ├── MatrixGrid.tsx                         # vrsta × mjesec tabela (server comp)
│   ├── MonthCalendar.tsx                      # 7-col day grid (server comp)
│   └── PlanNav.tsx                            # prev/next/today/godina (client, URL nav)
└── tests/e2e/
    └── 05-matrix-plan.spec.ts                 # E2E
```

---

## Task Map

| # | Task | Deliverable | Verifikacija |
|---|---|---|---|
| 1 | opterecenje RPC + lib/calendar.ts + types | RPC + grid helper + unit testovi | psql + vitest + typecheck |
| 2 | /prikaz skeleton + PrikazToolbar + OpterecenjeChart | chart + klijent/godina picker rade | E2E chart/toolbar |
| 3 | MatrixGrid (vrsta×mjesec) | matrica se renderuje za klijenta | E2E matrica |
| 4 | Matrix cell click → ?selected + empty → Novi termin | klik ćelije otvara sheet | E2E cell click |
| 5 | /plan + MonthCalendar + PlanNav | kalendar grid + navigacija + danas | E2E kalendar |
| 6 | /plan dan sidebar + ?selected iz sidebar-a | klik dana → termini + Detalji sheet | E2E dan/sidebar |
| 7 | Comprehensive E2E + phase gate + tag v0.5.0 | sve zeleno | fresh-agent gate |

**Ukupno: 7 tasks. Procjena: 2-3 dana.**

---

## Task 1: opterecenje RPC + lib/calendar.ts + regen types

**Files:**
- Create: `supabase/migrations/<ts>_opterecenje_rpc.sql`, `lib/calendar.ts`, `lib/calendar.test.ts`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces:
  - RPC `get_opterecenje(godina int)` → redovi `{ mjesec int, ukupno bigint, izvrseno bigint, kasni bigint, u_planu bigint }`
  - `type CalDay = { date: string; day: number; inMonth: boolean }`
  - `buildMonthGrid(year: number, month1to12: number): CalDay[]` (42 ćelije, ponedjeljak-prvi)
  - `prevMonth(year, month): { year: number; month: number }`, `nextMonth(...)`
  - `monthLabel(month1to12: number): string`

- [ ] **Step 1.1: Supabase up**
```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && supabase status | head -3
```
Ako nije: `supabase start`.

- [ ] **Step 1.2: Migracija**
```bash
supabase migration new opterecenje_rpc
```

- [ ] **Step 1.3: SQL (testiran)**
```sql
-- Opterećenje po mjesecima: broj termina po mjesecu za godinu, razbijeno po izvedenom statusu.
create or replace function get_opterecenje(godina int)
returns table (
  mjesec    int,
  ukupno    bigint,
  izvrseno  bigint,
  kasni     bigint,
  u_planu   bigint
)
language sql
stable
as $$
  select
    extract(month from rok_dospijeca)::int                              as mjesec,
    count(*)                                                            as ukupno,
    count(*) filter (where status_izvedeni = 'izvrseno')               as izvrseno,
    count(*) filter (where status_izvedeni = 'kasni')                  as kasni,
    count(*) filter (where status_izvedeni in ('planirano','zakazano')) as u_planu
  from termini_view
  where extract(year from rok_dospijeca) = godina
  group by 1
  order by 1;
$$;
```

- [ ] **Step 1.4: Primijeni + seed + sanity**
```bash
supabase db reset && pnpm seed
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select * from get_opterecenje(2026);"
```
Expected: do 12 redova; npr. mjesec 2 sa ukupno~196, mjesec 7 sa u_planu~132.

- [ ] **Step 1.5: Kreiraj `lib/calendar.ts`**
```ts
import { MONTHS_BS } from "@/lib/date"

export type CalDay = { date: string; day: number; inMonth: boolean }

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** Naziv mjeseca (1=Januar). Fallback "" za nevažeći broj. */
export function monthLabel(month1to12: number): string {
  return MONTHS_BS[month1to12 - 1] ?? ""
}

/** Prethodni mjesec (sa prelaskom godine). */
export function prevMonth(year: number, month1to12: number): { year: number; month: number } {
  return month1to12 <= 1 ? { year: year - 1, month: 12 } : { year, month: month1to12 - 1 }
}

/** Sljedeći mjesec (sa prelaskom godine). */
export function nextMonth(year: number, month1to12: number): { year: number; month: number } {
  return month1to12 >= 12 ? { year: year + 1, month: 1 } : { year, month: month1to12 + 1 }
}

/**
 * Gradi 42-ćelijski (6 sedmica × 7 dana) mjesečni grid, ponedjeljak-prvi.
 * Dani prethodnog/sljedećeg mjeseca imaju inMonth=false.
 * Weekday se računa preko Date.UTC (timezone-safe); brojevi dana integer aritmetikom.
 */
export function buildMonthGrid(year: number, month1to12: number): CalDay[] {
  const firstWeekday = new Date(Date.UTC(year, month1to12 - 1, 1)).getUTCDay() // 0=Ned..6=Sub
  const mondayOffset = (firstWeekday + 6) % 7 // koliko dana prije 1. (ponedjeljak-prvi)
  const lastDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
  const prevLast = new Date(Date.UTC(year, month1to12 - 1, 0)).getUTCDate()
  const cells: CalDay[] = []

  // vodeći dani prethodnog mjeseca
  const prev = prevMonth(year, month1to12)
  for (let i = mondayOffset; i > 0; i--) {
    const d = prevLast - i + 1
    cells.push({ date: `${prev.year}-${pad(prev.month)}-${pad(d)}`, day: d, inMonth: false })
  }
  // dani tekućeg mjeseca
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ date: `${year}-${pad(month1to12)}-${pad(d)}`, day: d, inMonth: true })
  }
  // prateći dani sljedećeg mjeseca do 42
  const next = nextMonth(year, month1to12)
  let d = 1
  while (cells.length < 42) {
    cells.push({ date: `${next.year}-${pad(next.month)}-${pad(d)}`, day: d, inMonth: false })
    d++
  }
  return cells
}
```

- [ ] **Step 1.6: Kreiraj `lib/calendar.test.ts`**
```ts
import { describe, it, expect } from "vitest"
import { buildMonthGrid, prevMonth, nextMonth, monthLabel } from "./calendar"

describe("buildMonthGrid", () => {
  it("uvijek vraća 42 ćelije", () => {
    expect(buildMonthGrid(2026, 2)).toHaveLength(42)
    expect(buildMonthGrid(2026, 7)).toHaveLength(42)
  })
  it("Februar 2026 počinje nedjeljom — 6 vodećih dana (Pon-Sub)", () => {
    // 2026-02-01 je nedjelja (UTC getUTCDay=0) → mondayOffset=6
    const g = buildMonthGrid(2026, 2)
    expect(g[0]?.inMonth).toBe(false)
    expect(g[6]).toEqual({ date: "2026-02-01", day: 1, inMonth: true })
  })
  it("tekući mjesec ima tačan broj dana inMonth", () => {
    const feb = buildMonthGrid(2026, 2).filter((c) => c.inMonth)
    expect(feb).toHaveLength(28)
    const jul = buildMonthGrid(2026, 7).filter((c) => c.inMonth)
    expect(jul).toHaveLength(31)
  })
  it("datumi su ISO YYYY-MM-DD", () => {
    const g = buildMonthGrid(2026, 7).find((c) => c.inMonth && c.day === 15)
    expect(g?.date).toBe("2026-07-15")
  })
})

describe("prevMonth / nextMonth", () => {
  it("prelazak godine", () => {
    expect(prevMonth(2026, 1)).toEqual({ year: 2025, month: 12 })
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 })
  })
  it("unutar godine", () => {
    expect(prevMonth(2026, 7)).toEqual({ year: 2026, month: 6 })
    expect(nextMonth(2026, 7)).toEqual({ year: 2026, month: 8 })
  })
})

describe("monthLabel", () => {
  it("1=Januar, 12=Decembar", () => {
    expect(monthLabel(1)).toBe("Januar")
    expect(monthLabel(12)).toBe("Decembar")
  })
})
```

- [ ] **Step 1.7: Regen types + provjeri**
```bash
pnpm db:types && grep -E "get_opterecenje" db/types.ts | head
pnpm test:unit
pnpm build && pnpm typecheck && pnpm lint
```
Expected: get_opterecenje u Functions; unit testovi (postojeći + novih ~9) prolaze; build/typecheck/lint čisti.

- [ ] **Step 1.8: Commit**
```bash
git add supabase/migrations/ db/types.ts lib/calendar.ts lib/calendar.test.ts && git commit -m "feat(phase-5): get_opterecenje RPC + lib/calendar grid helpers

- get_opterecenje(godina) RPC: termini po mjesecu po statusu (chart data)
- lib/calendar.ts: buildMonthGrid (42 ćelije, pon-prvi, UTC weekday),
  prevMonth/nextMonth, monthLabel
- 9 vitest testova; regen db/types.ts"
```

---

## Task 2: /prikaz skeleton + PrikazToolbar + OpterecenjeChart

**Files:**
- Create: `app/(dashboard)/prikaz/page.tsx`, `components/domain/PrikazToolbar.tsx`, `components/domain/OpterecenjeChart.tsx`
- Create: `tests/e2e/05-matrix-plan.spec.ts`

**Interfaces:**
- Consumes: `get_opterecenje` RPC (T1), klijenti lista, `currentYear`, `MONTHS_BS`
- Produces:
  - `<OpterecenjeChart data={OpterecenjeRow[]} />` — CSS bar chart (server comp)
  - `<PrikazToolbar klijenti={Opt[]} godine={number[]} />` — client, URL `?klijent=`, `?godina=`
  - `/prikaz` RSC: chart + toolbar (matrica placeholder dok T3)

- [ ] **Step 2.1: Kreiraj `components/domain/OpterecenjeChart.tsx`**
```tsx
import { MONTHS_BS } from "@/lib/date"
import { cn } from "@/lib/utils"

export type OpterecenjeRow = {
  mjesec: number
  ukupno: number
  izvrseno: number
  kasni: number
  u_planu: number
}

export function OpterecenjeChart({
  data, currentMonth,
}: {
  data: OpterecenjeRow[]
  currentMonth?: number
}) {
  // Popuni svih 12 mjeseci (RPC vraća samo mjesece sa podacima)
  const byMonth = new Map(data.map((r) => [r.mjesec, r]))
  const months = Array.from({ length: 12 }, (_, i) => byMonth.get(i + 1) ?? {
    mjesec: i + 1, ukupno: 0, izvrseno: 0, kasni: 0, u_planu: 0,
  })
  // Visina bara = zbir VIDLJIVIH segmenata (izvrseno+kasni+u_planu), NE ukupno
  // (ukupno može uključivati 'otkazano' koji nema segment → gap na vrhu). Tako visina = popunjenost.
  const seg = (m: OpterecenjeRow) => m.izvrseno + m.kasni + m.u_planu
  const max = Math.max(1, ...months.map(seg))

  return (
    <div data-testid="opterecenje-chart">
      <p className="text-sm font-semibold text-slate-700 mb-3">Opterećenje po mjesecima (broj termina)</p>
      <div className="flex items-end gap-2 h-44">
        {months.map((m) => (
          <div key={m.mjesec} className="flex-1 self-stretch flex flex-col items-center gap-1" data-testid="chart-bar" data-mjesec={m.mjesec} data-ukupno={m.ukupno}>
            <div className="w-full mt-auto flex flex-col-reverse" style={{ height: `${(seg(m) / max) * 100}%` }} title={`${MONTHS_BS[m.mjesec - 1]}: ${m.ukupno}`}>
              {/* stacked: izvrseno (zeleno), kasni (crveno), u_planu (plavo) */}
              <div className="w-full bg-green-500" style={{ flexGrow: m.izvrseno }} />
              <div className="w-full bg-red-500" style={{ flexGrow: m.kasni }} />
              <div className={cn("w-full rounded-t bg-blue-500", currentMonth === m.mjesec && "ring-2 ring-brand")} style={{ flexGrow: m.u_planu }} />
            </div>
            <span className="text-[10px] text-slate-400">{(MONTHS_BS[m.mjesec - 1] ?? "").slice(0, 3)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" />Izvršeno</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" />Kasni</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block" />U planu</span>
      </div>
    </div>
  )
}
```
**Napomena:** `flexGrow` brojevi dijele visinu bara proporcionalno statusima; ako je bar 0 (svi 0), visina 0% (prazno). Ako `ukupno>0` ali pojedini status=0, taj segment ima flexGrow:0 (nevidljiv).

- [ ] **Step 2.2: Kreiraj `components/domain/PrikazToolbar.tsx`**
```tsx
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

type Opt = { id: string; naziv: string }

export function PrikazToolbar({ klijenti, godine }: { klijenti: Opt[]; godine: number[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const klijent = params.get("klijent") ?? ""
  const godina = params.get("godina") ?? String(godine[0] ?? "")

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete("selected")
    startTransition(() => router.push(`/prikaz?${next.toString()}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="prikaz-toolbar" data-pending={pending}>
      <Select value={klijent} onValueChange={(v) => setParam("klijent", v ?? "")}>
        <SelectTrigger className="w-72" data-testid="prikaz-klijent"><SelectValue placeholder="Izaberi klijenta" /></SelectTrigger>
        <SelectContent>
          {klijenti.map((k) => <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={godina} onValueChange={(v) => setParam("godina", v ?? "")}>
        <SelectTrigger className="w-28" data-testid="prikaz-godina"><SelectValue placeholder="Godina" /></SelectTrigger>
        <SelectContent>
          {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Step 2.3: Kreiraj `app/(dashboard)/prikaz/page.tsx` (chart + toolbar, matrica placeholder)**
```tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { OpterecenjeChart, type OpterecenjeRow } from "@/components/domain/OpterecenjeChart"
import { PrikazToolbar } from "@/components/domain/PrikazToolbar"
import { currentYear, todayIso } from "@/lib/date"

export default async function PrikazPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const godina = Number(typeof sp.godina === "string" ? sp.godina : "") || currentYear()
  const klijentId = typeof sp.klijent === "string" ? sp.klijent : ""

  const supabase = await createServerSupabaseClient()
  const [opterecenjeRes, klijentiRes] = await Promise.all([
    supabase.rpc("get_opterecenje", { godina }),
    supabase.from("klijenti").select("id, naziv").order("naziv"),
  ])

  const opterecenje = (opterecenjeRes.data ?? []) as OpterecenjeRow[]
  const klijenti = (klijentiRes.data ?? []).map((k) => ({ id: k.id, naziv: k.naziv }))
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Prikaz</h1>

      <div className="rounded-xl border border-slate-200 p-4">
        <OpterecenjeChart data={opterecenje} currentMonth={godina === Number(todayIso().slice(0, 4)) ? Number(todayIso().slice(5, 7)) : undefined} />
      </div>

      <PrikazToolbar klijenti={klijenti} godine={godine} />

      {!klijentId ? (
        <div data-testid="prikaz-empty" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          Izaberite klijenta za prikaz godišnje matrice.
        </div>
      ) : (
        <div data-testid="prikaz-matrix-placeholder" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
          Matrica se popunjava u Task 3.
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2.4: Kreiraj `tests/e2e/05-matrix-plan.spec.ts` (chart + toolbar)**
```ts
import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("Faza 5 — Prikaz chart i toolbar", () => {
  test("opterećenje chart se renderuje sa 12 barova", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByRole("heading", { name: "Prikaz" })).toBeVisible()
    await expect(page.getByTestId("opterecenje-chart")).toBeVisible()
    expect(await page.getByTestId("chart-bar").count()).toBe(12)
  })

  test("bez izabranog klijenta prikazuje prompt", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
  })

  test("izbor klijenta postavlja ?klijent= i prikazuje matricu (placeholder/grid)", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    await page.getByRole("option").first().click()
    await page.waitForURL(/klijent=/)
    await expect(page.getByTestId("prikaz-empty")).toBeHidden()
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/prikaz")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
```

- [ ] **Step 2.5: Full check**
```bash
pnpm test:e2e tests/e2e/05-matrix-plan.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 2.6: Commit**
```bash
git add app/ components/domain/OpterecenjeChart.tsx components/domain/PrikazToolbar.tsx tests/e2e/05-matrix-plan.spec.ts && git commit -m "feat(phase-5): /prikaz skeleton — OpterecenjeChart (CSS barovi) + PrikazToolbar

- OpterecenjeChart: stacked CSS/Tailwind barovi (izvrseno/kasni/u_planu),
  RSC-native bez chart lib-a; tekući mjesec highlight
- PrikazToolbar: klijent + godina picker (URL ?klijent=/?godina=)
- /prikaz: chart + toolbar + matrix placeholder (T3 puni)
- get_opterecenje RPC podaci; 05-matrix-plan.spec.ts chart/toolbar"
```

---

## Task 3: MatrixGrid (vrsta × mjesec)

**Files:**
- Create: `components/domain/MatrixGrid.tsx`
- Modify: `app/(dashboard)/prikaz/page.tsx` (fetch + render matrica)
- Modify: `tests/e2e/05-matrix-plan.spec.ts`

**Interfaces:**
- Consumes: termini_view (po klijentu+godini), StatusBadge boje, formatDatum
- Produces:
  - `type MatrixCell = { terminId: string; dan: number; status: DerivedStatus; brojUCeliji: number }`
  - `<MatrixGrid rows={MatrixRow[]} />` — tabela: redovi=vrsta, kolone=12 mjeseci; sticky prva kolona; ćelija boja po statusu + datum. **(`currentSearch` prop se DODAJE u T4 za klik; u T3 je samo `rows`.)**
  - page: fetch klijentovih termina za godinu, pivot u `MatrixRow[]`

- [ ] **Step 3.1: Kreiraj `components/domain/MatrixGrid.tsx`**
```tsx
import { MONTHS_BS } from "@/lib/date"
import type { DerivedStatus } from "@/lib/termini"
import { cn } from "@/lib/utils"

export type MatrixCell = {
  terminId: string
  dan: number       // dan u mjesecu (za prikaz DD.)
  status: DerivedStatus
  brojUCeliji: number
}
export type MatrixRow = {
  vrstaId: string
  vrstaNaziv: string
  // index 1..12 → ćelija ili null
  mjeseci: Record<number, MatrixCell | null>
}

// boja ćelije po izvedenom statusu (mockup cell-done/plan/late)
const CELL_CLASS: Record<DerivedStatus, string> = {
  izvrseno: "bg-green-100 text-green-800 hover:bg-green-200",
  planirano: "bg-blue-50 text-blue-800 hover:bg-blue-100",
  zakazano: "bg-cyan-50 text-cyan-800 hover:bg-cyan-100", // cyan = brand status token (uskladi sa kalendar DOTS)
  kasni: "bg-red-100 text-red-800 hover:bg-red-200",
  otkazano: "bg-slate-100 text-slate-500 hover:bg-slate-200",
}

// Sadržaj ćelije po statusu (§7.2 C: ✓ za izvršeno, ! za kasni).
function cellLabel(cell: MatrixCell): string {
  const dan = String(cell.dan).padStart(2, "0") + "."
  const prefix = cell.status === "izvrseno" ? "✓ " : ""
  const kasni = cell.status === "kasni" ? "!" : ""
  const vise = cell.brojUCeliji > 1 ? ` (+${cell.brojUCeliji - 1})` : ""
  return `${prefix}${dan}${kasni}${vise}`
}

export function MatrixGrid({ rows }: { rows: MatrixRow[] }) {
  if (rows.length === 0) {
    return (
      <div data-testid="matrix-empty" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
        Ovaj klijent nema termina u izabranoj godini.
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200 overflow-x-auto">
      <table className="text-xs border-collapse" data-testid="prikaz-matrix">
        <thead className="bg-slate-50">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 border-r border-slate-200 min-w-[220px]">
              Vrsta pregleda / ispitivanja
            </th>
            {MONTHS_BS.map((m) => (
              <th key={m} className="px-2 py-2 text-center font-medium text-slate-500 whitespace-nowrap min-w-[56px]">
                {m.slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vrstaId} data-testid="matrix-row" className="border-t border-slate-100">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-700 border-r border-slate-100 min-w-[220px]">
                {r.vrstaNaziv}
              </td>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mj) => {
                const cell = r.mjeseci[mj] ?? null
                return (
                  <td key={mj} className="p-1 text-center align-middle" data-testid="matrix-cell" data-mjesec={mj}>
                    {cell ? (
                      <span
                        data-testid="matrix-cell-filled"
                        data-status={cell.status}
                        className={cn("inline-block w-full rounded px-1.5 py-1 tabular-nums", CELL_CLASS[cell.status])}
                      >
                        {cellLabel(cell)}
                      </span>
                    ) : (
                      <span className="text-slate-200">·</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3.2: Update `prikaz/page.tsx` — fetch + pivot matricu**
Dodaj kad je `klijentId` postavljen (zamijeni placeholder blok). Dohvat ide u Promise.all (3. leg, samo kad ima klijenta — ali Promise.all je fiksne širine; uslovi se rješavaju tako da se 3. query izvrši uvijek ali brzo vrati prazno kad nema klijenta). Jednostavnije: drugi `await` nakon glavnog Promise.all (pomoćni, izuzet iz query-by-page jer je sekundaran). Implementacija:
```tsx
import { MatrixGrid, type MatrixRow, type MatrixCell } from "@/components/domain/MatrixGrid"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { toDerivedStatus, type DerivedStatus } from "@/lib/termini"
// koristi TerminRow (= termini_view Row) svuda — isti tip kao TerminSheet props (bez lokalnog aliasa)

// status prioritet za "najurgentniji" u ćeliji (kasni > planirano/zakazano > izvrseno > otkazano)
const STATUS_PRIORITET: Record<DerivedStatus, number> = {
  kasni: 4, planirano: 3, zakazano: 3, izvrseno: 2, otkazano: 1,
}

// ... unutar funkcije, nakon dohvata klijenti/opterecenje:
let matrixRows: MatrixRow[] = []
if (klijentId) {
  const { data } = await supabase
    .from("termini_view")
    .select("id, vrsta_provjere_id, vrsta_naziv, rok_dospijeca, status_izvedeni")
    .eq("klijent_id", klijentId)
    .gte("rok_dospijeca", `${godina}-01-01`)
    .lte("rok_dospijeca", `${godina}-12-31`)
    .order("vrsta_naziv")
  const termini = (data ?? []) as TerminRow[]
  // pivot: vrsta → mjesec → najurgentniji termin
  const byVrsta = new Map<string, MatrixRow>()
  for (const t of termini) {
    if (!t.id || !t.vrsta_provjere_id || !t.rok_dospijeca) continue
    const vrstaId = t.vrsta_provjere_id
    let row = byVrsta.get(vrstaId)
    if (!row) {
      row = { vrstaId, vrstaNaziv: t.vrsta_naziv ?? "—", mjeseci: {} }
      byVrsta.set(vrstaId, row)
    }
    const mj = Number(t.rok_dospijeca.slice(5, 7))
    const dan = Number(t.rok_dospijeca.slice(8, 10))
    const status = toDerivedStatus(t.status_izvedeni)
    const existing = row.mjeseci[mj]
    if (!existing) {
      row.mjeseci[mj] = { terminId: t.id, dan, status, brojUCeliji: 1 }
    } else {
      existing.brojUCeliji += 1
      // zadrži najurgentniji status + njegov datum
      if (STATUS_PRIORITET[status] > STATUS_PRIORITET[existing.status]) {
        existing.terminId = t.id; existing.dan = dan; existing.status = status
      }
    }
  }
  matrixRows = Array.from(byVrsta.values())
}
```
I u JSX zamijeni placeholder:
```tsx
{!klijentId ? (
  <div data-testid="prikaz-empty" ...>Izaberite klijenta za prikaz godišnje matrice.</div>
) : (
  <MatrixGrid rows={matrixRows} />
)}
```

- [ ] **Step 3.3: E2E matrica**
Dodaj describe:
```ts
test.describe("Faza 5 — Matrix grid", () => {
  test("matrica prikazuje vrste (redove) i 12 mjeseci (kolone)", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    // izaberi WAIKIKI DELTA (najviše podataka) — ili prvi
    const opt = page.getByRole("option", { name: /WAIKIKI BANJA LUKA - DELTA/ })
    if (await opt.count()) await opt.click(); else await page.getByRole("option").first().click()
    await page.waitForURL(/klijent=/)
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Vrsta pregleda / ispitivanja" })).toBeVisible()
    expect(await page.getByTestId("matrix-row").count()).toBeGreaterThan(0)
    // bar jedna popunjena ćelija sa statusom
    await expect(page.getByTestId("matrix-cell-filled").first()).toBeVisible()
  })
})
```

- [ ] **Step 3.4: Full check**
```bash
pnpm test:e2e tests/e2e/05-matrix-plan.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 3.5: Commit**
```bash
git add components/domain/MatrixGrid.tsx app/ tests/e2e/05-matrix-plan.spec.ts && git commit -m "feat(phase-5): MatrixGrid (vrsta × 12 mjeseci, per-klijent)

- MatrixGrid: sticky prva kolona (vrsta), 12 mjesečnih kolona,
  ćelija = datum + status boja (cell-done/plan/late), '+N' za više
- /prikaz pivotira klijentove termine (godina) u Map vrsta→mjesec→najurgentniji
- empty state za klijenta bez termina
- E2E: matrica redovi/kolone + popunjena ćelija"
```

---

## Task 4: Matrix cell click → ?selected TerminSheet + empty → Novi termin

**Files:**
- Modify: `components/domain/MatrixGrid.tsx` (ćelija = Link na ?selected; prazna = Novi termin prefill)
- Modify: `app/(dashboard)/prikaz/page.tsx` (render TerminSheet kad ?selected + prefill props)
- Modify: `components/domain/NoviTerminButton.tsx` (opcioni prefill props + compact trigger)
- Modify: `tests/e2e/05-matrix-plan.spec.ts`

**Interfaces:**
- Produces:
  - MatrixGrid ćelija sa terminom → `<Link href="/prikaz?...&selected=<id>">`
  - `/prikaz` renderuje `<TerminSheet>` kad `?selected` (reuse pattern iz termini/page.tsx)
  - `NoviTerminButton` prima opcione `defaultKlijentId/defaultVrstaId/defaultRok` + `triggerLabel?`

- [ ] **Step 4.1: Proširi `MatrixGrid` — ćelija postaje Link, prima currentSearch**
Promijeni signaturu na `{ rows, currentSearch }` i popunjenu ćeliju umotaj u `next/link`:
```tsx
import Link from "next/link"
// ...
export function MatrixGrid({ rows, currentSearch }: { rows: MatrixRow[]; currentSearch: string }) {
// ... u ćeliji:
{cell ? (
  <Link
    href={`/prikaz?${withParam(currentSearch, "selected", cell.terminId)}`}
    data-testid="matrix-cell-filled"
    data-status={cell.status}
    className={cn("inline-block w-full rounded px-1.5 py-1 tabular-nums", CELL_CLASS[cell.status])}
  >
    {cellLabel(cell)}
  </Link>
) : (
  <span className="text-slate-200">·</span>
)}
```
Dodaj helper na vrh fajla:
```tsx
function withParam(search: string, key: string, value: string): string {
  const p = new URLSearchParams(search)
  p.set(key, value)
  return p.toString()
}
```

- [ ] **Step 4.2: Update `prikaz/page.tsx` — render TerminSheet kad ?selected**
Mirror termini/page.tsx ?selected logiku (fallback fetch + istorija + closeHref). Dodaj nakon matrixRows izračuna:
```tsx
import { TerminSheet } from "@/components/domain/TerminSheet"
import { formatDatum } from "@/lib/date" // ako nije već

const currentSearch = new URLSearchParams(
  Object.entries(sp).flatMap(([k, v]) => typeof v === "string" ? [[k, v] as [string, string]] : [])
).toString()

const selectedId = typeof sp.selected === "string" ? sp.selected : null
let selectedTermin: TerminRow | null = null
let istorija: TerminRow[] = []
if (selectedId) {
  const { data } = await supabase.from("termini_view").select("*").eq("id", selectedId).maybeSingle()
  selectedTermin = (data as TerminRow | null) ?? null
  if (selectedTermin?.klijent_id && selectedTermin?.vrsta_provjere_id) {
    const { data: h } = await supabase.from("termini_view").select("*")
      .eq("klijent_id", selectedTermin.klijent_id)
      .eq("vrsta_provjere_id", selectedTermin.vrsta_provjere_id)
      .eq("status", "izvrseno").neq("id", selectedTermin.id ?? "")
      .order("datum_izvrsenja", { ascending: false }).limit(5)
    istorija = (h ?? []) as TerminRow[]
  }
}
const closeParams = new URLSearchParams(currentSearch); closeParams.delete("selected")
const closeHref = `/prikaz${closeParams.toString() ? `?${closeParams.toString()}` : ""}`
```
Proslijedi `currentSearch` u MatrixGrid: `<MatrixGrid rows={matrixRows} currentSearch={currentSearch} />`. Na kraju JSX-a:
```tsx
{selectedTermin && <TerminSheet termin={selectedTermin} istorija={istorija} closeHref={closeHref} />}
```
**Napomena:** `selectedTermin`/`istorija` su tipovani kao `TerminRow` (importovan iz TerminiTable = `termini_view` Row) — isti tip koji `TerminSheet` prima, pa nema cast-a ni lokalnog aliasa. Identičan pattern kao termini/page.tsx.

- [ ] **Step 4.3: Proširi `NoviTerminButton` opcionim prefill-om**
Dodaj opcione props bez lomljenja postojeće upotrebe:
```tsx
export function NoviTerminButton({
  klijenti, vrste, defaultKlijentId, defaultVrstaId, defaultRok, triggerLabel,
}: {
  klijenti: Opt[]; vrste: Opt[]
  defaultKlijentId?: string; defaultVrstaId?: string; defaultRok?: string; triggerLabel?: string
}) {
  // useState init sa default:
  const [klijentId, setKlijentId] = useState(defaultKlijentId ?? "")
  const [vrstaId, setVrstaId] = useState(defaultVrstaId ?? "")
  // rok input: defaultValue={defaultRok ?? ""}
  // trigger: <Button ...>{triggerLabel ?? <><Plus/> Novi termin</>}</Button>
```
Empty cell u MatrixGrid: umjesto `·`, renderuj prazan razmak (klik-na-prazno create je opcioni stretch). **MVP: prazna ćelija ostaje `·` (ne-klikabilna).** Empty-cell create je dokumentovan kao odložen (vidi Self-Review) da se izbjegne prosljeđivanje vrste/klijent liste kroz cijelu matricu. Fokus T4 = klik popunjene ćelije → sheet.

**Napomena:** Pošto je empty-cell create odložen, izmjene NoviTerminButton-a (prefill props) NISU nužne za T4 — preskoči Step 4.3 osim ako se radi empty-cell create. Zadrži T4 fokus na cell→?selected.

- [ ] **Step 4.4: E2E cell click**
```ts
test.describe("Faza 5 — Matrix cell click", () => {
  test("klik popunjene ćelije otvara TerminSheet", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    const opt = page.getByRole("option", { name: /WAIKIKI BANJA LUKA - DELTA/ })
    if (await opt.count()) await opt.click(); else await page.getByRole("option").first().click()
    await page.waitForURL(/klijent=/)
    await page.getByTestId("matrix-cell-filled").first().click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    // zatvori
    await page.getByTestId("sheet-close").click()
    await page.waitForURL((u) => !u.search.includes("selected="))
    await expect(page.getByTestId("termin-sheet")).toBeHidden()
  })
})
```

- [ ] **Step 4.5: Full check**
```bash
pnpm test:e2e tests/e2e/05-matrix-plan.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 4.6: Commit**
```bash
git add components/domain/MatrixGrid.tsx app/ tests/e2e/05-matrix-plan.spec.ts && git commit -m "feat(phase-5): matrix ćelija klik → ?selected TerminSheet (reuse)

- MatrixGrid popunjena ćelija = Link na /prikaz?...&selected=<id>
  (najurgentniji termin u ćeliji)
- /prikaz renderuje TerminSheet (fallback fetch + istorija + closeHref,
  isti pattern kao termini/page.tsx)
- empty-cell create odložen (dokumentovano)
- E2E: klik ćelije otvara/zatvara sheet"
```

---

## Task 5: /plan + MonthCalendar + PlanNav

**Files:**
- Create: `app/(dashboard)/plan/page.tsx`, `components/domain/MonthCalendar.tsx`, `components/domain/PlanNav.tsx`
- Modify: `tests/e2e/05-matrix-plan.spec.ts`

**Interfaces:**
- Consumes: termini_view (po mjesecu), `buildMonthGrid`, `monthLabel`, `prevMonth/nextMonth`, `todayIso`, `currentYear`
- Produces:
  - `<MonthCalendar grid={CalDay[]} terminiByDan={Map<string, DayTermin[]>} selectedDan godina mjesec currentSearch />` — 7-col grid, danas highlight, klik dana = Link ?dan=
  - `<PlanNav godina mjesec godine />` — client: prev/next/today/godina nav
  - `/plan` RSC: fetch mjesec termina, grupiše po danu

- [ ] **Step 5.1: Kreiraj `components/domain/PlanNav.tsx`**
```tsx
"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { prevMonth, nextMonth, monthLabel } from "@/lib/calendar"
import { cn } from "@/lib/utils"

export function PlanNav({
  godina, mjesec, godine, danas,
}: {
  godina: number; mjesec: number; godine: number[]; danas: { godina: number; mjesec: number }
}) {
  const router = useRouter()
  const params = useSearchParams()
  const href = (g: number, m: number) => {
    const p = new URLSearchParams(params.toString())
    p.set("godina", String(g)); p.set("mjesec", String(m)); p.delete("dan"); p.delete("selected")
    return `/plan?${p.toString()}`
  }
  const p = prevMonth(godina, mjesec)
  const n = nextMonth(godina, mjesec)
  return (
    <div className="flex items-center gap-2" data-testid="plan-nav">
      <Link href={href(p.year, p.month)} className={buttonVariants({ variant: "outline", size: "icon-sm" })} data-testid="plan-nav-prev" aria-label="Prethodni mjesec"><ChevronLeft className="w-4 h-4" /></Link>
      <span className="min-w-[140px] text-center font-medium" data-testid="plan-nav-label">{monthLabel(mjesec)} {godina}</span>
      <Link href={href(n.year, n.month)} className={buttonVariants({ variant: "outline", size: "icon-sm" })} data-testid="plan-nav-next" aria-label="Sljedeći mjesec"><ChevronRight className="w-4 h-4" /></Link>
      <Link href={href(danas.godina, danas.mjesec)} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="plan-nav-today">Danas</Link>
      <Select value={String(godina)} onValueChange={(v) => { const g = Number(v); if (g) router.push(href(g, mjesec)) }}>
        <SelectTrigger size="sm" className="w-24" data-testid="plan-nav-godina"><SelectValue /></SelectTrigger>
        <SelectContent>{godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Step 5.2: Kreiraj `components/domain/MonthCalendar.tsx`**
```tsx
import Link from "next/link"
import type { CalDay } from "@/lib/calendar"
import type { DerivedStatus } from "@/lib/termini"
import { cn } from "@/lib/utils"

export type DayTermin = { id: string; klijentNaziv: string; status: DerivedStatus }

const DOTS: Record<DerivedStatus, string> = {
  izvrseno: "bg-green-500", planirano: "bg-blue-500", zakazano: "bg-cyan-500", kasni: "bg-red-500", otkazano: "bg-slate-400",
}
const DANI = ["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"]

export function MonthCalendar({
  grid, terminiByDan, today, selectedDan, currentSearch,
}: {
  grid: CalDay[]
  terminiByDan: Map<string, DayTermin[]>
  today: string
  selectedDan: string | null
  currentSearch: string
}) {
  const dayHref = (date: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("dan", date); p.delete("selected")
    return `/plan?${p.toString()}`
  }
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden" data-testid="plan-grid">
      <div className="grid grid-cols-7 bg-slate-50 text-xs font-medium text-slate-500">
        {DANI.map((d) => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {grid.map((c) => {
          const termini = terminiByDan.get(c.date) ?? []
          const isToday = c.date === today
          const isSelected = c.date === selectedDan
          return (
            <Link
              key={c.date}
              href={dayHref(c.date)}
              data-testid="plan-day-cell"
              data-date={c.date}
              data-selected={isSelected}
              className={cn(
                "min-h-[84px] border-t border-l border-slate-100 p-1.5 text-left align-top transition",
                !c.inMonth && "bg-slate-50/50 text-slate-300",
                isSelected ? "ring-2 ring-inset ring-brand bg-brand-light/30" : "hover:bg-slate-50",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-xs", isToday && "inline-grid place-items-center w-5 h-5 rounded-full bg-brand text-white font-semibold")}>{c.day}</span>
                {termini.length > 0 && <span className="text-[10px] text-slate-400">{termini.length}</span>}
              </div>
              <div className="mt-1 space-y-0.5">
                {termini.slice(0, 3).map((t) => (
                  <div key={t.id} className="flex items-center gap-1 truncate text-[11px] text-slate-600">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", DOTS[t.status])} />
                    <span className="truncate">{t.klijentNaziv}</span>
                  </div>
                ))}
                {/* "još N" — cijela ćelija je već <Link> na ?dan= (otvara sidebar); text-brand signalizira klik */}
                {termini.length > 3 && <div className="text-[10px] text-brand font-medium">još {termini.length - 3}</div>}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 5.3: Kreiraj `app/(dashboard)/plan/page.tsx` (grid + nav; sidebar T6)**
```tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { MonthCalendar, type DayTermin } from "@/components/domain/MonthCalendar"
import { PlanNav } from "@/components/domain/PlanNav"
import { buildMonthGrid } from "@/lib/calendar"
import { monthRange, todayIso, currentYear } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import type { TerminRow } from "@/components/domain/TerminiTable"
// koristi TerminRow (= termini_view Row) — isti tip kao TerminSheet props

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const today = todayIso()
  const godina = Number(typeof sp.godina === "string" ? sp.godina : "") || Number(today.slice(0, 4))
  const mjesecRaw = Number(typeof sp.mjesec === "string" ? sp.mjesec : "") || Number(today.slice(5, 7))
  const mjesec = Math.min(12, Math.max(1, mjesecRaw))
  const danas = { godina: Number(today.slice(0, 4)), mjesec: Number(today.slice(5, 7)) }

  const supabase = await createServerSupabaseClient()
  const { from, to } = monthRange(godina, mjesec)
  const { data } = await supabase
    .from("termini_view")
    .select("id, rok_dospijeca, klijent_naziv, status_izvedeni")
    .gte("rok_dospijeca", from).lte("rok_dospijeca", to)
    .order("rok_dospijeca")
  const termini = (data ?? []) as TerminRow[]

  const terminiByDan = new Map<string, DayTermin[]>()
  for (const t of termini) {
    if (!t.id || !t.rok_dospijeca) continue
    const dan = t.rok_dospijeca.slice(0, 10)
    const arr = terminiByDan.get(dan) ?? []
    arr.push({ id: t.id, klijentNaziv: t.klijent_naziv ?? "—", status: toDerivedStatus(t.status_izvedeni) })
    terminiByDan.set(dan, arr)
  }

  const grid = buildMonthGrid(godina, mjesec)
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]
  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => typeof v === "string" ? [[k, v] as [string, string]] : [])
  ).toString()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Mjesečni plan</h1>
        <PlanNav godina={godina} mjesec={mjesec} godine={godine} danas={danas} />
      </div>
      <MonthCalendar grid={grid} terminiByDan={terminiByDan} today={today} selectedDan={null} currentSearch={currentSearch} />
    </div>
  )
}
```

- [ ] **Step 5.4: E2E kalendar**
```ts
test.describe("Faza 5 — Mjesečni plan", () => {
  test("kalendar grid + navigacija", async ({ page }) => {
    await page.goto("/plan")
    await expect(page.getByRole("heading", { name: "Mjesečni plan" })).toBeVisible()
    await expect(page.getByTestId("plan-grid")).toBeVisible()
    // 42 dana ćelije
    expect(await page.getByTestId("plan-day-cell").count()).toBe(42)
    const label = await page.getByTestId("plan-nav-label").textContent()
    await page.getByTestId("plan-nav-next").click()
    await page.waitForURL(/mjesec=/)
    await expect(page.getByTestId("plan-nav-label")).not.toHaveText(label ?? "")
  })

  test("Danas dugme vraća na tekući mjesec", async ({ page }) => {
    await page.goto("/plan?godina=2025&mjesec=1")
    await page.getByTestId("plan-nav-today").click()
    await page.waitForURL(/mjesec=/)
    await expect(page.getByTestId("plan-grid")).toBeVisible()
  })

  test("godina dropdown mijenja godinu (§7.2 D)", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    await page.getByTestId("plan-nav-godina").click()
    await page.getByRole("option", { name: "2025" }).click()
    await page.waitForURL(/godina=2025/)
    await expect(page.getByTestId("plan-nav-label")).toContainText("2025")
  })
})
```

- [ ] **Step 5.5: Full check**
```bash
pnpm test:e2e tests/e2e/05-matrix-plan.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 5.6: Commit**
```bash
git add app/ components/domain/MonthCalendar.tsx components/domain/PlanNav.tsx tests/e2e/05-matrix-plan.spec.ts && git commit -m "feat(phase-5): /plan kalendar — MonthCalendar grid + PlanNav

- MonthCalendar: 7-col grid (42 ćelije, pon-prvi), termini status-dotovi
  po danu (max 3 + 'još N'), danas highlight (UTC todayIso), klik dana → ?dan=
- PlanNav: prev/next/today (Link) + godina (Select), URL nav
- /plan RSC fetch mjesec termina (monthRange), grupisanje po danu
- E2E: 42 ćelije, next nav, Danas"
```

---

## Task 6: /plan dan sidebar + ?selected iz sidebar-a

**Files:**
- Modify: `app/(dashboard)/plan/page.tsx` (dan sidebar + ?selected TerminSheet)
- Modify: `tests/e2e/05-matrix-plan.spec.ts`

**Interfaces:**
- Produces: kad `?dan=` set → sidebar lista termina tog dana; svaki ima "Detalji" Link → `?selected=<id>` → TerminSheet

- [ ] **Step 6.1: Update `plan/page.tsx` — dan sidebar + selected sheet**
Promijeni fetch da uključi više polja (za sidebar) i dodaj selected logiku:
```tsx
import Link from "next/link"
import { TerminSheet } from "@/components/domain/TerminSheet"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { formatDatum } from "@/lib/date"

// proširi select: dodaj vrsta_naziv, lokacija_naziv, datum_zakazan, datum_izvrsenja, zaduzeni, napomena, klijent_id, vrsta_provjere_id, status
// (potrebno za sidebar + TerminSheet selected)
// promijeni .select(...) u .select("*")

const selectedDan = typeof sp.dan === "string" ? sp.dan : null
const danTermini = selectedDan ? termini.filter((t) => (t.rok_dospijeca ?? "").slice(0, 10) === selectedDan) : []

const selectedId = typeof sp.selected === "string" ? sp.selected : null
let selectedTermin: TerminRow | null = selectedId ? (termini.find((t) => t.id === selectedId) ?? null) : null
let istorija: TerminRow[] = []
if (selectedId && !selectedTermin) {
  const { data: one } = await supabase.from("termini_view").select("*").eq("id", selectedId).maybeSingle()
  selectedTermin = (one as TerminRow | null) ?? null
}
if (selectedTermin?.klijent_id && selectedTermin?.vrsta_provjere_id) {
  const { data: h } = await supabase.from("termini_view").select("*")
    .eq("klijent_id", selectedTermin.klijent_id).eq("vrsta_provjere_id", selectedTermin.vrsta_provjere_id)
    .eq("status", "izvrseno").neq("id", selectedTermin.id ?? "")
    .order("datum_izvrsenja", { ascending: false }).limit(5)
  istorija = (h ?? []) as TerminRow[]
}
const closeParams = new URLSearchParams(currentSearch); closeParams.delete("selected")
const closeHref = `/plan${closeParams.toString() ? `?${closeParams.toString()}` : ""}`
const detailHref = (id: string) => { const p = new URLSearchParams(currentSearch); p.set("selected", id); return `/plan?${p.toString()}` }
```
**Query-budget napomena:** `/plan` primary podaci = 1 round-trip (mjesec termini). Kad je `?selected` postavljen, dodaju se 2 sekundarna round-tripa (fallback fetch ako selected nije u tekućem mjesecu + istorija) — **izuzeti iz 1-query limita** kao sekundarni, isti pattern kao /prikaz i /termini. Fallback je potreban jer ?selected može preživjeti navigaciju iz /prikaz na termin u drugom mjesecu.

Promijeni layout u grid (kalendar + sidebar kad ?dan):
```tsx
<div className={selectedDan ? "grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4" : ""}>
  <MonthCalendar grid={grid} terminiByDan={terminiByDan} today={today} selectedDan={selectedDan} currentSearch={currentSearch} />
  {selectedDan && (
    <aside data-testid="plan-sidebar" className="rounded-xl border border-slate-200 p-4 h-fit">
      <p className="font-medium" data-testid="plan-sidebar-datum">{formatDatum(selectedDan)}</p>
      {danTermini.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nema termina za ovaj dan.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {danTermini.map((t) => (
            <li key={t.id ?? ""} data-testid="sidebar-termin" className="text-sm border-b border-slate-100 pb-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800 truncate">{t.klijent_naziv ?? "—"}</span>
                <StatusBadge status={t.status_izvedeni} />
              </div>
              <p className="text-slate-500">{t.vrsta_naziv ?? "—"}</p>
              {t.id && <Link href={detailHref(t.id)} className="text-brand hover:underline text-xs" data-testid="sidebar-detalji">Detalji</Link>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )}
</div>
{selectedTermin && <TerminSheet termin={selectedTermin} istorija={istorija} closeHref={closeHref} />}
```

- [ ] **Step 6.2: E2E dan + sidebar + sheet**
```ts
test.describe("Faza 5 — Plan dan sidebar", () => {
  test("klik dana sa terminima → sidebar → Detalji → sheet", async ({ page }) => {
    // jul 2026 ima dosta termina; data-driven: nađi dan ćeliju koja STVARNO ima termine
    await page.goto("/plan?godina=2026&mjesec=7")
    // dan ćelija sa terminima ima status-dot (span sa rounded-full) — biraj prvu takvu
    const cellWithTermini = page.getByTestId("plan-day-cell").filter({ has: page.locator("span.rounded-full") }).first()
    await expect(cellWithTermini).toBeVisible()
    await cellWithTermini.click()
    await page.waitForURL(/dan=/)
    await expect(page.getByTestId("plan-sidebar")).toBeVisible()
    // dan ima termine → sidebar MORA imati bar jedan termin (bez guard-a)
    await expect(page.getByTestId("sidebar-termin").first()).toBeVisible()
    await page.getByTestId("sidebar-detalji").first().click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
  })
})
```
**Napomena:** test bira dan ćeliju koja STVARNO sadrži termine (filter na status-dot `span.rounded-full`), pa Detalji→sheet put nije guard-ovan (mora raditi). Determinističko jer jul 2026 ima guste termine.

- [ ] **Step 6.3: Full check**
```bash
pnpm test:e2e tests/e2e/05-matrix-plan.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 6.4: Commit**
```bash
git add app/ tests/e2e/05-matrix-plan.spec.ts && git commit -m "feat(phase-5): /plan dan sidebar + ?selected TerminSheet

- klik dana → ?dan= → sidebar lista termina (klijent + vrsta + StatusBadge)
- Detalji u sidebar-u → ?selected → TerminSheet (reuse, closeHref čuva ?dan)
- E2E: dan → sidebar → Detalji → sheet"
```

---

## Task 7: Comprehensive E2E + phase gate + tag v0.5.0

**Files:**
- Modify: `tests/e2e/05-matrix-plan.spec.ts` (vizuelni smoke)

- [ ] **Step 7.1: Dodaj vizuelni smoke**
```ts
test.describe("Faza 5 — Vizuelni smoke", () => {
  test("prikaz screenshot", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    const opt = page.getByRole("option", { name: /WAIKIKI BANJA LUKA - DELTA/ })
    if (await opt.count()) await opt.click(); else await page.getByRole("option").first().click()
    await page.waitForURL(/klijent=/)
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await page.screenshot({ path: "test-results/prikaz-faza5.png", fullPage: true })
  })
  test("plan screenshot", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("plan-grid")).toBeVisible()
    await page.screenshot({ path: "test-results/plan-faza5.png", fullPage: true })
  })
})
```

- [ ] **Step 7.2: Pun E2E (clean seed)**
```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && pnpm db:reset && pnpm seed && pnpm test:e2e
```
Svi spec-ovi (01-05) pass Chromium+WebKit, --workers=1.

- [ ] **Step 7.3: Full check**
```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e
```

- [ ] **Step 7.4: Commit + push**
```bash
git add tests/e2e/05-matrix-plan.spec.ts && git commit -m "test(phase-5): comprehensive 05-matrix-plan + vizuelni smoke" && git push origin main
```

- [ ] **Step 7.5: Phase 5 Gate — fresh agent**
Dispatch novi `general-purpose` agent, prazan kontekst:
```
You are an independent verifier for Phase 5 of the Tehpro MVP. NO context. Validate ONLY Phase 5 (Prikaz matrix + Mjesecni plan).
Inputs: codebase /Users/nmil/Desktop/Ai Forward/tehpro-mvp/, spec §7.2 C/D, plan docs/superpowers/plans/2026-06-21-tehpro-mvp-phase-5-prikaz-plan.md. LOCAL ONLY (Docker Supabase).
Tasks:
1. supabase start if down; pnpm install; pnpm db:reset && pnpm seed
2. pnpm build && pnpm lint && pnpm typecheck (exit 0)
3. pnpm test:unit (vitest pass — incl calendar tests)
4. pnpm test:e2e (ALL pass Chromium+WebKit, note count)
5. DB: psql -c "select * from get_opterecenje(2026);" — returns per-month counts
6. Manual via mcp__playwright__*: /prikaz chart (12 bars) + klijent picker → matrix (vrste rows × 12 month cols) + cell click → TerminSheet; /plan calendar (42 cells, today highlight) + next/today nav + day click → sidebar → Detalji → sheet; zero console errors; screenshots.
7. Inventory: app/(dashboard)/{prikaz,plan}/page.tsx, components/domain/{OpterecenjeChart,PrikazToolbar,MatrixGrid,MonthCalendar,PlanNav}.tsx, lib/calendar.ts, migration *_opterecenje_rpc.sql. grep no sm:/md:. Confirm NO recharts in package.json (CSS-bar decision).
8. Git: clean, ~8 commits since v0.4.0, pushed.
Return STRICT JSON: {phase:5, gate_1:{build,lint,typecheck}, gate_2_unit, gate_3_e2e, gate_4_rpc, gate_5_manual:[...], gate_6_inventory, gate_6_no_sm_md, gate_6_no_recharts, gate_7_git, commits_since_v0_4_0, blockers:[], non_blockers:[]}
Do NOT suggest improvements. Stop dev server when done.
```
Ako blockers → fiks → re-run. Ako čisto → tag.

- [ ] **Step 7.6: Tag v0.5.0**
```bash
git tag -a v0.5.0 -m "Phase 5 — Prikaz matrix + Mjesečni plan complete

T1: get_opterecenje RPC + lib/calendar (grid helpers) + unit testovi
T2: /prikaz skeleton + OpterecenjeChart (CSS barovi) + PrikazToolbar
T3: MatrixGrid (vrsta × 12 mjeseci, per-klijent pivot)
T4: matrix ćelija klik → ?selected TerminSheet (reuse)
T5: /plan MonthCalendar grid + PlanNav
T6: /plan dan sidebar + ?selected sheet
T7: comprehensive E2E + phase gate

Odluke: per-klijent vrsta×mjesec matrica (ne klijenti×vrste); CSS barovi (ne Recharts).
Phase Gate: ALL PASS. Repo: https://github.com/stpauli98/Tehrpo" && git push origin v0.5.0
```

---

## Self-Review

**1. Spec coverage:**
- §7.2 C (/prikaz): matrica ✓ (T3, per-klijent vrsta×mjesec — **dokumentovana divergencija** od klijenti×vrste jer je netraktabilno/prazno), ćelija boja+datum ✓ (T3: izvrseno zeleno, planirano plavo, kasni crveno), klik ćeliju → TerminSheet ✓ (T4), toggle ✓ (godina + klijent picker; "po mjesecu/godini" realizovano kao godišnji prikaz — mjesečni prikaz je /plan), bar chart "opterećenje" ✓ (T2, **CSS barovi ne Recharts — dokumentovano**).
- §7.2 D (/plan): mjesečni 7-col grid 6 redova ✓ (T5, 42 ćelije), dani prošlog/sljedećeg sivo ✓, max 3 termina + "još N" ✓, sidebar za izabrani dan ✓ (T6), navigacija prev/next/danas/godina ✓ (T5 PlanNav).
- §7.5 MatrixGrid + MonthCalendar: ✓.
- §8 scope "Matrix grid, kalendar, opterećenje chart": ✓. Van obima (chart drill-down, plan drag-drop): nisu rađeni ✓.
- §9.1 05-matrix-plan.spec.ts (matrica ćelije, klik otvara termin, kalendar nav): ✓ (T3/T4/T5/T6).

**Dokumentovane divergencije (svjesne):**
- **Matrix orijentacija:** per-klijent **vrsta × mjesec** umjesto spec-ovog klijenti×vrste. Razlog: 51×58=2958 ćelija/89% prazno je netraktabilno; lokacije prazne. Per-klijent godišnja matrica je tractable + ima podatke + matchuje Excel-matrica intent.
- **Chart:** čisti CSS/Tailwind barovi umjesto Recharts. Razlog: KISS/YAGNI, RSC-native, bez hydration rizika, bez dep-a; vizuelno ekvivalentno za jedan prost bar chart. Recharts dodati kasnije ako zatreba.
- **"Toggle po mjesecu/godini":** /prikaz je godišnji (vrsta×12 mjeseci); mjesečni detalj je /plan kalendar. Spec-ov toggle realizovan kao dvije rute + godina picker.
- **Empty-cell create:** spec §7.2 C navodi "klik prazne ćelije → novi termin sa pre-popunjenim klijent/vrsta". **Odloženo** — prazna ćelija ostaje ne-klikabilni `·`. Razlog: prosljeđivanje klijent/vrsta listi kroz matricu radi prefill-create dodaje kompleksnost za marginalnu vrijednost; kreiranje se radi preko /termini "Novi termin". Dodati u kasnijoj fazi ako zatreba.
- **Kalendar 6 redova (42 ćelije) fiksno:** spec §7.2 D kaže "5-6 redova". Koristimo fiksnih 6 (42 ćelije) radi vizuelne stabilnosti (nema skakanja visine između mjeseci). Svjestan izbor.
- **Cell sadržaj format:** spec §7.2 C "✓ DD.MM.YYYY / datum / Kasni!" — koristimo skraćeno "✓ DD." (izvršeno), "DD." (planirano, plava/cyan), "DD.!" (kasni, crveno) + "(+N)" za više termina u ćeliji, radi uske mjesečne kolone. Boja + marker prenose status.

**2. Placeholder scan:**
- T2 "Matrica se popunjava u Task 3" — stub zamijenjen u T3 (sekvencijalni razvoj). OK.
- Empty-cell create (klik prazne ćelije → novi termin) — **odložen/dokumentovan** (T4 napomena): prazna ćelija ostaje `·` ne-klikabilna; create se radi preko /termini Novi termin. Spec §7.2 C pominje empty-cell create kao "novi mode" — odloženo radi izbjegavanja prosljeđivanja vrste/klijent listi kroz matricu; nije core. Eksplicitno navedeno.
- Nema "TBD"/"implement later" u plan kodu.

**3. Type consistency:**
- `TerminRow` (TerminiTable) = termini_view Row → TerminSheet props u /prikaz + /plan ?selected. Match (koristi isti alias kao termini/page.tsx).
- `OpterecenjeRow` (OpterecenjeChart) ↔ get_opterecenje RPC redovi (mjesec/ukupno/izvrseno/kasni/u_planu). Match.
- `CalDay`/`buildMonthGrid` (lib/calendar) → MonthCalendar grid prop. Match.
- `DerivedStatus`/`toDerivedStatus` (lib/termini) → MatrixCell.status, DayTermin.status, CELL_CLASS/DOTS mape. Match.
- `MatrixRow`/`MatrixCell` (MatrixGrid) ↔ pivot u prikaz/page.tsx. Match.

**Rizici flagovani za implementera:**
1. base-ui Select/Tabs testid → testovi `getByRole("option")`. Plan to radi.
2. Kalendar timezone: `todayIso()` UTC za danas-highlight; grid integer aritmetika. Edge: korisnik u UTC+2 kasno noću → danas može biti +1 dan. Prihvaćeno za MVP (komentar).
3. Matrix render veličina: per-klijent ograničava (max ~28 vrsta × 12). overflow-x-auto. Bez virtualizacije.
4. Chart `flexGrow` proporcije: ako svi statusi 0 ali ukupno>0 (ne bi trebalo), bar prazan. Robusno jer ukupno = zbir statusa.
5. ?selected reuse: closeHref mora čuvati ostale parametre (klijent/godina za prikaz, dan za plan). Plan to radi.
6. /plan default mjesec/godina iz `todayIso()` (UTC), ne `new Date().getMonth()` (local). Plan to radi.
