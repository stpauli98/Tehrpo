# Plan aktivnosti — modal za izvoz: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamijeniti dva "brza" izvoz dugmeta (Excel/PDF) jednim "Preuzmi" dugmetom koje otvara modal sa izborom formata (PDF/Excel), perioda (ovaj mjesec / cijela godina / određeni mjesec / prilagođeni raspon / sve), opsega (sve vs trenutno filtrirano) i živim brojem aktivnosti.

**Architecture:** Serverski PDF/Excel generatori ostaju netaknuti. Nova čista logika (period → datumski raspon, parsiranje parametara, label) živi u `lib/plan-izvoz/{period,params}.ts` i jedinično se testira. Postojeća `applyPlanFilteri` se cijepa na `applyPlanFilteriBezDatuma` + datum, da izvoz može nezavisno birati opseg i period. Postojeća API ruta se aditivno proširuje (novi `period`/`opseg`/`od`/`do`/`count` parametri; backward-compat kad `period` nedostaje). Klijentski modal (`PlanIzvozModal.tsx`) gradi query i pokreće download.

**Tech Stack:** Next.js 16 (App Router, `--webpack`), React 19, `@base-ui/react` (Dialog/Select/Button), next-intl (sr/en/de), Supabase (`termini_view`), vitest (unit), Playwright (e2e), `pdf-lib` + `exceljs` (generatori — bez izmjena).

## Global Constraints

- **Bez hardkodiranja brenda/firme** — naziv ide preko `APP_NAME` (`lib/brand.ts`); izvoz meta već koristi `APP_NAME`. Ne dodavati nove hardkodirane nazive.
- **i18n paritet OBAVEZAN** — svaki novi ključ mora postojati u `messages/sr.json`, `messages/en.json` i `messages/de.json` sa istom putanjom; `i18n/paritet.test.ts` pada inače. Default locale je `sr`.
- **ICU `one` zabranjen za `sr`** — ne koristiti plural `one` granu; ovaj plan izbjegava ICU plural u potpunosti (koristi `{broj}` interpolaciju).
- **Datumi po `datum_prikaza`** — svi datumski rasponi filtriraju `datum_prikaza` (ne `rok_dospijeca`), radi poklapanja sa kalendar/matrica prikazom.
- **Backward-compat rute** — ako `period` query param nedostaje, `/api/plan-aktivnosti/izvoz` mora raditi tačno kao dosad (legacy `mjesec`/`godina` + svi filteri).
- **Bez dummy podataka** — testovi koriste stvarne helpere/DEMO bazu (e2e), ne izmišljene fixture vrijednosti.
- **Runner komande:** unit `pnpm test:unit`, e2e `pnpm test:e2e`, lint `pnpm lint`, typecheck `pnpm typecheck`.

---

### Task 1: Period resolver (`lib/plan-izvoz/period.ts`)

Čista logika: tip perioda, validacija raspona, datumski raspon i ljudski label. Bez I/O, bez React — potpuno jedinično testabilno. Klijent i server ga dijele.

**Files:**
- Create: `lib/plan-izvoz/period.ts`
- Test: `lib/plan-izvoz/period.test.ts`

**Interfaces:**
- Consumes: `monthRange`, `periodRange`, `todayIso`, `monthName`, `formatDatum` iz `@/lib/date` (postojeći).
- Produces:
  - `type IzvozPeriod = { mod: "om" } | { mod: "god"; godina: number } | { mod: "mj"; godina: number; mjesec: number } | { mod: "raspon"; od: string; do: string } | { mod: "svi" }`
  - `validIsoDatum(s): s is string`
  - `validRaspon(od, doD): boolean`
  - `izvozPeriodRange(p: IzvozPeriod, danas?: string): { from: string; to: string } | null`
  - `izvozPeriodLabel(p: IzvozPeriod, sviLabel: string, danas?: string): string`

- [ ] **Step 1: Write the failing test**

Create `lib/plan-izvoz/period.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { validRaspon, izvozPeriodRange, izvozPeriodLabel, type IzvozPeriod } from "./period"

describe("validRaspon", () => {
  it("oba ISO i od<=do → true", () => {
    expect(validRaspon("2026-07-01", "2026-07-15")).toBe(true)
    expect(validRaspon("2026-07-15", "2026-07-15")).toBe(true)
  })
  it("od>do → false", () => expect(validRaspon("2026-07-16", "2026-07-15")).toBe(false))
  it("nedostaje/nevažeći → false", () => {
    expect(validRaspon(null, "2026-07-15")).toBe(false)
    expect(validRaspon("2026-07-01", "")).toBe(false)
    expect(validRaspon("07/01/2026", "2026-07-15")).toBe(false)
  })
})

describe("izvozPeriodRange", () => {
  it("om → tekući kalendarski mjesec (danas override)", () => {
    expect(izvozPeriodRange({ mod: "om" }, "2026-07-11")).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("god → cijela godina", () => {
    expect(izvozPeriodRange({ mod: "god", godina: 2026 })).toEqual({ from: "2026-01-01", to: "2026-12-31" })
  })
  it("mj → taj mjesec", () => {
    expect(izvozPeriodRange({ mod: "mj", godina: 2025, mjesec: 2 })).toEqual({ from: "2025-02-01", to: "2025-02-28" })
  })
  it("raspon → od/do direktno", () => {
    expect(izvozPeriodRange({ mod: "raspon", od: "2026-07-03", do: "2026-08-09" })).toEqual({ from: "2026-07-03", to: "2026-08-09" })
  })
  it("svi → null", () => expect(izvozPeriodRange({ mod: "svi" })).toBeNull())
})

describe("izvozPeriodLabel", () => {
  it("om → 'Jul 2026'", () => expect(izvozPeriodLabel({ mod: "om" }, "svi mjeseci", "2026-07-11")).toBe("Jul 2026"))
  it("god → '2026'", () => expect(izvozPeriodLabel({ mod: "god", godina: 2026 }, "svi mjeseci")).toBe("2026"))
  it("mj → 'Mart 2026'", () => expect(izvozPeriodLabel({ mod: "mj", godina: 2026, mjesec: 3 }, "svi mjeseci")).toBe("Mart 2026"))
  it("svi → injektovani label", () => expect(izvozPeriodLabel({ mod: "svi" }, "svi mjeseci")).toBe("svi mjeseci"))
  it("raspon → formatirani datumi", () => {
    const l = izvozPeriodLabel({ mod: "raspon", od: "2026-07-01", do: "2026-07-15" }, "svi mjeseci")
    expect(l).toContain("01.07.2026")
    expect(l).toContain("15.07.2026")
    expect(l).toContain("–")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit lib/plan-izvoz/period.test.ts`
Expected: FAIL — `Cannot find module './period'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/plan-izvoz/period.ts`:

```ts
import { monthRange, periodRange, todayIso, monthName, formatDatum } from "@/lib/date"

/** Način izbora perioda za izvoz. */
export type IzvozPeriod =
  | { mod: "om" }
  | { mod: "god"; godina: number }
  | { mod: "mj"; godina: number; mjesec: number }
  | { mod: "raspon"; od: string; do: string }
  | { mod: "svi" }

/** Striktni ISO YYYY-MM-DD. */
export function validIsoDatum(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/** Raspon je validan kad su oba ISO i od <= do (leksikografsko poređenje radi za ISO). */
export function validRaspon(od: string | null | undefined, doD: string | null | undefined): boolean {
  return validIsoDatum(od) && validIsoDatum(doD) && od <= doD
}

/** Datumski raspon za odabrani period; null = bez vremenskog ograničenja. `danas` je ISO override za test. */
export function izvozPeriodRange(p: IzvozPeriod, danas?: string): { from: string; to: string } | null {
  switch (p.mod) {
    case "om": {
      const iso = danas ?? todayIso()
      return monthRange(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)))
    }
    case "god": {
      const r = periodRange("godina", p.godina)
      return { from: r.od, to: r.do }
    }
    case "mj":
      return monthRange(p.godina, p.mjesec)
    case "raspon":
      return { from: p.od, to: p.do }
    case "svi":
      return null
  }
}

/** Ljudski čitljiv label perioda (PDF/Excel podnaslov + naziv fajla). `sviLabel` = prevod za "svi mjeseci". */
export function izvozPeriodLabel(p: IzvozPeriod, sviLabel: string, danas?: string): string {
  switch (p.mod) {
    case "om": {
      const iso = danas ?? todayIso()
      return `${monthName(Number(iso.slice(5, 7)))} ${Number(iso.slice(0, 4))}`
    }
    case "god":
      return String(p.godina)
    case "mj":
      return `${monthName(p.mjesec)} ${p.godina}`
    case "raspon":
      return `${formatDatum(p.od)}–${formatDatum(p.do)}`
    case "svi":
      return sviLabel
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit lib/plan-izvoz/period.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/plan-izvoz/period.ts lib/plan-izvoz/period.test.ts
git commit -m "feat(izvoz): period resolver (raspon validacija, datumski raspon, label)"
```

---

### Task 2: Parametri izvoza (`lib/plan-izvoz/params.ts`)

Čisto parsiranje `URLSearchParams` → strukturirani izbor (format, opseg, period ili legacy, count flag, validaciona greška). Route ga koristi kao jedinu tačku parsiranja.

**Files:**
- Create: `lib/plan-izvoz/params.ts`
- Test: `lib/plan-izvoz/params.test.ts`

**Interfaces:**
- Consumes: `validRaspon`, `type IzvozPeriod` iz Task 1; `currentYear` iz `@/lib/date`.
- Produces:
  - `type IzvozFormat = "pdf" | "xlsx"`
  - `type IzvozOpseg = "sve" | "filtrirano"`
  - `type IzvozParams = { ok: true; legacy: true; format: IzvozFormat; count: boolean } | { ok: true; legacy: false; format: IzvozFormat; opseg: IzvozOpseg; period: IzvozPeriod; count: boolean } | { ok: false; greska: "raspon" }`
  - `parseIzvozParams(sp: URLSearchParams): IzvozParams`

- [ ] **Step 1: Write the failing test**

Create `lib/plan-izvoz/params.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { parseIzvozParams } from "./params"
import { currentYear } from "@/lib/date"

describe("parseIzvozParams", () => {
  it("bez 'period' → legacy grana, format default xlsx", () => {
    const r = parseIzvozParams(new URLSearchParams(""))
    expect(r).toEqual({ ok: true, legacy: true, format: "xlsx", count: false })
  })
  it("legacy zadrži format=pdf i count", () => {
    const r = parseIzvozParams(new URLSearchParams("format=pdf&count=1"))
    expect(r).toEqual({ ok: true, legacy: true, format: "pdf", count: true })
  })
  it("period=om → default opseg 'sve'", () => {
    const r = parseIzvozParams(new URLSearchParams("period=om"))
    expect(r).toMatchObject({ ok: true, legacy: false, opseg: "sve", period: { mod: "om" } })
  })
  it("period=god čita godinu; default godina = tekuća", () => {
    expect(parseIzvozParams(new URLSearchParams("period=god&godina=2025"))).toMatchObject({ period: { mod: "god", godina: 2025 } })
    expect(parseIzvozParams(new URLSearchParams("period=god"))).toMatchObject({ period: { mod: "god", godina: currentYear() } })
  })
  it("period=mj čita mjesec+godinu; nevažeći mjesec → 1", () => {
    expect(parseIzvozParams(new URLSearchParams("period=mj&mjesec=3&godina=2026"))).toMatchObject({ period: { mod: "mj", mjesec: 3, godina: 2026 } })
    expect(parseIzvozParams(new URLSearchParams("period=mj&mjesec=99"))).toMatchObject({ period: { mod: "mj", mjesec: 1 } })
  })
  it("period=raspon validan → period raspon; opseg=filtrirano se poštuje", () => {
    const r = parseIzvozParams(new URLSearchParams("period=raspon&od=2026-07-01&do=2026-07-31&opseg=filtrirano"))
    expect(r).toMatchObject({ ok: true, legacy: false, opseg: "filtrirano", period: { mod: "raspon", od: "2026-07-01", do: "2026-07-31" } })
  })
  it("period=raspon nevažeći (od>do ili prazan) → greška", () => {
    expect(parseIzvozParams(new URLSearchParams("period=raspon&od=2026-07-31&do=2026-07-01"))).toEqual({ ok: false, greska: "raspon" })
    expect(parseIzvozParams(new URLSearchParams("period=raspon&od=2026-07-01"))).toEqual({ ok: false, greska: "raspon" })
  })
  it("period=svi → mod svi", () => {
    expect(parseIzvozParams(new URLSearchParams("period=svi"))).toMatchObject({ period: { mod: "svi" } })
  })
  it("nepoznat period → fallback om", () => {
    expect(parseIzvozParams(new URLSearchParams("period=xyz"))).toMatchObject({ period: { mod: "om" } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit lib/plan-izvoz/params.test.ts`
Expected: FAIL — `Cannot find module './params'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/plan-izvoz/params.ts`:

```ts
import { currentYear } from "@/lib/date"
import { validRaspon, type IzvozPeriod } from "@/lib/plan-izvoz/period"

export type IzvozFormat = "pdf" | "xlsx"
export type IzvozOpseg = "sve" | "filtrirano"

export type IzvozParams =
  | { ok: true; legacy: true; format: IzvozFormat; count: boolean }
  | { ok: true; legacy: false; format: IzvozFormat; opseg: IzvozOpseg; period: IzvozPeriod; count: boolean }
  | { ok: false; greska: "raspon" }

export function parseIzvozParams(sp: URLSearchParams): IzvozParams {
  const format: IzvozFormat = sp.get("format") === "pdf" ? "pdf" : "xlsx"
  const count = sp.get("count") === "1"
  const periodParam = sp.get("period")

  // Backward-compat: bez 'period' param → stara ruta (parsePlanFilteri + applyPlanFilteri).
  if (!periodParam) return { ok: true, legacy: true, format, count }

  const opseg: IzvozOpseg = sp.get("opseg") === "filtrirano" ? "filtrirano" : "sve"
  const godina = Number(sp.get("godina")) || currentYear()

  let period: IzvozPeriod
  switch (periodParam) {
    case "god":
      period = { mod: "god", godina }
      break
    case "mj": {
      const m = Number(sp.get("mjesec"))
      period = { mod: "mj", godina, mjesec: m >= 1 && m <= 12 ? m : 1 }
      break
    }
    case "raspon": {
      const od = sp.get("od")
      const doD = sp.get("do")
      if (!validRaspon(od, doD)) return { ok: false, greska: "raspon" }
      period = { mod: "raspon", od, do: doD }
      break
    }
    case "svi":
      period = { mod: "svi" }
      break
    case "om":
    default:
      period = { mod: "om" }
      break
  }
  return { ok: true, legacy: false, format, opseg, period, count }
}
```

Napomena: nakon `validRaspon(od, doD)` TypeScript zna da su `od`/`doD` `string` (type guard `s is string`), pa dodjela ne treba `!`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit lib/plan-izvoz/params.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/plan-izvoz/params.ts lib/plan-izvoz/params.test.ts
git commit -m "feat(izvoz): parseIzvozParams (format/opseg/period/count + legacy + validacija)"
```

---

### Task 3: Cijepanje primjene filtera (`lib/plan-filteri.ts`)

Izdvoji ne-datumske filtere u `applyPlanFilteriBezDatuma` da izvoz može period birati nezavisno; `applyPlanFilteri` se refaktoriše da ga koristi (identično ponašanje — lista ruta i postojeći testovi ostaju zeleni).

**Files:**
- Modify: `lib/plan-filteri.ts:44-61` (refaktor `applyPlanFilteri`, dodaj `applyPlanFilteriBezDatuma`)
- Test: `lib/plan-filteri.test.ts` (dodaj describe blok; postojeći ostaju)

**Interfaces:**
- Consumes: `PlanFilteri`, `mjesecRange` (postojeći u istom fajlu).
- Produces: `applyPlanFilteriBezDatuma<Q>(q: Q, f: PlanFilteri): Q` — primjenjuje status/q/klijentId/lokacijaId/vrstaId/nacin, BEZ `datum_prikaza`.

- [ ] **Step 1: Write the failing test**

Dodaj na kraj `lib/plan-filteri.test.ts` (uz postojeći import — proširi ga na `applyPlanFilteriBezDatuma`):

```ts
// Proširi postojeći import na vrhu fajla:
// import { parsePlanFilteri, mjesecRange, applyPlanFilteri, applyPlanFilteriBezDatuma, type PlanFilteri } from "./plan-filteri"

describe("applyPlanFilteriBezDatuma", () => {
  const base: PlanFilteri = { status: "svi", q: "", klijentId: "", lokacijaId: "", vrstaId: "", mjesec: "7", godina: 2026, nacin: "svi" }
  function mockQ() {
    const calls: [string, unknown][] = []
    const q: Record<string, (...a: unknown[]) => unknown> = {}
    for (const m of ["eq", "or", "gte", "lte"]) q[m] = (...a: unknown[]) => { calls.push([m, a]); return q }
    return { q, calls }
  }
  it("primjenjuje ne-datumske filtere ali NIKAD gte/lte (čak i uz mjesec=7)", () => {
    const { q, calls } = mockQ()
    applyPlanFilteriBezDatuma(q as never, { ...base, status: "kasni", klijentId: "K1" })
    expect(calls).toContainEqual(["eq", ["status_izvedeni", "kasni"]])
    expect(calls).toContainEqual(["eq", ["klijent_id", "K1"]])
    expect(calls.some(([m]) => m === "gte" || m === "lte")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit lib/plan-filteri.test.ts`
Expected: FAIL — `applyPlanFilteriBezDatuma is not exported` (import/reference error).

- [ ] **Step 3: Write minimal implementation**

U `lib/plan-filteri.ts` zamijeni tijelo `applyPlanFilteri` (linije ~44–61) ovim (dodaje novu funkciju + refaktoriše postojeću da je koristi):

```ts
/** Ne-datumski filteri (status/pretraga/klijent/lokacija/vrsta/nacin). Dijele lista i izvoz. */
export function applyPlanFilteriBezDatuma<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Q extends PostgrestFilterBuilder<any, any, any, any, any>,
>(q: Q, f: PlanFilteri): Q {
  let out = q
  if (f.status && f.status !== "svi") out = out.eq("status_izvedeni", f.status)
  if (f.q) {
    const safe = f.q.replace(/[(),]/g, " ")
    out = out.or(`klijent_naziv.ilike.%${safe}%,lokacija_naziv.ilike.%${safe}%`)
  }
  if (f.klijentId) out = out.eq("klijent_id", f.klijentId)
  if (f.lokacijaId) out = out.eq("lokacija_id", f.lokacijaId)
  if (f.vrstaId) out = out.eq("vrsta_provjere_id", f.vrstaId)
  if (f.nacin !== "svi") out = out.eq("nacin_izvrsenja", f.nacin)
  return out
}

/** Primjenjuje sve plan-filtere (ne-datumske + mjesec-raspon) na termini_view upit (DRY: lista + izvoz legacy). */
export function applyPlanFilteri<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Q extends PostgrestFilterBuilder<any, any, any, any, any>,
>(q: Q, f: PlanFilteri): Q {
  let out = applyPlanFilteriBezDatuma(q, f)
  const r = mjesecRange(f)
  if (r) out = out.gte("datum_prikaza", r.from).lte("datum_prikaza", r.to)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes (i da nema regresije)**

Run: `pnpm test:unit lib/plan-filteri.test.ts`
Expected: PASS — novi blok + svi postojeći `applyPlanFilteri`/`parsePlanFilteri`/`mjesecRange` testovi.

- [ ] **Step 5: Commit**

```bash
git add lib/plan-filteri.ts lib/plan-filteri.test.ts
git commit -m "refactor(plan-filteri): izdvoji applyPlanFilteriBezDatuma (izvoz bira period nezavisno)"
```

---

### Task 4: Proširenje API rute (`app/api/plan-aktivnosti/izvoz/route.ts`)

Ruta koristi `parseIzvozParams`; grana na legacy (nepromijenjeno) i novo (opseg + period + count). PDF/Excel poziv nepromijenjen. Deliverable se verifikuje kroz typecheck/lint/build + jedinično testirane pod-jedinice (Task 1–3); ponašanje kroz e2e (Task 6).

**Files:**
- Modify: `app/api/plan-aktivnosti/izvoz/route.ts` (cijela `GET` funkcija + import + `periodLabel`)

**Interfaces:**
- Consumes: `parseIzvozParams` (Task 2), `izvozPeriodRange` + `izvozPeriodLabel` (Task 1), `parsePlanFilteri` + `applyPlanFilteri` + `applyPlanFilteriBezDatuma` (Task 3), postojeći `planToPdf`/`planToXlsx`/`periodLabel` helperi.
- Produces: `GET` koji vraća fajl (`Content-Disposition: attachment`) ili — uz `?count=1` — JSON `{ broj: number }`; `400 { greska }` na nevažeći raspon.

- [ ] **Step 1: Napiši implementaciju (route glue — bez zasebnog unit testa; pokriveno e2e + typecheck)**

Zamijeni `app/api/plan-aktivnosti/izvoz/route.ts` sljedećim (zadržava postojeći `periodLabel` za legacy, dodaje novo):

```ts
import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, applyPlanFilteri, applyPlanFilteriBezDatuma } from "@/lib/plan-filteri"
import { parseIzvozParams } from "@/lib/plan-izvoz/params"
import { izvozPeriodRange, izvozPeriodLabel } from "@/lib/plan-izvoz/period"
import { planToXlsx } from "@/lib/plan-izvoz/xlsx"
import { planToPdf } from "@/lib/plan-izvoz/pdf"
import type { PlanRed } from "@/lib/plan-izvoz/types"
import { formatDatum, monthName, tekuciNarednomMjesecuRange } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { APP_NAME } from "@/lib/brand"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const tStatus = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "status" })
const tIzvoz = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "izvoz.plan" })

/** Legacy label (mjesec=tn/svi/1-12) — zadržan radi backward-compat. */
function legacyPeriodLabel(mjesec: string, godina: number): string {
  if (mjesec === "tn") {
    const { from, to } = tekuciNarednomMjesecuRange()
    const fromY = Number(from.slice(0, 4))
    const fromM = Number(from.slice(5, 7))
    const toY = Number(to.slice(0, 4))
    const toM = Number(to.slice(5, 7))
    if (fromY === toY) return `${monthName(fromM)}–${monthName(toM)} ${fromY}`
    return `${monthName(fromM)} ${fromY} – ${monthName(toM)} ${toY}`
  }
  if (mjesec === "svi") return tIzvoz("sviMjeseci")
  const mn = Number(mjesec)
  return mn >= 1 && mn <= 12 ? `${monthName(mn)} ${godina}` : tIzvoz("sviMjeseci")
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const parsed = parseIzvozParams(sp)
  if (!parsed.ok) {
    return NextResponse.json({ greska: tIzvoz("raspon.nevazeci") }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()

  // Count grana: samo broj (head), bez povlačenja redova.
  if (parsed.count) {
    let cq = supabase.from("termini_view").select("*", { count: "exact", head: true })
    if (parsed.legacy) {
      cq = applyPlanFilteri(cq, parsePlanFilteri(sp))
    } else {
      if (parsed.opseg === "filtrirano") cq = applyPlanFilteriBezDatuma(cq, parsePlanFilteri(sp))
      const r = izvozPeriodRange(parsed.period)
      if (r) cq = cq.gte("datum_prikaza", r.from).lte("datum_prikaza", r.to)
    }
    const { count, error } = await cq
    if (error) return NextResponse.json({ greska: error.message }, { status: 500 })
    return NextResponse.json({ broj: count ?? 0 })
  }

  // Fajl grana.
  let q = supabase.from("termini_view").select("*").order("datum_prikaza", { ascending: true })
  let period: string
  if (parsed.legacy) {
    const f = parsePlanFilteri(sp)
    q = applyPlanFilteri(q, f)
    period = legacyPeriodLabel(f.mjesec, f.godina)
  } else {
    if (parsed.opseg === "filtrirano") q = applyPlanFilteriBezDatuma(q, parsePlanFilteri(sp))
    const r = izvozPeriodRange(parsed.period)
    if (r) q = q.gte("datum_prikaza", r.from).lte("datum_prikaza", r.to)
    period = izvozPeriodLabel(parsed.period, tIzvoz("sviMjeseci"))
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ greska: error.message }, { status: 500 })

  const rows: PlanRed[] = (data ?? []).map((red) => ({
    klijent: red.klijent_naziv ?? "—",
    lokacija: red.lokacija_naziv ?? "—",
    usluga: red.vrsta_naziv ?? "—",
    rok: formatDatum(red.rok_dospijeca),
    status: tStatus(toDerivedStatus(red.status_izvedeni)),
    periodikaMj: red.interval_mjeseci ?? null,
    odgovorna: red.zaduzeni ?? "—",
    nacin: red.nacin_izvrsenja === "pracenje" ? tIzvoz("nacin.pracenje") : tIzvoz("nacin.izvrsava"),
  }))

  const meta = { naslov: APP_NAME, period }
  let buf: Buffer
  try {
    buf = parsed.format === "pdf" ? await planToPdf(rows, meta) : await planToXlsx(rows, meta)
  } catch (e) {
    const message = e instanceof Error ? e.message : tIzvoz("greska")
    return NextResponse.json({ greska: tIzvoz("greskaGenerisanje", { poruka: message }) }, { status: 500 })
  }
  const ext = parsed.format === "pdf" ? "pdf" : "xlsx"
  const ct = parsed.format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  const slug = meta.period.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": ct, "Content-Disposition": `attachment; filename="plan-aktivnosti-${slug}.${ext}"` },
  })
}
```

> Napomena: raniji kod je vraćao `{ error }`; ovdje je ključ `{ greska }` radi konzistentnosti sa novom 400 porukom. Ako neki potrošač zavisi od `error`, zadrži `error`. Provjeri: `grep -rn "izvoz" --include=*.tsx components app | grep -i "\.error"` (očekivano: nema potrošača koji čita JSON grešku — dugmad su bila obična linkovanja).

- [ ] **Step 2: Dodaj i18n ključ `izvoz.plan.raspon.nevazeci` (sva 3 jezika)**

U `messages/sr.json` → `izvoz.plan` blok dodaj:
```json
"raspon": { "nevazeci": "Nevažeći raspon datuma (od mora biti ≤ do)." }
```
U `messages/en.json` → `izvoz.plan`:
```json
"raspon": { "nevazeci": "Invalid date range (from must be ≤ to)." }
```
U `messages/de.json` → `izvoz.plan`:
```json
"raspon": { "nevazeci": "Ungültiger Datumsbereich (von muss ≤ bis sein)." }
```

- [ ] **Step 3: Verifikuj typecheck + lint + i18n paritet + postojeći generator testovi**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit i18n/paritet.test.ts lib/plan-izvoz`
Expected: sve PASS (paritet zelen jer je ključ dodat u sva 3 jezika; pdf/xlsx generator testovi nepromijenjeni).

- [ ] **Step 4: Ručna provjera legacy + novih grana (dev server)**

Run: `pnpm dev` pa u browseru (ili curl):
- Legacy fajl: `/api/plan-aktivnosti/izvoz?format=xlsx` → skida .xlsx (kao prije).
- Novi count: `/api/plan-aktivnosti/izvoz?count=1&period=om&opseg=sve` → JSON `{ "broj": N }`.
- Nevažeći raspon: `/api/plan-aktivnosti/izvoz?period=raspon&od=2026-07-31&do=2026-07-01` → `400 { "greska": ... }`.
Expected: kako opisano.

- [ ] **Step 5: Commit**

```bash
git add app/api/plan-aktivnosti/izvoz/route.ts messages/sr.json messages/en.json messages/de.json
git commit -m "feat(izvoz): API podržava period/opseg/count + backward-compat legacy grana"
```

---

### Task 5: Modal komponenta + zamjena dugmadi (`PlanIzvozModal.tsx`)

Jedno "Preuzmi" dugme → `Dialog` sa format/period/opseg izborom, "Prilagodi" sekcijom i živim brojem. Zamjenjuje `PlanIzvozDugmad`. Bez RTL u repou → verifikacija kroz typecheck/lint/build; ponašanje kroz e2e (Task 6).

**Files:**
- Create: `components/domain/PlanIzvozModal.tsx`
- Delete: `components/domain/PlanIzvozDugmad.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/page.tsx:5` (import), `:44` (render)
- Modify: `messages/{sr,en,de}.json` → `plan.izvoz` blok (novi ključevi)

**Interfaces:**
- Consumes: `validRaspon` iz `@/lib/plan-izvoz/period` (klijent-safe, pure); `useSearchParams` (trenutni filteri); `Dialog*`, `Select*`, `Button`, `Input` iz `@/components/ui/*`; `monthName`, `currentYear` iz `@/lib/date`.
- Produces: `export function PlanIzvozModal()` (client komponenta bez propsa; čita filtere iz URL-a).

- [ ] **Step 1: Zamijeni `plan.izvoz` i18n blok (sva 3 jezika)**

U `messages/sr.json` zamijeni postojeći `plan.izvoz` (linije ~670–673 `{"excel","pdf"}`) ovim:
```json
"izvoz": {
  "preuzmi": "Preuzmi",
  "naslovModala": "Preuzmi izvještaj",
  "format": "Format",
  "formatPdf": "PDF",
  "formatExcel": "Excel",
  "period": "Period",
  "periodOvajMjesec": "Ovaj mjesec",
  "periodGodina": "Cijela godina",
  "periodMjesec": "Određeni mjesec",
  "periodRaspon": "Prilagođeni raspon",
  "periodSvi": "Sve (bez vremenskog ograničenja)",
  "od": "Od",
  "do": "Do",
  "opseg": "Opseg",
  "opsegSve": "Sve aktivnosti",
  "opsegFiltrirano": "Samo trenutno filtrirano",
  "filteriPrimijenjeni": "Filteri sa stranice su primijenjeni",
  "nemaFiltera": "Nema aktivnih filtera na stranici",
  "prilagodi": "Prilagodi",
  "sakrij": "Sakrij",
  "brojAktivnosti": "Izvešće se {broj} aktivnosti",
  "racunam": "Računam…",
  "greskaBroj": "Broj trenutno nedostupan"
}
```
U `messages/en.json` (`plan.izvoz`):
```json
"izvoz": {
  "preuzmi": "Download",
  "naslovModala": "Download report",
  "format": "Format",
  "formatPdf": "PDF",
  "formatExcel": "Excel",
  "period": "Period",
  "periodOvajMjesec": "This month",
  "periodGodina": "Whole year",
  "periodMjesec": "Specific month",
  "periodRaspon": "Custom range",
  "periodSvi": "All (no time limit)",
  "od": "From",
  "do": "To",
  "opseg": "Scope",
  "opsegSve": "All activities",
  "opsegFiltrirano": "Only currently filtered",
  "filteriPrimijenjeni": "Page filters are applied",
  "nemaFiltera": "No active page filters",
  "prilagodi": "Customize",
  "sakrij": "Hide",
  "brojAktivnosti": "{broj} activities will be exported",
  "racunam": "Calculating…",
  "greskaBroj": "Count currently unavailable"
}
```
U `messages/de.json` (`plan.izvoz`):
```json
"izvoz": {
  "preuzmi": "Herunterladen",
  "naslovModala": "Bericht herunterladen",
  "format": "Format",
  "formatPdf": "PDF",
  "formatExcel": "Excel",
  "period": "Zeitraum",
  "periodOvajMjesec": "Dieser Monat",
  "periodGodina": "Ganzes Jahr",
  "periodMjesec": "Bestimmter Monat",
  "periodRaspon": "Benutzerdefinierter Bereich",
  "periodSvi": "Alle (ohne Zeitlimit)",
  "od": "Von",
  "do": "Bis",
  "opseg": "Umfang",
  "opsegSve": "Alle Aktivitäten",
  "opsegFiltrirano": "Nur aktuell gefiltert",
  "filteriPrimijenjeni": "Seitenfilter werden angewendet",
  "nemaFiltera": "Keine aktiven Seitenfilter",
  "prilagodi": "Anpassen",
  "sakrij": "Ausblenden",
  "brojAktivnosti": "{broj} Aktivitäten werden exportiert",
  "racunam": "Wird berechnet…",
  "greskaBroj": "Anzahl derzeit nicht verfügbar"
}
```

- [ ] **Step 2: Kreiraj `components/domain/PlanIzvozModal.tsx`**

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Download } from "lucide-react"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { currentYear, monthName, todayIso } from "@/lib/date"
import { validRaspon } from "@/lib/plan-izvoz/period"

type PeriodMod = "om" | "god" | "mj" | "raspon" | "svi"
const FILTER_KEYS = ["status", "q", "klijent_id", "lokacija", "vrsta_id", "nacin"] as const

export function PlanIzvozModal() {
  const params = useSearchParams()
  const t = useTranslations("plan.izvoz")

  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<"pdf" | "xlsx">("pdf")
  const [prilagodi, setPrilagodi] = useState(false)
  const [periodMod, setPeriodMod] = useState<PeriodMod>("om")
  const [godina, setGodina] = useState<number>(currentYear())
  const [mjesec, setMjesec] = useState<number>(Number(todayIso().slice(5, 7)))
  const [od, setOd] = useState("")
  const [doDatum, setDoDatum] = useState("")
  const [opseg, setOpseg] = useState<"sve" | "filtrirano">("sve")
  const [broj, setBroj] = useState<number | "loading" | null>(null)

  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]
  const rasponNevazeci = periodMod === "raspon" && !validRaspon(od, doDatum)

  const aktivniFilteri = useMemo(
    () => FILTER_KEYS.filter((k) => params.get(k)),
    [params]
  )

  // Gradi query za izvoz/count. forCount: doda count=1, izostavi format.
  function buildParams(forCount: boolean): URLSearchParams {
    const p = new URLSearchParams()
    if (forCount) p.set("count", "1")
    else p.set("format", format)
    p.set("period", periodMod)
    p.set("opseg", opseg)
    if (periodMod === "god" || periodMod === "mj") p.set("godina", String(godina))
    if (periodMod === "mj") p.set("mjesec", String(mjesec))
    if (periodMod === "raspon") { p.set("od", od); p.set("do", doDatum) }
    if (opseg === "filtrirano") {
      for (const k of FILTER_KEYS) { const v = params.get(k); if (v) p.set(k, v) }
    }
    return p
  }

  // Živi broj — debounce; ne zavisi od formata. Preskoči kad je raspon nevažeći.
  const filterKljuc = FILTER_KEYS.map((k) => params.get(k) ?? "").join("|")
  useEffect(() => {
    if (!open) return
    if (rasponNevazeci) { setBroj(null); return }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setBroj("loading")
      try {
        const res = await fetch(`/api/plan-aktivnosti/izvoz?${buildParams(true).toString()}`, { signal: ctrl.signal })
        if (!res.ok) throw new Error("count")
        const data = (await res.json()) as { broj?: number }
        setBroj(typeof data.broj === "number" ? data.broj : null)
      } catch {
        if (!ctrl.signal.aborted) setBroj(null)
      }
    }, 300)
    return () => { ctrl.abort(); clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, periodMod, godina, mjesec, od, doDatum, opseg, filterKljuc, rasponNevazeci])

  function preuzmi() {
    if (rasponNevazeci) return
    window.location.assign(`/api/plan-aktivnosti/izvoz?${buildParams(false).toString()}`)
    setOpen(false)
  }

  const brojTekst =
    broj === "loading" ? t("racunam")
    : broj === null ? t("greskaBroj")
    : t("brojAktivnosti", { broj })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="icon-lg" aria-label={t("preuzmi")} data-testid="izvoz-trigger" />
        }
      >
        <Download className="h-[18px] w-[18px]" aria-hidden />
      </DialogTrigger>

      <DialogContent className="max-w-md" data-testid="izvoz-modal">
        <DialogHeader>
          <DialogTitle>{t("naslovModala")}</DialogTitle>
        </DialogHeader>

        {/* Format */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("format")}</span>
          <div className="flex gap-2">
            <Button
              type="button" variant={format === "pdf" ? "default" : "outline"} size="sm"
              aria-pressed={format === "pdf"} data-testid="izvoz-format-pdf"
              onClick={() => setFormat("pdf")}
            >{t("formatPdf")}</Button>
            <Button
              type="button" variant={format === "xlsx" ? "default" : "outline"} size="sm"
              aria-pressed={format === "xlsx"} data-testid="izvoz-format-xlsx"
              onClick={() => setFormat("xlsx")}
            >{t("formatExcel")}</Button>
          </div>
        </div>

        {/* Period: sažeto vs prilagođeno */}
        {!prilagodi ? (
          <div className="flex items-center justify-between text-sm">
            <span><span className="text-muted-foreground">{t("period")}: </span>{t("periodOvajMjesec")}</span>
            <button
              type="button" className="text-primary hover:underline text-sm"
              data-testid="izvoz-prilagodi"
              onClick={() => { setPeriodMod("om"); setPrilagodi(true) }}
            >▸ {t("prilagodi")}</button>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2" data-testid="izvoz-period">
              <legend className="text-xs font-medium text-muted-foreground mb-1">{t("period")}</legend>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "om"} onChange={() => setPeriodMod("om")} data-testid="izvoz-period-om" />
                {t("periodOvajMjesec")}
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "god"} onChange={() => setPeriodMod("god")} data-testid="izvoz-period-god" />
                {t("periodGodina")}
                {periodMod === "god" && (
                  <Select value={String(godina)} onValueChange={(v) => setGodina(Number(v))}>
                    <SelectTrigger size="sm" className="w-24" data-testid="izvoz-godina"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "mj"} onChange={() => setPeriodMod("mj")} data-testid="izvoz-period-mj" />
                {t("periodMjesec")}
                {periodMod === "mj" && (
                  <>
                    <Select value={String(mjesec)} onValueChange={(v) => setMjesec(Number(v))}>
                      <SelectTrigger size="sm" className="w-32" data-testid="izvoz-mjesec"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={String(godina)} onValueChange={(v) => setGodina(Number(v))}>
                      <SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "raspon"} onChange={() => setPeriodMod("raspon")} data-testid="izvoz-period-raspon" />
                {t("periodRaspon")}
              </label>
              {periodMod === "raspon" && (
                <div className="flex items-center gap-2 pl-6 text-sm">
                  <span className="text-muted-foreground">{t("od")}</span>
                  <Input type="date" value={od} onChange={(e) => setOd(e.target.value)} className="w-40" data-testid="izvoz-od" />
                  <span className="text-muted-foreground">{t("do")}</span>
                  <Input type="date" value={doDatum} onChange={(e) => setDoDatum(e.target.value)} className="w-40" data-testid="izvoz-do" />
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-period" checked={periodMod === "svi"} onChange={() => setPeriodMod("svi")} data-testid="izvoz-period-svi" />
                {t("periodSvi")}
              </label>
            </fieldset>

            {/* Opseg */}
            <fieldset className="flex flex-col gap-2" data-testid="izvoz-opseg">
              <legend className="text-xs font-medium text-muted-foreground mb-1">{t("opseg")}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-opseg" checked={opseg === "sve"} onChange={() => setOpseg("sve")} data-testid="izvoz-opseg-sve" />
                {t("opsegSve")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="izvoz-opseg" checked={opseg === "filtrirano"} onChange={() => setOpseg("filtrirano")} data-testid="izvoz-opseg-filtrirano" />
                {t("opsegFiltrirano")}
              </label>
              {opseg === "filtrirano" && (
                <p className="pl-6 text-xs text-muted-foreground">
                  {aktivniFilteri.length > 0 ? t("filteriPrimijenjeni") : t("nemaFiltera")}
                </p>
              )}
            </fieldset>

            <button
              type="button" className="text-primary hover:underline text-sm self-start"
              data-testid="izvoz-sakrij"
              onClick={() => setPrilagodi(false)}
            >▾ {t("sakrij")}</button>
          </>
        )}

        {/* Živi broj + akcija */}
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground" data-testid="izvoz-broj">{brojTekst}</span>
          <Button type="button" onClick={preuzmi} disabled={rasponNevazeci} data-testid="izvoz-preuzmi">
            <Download className="h-4 w-4" aria-hidden /> {t("preuzmi")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Zamijeni komponentu u `page.tsx`**

U `app/(dashboard)/plan-aktivnosti/page.tsx`:
- Linija 5: `import { PlanIzvozDugmad } from "@/components/domain/PlanIzvozDugmad"` → `import { PlanIzvozModal } from "@/components/domain/PlanIzvozModal"`
- Linija 44: `<Suspense fallback={null}><PlanIzvozDugmad /></Suspense>` → `<Suspense fallback={null}><PlanIzvozModal /></Suspense>`

- [ ] **Step 4: Obriši staru komponentu**

```bash
git rm components/domain/PlanIzvozDugmad.tsx
```

- [ ] **Step 5: Verifikuj typecheck + lint + i18n paritet + build**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit i18n/paritet.test.ts && pnpm build`
Expected: sve PASS. (Ako `DialogTrigger render=` tipizacija prijavi grešku, koristi kontrolisani obrazac: ostavi `<DialogTrigger>` bez render i umjesto njega `<Button onClick={() => setOpen(true)} …>` iznad `<Dialog>`; base-ui `Dialog` je već kontrolisan preko `open`/`onOpenChange`.)

- [ ] **Step 6: Commit**

```bash
git add components/domain/PlanIzvozModal.tsx app/(dashboard)/plan-aktivnosti/page.tsx messages/sr.json messages/en.json messages/de.json
git rm components/domain/PlanIzvozDugmad.tsx
git commit -m "feat(izvoz): PlanIzvozModal (format/period/opseg + živi broj) zamjenjuje dugmad"
```

---

### Task 6: E2E test (`tests/e2e/20-plan-aktivnosti.spec.ts`)

Doda scenario za modal: otvaranje, default, "Prilagodi" otkriva opcije, promjena perioda mijenja broj, "Preuzmi" pokreće download.

**Files:**
- Modify: `tests/e2e/20-plan-aktivnosti.spec.ts` (dodaj `test.describe` blok na kraj)

**Interfaces:**
- Consumes: testid-ovi iz Task 5 (`izvoz-trigger`, `izvoz-modal`, `izvoz-format-*`, `izvoz-prilagodi`, `izvoz-period-*`, `izvoz-broj`, `izvoz-preuzmi`).

- [ ] **Step 1: Napiši e2e test**

Dodaj na kraj `tests/e2e/20-plan-aktivnosti.spec.ts` (unutar istog fajla, novi describe):

```ts
test.describe("Plan aktivnosti — izvoz modal", () => {
  test("otvara modal, default period, Prilagodi otkriva opcije", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await expect(page.getByTestId("izvoz-modal")).toBeVisible()
    // Prilagodi skriveno na početku
    await expect(page.getByTestId("izvoz-period")).toHaveCount(0)
    await page.getByTestId("izvoz-prilagodi").click()
    await expect(page.getByTestId("izvoz-period")).toBeVisible()
    await expect(page.getByTestId("izvoz-period-om")).toBeChecked()
    // Živi broj se prikaže (bilo koji tekst)
    await expect(page.getByTestId("izvoz-broj")).not.toHaveText("")
  })

  test("Preuzmi pokreće download (Excel)", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-format-xlsx").click()
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("izvoz-preuzmi").click(),
    ])
    expect(download.suggestedFilename()).toMatch(/plan-aktivnosti-.*\.xlsx$/)
  })

  test("prilagođeni raspon: nevažeći datumi drže Preuzmi onemogućen", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-prilagodi").click()
    await page.getByTestId("izvoz-period-raspon").check()
    await page.getByTestId("izvoz-od").fill("2026-07-31")
    await page.getByTestId("izvoz-do").fill("2026-07-01")
    await expect(page.getByTestId("izvoz-preuzmi")).toBeDisabled()
  })
})
```

- [ ] **Step 2: Pokreni e2e (traži pokrenut dev server / DEMO bazu)**

Run: `pnpm test:e2e tests/e2e/20-plan-aktivnosti.spec.ts`
Expected: PASS (postojeći + 3 nova testa). Ako download test padne zbog praznih podataka za tekući mjesec, promijeni format test da prvo izabere `izvoz-period-svi` prije `izvoz-preuzmi`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/20-plan-aktivnosti.spec.ts
git commit -m "test(e2e): izvoz modal — otvaranje, download, validacija raspona"
```

---

### Task 7: Finalna verifikacija cijele grane

- [ ] **Step 1: Pokreni cijeli unit + lint + typecheck + build**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`
Expected: sve PASS. Posebno provjeri da su zeleni: `lib/plan-izvoz/period.test.ts`, `lib/plan-izvoz/params.test.ts`, `lib/plan-filteri.test.ts`, `i18n/paritet.test.ts`, `lib/plan-izvoz/pdf.test.ts`, `lib/plan-izvoz/xlsx.test.ts`.

- [ ] **Step 2: Ručna dimna proba (dev)**

Run: `pnpm dev` → `/plan-aktivnosti`:
- Klik "Preuzmi" → modal; default "Ovaj mjesec"; broj se prikaže.
- "Prilagodi" → sve opcije perioda + opseg.
- Promijeni period na "Cijela godina" → broj se ažurira.
- "Samo trenutno filtrirano" → prikaže sažetak filtera.
- Preuzmi PDF i Excel — fajlovi ispravni, isti podaci kao u ranijim izvozima za isti period.

- [ ] **Step 3: (Opciono) Provjera bez regresije za legacy link**

Otvori direktno `/api/plan-aktivnosti/izvoz?format=pdf` → skida PDF (legacy grana, kao prije redizajna).

## Self-Review (popunjeno pri pisanju plana)

**Spec coverage:**
- Format PDF/Excel → Task 5 (format prekidač) + Task 4 (route). ✅
- Default "Ovaj mjesec" → Task 1 (`om`), Task 5 (default state). ✅
- Period opcije (godina/mjesec/raspon/svi) → Task 1 + Task 2 + Task 5. ✅
- Opseg sve/filtrirano → Task 2 (opseg), Task 3 (split), Task 5 (UI). ✅
- Živi broj → Task 4 (count grana), Task 5 (fetch+prikaz). ✅
- Jedno "Preuzmi" dugme → Task 5 (zamjena `PlanIzvozDugmad`). ✅
- Backward-compat → Task 2 (legacy grana) + Task 4. ✅
- Testovi (period resolver, count, e2e) → Task 1/2/3 unit, Task 6 e2e. ✅
- i18n paritet → Task 4 + Task 5 (sva 3 jezika), gate `paritet.test.ts`. ✅

**Placeholder scan:** nema TBD/TODO; sav kod je kompletan. Jedina „ako zatreba" napomena je fallback za `DialogTrigger render=` (Task 5 Step 5) — dat je konkretan alternativni obrazac, ne placeholder.

**Type consistency:** `IzvozPeriod` (Task 1) koristi se identično u Task 2 (`parseIzvozParams`) i Task 4 (route). `applyPlanFilteriBezDatuma` (Task 3) poziva se u Task 4. `buildParams` u Task 5 emituje tačno parametre koje `parseIzvozParams` čita (`period`, `opseg`, `godina`, `mjesec`, `od`, `do`, `count`, `format` + filter ključevi). `broj` JSON ključ konzistentan između Task 4 (`{ broj }`) i Task 5 (čita `data.broj`).
