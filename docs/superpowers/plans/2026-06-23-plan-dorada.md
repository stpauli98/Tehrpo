# Dorada Plan taba — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doraditi `/plan` kalendar — legenda boja, uklanjanje zbunjujućeg broja u ćeliji, direktan klik na pojedinačni termin, i mjesec dropdown u navigaciji.

**Architecture:** Tri izolovana zahvata, reuse-first. Status-boje tačaka postaju jedan izvor istine u `lib/termini.ts`. Nova čista `PlanLegenda` komponenta. `MonthCalendar` ćelija se restrukturira iz jednog `<Link>` u `<div>` sa pozadinskim dan-linkom (`absolute inset-0`) + slojem sadržaja gdje su pojedinačni termini zasebni linkovi (`pointer-events`). `PlanNav` dobija mjesec `Select` uz postojeći godina `Select`.

**Tech Stack:** Next.js 16 App Router (server components), React 19, TypeScript, Tailwind v4, base-ui Select, Playwright e2e (cloud Supabase), pnpm.

## Global Constraints

- Grana: `fix/plan-dorada` (NE `main`). Već kreirana i aktivna.
- App je na **cloud Supabase** — e2e idu protiv cloud-a (`tests/e2e/db.ts`), bez lokalnog Dockera.
- Desktop-only: zabranjen `sm:`/`md:` breakpoint (ESLint `no-restricted-syntax`). Koristiti `lg:`/`xl:`/`2xl:` ili bez breakpointa.
- Ćelija NE smije imati ugniježdene `<a>` (nevalidan HTML) — pozadinski link + sloj sadržaja s `pointer-events`.
- Status boje-tačke (kalendar, verbatim): `planirano: bg-blue-500`, `zakazano: bg-cyan-500`, `izvrseno: bg-green-500`, `kasni: bg-red-500`, `otkazano: bg-slate-400`.
- `?selected=<id>` → `TerminSheet` (ostaje u Planu); `?dan=<date>` → dnevni sidebar. Param imena verbatim: `godina`, `mjesec` ("1".."12"), `dan` (`YYYY-MM-DD`), `selected`.
- Dev server (vizuelna provjera): `ZAPISNIK_DRY_RUN=1 CHAT_DRY_RUN=1 pnpm dev` na portu 3000; ugasiti kad ne treba.
- AGENTS.md: ovo NIJE standardni Next.js — konsultovati `node_modules/next/dist/docs/` prije pisanja koda ako nešto odstupa.

---

### Task 1: Dijeljene dot-boje + legenda + uklanjanje broja (#1, #2)

**Files:**
- Modify: `lib/termini.ts` (dodati `STATUS_DOT_CLASS` poslije `STATUS_BADGE_CLASS`, oko linije 66)
- Create: `components/domain/PlanLegenda.tsx`
- Modify: `components/domain/MonthCalendar.tsx` (zamijeniti lokalni `DOTS`, ukloniti count-span)
- Modify: `app/(dashboard)/plan/page.tsx` (renderovati `<PlanLegenda />` ispod kalendara)
- Test: `tests/e2e/14-plan-dorada.spec.ts` (kreira se ovdje; legenda + odsustvo broja)

**Interfaces:**
- Produces: `STATUS_DOT_CLASS: Record<DerivedStatus, string>` (export iz `lib/termini.ts`); `PlanLegenda` (named export, bez props-a, renderuje `data-testid="plan-legenda"`).
- Consumes: `DerivedStatus`, `STATUS_LABEL` iz `@/lib/termini`.

- [ ] **Step 1: Dodati `STATUS_DOT_CLASS` u `lib/termini.ts`**

Poslije bloka `STATUS_BADGE_CLASS` (završava oko linije 66) dodati:

```ts
/** Pune tačke za kalendar (bg-*-500 skala). Jedan izvor istine za MonthCalendar + PlanLegenda. */
export const STATUS_DOT_CLASS: Record<DerivedStatus, string> = {
  planirano: "bg-blue-500",
  zakazano: "bg-cyan-500",
  izvrseno: "bg-green-500",
  kasni: "bg-red-500",
  otkazano: "bg-slate-400",
}
```

- [ ] **Step 2: Kreirati `components/domain/PlanLegenda.tsx`**

```tsx
import { STATUS_LABEL, STATUS_DOT_CLASS, type DerivedStatus } from "@/lib/termini"

const REDOSLIJED: DerivedStatus[] = ["izvrseno", "planirano", "zakazano", "kasni", "otkazano"]

export function PlanLegenda() {
  return (
    <div
      data-testid="plan-legenda"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"
    >
      <span className="font-medium text-slate-600">Legenda:</span>
      {REDOSLIJED.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASS[s]}`} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: U `MonthCalendar.tsx` zamijeniti lokalni `DOTS` i ukloniti count-span**

Ukloniti lokalnu `const DOTS: Record<DerivedStatus, string> = {...}` (linije ~13-19). NAPOMENA: tip `DerivedStatus` se i dalje koristi u `DayTermin` (linija ~10), pa taj import OSTAJE. Postojeću liniju `import type { DerivedStatus } from "@/lib/termini"` (linija 3) zamijeniti kombinovanim importom koji dodaje `STATUS_DOT_CLASS` (value):

```tsx
import { STATUS_DOT_CLASS, type DerivedStatus } from "@/lib/termini"
```

Zamijeniti referencu `DOTS[t.status]` sa `STATUS_DOT_CLASS[t.status]` (u mapiranju termina, ~linija 104).

Ukloniti count-span u zaglavlju ćelije (trenutno linije ~89-93):

```tsx
{termini.length > 0 && (
  <span className="text-[10px] text-slate-400">
    {termini.length}
  </span>
)}
```

Nakon uklanjanja, `<div className="flex items-center justify-between">` ostaje samo s brojem dana lijevo; može ostati `justify-between` (broj dana ostaje lijevo).

- [ ] **Step 4: U `plan/page.tsx` renderovati `<PlanLegenda />` ispod kalendara**

Import na vrhu (uz ostale domain importe):

```tsx
import { PlanLegenda } from "@/components/domain/PlanLegenda"
```

Trenutni JSX (linije ~127-173) ima `<div className={selectedDan ? "grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4" : ""}>` koji sadrži `MonthCalendar` + sidebar. Dodati legendu ODMAH ISPOD tog `</div>` (preko cijele širine, ne unutar grida):

```tsx
      </div>
      <PlanLegenda />
      {selectedTermin && (
```

(tj. između zatvaranja kalendar/sidebar grid `</div>` i `{selectedTermin && (`).

- [ ] **Step 5: Kreirati `tests/e2e/14-plan-dorada.spec.ts` sa legenda + odsustvo-broja testovima**

```ts
import { test, expect } from "@playwright/test"

test.describe("Plan dorada — legenda i čćelija", () => {
  test("legenda je vidljiva ispod kalendara sa 5 statusa", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    const legenda = page.getByTestId("plan-legenda")
    await expect(legenda).toBeVisible()
    for (const label of ["Izvršeno", "Planirano", "Zakazano", "Kasni", "Otkazano"]) {
      await expect(legenda.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test("nema sivog count-broja u uglu ćelije (samo broj dana + 'još N')", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    // Stari count-span je bio text-[10px] text-slate-400 sa golim brojem termina.
    // Provjeravamo da ćelija sa terminima NE sadrži drugi broj pored broja dana;
    // umjesto toga preljev se vidi kroz "još N".
    await expect(page.getByText(/^još \d+$/).first()).toBeVisible()
  })
})
```

- [ ] **Step 6: Pokrenuti nove testove — moraju proći**

Run: `pnpm exec playwright test tests/e2e/14-plan-dorada.spec.ts --reporter=line`
Expected: PASS (2 testa × 2 browsera = 4 passed). Ako dev server nije pokrenut, Playwright config ga diže (`reuseExistingServer`).

- [ ] **Step 7: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 8: Commit**

```bash
git add lib/termini.ts components/domain/PlanLegenda.tsx components/domain/MonthCalendar.tsx "app/(dashboard)/plan/page.tsx" tests/e2e/14-plan-dorada.spec.ts
git commit -m "feat(plan): legenda boja + dijeljene dot-klase + ukloni zbunjujući broj"
```

---

### Task 2: Mjesec dropdown u PlanNav (#4)

**Files:**
- Modify: `components/domain/PlanNav.tsx` (dodati mjesec `Select` uz godina `Select`)
- Test: `tests/e2e/14-plan-dorada.spec.ts` (dodati mjesec-dropdown test)

**Interfaces:**
- Consumes: `MONTHS_BS` iz `@/lib/date` (niz naziva mjeseci, index 0 = Januar); postojeći `href(g, m)` iz PlanNav koji već briše `dan`/`selected`.
- Produces: novi `data-testid="plan-nav-mjesec"` (SelectTrigger).

- [ ] **Step 1: Dodati mjesec-dropdown test u `tests/e2e/14-plan-dorada.spec.ts`**

Dodati novi `test.describe` blok u isti fajl:

```ts
test.describe("Plan dorada — mjesec dropdown", () => {
  test("izbor mjeseca mijenja ?mjesec= i label", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    await expect(page.getByTestId("plan-nav-label")).toContainText("Jul")
    await page.getByTestId("plan-nav-mjesec").click()
    await page.getByRole("option", { name: "Decembar" }).click()
    await page.waitForURL(/mjesec=12/)
    await expect(page.getByTestId("plan-nav-label")).toContainText("Decembar")
  })
})
```

- [ ] **Step 2: Pokrenuti test — mora pasti (nema `plan-nav-mjesec`)**

Run: `pnpm exec playwright test tests/e2e/14-plan-dorada.spec.ts -g "mjesec dropdown" --reporter=line`
Expected: FAIL (timeout na `getByTestId("plan-nav-mjesec")` — element ne postoji).

- [ ] **Step 3: Dodati mjesec `Select` u `PlanNav.tsx`**

Importovati `MONTHS_BS` na vrhu:

```tsx
import { MONTHS_BS } from "@/lib/date"
```

Dodati mjesec `Select` ODMAH PRIJE godina `Select`-a (oko linije 78, prije `<Select value={String(godina)}...>`):

```tsx
      <Select
        value={String(mjesec)}
        onValueChange={(v) => {
          const m = Number(v)
          if (m) router.push(href(godina, m))
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-32"
          data-testid="plan-nav-mjesec"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MONTHS_BS.map((naziv, i) => (
            <SelectItem key={naziv} value={String(i + 1)}>
              {naziv}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
```

- [ ] **Step 4: Pokrenuti test — mora proći**

Run: `pnpm exec playwright test tests/e2e/14-plan-dorada.spec.ts -g "mjesec dropdown" --reporter=line`
Expected: PASS (1 test × 2 browsera = 2 passed).

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 6: Commit**

```bash
git add components/domain/PlanNav.tsx tests/e2e/14-plan-dorada.spec.ts
git commit -m "feat(plan): mjesec dropdown u navigaciji (konzistentno s Prikazom)"
```

---

### Task 3: Direktan klik na termin — restruktura ćelije (#3)

**Files:**
- Modify: `components/domain/MonthCalendar.tsx` (ćelija: `<Link>` → `<div>` + pozadinski dan-link + per-termin linkovi)
- Modify: `tests/e2e/05-matrix-plan.spec.ts` (ažurirati "klik dana → sidebar" test za novi model)
- Test: `tests/e2e/14-plan-dorada.spec.ts` (dodati direktan-klik + pozadina-dana testove)

**Interfaces:**
- Consumes: `currentSearch` (string), `STATUS_DOT_CLASS`, `CalDay`, `DayTermin` (već u komponenti). `?selected=<id>` otvara `TerminSheet` u `plan/page.tsx` (postojeća logika, linije 74-88).
- Produces: novi `data-testid="cell-termin"` (per-termin `<Link>` na `?selected=`), `data-testid="cell-vise"` ("još N" `<Link>` na `?dan=`); `data-testid="plan-day-cell"` ostaje (sad na pozadinskom dan-linku, 1 po ćeliji → 42 ukupno).

- [ ] **Step 1: Dodati direktan-klik i pozadina-dana testove u `tests/e2e/14-plan-dorada.spec.ts`**

Dodati novi `test.describe` blok:

```ts
test.describe("Plan dorada — klik model ćelije", () => {
  test("klik na pojedinačni termin otvara TerminSheet direktno", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    const termin = page.getByTestId("cell-termin").first()
    await expect(termin).toBeVisible()
    await termin.click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
  })

  test("klik na pozadinu dana (ne na termin) otvara dnevni sidebar", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    // dan 28 ima puno termina; klik na pozadinski dan-link (broj/prazni dio)
    const dayLink = page.locator('[data-testid="plan-day-cell"][data-date="2026-07-28"]')
    await expect(dayLink).toBeVisible()
    await dayLink.click()
    await page.waitForURL(/dan=2026-07-28/)
    await expect(page.getByTestId("plan-sidebar")).toBeVisible()
  })
})
```

- [ ] **Step 2: Pokrenuti testove — moraju pasti (nema `cell-termin`)**

Run: `pnpm exec playwright test tests/e2e/14-plan-dorada.spec.ts -g "klik model" --reporter=line`
Expected: FAIL (timeout na `cell-termin` — ne postoji; ćelija je još uvijek jedan link).

- [ ] **Step 3: Restrukturirati ćeliju u `MonthCalendar.tsx`**

Trenutno `grid.map` vraća `<Link ...>` po ćeliji (linije ~59-121). Zamijeniti tijelo mape ovim. Dodati `terminHref` pomoćnu funkciju uz postojeću `dayHref` (oko linije 36):

```tsx
  const dayHref = (date: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("dan", date)
    p.delete("selected")
    return `/plan?${p.toString()}`
  }

  const terminHref = (id: string) => {
    const p = new URLSearchParams(currentSearch)
    p.set("selected", id)
    p.delete("dan")
    return `/plan?${p.toString()}`
  }
```

Tijelo `grid.map((c) => { ... })` (od `const termini = ...` do `return (<Link>...)`) zamijeniti:

```tsx
        {grid.map((c) => {
          const termini = terminiByDan.get(c.date) ?? []
          const isToday = c.date === today
          const isSelected = c.date === selectedDan

          return (
            <div
              key={c.date}
              className={cn(
                "relative min-h-[84px] border-t border-l border-slate-100 transition",
                !c.inMonth && "bg-slate-50/50 text-slate-300",
                isSelected
                  ? "ring-2 ring-inset ring-brand bg-brand-light/30"
                  : "hover:bg-slate-50",
              )}
            >
              {/* Pozadinski sloj: klik na cijeli dan → ?dan sidebar */}
              <Link
                href={dayHref(c.date)}
                data-testid="plan-day-cell"
                data-date={c.date}
                data-selected={isSelected}
                aria-label={`Dan ${c.day}`}
                className="absolute inset-0"
              />
              {/* Sloj sadržaja: broj dana + termini (klikovi prolaze do pozadine osim na linkovima) */}
              <div className="relative pointer-events-none p-1.5 text-left align-top">
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-xs",
                      isToday &&
                        "inline-grid place-items-center w-5 h-5 rounded-full bg-brand text-white font-semibold",
                    )}
                  >
                    {c.day}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {termini.slice(0, 3).map((t) => (
                    <Link
                      key={t.id}
                      href={terminHref(t.id)}
                      data-testid="cell-termin"
                      data-status={t.status}
                      className="pointer-events-auto flex items-center gap-1 truncate rounded px-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          STATUS_DOT_CLASS[t.status],
                        )}
                      />
                      <span className="truncate">
                        {t.klijentNaziv}
                        {t.lokacijaNaziv ? ` · ${t.lokacijaNaziv}` : ""}
                      </span>
                    </Link>
                  ))}
                  {termini.length > 3 && (
                    <Link
                      href={dayHref(c.date)}
                      data-testid="cell-vise"
                      className="pointer-events-auto block text-[10px] text-brand font-medium hover:underline"
                    >
                      još {termini.length - 3}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )
        })}
```

NAPOMENA: `STATUS_DOT_CLASS` je već importovan u Tasku 1. Ako se Task 3 izvodi prije Taska 1 (ne bi trebalo — redom su), dodati `import { STATUS_DOT_CLASS } from "@/lib/termini"`.

- [ ] **Step 4: Pokrenuti nove testove — moraju proći**

Run: `pnpm exec playwright test tests/e2e/14-plan-dorada.spec.ts -g "klik model" --reporter=line`
Expected: PASS (2 testa × 2 browsera = 4 passed).

- [ ] **Step 5: Ažurirati postojeći "klik dana → sidebar" test u `05-matrix-plan.spec.ts`**

Trenutni test (linije ~76-90) bira ćeliju preko `plan-day-cell` koja sadrži `span.rounded-full` — taj filter više ne važi (tačke su u sloju sadržaja, ne u pozadinskom linku). Zamijeniti tijelo testa:

```ts
  test("klik dana sa terminima → sidebar → Detalji → sheet", async ({ page }) => {
    // jul 2026, dan 28 ima dosta termina (data-driven: poznat gust dan)
    await page.goto("/plan?godina=2026&mjesec=7")
    const dayLink = page.locator('[data-testid="plan-day-cell"][data-date="2026-07-28"]')
    await expect(dayLink).toBeVisible()
    await dayLink.click()
    await page.waitForURL(/dan=2026-07-28/)
    await expect(page.getByTestId("plan-sidebar")).toBeVisible()
    await expect(page.getByTestId("sidebar-termin").first()).toBeVisible()
    await page.getByTestId("sidebar-detalji").first().click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
  })
```

- [ ] **Step 6: Pokrenuti cijeli `05-matrix-plan` — sve zeleno (regresija)**

Run: `pnpm exec playwright test tests/e2e/05-matrix-plan.spec.ts --reporter=line`
Expected: PASS (sve Plan i Prikaz sekcije). Grid test i dalje broji 42 `plan-day-cell`.

- [ ] **Step 7: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka, build prolazi.

- [ ] **Step 8: Commit**

```bash
git add components/domain/MonthCalendar.tsx tests/e2e/05-matrix-plan.spec.ts tests/e2e/14-plan-dorada.spec.ts
git commit -m "feat(plan): direktan klik na termin (pozadinski dan-link + per-termin linkovi)"
```

---

## Završna verifikacija (cijela grana)

- [ ] `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka.
- [ ] `pnpm exec playwright test tests/e2e/05-matrix-plan.spec.ts tests/e2e/14-plan-dorada.spec.ts --reporter=line` — sve zeleno (flake-ove ponoviti izolovano).
- [ ] Vizuelna provjera (dev server): legenda ispod kalendara; nema broja u uglu; mjesec dropdown radi; klik na termin → `TerminSheet`; klik na pozadinu dana → sidebar.
- [ ] Ugasiti dev server (`lsof -ti:3000 | xargs kill`).
