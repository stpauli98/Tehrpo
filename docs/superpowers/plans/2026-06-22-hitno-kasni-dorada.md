# Dorada "Hitno / kasni" widgeta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pretvoriti dashboard "Hitno / kasni" listu iz spiska datuma u akcijski widget — klik otvara baš taj termin, relativni rok ("kasni X dana"), lokacija, i istinit klikabilan footer.

**Architecture:** Čista funkcija za relativnu oznaku roka (`lib/hitno.ts`, unit-testirana, TDD) + redizajn server-komponente `HitnoKasniList` koja je koristi; upit `getHitnoKasni` dobija `lokacija_naziv`; dashboard prosljeđuje `today` i ukupan broj kasnih. Verifikacija Playwright E2E na `/pregled`.

**Tech Stack:** Next.js 16 (server component), React 19, Supabase, vitest (unit), Playwright (e2e), pnpm, Tailwind.

## Global Constraints

- **Grana:** rad na `fix/dashboard-kartice` (već postoji, NE `main`).
- **Docker lokalni Supabase** UP + seedovan; ne pokretati `pnpm db:reset`. Ako port 3000 visi, ne ubijati procese — to radi izvođač/controller.
- **Next.js je NESTANDARDAN (Next 16)** — po `AGENTS.md` konsultovati `node_modules/next/dist/docs/` prije rute/Link izmjena.
- **Verbatim vrijednosti:**
  - Red linka: `/termini?selected=<id>` (otvara TerminSheet; `termini/page.tsx` ima fallback dohvat ako nije na stranici).
  - Footer link: `/termini?status=kasni`, tekst `Svi kasni rokovi (N) →` (N = ukupan broj kasnih).
  - Relativna oznaka: prošli rok → `kasni X dan` / `kasni X dana`; rok danas → `danas`; budući → `za X dan` / `za X dana`. Bosanska množina: `dan` ako `n % 10 === 1 && n % 100 !== 11`, inače `dana`.
  - Tonovi: prošli rok i danas → `danger` (crveno `text-red-600`); budući → `warning` (amber `text-amber-600`).
  - Red prikazuje: firma (bold) + podlinija `vrsta · lokacija`; desno relativna oznaka (tooltip = formatiran datum).
- **Komande:** unit `pnpm vitest run <path>`; e2e `pnpm test:e2e tests/e2e/10-pregled.spec.ts`; gate `pnpm lint && pnpm typecheck && pnpm build`.
- **Reuse (ne mijenjati signature):** `formatDatum` (`lib/date.ts`), `termini_view` (ima `lokacija_naziv`), `?selected=` handling u `termini/page.tsx:97-109`.

## File Structure

- `lib/hitno.ts` — NOVO: čista `rokRelativnaOznaka(rokIso, todayIso) → { text, tone }`.
- `lib/hitno.test.ts` — NOVO: unit testovi za graničke slučajeve.
- `lib/termini.ts` — IZMJENA: `HitnoKasniItem` + `getHitnoKasni` dobijaju `lokacija_naziv`.
- `components/domain/HitnoKasniList.tsx` — IZMJENA: redizajn reda (link `?selected`, relativna oznaka, lokacija) + footer link.
- `app/(dashboard)/pregled/page.tsx` — IZMJENA: prosljeđuje `ukupnoKasni={stats.kasni}` i `today={todayIso()}`.
- `tests/e2e/10-pregled.spec.ts` — IZMJENA: testovi za novi red/footer.

---

### Task 1: Čista funkcija `rokRelativnaOznaka`

**Files:**
- Create: `lib/hitno.ts`
- Create: `lib/hitno.test.ts`

**Interfaces:**
- Produces:
  - `type RokTon = "danger" | "warning"`
  - `type RokOznaka = { text: string; tone: RokTon }`
  - `rokRelativnaOznaka(rokIso: string, todayIso: string): RokOznaka`

- [ ] **Step 1: Napisati failing unit test (`lib/hitno.test.ts`)**

```ts
import { describe, it, expect } from "vitest"
import { rokRelativnaOznaka } from "./hitno"

describe("rokRelativnaOznaka", () => {
  it("prošli rok → 'kasni X dana', danger", () => {
    expect(rokRelativnaOznaka("2026-06-20", "2026-06-22")).toEqual({ text: "kasni 2 dana", tone: "danger" })
  })
  it("kasni 1 dan (singular)", () => {
    expect(rokRelativnaOznaka("2026-06-21", "2026-06-22")).toEqual({ text: "kasni 1 dan", tone: "danger" })
  })
  it("rok danas → 'danas', danger", () => {
    expect(rokRelativnaOznaka("2026-06-22", "2026-06-22")).toEqual({ text: "danas", tone: "danger" })
  })
  it("budući 1 dan → 'za 1 dan', warning", () => {
    expect(rokRelativnaOznaka("2026-06-23", "2026-06-22")).toEqual({ text: "za 1 dan", tone: "warning" })
  })
  it("budući 5 dana → 'za 5 dana', warning", () => {
    expect(rokRelativnaOznaka("2026-06-27", "2026-06-22")).toEqual({ text: "za 5 dana", tone: "warning" })
  })
  it("11 ostaje 'dana' (n%100===11 izuzetak)", () => {
    expect(rokRelativnaOznaka("2026-07-03", "2026-06-22").text).toBe("za 11 dana")
  })
  it("prelazak mjeseca računa cijele dane", () => {
    expect(rokRelativnaOznaka("2026-01-20", "2026-02-01")).toEqual({ text: "kasni 12 dana", tone: "danger" })
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm vitest run lib/hitno.test.ts`
Expected: FAIL (`lib/hitno` ne postoji).

- [ ] **Step 3: Implementirati `lib/hitno.ts`**

```ts
export type RokTon = "danger" | "warning"
export type RokOznaka = { text: string; tone: RokTon }

// Cijeli dani od a do b (b - a); ulazi su ISO "YYYY-MM-DD".
function danaIzmedju(aIso: string, bIso: string): number {
  const a = Date.UTC(+aIso.slice(0, 4), +aIso.slice(5, 7) - 1, +aIso.slice(8, 10))
  const b = Date.UTC(+bIso.slice(0, 4), +bIso.slice(5, 7) - 1, +bIso.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

function danRijec(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? "dan" : "dana"
}

export function rokRelativnaOznaka(rokIso: string, todayIso: string): RokOznaka {
  const dani = danaIzmedju(todayIso, rokIso) // rok - danas
  if (dani < 0) {
    const n = -dani
    return { text: `kasni ${n} ${danRijec(n)}`, tone: "danger" }
  }
  if (dani === 0) return { text: "danas", tone: "danger" }
  return { text: `za ${dani} ${danRijec(dani)}`, tone: "warning" }
}
```

- [ ] **Step 4: Pokrenuti — mora proći**

Run: `pnpm vitest run lib/hitno.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add lib/hitno.ts lib/hitno.test.ts
git commit -m "feat(hitno): rokRelativnaOznaka — relativni rok sa bosanskom množinom"
```

---

### Task 2: Redizajn `HitnoKasniList` + podaci + dashboard wiring

**Files:**
- Modify: `lib/termini.ts` (`HitnoKasniItem` + `getHitnoKasni`)
- Modify: `components/domain/HitnoKasniList.tsx`
- Modify: `app/(dashboard)/pregled/page.tsx`
- Test: `tests/e2e/10-pregled.spec.ts`

**Interfaces:**
- Consumes: `rokRelativnaOznaka` (Task 1); `formatDatum` (`lib/date.ts`); `?selected=` handling (`termini/page.tsx`).
- Produces: `HitnoKasniList({ items, ukupnoKasni, today })`; `HitnoKasniItem` sa `lokacija_naziv: string | null`.

- [ ] **Step 1: Napisati failing e2e (`tests/e2e/10-pregled.spec.ts`)**

Dodati u `test.describe("Faza dashboard — Pregled", ...)`:

```ts
test("klik na hitno/kasni red otvara taj termin (?selected)", async ({ page }) => {
  await page.goto("/pregled")
  await page.getByTestId("hitno-kasni-row").first().click()
  await page.waitForURL(/\/termini\?selected=[0-9a-f-]{36}/)
})

test("hitno/kasni red ima relativnu oznaku (kasni/za/danas)", async ({ page }) => {
  await page.goto("/pregled")
  await expect(page.getByTestId("hitno-kasni-row").first()).toContainText(/kasni \d+|za \d+|danas/)
})

test("hitno/kasni footer vodi na sve kasne", async ({ page }) => {
  await page.goto("/pregled")
  await page.getByTestId("hitno-kasni-footer").click()
  await page.waitForURL(/\/termini\?status=kasni/)
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm test:e2e tests/e2e/10-pregled.spec.ts`
Expected: FAIL (nema `hitno-kasni-footer`; red vodi na `?klijent_id`, ne `?selected`).

- [ ] **Step 3: Dodati `lokacija_naziv` u podatke (`lib/termini.ts`)**

Zamijeniti `HitnoKasniItem` tip:

```ts
export type HitnoKasniItem = {
  id: string
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  rok_dospijeca: string
  status_izvedeni: string
}
```

I u `getHitnoKasni` dodati `lokacija_naziv` u `.select(...)`:

```ts
    .select("id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, rok_dospijeca, status_izvedeni")
```

(Ostatak upita — `.or(...)`, `.order`, `.limit` — ostaje nepromijenjen.)

- [ ] **Step 4: Redizajnirati `components/domain/HitnoKasniList.tsx`**

Zamijeniti cijeli fajl:

```tsx
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { formatDatum } from "@/lib/date"
import { rokRelativnaOznaka } from "@/lib/hitno"
import type { HitnoKasniItem } from "@/lib/termini"
import { cn } from "@/lib/utils"

const TONE: Record<"danger" | "warning", string> = {
  danger: "text-red-600",
  warning: "text-amber-600",
}

export function HitnoKasniList({
  items,
  ukupnoKasni,
  today,
}: {
  items: HitnoKasniItem[]
  ukupnoKasni: number
  today: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4" data-testid="hitno-kasni-list">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden />
        <h2 className="font-semibold">Hitno / kasni</h2>
      </div>
      {items.length === 0 ? (
        <p data-testid="hitno-kasni-empty" className="text-sm text-slate-500">
          Nema hitnih ni kasnih termina.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => {
            const oznaka = rokRelativnaOznaka(t.rok_dospijeca, today)
            return (
              <li key={t.id}>
                <Link
                  href={`/termini?selected=${t.id}`}
                  data-testid="hitno-kasni-row"
                  className="flex items-center justify-between gap-2 py-2 hover:bg-slate-50 -mx-2 px-2 rounded"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.klijent_naziv}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {t.vrsta_naziv}
                      {t.lokacija_naziv ? ` · ${t.lokacija_naziv}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn("shrink-0 text-sm font-medium", TONE[oznaka.tone])}
                    title={formatDatum(t.rok_dospijeca)}
                  >
                    {oznaka.text}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {ukupnoKasni > 0 && (
        <Link
          href="/termini?status=kasni"
          data-testid="hitno-kasni-footer"
          className="mt-3 inline-block text-xs text-brand hover:underline"
        >
          Svi kasni rokovi ({ukupnoKasni}) →
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Ažurirati dashboard wiring (`app/(dashboard)/pregled/page.tsx`)**

Zamijeniti poziv komponente (zadnji red drugog grid-a). `getPredstojeciCount`/`predstojeci` OSTAJE (koristi se za KPI karticu "Predstojeći") — mijenja se SAMO šta se prosljeđuje `HitnoKasniList`:

```tsx
        <HitnoKasniList
          items={hitnoKasni}
          ukupnoKasni={stats.kasni}
          today={todayIso()}
        />
```

(`todayIso` je već importovan u ovom fajlu; `stats.kasni` već postoji.)

- [ ] **Step 6: Pokrenuti e2e — mora proći**

Run: `pnpm test:e2e tests/e2e/10-pregled.spec.ts`
Expected: PASS (uključujući 3 nova testa + postojeće "prikazuje 4 KPI… hitno/kasni listu" i "bez console grešaka").

- [ ] **Step 7: Gate**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 errors (2 postojeća warninga su OK).
Vizuelna provjera (kad se app digne ručno): redovi pokazuju "kasni X dana" crveno, klik otvara TerminSheet tog termina, footer "Svi kasni rokovi (N) →" vodi na filtriranu listu.

- [ ] **Step 8: Commit**

```bash
git add lib/termini.ts components/domain/HitnoKasniList.tsx "app/(dashboard)/pregled/page.tsx" tests/e2e/10-pregled.spec.ts
git commit -m "feat(pregled): Hitno/kasni akcijski — red→termin, relativni rok, lokacija, footer link"
```

---

## Pokrivenost 6 stavki (mapiranje)

| # | Stavka | Riješeno u |
|---|---|---|
| 1 🔴 | Klik vodi na klijenta, ne termin | Task 2 (red → `?selected=<id>`) |
| 2 🟡 | Lista↔footer nesklad | Task 2 (footer = "Svi kasni rokovi (N)", odgovara listi; predstojeći ostaje u KPI kartici) |
| 3 🟡 | Sirovi datum bez konteksta | Task 1 + Task 2 (relativna oznaka) |
| 4 🟡 | Footer mrtav `<p>` | Task 2 (footer je `<Link>` na `?status=kasni`) |
| 5 🟡 | Nema lokacije | Task 2 (`lokacija_naziv` u upitu + redu) |
| 6 🟡 | Nema prioriteta u listi | Task 1 + Task 2 (relativni broj dana pokazuje koliko je hitno) |

## Self-Review

**Spec coverage:** svih 6 stavki mapirano na Task 1/2 (tabela gore). ✓
**Placeholder scan:** nema TBD/TODO; sav kod konkretan. ✓
**Type consistency:** `rokRelativnaOznaka(rokIso, todayIso) → { text, tone }` definisan u Task 1, korišten u Task 2; `HitnoKasniItem` sa `lokacija_naziv` definisan u Task 2 Step 3, korišten u Step 4; `HitnoKasniList({ items, ukupnoKasni, today })` props usklađeni Step 4 ↔ Step 5. ✓
**Napomena za izvođača (provjeriti, nije placeholder):** potvrditi da `formatDatum` postoji u `lib/date.ts` (`grep -n "export function formatDatum" lib/date.ts`) — koristi se za tooltip.
