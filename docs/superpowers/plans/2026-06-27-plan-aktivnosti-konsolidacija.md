# Plan aktivnosti — konsolidacija tabova — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spojiti Termini+Plan+Prikaz u jedan ekran `/plan-aktivnosti` sa prekidačem prikaza (Lista/Kalendar/Matrica), stare rute → redirecti, ukloniti dupli grafikon; Pregled ostaje dashboard.

**Architecture:** Tijela postojećih strana (termini/plan/prikaz) izvlače se u server‑komponente `_views/*`, koje jedan `plan-aktivnosti/page.tsx` bira po `?view=`. Dijeljene komponente (TerminiTable/MonthCalendar/PlanNav/MatrixGrid/PrikazToolbar) preusmjeravaju href‑ove na `/plan-aktivnosti`. Stare rute postaju tanki `redirect()` koji čuvaju query‑param.

**Tech Stack:** Next.js 16 (App Router, server komponente, `redirect()` iz next/navigation), React 19, vitest, Playwright, pnpm.

## Global Constraints

- **Next.js je netipičan:** prije pisanja koda konsultovati `node_modules/next/dist/docs/` (vidi `AGENTS.md`). Dev: `pnpm dev` (`next dev -p 3000 --webpack`).
- **`searchParams` je Promise** u stranama (`const sp = await searchParams`); **view‑komponente primaju VEĆ razriješen objekat** (`searchParams: Record<string, string | string[] | undefined>`), bez `await`.
- **Default view = `lista`**; validni view‑ovi: `lista`, `kalendar`, `matrica`.
- **Redirecti čuvaju sve query‑parametre** i dodaju `view`.
- **Grafikon `OpterecenjeChart` ostaje SAMO na Pregledu** — izbaciti iz matrice (+ njegov import).
- **vitest lib testovi koriste RELATIVNI import** (`./plan-view`), ne `@/` (alias puca na spaced path).
- **Desktop‑only:** samo `lg:`/`xl:`/`2xl:` breakpoint‑i; bez ASCII `"` u JSX tekstu (escape ili izbjeći).
- **Forma‑obrazac/komponente** prate postojeće (base‑ui); ne mijenja se ponašanje, samo rute.
- **Gate svaki task:** `pnpm typecheck` + (za UI) `pnpm lint`. Bez DB/šeme izmjena → nema migracija.

---

## File Structure

**Novo:**
- `lib/plan-view.ts` — `PLAN_VIEWS`, `PlanView`, `jeValidanView`, `buildViewHref`, `buildRedirectHref`.
- `lib/plan-view.test.ts` — unit testovi.
- `components/domain/PlanViewSwitcher.tsx` — client prekidač.
- `app/(dashboard)/plan-aktivnosti/page.tsx` — objedinjeni ekran.
- `app/(dashboard)/plan-aktivnosti/_views/lista.tsx` — iz `termini/page.tsx`.
- `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx` — iz `plan/page.tsx`.
- `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx` — iz `prikaz/page.tsx` (bez grafikona).
- `tests/e2e/20-plan-aktivnosti.spec.ts`.

**Izmjena:**
- `app/(dashboard)/termini/page.tsx`, `plan/page.tsx`, `prikaz/page.tsx` → redirect.
- `components/domain/TerminiTable.tsx`, `MonthCalendar.tsx`, `PlanNav.tsx`, `MatrixGrid.tsx`, `PrikazToolbar.tsx` → rute.
- `components/shell/Sidebar.tsx` (nav).
- `app/(dashboard)/pregled/page.tsx`, `components/domain/HitnoKasniList.tsx`, `app/(dashboard)/obilasci/page.tsx` (linkovi).
- `app/(dashboard)/dokumenti/actions.ts`, `app/(dashboard)/termini/actions.ts` (`revalidatePath`).
- Postojeći E2E specovi (03/05/10/11/13/14/01).

---

## Task 1: `lib/plan-view.ts` helperi + unit testovi

**Files:**
- Create: `lib/plan-view.ts`
- Test: `lib/plan-view.test.ts`

**Interfaces:**
- Produces:
  - `PLAN_VIEWS: readonly ["lista","kalendar","matrica"]`
  - `type PlanView = (typeof PLAN_VIEWS)[number]`
  - `jeValidanView(v: string | undefined): v is PlanView`
  - `buildViewHref(params: URLSearchParams, view: PlanView): string`
  - `buildRedirectHref(view: PlanView, sp: Record<string, string | string[] | undefined>): string`

- [ ] **Step 1: Napisati failing test** (`lib/plan-view.test.ts`)

```typescript
import { describe, it, expect } from "vitest"
import { PLAN_VIEWS, jeValidanView, buildViewHref, buildRedirectHref } from "./plan-view"

describe("jeValidanView", () => {
  it("prihvata poznate view-ove", () => {
    for (const v of PLAN_VIEWS) expect(jeValidanView(v)).toBe(true)
  })
  it("odbija nepoznato/undefined", () => {
    expect(jeValidanView("xyz")).toBe(false)
    expect(jeValidanView(undefined)).toBe(false)
  })
})

describe("buildViewHref", () => {
  it("postavlja view i čuva ostale parametre", () => {
    const p = new URLSearchParams("status=kasni&mjesec=7")
    expect(buildViewHref(p, "kalendar")).toBe("/plan-aktivnosti?status=kasni&mjesec=7&view=kalendar")
  })
  it("mijenja postojeći view", () => {
    const p = new URLSearchParams("view=lista&klijent_id=abc")
    expect(buildViewHref(p, "matrica")).toBe("/plan-aktivnosti?view=matrica&klijent_id=abc")
  })
  it("bez parametara → samo view", () => {
    expect(buildViewHref(new URLSearchParams(), "lista")).toBe("/plan-aktivnosti?view=lista")
  })
})

describe("buildRedirectHref", () => {
  it("mapira view + čuva string parametre", () => {
    expect(buildRedirectHref("lista", { status: "kasni" })).toBe("/plan-aktivnosti?status=kasni&view=lista")
  })
  it("ignoriše ne-string (array) parametre", () => {
    expect(buildRedirectHref("matrica", { foo: ["a", "b"], godina: "2026" })).toBe("/plan-aktivnosti?godina=2026&view=matrica")
  })
  it("bez parametara → samo view", () => {
    expect(buildRedirectHref("kalendar", {})).toBe("/plan-aktivnosti?view=kalendar")
  })
})
```

- [ ] **Step 2: Pokrenuti test (mora pasti)**

Run: `pnpm test:unit lib/plan-view.test.ts`
Expected: FAIL — `Cannot find module './plan-view'`.

- [ ] **Step 3: Implementirati** (`lib/plan-view.ts`)

```typescript
export const PLAN_VIEWS = ["lista", "kalendar", "matrica"] as const
export type PlanView = (typeof PLAN_VIEWS)[number]

export function jeValidanView(v: string | undefined): v is PlanView {
  return v !== undefined && (PLAN_VIEWS as readonly string[]).includes(v)
}

/** URL za /plan-aktivnosti sa zadanim view-om; čuva ostale parametre (set view zadnji). */
export function buildViewHref(params: URLSearchParams, view: PlanView): string {
  const next = new URLSearchParams(params)
  next.delete("view")
  next.set("view", view)
  const qs = next.toString()
  return `/plan-aktivnosti${qs ? `?${qs}` : ""}`
}

/** Redirect URL sa stare rute: čuva sve string query-parametre + dodaje view. */
export function buildRedirectHref(view: PlanView, sp: Record<string, string | string[] | undefined>): string {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") next.set(k, v)
  }
  next.set("view", view)
  return `/plan-aktivnosti?${next.toString()}`
}
```

Napomena: u prvom testu `buildViewHref` daje `...status=kasni&mjesec=7&view=kalendar` jer `delete`+`set` stavlja `view` na kraj; u drugom `view=matrica&klijent_id=abc` jer je `view` već bio prvi pa `delete` ukloni a `set` doda na kraj → zapravo `klijent_id=abc&view=matrica`. **Uskladi očekivanja:** ispraviti test #2 očekivanje na `"/plan-aktivnosti?klijent_id=abc&view=matrica"`.

- [ ] **Step 4: Ispraviti test #2 očekivanje i pokrenuti (mora proći)**

U `buildViewHref` testu „mijenja postojeći view" promijeniti očekivano u:
```typescript
    expect(buildViewHref(p, "matrica")).toBe("/plan-aktivnosti?klijent_id=abc&view=matrica")
```
Run: `pnpm test:unit lib/plan-view.test.ts`
Expected: PASS (sve grupe).

- [ ] **Step 5: Commit**

```bash
git add lib/plan-view.ts lib/plan-view.test.ts
git commit -m "feat(plan-aktivnosti): plan-view helperi (buildViewHref/buildRedirectHref) + testovi"
```

---

## Task 2: `PlanViewSwitcher` komponenta

**Files:**
- Create: `components/domain/PlanViewSwitcher.tsx`

**Interfaces:**
- Consumes: `PLAN_VIEWS`, `buildViewHref`, `PlanView` iz `@/lib/plan-view`; `cn` iz `@/lib/utils`.
- Produces: `<PlanViewSwitcher current={PlanView} />`.

- [ ] **Step 1: Implementirati komponentu**

```tsx
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { cn } from "@/lib/utils"
import { PLAN_VIEWS, buildViewHref, type PlanView } from "@/lib/plan-view"

const LABELE: Record<PlanView, string> = { lista: "Lista", kalendar: "Kalendar", matrica: "Matrica" }

export function PlanViewSwitcher({ current }: { current: PlanView }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-1" data-testid="plan-view-switcher" data-pending={pending}>
      {PLAN_VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          data-testid={`view-${v}`}
          data-active={current === v}
          onClick={() =>
            startTransition(() => router.push(buildViewHref(new URLSearchParams(params.toString()), v)))
          }
          className={cn(
            "px-3 py-1 rounded-full text-sm border transition",
            current === v
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50",
          )}
        >
          {LABELE[v]}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/domain/PlanViewSwitcher.tsx
git commit -m "feat(plan-aktivnosti): PlanViewSwitcher (lista/kalendar/matrica)"
```

---

## Task 3: Objedinjeni ekran + Lista view (iz `termini/page.tsx`)

**Files:**
- Create: `app/(dashboard)/plan-aktivnosti/page.tsx`
- Create: `app/(dashboard)/plan-aktivnosti/_views/lista.tsx`
- Modify: `components/domain/TerminiTable.tsx` (detailHref ruta)

**Interfaces:**
- Consumes: `jeValidanView`, `PlanView`; `PlanViewSwitcher`.
- Produces: ruta `/plan-aktivnosti?view=lista`; `ListaView({ searchParams })` (server, prima razriješen `Record<string,...>`).

- [ ] **Step 1: `plan-aktivnosti/page.tsx` (skeleton + lista)**

```tsx
import { PlanViewSwitcher } from "@/components/domain/PlanViewSwitcher"
import { jeValidanView, type PlanView } from "@/lib/plan-view"
import { ListaView } from "./_views/lista"

export default async function PlanAktivnostiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const raw = typeof sp.view === "string" ? sp.view : undefined
  const view: PlanView = jeValidanView(raw) ? raw : "lista"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Plan aktivnosti</h1>
        <PlanViewSwitcher current={view} />
      </div>
      {view === "lista" && <ListaView searchParams={sp} />}
    </div>
  )
}
```

- [ ] **Step 2: `_views/lista.tsx` — kopirati tijelo `termini/page.tsx` uz izmjene**

Kreirati `app/(dashboard)/plan-aktivnosti/_views/lista.tsx` sa SADRŽAJEM `app/(dashboard)/termini/page.tsx`, ali sa tačno ovim izmjenama:
1. Potpis i izvoz: `export default async function TerminiPage({ searchParams }: { searchParams: Promise<...> })` → `export async function ListaView({ searchParams }: { searchParams: Record<string, string | string[] | undefined> })`.
2. Ukloniti `const sp = await searchParams` → `const sp = searchParams`.
3. Importi: putanje ostaju `@/components/...` i `@/lib/...` (rade iz novog mjesta).
4. Ukloniti vanjski `<h1>Termini</h1>` red — zamijeniti header `<div className="flex items-center justify-between">…</div>` sa samo dugmetom:
   ```tsx
   <div className="flex items-center justify-end">
     <NoviTerminButton klijenti={klijenti} vrste={vrste} lokacijeByFirma={lokacijeByFirma} />
   </div>
   ```
5. `closeHref`: `` `/termini${…}` `` → `` `/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}` `` (closeParams već sadrži `view=lista` jer dolazi iz `currentSearch`).
6. `pageHref`: `` `/termini?${params.toString()}` `` → `` `/plan-aktivnosti?${params.toString()}` ``.
7. KPI Link‑ovi:
   - `href="/termini"` → `href="/plan-aktivnosti?view=lista"`
   - `` href={`/termini?mjesec=${ovajMjesec}`} `` → `` href={`/plan-aktivnosti?view=lista&mjesec=${ovajMjesec}`} ``
   - `href="/termini?status=kasni"` → `href="/plan-aktivnosti?view=lista&status=kasni"`
   - `href="/termini?status=izvrseno"` → `href="/plan-aktivnosti?view=lista&status=izvrseno"`
8. Zadržati vanjski `<div className="space-y-6">…</div>` wrapper (renderuje se unutar page wrappera — ugniježđeno space-y je ok).

- [ ] **Step 3: Reroute `TerminiTable.tsx` detailHref**

U `components/domain/TerminiTable.tsx`, u funkciji `detailHref` (oko linije 17–20):
```typescript
  return `/plan-aktivnosti?${params.toString()}`
```
(bilo `/termini?…`). `currentSearch` već nosi `view=lista` kad se renderuje iz Lista view‑a; kad ga nema (default), page ionako rezolvira na lista.

- [ ] **Step 4: Build + typecheck + ručna provjera rute**

Run: `pnpm typecheck`
Expected: PASS.
Run (Docker dev mora biti pokrenut): otvoriti `/plan-aktivnosti` → prikazuje listu sa filterima i KPI karticama; switcher vidljiv (Kalendar/Matrica još ne renderuju ništa — to je Task 4/5).

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/plan-aktivnosti/page.tsx" "app/(dashboard)/plan-aktivnosti/_views/lista.tsx" components/domain/TerminiTable.tsx
git commit -m "feat(plan-aktivnosti): objedinjeni ekran + Lista view (iz termini) + TerminiTable reroute"
```

---

## Task 4: Kalendar view (iz `plan/page.tsx`)

**Files:**
- Create: `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/page.tsx` (dodati granu)
- Modify: `components/domain/MonthCalendar.tsx`, `components/domain/PlanNav.tsx` (rute)

**Interfaces:**
- Produces: `KalendarView({ searchParams })` (server); `/plan-aktivnosti?view=kalendar`.

- [ ] **Step 1: `_views/kalendar.tsx` — kopirati tijelo `plan/page.tsx` uz izmjene**

Kreirati `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx` sa sadržajem `app/(dashboard)/plan/page.tsx`, uz izmjene:
1. `export default async function PlanPage({ searchParams }: { searchParams: Promise<...> })` → `export async function KalendarView({ searchParams }: { searchParams: Record<string, string | string[] | undefined> })`.
2. `const sp = await searchParams` → `const sp = searchParams`.
3. Ukloniti vanjski `<h1 className="text-2xl font-semibold">Mjesečni plan</h1>` (zadržati `PlanNav` u istom redu — header postaje samo `<div className="flex items-center justify-end"><PlanNav … /></div>`).
4. `closeHref`: `` `/plan${…}` `` → `` `/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}` `` (closeParams nosi `view=kalendar`).
5. `detailHref`: `` `/plan?${p.toString()}` `` → `` `/plan-aktivnosti?${p.toString()}` ``.

- [ ] **Step 2: Reroute `MonthCalendar.tsx` i `PlanNav.tsx`**

U `components/domain/MonthCalendar.tsx` (dayHref ~lin.32, terminHref ~lin.39): `` `/plan?${p.toString()}` `` → `` `/plan-aktivnosti?${p.toString()}` `` (oba mjesta).
U `components/domain/PlanNav.tsx` (`href` builder ~lin.38): `` `/plan?${p.toString()}` `` → `` `/plan-aktivnosti?${p.toString()}` ``.
(`currentSearch`/params nose `view=kalendar` jer je korisnik na `?view=kalendar`.)

- [ ] **Step 3: Dodati granu u `page.tsx`**

U `app/(dashboard)/plan-aktivnosti/page.tsx` dodati import i granu:
```tsx
import { KalendarView } from "./_views/kalendar"
```
```tsx
      {view === "kalendar" && <KalendarView searchParams={sp} />}
```

- [ ] **Step 4: Typecheck + provjera**

Run: `pnpm typecheck`
Expected: PASS.
Ručno: `/plan-aktivnosti?view=kalendar` prikazuje kalendar; navigacija mjeseci ostaje na `?view=kalendar`.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx" "app/(dashboard)/plan-aktivnosti/page.tsx" components/domain/MonthCalendar.tsx components/domain/PlanNav.tsx
git commit -m "feat(plan-aktivnosti): Kalendar view (iz plan) + MonthCalendar/PlanNav reroute"
```

---

## Task 5: Matrica view (iz `prikaz/page.tsx`, bez grafikona)

**Files:**
- Create: `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/page.tsx` (grana)
- Modify: `components/domain/MatrixGrid.tsx`, `components/domain/PrikazToolbar.tsx` (rute)

**Interfaces:**
- Produces: `MatricaView({ searchParams })` (server); `/plan-aktivnosti?view=matrica`.

- [ ] **Step 1: `_views/matrica.tsx` — kopirati tijelo `prikaz/page.tsx` uz izmjene**

Kreirati `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx` sa sadržajem `app/(dashboard)/prikaz/page.tsx`, uz izmjene:
1. `export default async function PrikazPage({ searchParams }: { searchParams: Promise<...> })` → `export async function MatricaView({ searchParams }: { searchParams: Record<string, string | string[] | undefined> })`.
2. `const sp = await searchParams` → `const sp = searchParams`.
3. **Ukloniti `OpterecenjeChart`**: izbrisati import `OpterecenjeChart` i njegov `type OpterecenjeRow`, izbrisati `opterecenjeRes` iz `Promise.all` (ostaviti `klijentiRes`), izbrisati `const opterecenje = …`, i izbrisati cijeli `<div className="rounded-xl border …"><OpterecenjeChart … /></div>` blok iz JSX‑a. Ako `get_opterecenje` RPC nije više korišten — ukloniti i taj poziv.
4. Ukloniti vanjski `<h1 className="text-2xl font-semibold">Prikaz</h1>`.
5. `closeHref`: `` `/prikaz${…}` `` → `` `/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}` `` (nosi `view=matrica`).
6. `multiHref` (ćelije sa >1 termina): mijenja se da vodi na **listu**:
   - `` `/termini?klijent_id=${colId}&vrsta_id=${vrstaId}&mjesec=${mjesec}&godina=${godina}` `` → `` `/plan-aktivnosti?view=lista&klijent_id=${colId}&vrsta_id=${vrstaId}&mjesec=${mjesec}&godina=${godina}` ``
   - `` `/termini?klijent_id=${klijentId}&vrsta_id=${vrstaId}&mjesec=${colId}&godina=${godina}` `` → `` `/plan-aktivnosti?view=lista&klijent_id=${klijentId}&vrsta_id=${vrstaId}&mjesec=${colId}&godina=${godina}` ``

- [ ] **Step 2: Reroute `MatrixGrid.tsx` i `PrikazToolbar.tsx`**

U `components/domain/MatrixGrid.tsx` (~lin.99): `` `/prikaz?${withParam(currentSearch, "selected", cell.terminId)}` `` → `` `/plan-aktivnosti?${withParam(currentSearch, "selected", cell.terminId)}` `` (`currentSearch` nosi `view=matrica`).
U `components/domain/PrikazToolbar.tsx` (~lin.45 i ~lin.53): `` `/prikaz?${next.toString()}` `` → `` `/plan-aktivnosti?${next.toString()}` ``. **Provjeriti** da `next` čuva `view` (gradi se iz trenutnih `searchParams`); ako toolbar ne kopira `view`, dodati `next.set("view","matrica")` prije `router.push`.

- [ ] **Step 3: Dodati granu u `page.tsx`**

```tsx
import { MatricaView } from "./_views/matrica"
```
```tsx
      {view === "matrica" && <MatricaView searchParams={sp} />}
```

- [ ] **Step 4: Typecheck + lint + provjera**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (lint: nema nekorištenog `OpterecenjeChart`/`opterecenje`/`get_opterecenje`).
Ručno: `/plan-aktivnosti?view=matrica` prikazuje matricu **bez grafikona**; klik na ćeliju sa više termina vodi na `?view=lista` filtriran.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/plan-aktivnosti/_views/matrica.tsx" "app/(dashboard)/plan-aktivnosti/page.tsx" components/domain/MatrixGrid.tsx components/domain/PrikazToolbar.tsx
git commit -m "feat(plan-aktivnosti): Matrica view (iz prikaz, bez grafikona) + MatrixGrid/PrikazToolbar reroute"
```

---

## Task 6: Redirecti starih ruta (termini/plan/prikaz)

**Files:**
- Modify: `app/(dashboard)/termini/page.tsx`, `app/(dashboard)/plan/page.tsx`, `app/(dashboard)/prikaz/page.tsx`

**Interfaces:**
- Consumes: `buildRedirectHref` iz `@/lib/plan-view`; `redirect` iz `next/navigation`.

- [ ] **Step 1: Zamijeniti `termini/page.tsx` redirectom**

Cijeli sadržaj `app/(dashboard)/termini/page.tsx`:
```tsx
import { redirect } from "next/navigation"
import { buildRedirectHref } from "@/lib/plan-view"

export default async function TerminiRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(buildRedirectHref("lista", await searchParams))
}
```

- [ ] **Step 2: Zamijeniti `plan/page.tsx` redirectom**

```tsx
import { redirect } from "next/navigation"
import { buildRedirectHref } from "@/lib/plan-view"

export default async function PlanRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(buildRedirectHref("kalendar", await searchParams))
}
```

- [ ] **Step 3: Zamijeniti `prikaz/page.tsx` redirectom**

```tsx
import { redirect } from "next/navigation"
import { buildRedirectHref } from "@/lib/plan-view"

export default async function PrikazRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(buildRedirectHref("matrica", await searchParams))
}
```

- [ ] **Step 4: Typecheck + provjera redirekata**

Run: `pnpm typecheck`
Expected: PASS.
Ručno: `/termini?status=kasni` → `/plan-aktivnosti?status=kasni&view=lista`; `/plan` → `?view=kalendar`; `/prikaz?godina=2026` → `?godina=2026&view=matrica`.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/termini/page.tsx" "app/(dashboard)/plan/page.tsx" "app/(dashboard)/prikaz/page.tsx"
git commit -m "feat(plan-aktivnosti): stare rute termini/plan/prikaz -> redirect (cuva query)"
```

---

## Task 7: Navigacija (Sidebar) 3 → 1

**Files:**
- Modify: `components/shell/Sidebar.tsx`

- [ ] **Step 1: Zamijeniti tri nav stavke jednom**

U `components/shell/Sidebar.tsx`, u `NAV_ITEMS`, ukloniti redove:
```tsx
  { href: "/termini",   label: "Termini",   icon: ClipboardList },
  { href: "/prikaz",    label: "Prikaz",    icon: Grid3x3 },
  { href: "/plan",      label: "Plan",      icon: Calendar },
```
i umjesto njih (odmah nakon `/pregled`) dodati:
```tsx
  { href: "/plan-aktivnosti", label: "Plan aktivnosti", icon: Calendar },
```
Ukloniti sad nekorištene ikone iz importa (`ClipboardList`, `Grid3x3`) ako se ne koriste drugdje u fajlu; `Calendar` zadržati.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (bez nekorištenih importa).

- [ ] **Step 3: Commit**

```bash
git add components/shell/Sidebar.tsx
git commit -m "feat(plan-aktivnosti): navigacija 3 taba -> 1 'Plan aktivnosti'"
```

---

## Task 8: Interni linkovi + `revalidatePath`

**Files:**
- Modify: `app/(dashboard)/pregled/page.tsx`, `components/domain/HitnoKasniList.tsx`, `app/(dashboard)/obilasci/page.tsx`, `app/(dashboard)/dokumenti/actions.ts`, `app/(dashboard)/termini/actions.ts`

- [ ] **Step 1: `pregled/page.tsx` linkovi**

- Linija ~44: `` href={`/termini?mjesec=${mjesec}`} `` → `` href={`/plan-aktivnosti?view=lista&mjesec=${mjesec}`} ``
- Linija ~54: `href="/termini?status=kasni"` → `href="/plan-aktivnosti?view=lista&status=kasni"`

- [ ] **Step 2: `HitnoKasniList.tsx` link**

- Linija ~64: `href="/termini?status=kasni"` → `href="/plan-aktivnosti?view=lista&status=kasni"`

- [ ] **Step 3: `obilasci/page.tsx` link**

- Linija ~81: `` href={`/termini?klijent_id=${t.klijent_id}`} `` → `` href={`/plan-aktivnosti?view=lista&klijent_id=${t.klijent_id}`} ``

- [ ] **Step 4: `dokumenti/actions.ts` revalidatePath**

U `revalidateDokumenti` (linije ~27–30): tri poziva `revalidatePath("/termini")`, `revalidatePath("/plan")`, `revalidatePath("/prikaz")` zamijeniti jednim:
```typescript
  revalidatePath("/plan-aktivnosti")
```
(zadržati `revalidatePath("/zapisnici")` i `revalidatePath(`/klijenti/${klijentId}`)`).

- [ ] **Step 5: `termini/actions.ts` revalidatePath**

Sve `revalidatePath("/termini")` (linije ~65, 82, 145, 173) → `revalidatePath("/plan-aktivnosti")`.

- [ ] **Step 6: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add "app/(dashboard)/pregled/page.tsx" components/domain/HitnoKasniList.tsx "app/(dashboard)/obilasci/page.tsx" "app/(dashboard)/dokumenti/actions.ts" "app/(dashboard)/termini/actions.ts"
git commit -m "feat(plan-aktivnosti): interni linkovi + revalidatePath -> /plan-aktivnosti"
```

---

## Task 9: E2E — novi spec + ažuriranje postojećih

**Files:**
- Create: `tests/e2e/20-plan-aktivnosti.spec.ts`
- Modify: postojeći specovi koji asertuju stare rute (vidi Step 3)

**Interfaces:**
- Consumes: testid‑ovi `plan-view-switcher`, `view-lista|kalendar|matrica`, postojeći (`termini-filters`, `dashboard-chart`, `prikaz-empty`, itd.).

- [ ] **Step 1: Pogledati postojeći E2E setup**

Run: `sed -n '1,30p' tests/e2e/01-smoke.spec.ts`
Cilj: potvrditi `storageState` login (admin) i obrazac navigacije; uskladiti selektore.

- [ ] **Step 2: Napisati `20-plan-aktivnosti.spec.ts`**

```typescript
import { test, expect } from "@playwright/test"

test.describe("Plan aktivnosti — konsolidacija", () => {
  test("default view = lista; switcher mijenja prikaz", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await expect(page.getByTestId("plan-view-switcher")).toBeVisible()
    await expect(page.getByTestId("view-lista")).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("termini-filters")).toBeVisible()

    await page.getByTestId("view-kalendar").click()
    await page.waitForURL(/view=kalendar/)
    await expect(page.getByTestId("view-kalendar")).toHaveAttribute("data-active", "true")

    await page.getByTestId("view-matrica").click()
    await page.waitForURL(/view=matrica/)
    await expect(page.getByTestId("view-matrica")).toHaveAttribute("data-active", "true")
  })

  test("filter se zadrži pri promjeni view-a", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=lista&status=kasni")
    await page.getByTestId("view-kalendar").click()
    await page.waitForURL(/status=kasni/)
    await expect(page).toHaveURL(/view=kalendar/)
  })

  test("redirect: /termini?status=kasni -> /plan-aktivnosti?...view=lista", async ({ page }) => {
    await page.goto("/termini?status=kasni")
    await page.waitForURL(/\/plan-aktivnosti\?/)
    await expect(page).toHaveURL(/view=lista/)
    await expect(page).toHaveURL(/status=kasni/)
  })

  test("matrica NEMA grafikon; Pregled IMA grafikon", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=matrica")
    await expect(page.getByTestId("dashboard-chart")).toHaveCount(0)
    await page.goto("/pregled")
    await expect(page.getByTestId("dashboard-chart")).toBeVisible()
  })

  test("Sidebar: postoji 'Plan aktivnosti', nema Termini/Prikaz/Plan", async ({ page }) => {
    await page.goto("/pregled")
    const nav = page.getByRole("navigation", { name: "Glavna navigacija" })
    await expect(nav.getByRole("link", { name: "Plan aktivnosti" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Prikaz", exact: true })).toHaveCount(0)
  })
})
```

- [ ] **Step 3: Ažurirati postojeće specove**

Pretraga i zamjena URL/navigacija asercija u specovima koji posjećuju/asertuju stare rute. Pokrenuti:
Run: `grep -rln "/termini\|/prikaz\b\|/plan\b\|name: \"Termini\"\|name: \"Prikaz\"\|name: \"Plan\"" tests/e2e/*.spec.ts`
Za svaki pogođeni spec (očekivano: 01‑smoke nav lista 9→7 + nazivi; 03‑termini `page.goto('/termini')` → `/plan-aktivnosti`; 05‑matrix‑plan; 10‑pregled (kartice vode na /plan-aktivnosti); 11/13‑prikaz `page.goto('/prikaz')` → `/plan-aktivnosti?view=matrica`; 14‑plan → `?view=kalendar`):
- `page.goto("/termini…")` → `page.goto("/plan-aktivnosti?view=lista…")` (ili ostaviti — redirect radi, ali ažurirati `toHaveURL` asercije).
- Nav `getByRole("link",{name:"Termini"/"Prikaz"/"Plan"})` → `"Plan aktivnosti"`.
- 01‑smoke „Sidebar prikazuje svih 9 nav stavki" → 7 stavki, bez Termini/Prikaz/Plan, sa „Plan aktivnosti".

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/
git commit -m "test(plan-aktivnosti): novi E2E + azuriranje postojecih specova na nove rute"
```

---

## Task 10: Završni gate

**Files:** (bez novih)

- [ ] **Step 1: Statika**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint`
Expected: sve PASS.

- [ ] **Step 2: Produkcijski build**

Run: `pnpm build`
Expected: PASS; ruta `/plan-aktivnosti` u izlazu; `/termini`,`/plan`,`/prikaz` i dalje postoje (kao redirect strane).

- [ ] **Step 3: Pun E2E (Docker dev)**

Run: `pnpm test:e2e --project=chromium`
Expected: sve PASS (novi 20‑plan‑aktivnosti + ažurirani postojeći).

- [ ] **Step 4: Provjera bez nekorištenog koda**

Run: `grep -rn "OpterecenjeChart" "app/(dashboard)/plan-aktivnosti/_views/matrica.tsx"`
Expected: prazno (grafikon uklonjen iz matrice).

---

## Self-Review (autor plana)

**Spec coverage:**
- §4.1 nova ruta + ?view → Task 3. ✅
- §4.2 tri view‑a (matrica bez grafikona) → Task 3/4/5. ✅
- §4.3 switcher + buildViewHref → Task 1/2. ✅
- §4.4 redirecti + buildRedirectHref → Task 1/6. ✅
- §4.5 nav 3→1 → Task 7. ✅
- §4.6 grafikon samo na Pregledu → Task 5 (uklonjen iz matrice), Pregled netaknut. ✅
- §4.7 interni linkovi + revalidatePath → Task 8. ✅
- §6 testiranje (unit + E2E + ažuriranje) → Task 1/9/10. ✅

**Placeholder scan:** Task 5 Step 1 (uklanjanje grafikona) i Task 9 Step 3 (ažuriranje postojećih specova) su „pretraži‑i‑izmijeni" koraci sa konkretnim grep komandama i tačnim zamjenama — ne otvoreni TODO. Reroute komponenti dat sa tačnim linijama i string‑zamjenama.

**Type consistency:** `PlanView`/`PLAN_VIEWS`/`buildViewHref`/`buildRedirectHref`/`jeValidanView` dosljedni (Task 1) i korišteni u Task 2/3/6. View‑komponente jedinstveno primaju `searchParams: Record<string,...>` (razriješeno). `data-testid` switcher‑a (`plan-view-switcher`, `view-<v>`) dosljedni u Task 2/9.

**Rizik:** PrikazToolbar `next` možda ne nosi `view` — Task 5 Step 2 ima fallback (`next.set("view","matrica")`). Stari E2E koji asertuju URL — Task 9 Step 3 ih sistematski ažurira; redirecti su safety‑net.
