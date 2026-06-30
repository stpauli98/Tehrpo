# Plan aktivnosti — period + izvoz — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodati "tekući + naredni mjesec" period (kao default) u Plan aktivnosti i izvoz trenutno-filtriranog plana u Excel (.xlsx) i PDF.

**Architecture:** Čista period/filter logika (`lib/date.ts`, `lib/plan-filteri.ts`) koju dijele `lista` i nova `izvoz` ruta; izvoz preko `exceljs` (Excel) i `pdf-lib` (PDF); dva download dugmeta u toolbaru.

**Tech Stack:** Next.js 16 (App Router, route handlers, `runtime=nodejs`), Supabase (`termini_view`, RLS po dodjeli), `exceljs` (postoji), `pdf-lib` (nova), Vitest, pnpm.

## Global Constraints

- Package manager **pnpm**; dev `--webpack`. Domenski jezik bosanski.
- Izvoz čita preko **SSR (RLS)** klijenta (`createServerSupabaseClient`) — operater izvozi samo svoje klijente; **nikad service-role u request-pathu**.
- Izvoz **poštuje trenutne filtere** (status/klijent/lokacija/vrsta/mjesec/godina/pretraga) — isti kao lista.
- `lista` i `izvoz` dijele **isti** parse+range helper (`lib/plan-filteri.ts`) — bez duplikata logike.
- Kolone izvoza: **Klijent · Lokacija · Usluga · Rok · Status · Periodika (mj) · Odgovorna osoba**; zaglavlje = `APP_NAME` + labela perioda.
- Bez `sm:`/`md:` Tailwind breakpointa (eslint); `no-await-in-loop` (osim `scripts/`). Bez DB migracije.
- Grana: `feat/plan-izvoz-period`. `db/types.ts` se NE dira (nema schema izmjene).
- **Napomena:** `kalendar`/`matrica` rute NE treba mijenjati — već rade fallback (`Number("tn") || tekući mjesec`).

---

### Task 1: Period logika + filter opcija + dijeljeni parse/range (čisto, TDD)

**Files:**
- Modify: `lib/date.ts`
- Test: `lib/date.test.ts`
- Modify: `lib/termini-filters.ts`
- Create: `lib/plan-filteri.ts`
- Test: `lib/plan-filteri.test.ts`

**Interfaces:**
- Produces:
  - `tekuciNarednomMjesecuRange(danas?: Date): { from: string; to: string }`
  - `type PlanFilteri = { status: string; q: string; klijentId: string; lokacijaId: string; vrstaId: string; mjesec: string; godina: number }`
  - `parsePlanFilteri(sp: URLSearchParams): PlanFilteri`
  - `mjesecRange(f: PlanFilteri): { from: string; to: string } | null`

- [ ] **Step 1: Testovi za `tekuciNarednomMjesecuRange`** — dodaj na kraj `lib/date.test.ts`

```ts
import { tekuciNarednomMjesecuRange } from "./date"

describe("tekuciNarednomMjesecuRange", () => {
  it("jun → [01.06, 31.07]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 5, 15)))).toEqual({ from: "2026-06-01", to: "2026-07-31" })
  })
  it("preko granice godine: decembar → [01.12, 31.01 sljedeće]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 11, 3)))).toEqual({ from: "2026-12-01", to: "2027-01-31" })
  })
  it("februar (28 dana naredni? ne — naredni je mart) → [01.02, 31.03]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 1, 10)))).toEqual({ from: "2026-02-01", to: "2026-03-31" })
  })
})
```

- [ ] **Step 2: Pokreni — mora pasti**

Run: `pnpm vitest run lib/date.test.ts`
Expected: FAIL ("tekuciNarednomMjesecuRange is not a function").

- [ ] **Step 3: Implementiraj `tekuciNarednomMjesecuRange`** — dodaj u `lib/date.ts`

```ts
/** Raspon [prvi dan tekućeg mjeseca, zadnji dan narednog mjeseca] (ISO, UTC, granica godine OK). */
export function tekuciNarednomMjesecuRange(danas?: Date): { from: string; to: string } {
  const base = danas ?? new Date()
  const y = base.getUTCFullYear()
  const m = base.getUTCMonth() // 0..11 (tekući)
  const pad = (n: number) => String(n).padStart(2, "0")
  const from = `${y}-${pad(m + 1)}-01`
  const end = new Date(Date.UTC(y, m + 2, 0)) // dan 0 mjeseca (m+2) = zadnji dan narednog (m+1)
  const to = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
  return { from, to }
}
```

- [ ] **Step 4: Pokreni — mora proći**

Run: `pnpm vitest run lib/date.test.ts`
Expected: PASS.

- [ ] **Step 5: Dodaj "tn" opciju** — `lib/termini-filters.ts`

```ts
import { MONTHS_BS } from "@/lib/date"

/** Mjesec opcije za filter — value je "tn" | "1".."12". */
export const MONTHS_BS_OPTION = [
  { value: "tn", label: "Tekući + naredni mjesec" },
  ...MONTHS_BS.map((label, i) => ({ value: String(i + 1), label })),
]
```

- [ ] **Step 6: Testovi za `parsePlanFilteri` + `mjesecRange`** — `lib/plan-filteri.test.ts` (novi)

```ts
import { describe, it, expect } from "vitest"
import { parsePlanFilteri, mjesecRange } from "./plan-filteri"
import { currentYear } from "./date"

describe("parsePlanFilteri", () => {
  it("prazni params → default mjesec 'tn', status 'svi', godina = tekuća", () => {
    const f = parsePlanFilteri(new URLSearchParams())
    expect(f.mjesec).toBe("tn")
    expect(f.status).toBe("svi")
    expect(f.godina).toBe(currentYear())
    expect(f.klijentId).toBe("")
  })
  it("čita sve filtere", () => {
    const f = parsePlanFilteri(new URLSearchParams("status=kasni&q=as&klijent_id=k1&lokacija=l1&vrsta_id=v1&mjesec=7&godina=2027"))
    expect(f).toMatchObject({ status: "kasni", q: "as", klijentId: "k1", lokacijaId: "l1", vrstaId: "v1", mjesec: "7", godina: 2027 })
  })
})

describe("mjesecRange", () => {
  const base = (mjesec: string, godina = 2026) => ({ status: "svi", q: "", klijentId: "", lokacijaId: "", vrstaId: "", mjesec, godina })
  it("'tn' → raspon tekući+naredni (ne null)", () => {
    const r = mjesecRange(base("tn"))
    expect(r).not.toBeNull()
    expect(r!.from.endsWith("-01")).toBe(true)
  })
  it("'7' → juli 2026", () => {
    expect(mjesecRange(base("7"))).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("'svi' → null (bez datumskog opsega)", () => {
    expect(mjesecRange(base("svi"))).toBeNull()
  })
})
```

- [ ] **Step 7: Pokreni — mora pasti**

Run: `pnpm vitest run lib/plan-filteri.test.ts`
Expected: FAIL ("Cannot find module './plan-filteri'").

- [ ] **Step 8: Implementiraj `lib/plan-filteri.ts`**

```ts
import { monthRange, currentYear, tekuciNarednomMjesecuRange } from "@/lib/date"

export type PlanFilteri = {
  status: string
  q: string
  klijentId: string
  lokacijaId: string
  vrstaId: string
  mjesec: string // "tn" (default) | "svi" | "1".."12"
  godina: number
}

/** Parsiraj filtere iz query stringa (isto za lista i izvoz rutu). Default mjeseca = "tn". */
export function parsePlanFilteri(sp: URLSearchParams): PlanFilteri {
  return {
    status: sp.get("status") ?? "svi",
    q: (sp.get("q") ?? "").trim(),
    klijentId: sp.get("klijent_id") ?? "",
    lokacijaId: sp.get("lokacija") ?? "",
    vrstaId: sp.get("vrsta_id") ?? "",
    mjesec: sp.get("mjesec") || "tn",
    godina: Number(sp.get("godina")) || currentYear(),
  }
}

/** Datumski raspon za mjesec-filter: "tn" → tekući+naredni, "1".."12" → taj mjesec, "svi" → null. */
export function mjesecRange(f: PlanFilteri): { from: string; to: string } | null {
  if (f.mjesec === "tn") return tekuciNarednomMjesecuRange()
  const mn = Number(f.mjesec)
  if (mn >= 1 && mn <= 12) return monthRange(f.godina, mn)
  return null
}
```

- [ ] **Step 9: Pokreni — mora proći**

Run: `pnpm vitest run lib/plan-filteri.test.ts lib/date.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/date.ts lib/date.test.ts lib/termini-filters.ts lib/plan-filteri.ts lib/plan-filteri.test.ts
git commit -m "feat(plan): tekući+naredni period helper + dijeljeni filter parser"
```

---

### Task 2: Lista ruta koristi dijeljeni filter + UI default "tn"

**Files:**
- Modify: `app/api/plan-aktivnosti/lista/route.ts`
- Modify: `components/domain/TerminiFilters.tsx`

**Interfaces:**
- Consumes: `parsePlanFilteri`, `mjesecRange` (Task 1); `MONTHS_BS_OPTION` (sada s "tn").

- [ ] **Step 1: Refaktoriši `lista` rutu da koristi dijeljeni filter** (`app/api/plan-aktivnosti/lista/route.ts`)

Zamijeni import `monthRange, currentYear` i blok izgradnje filtera. Novi relevantni dio:

```ts
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, mjesecRange } from "@/lib/plan-filteri"

const PER_PAGE = 50

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams

  const pageNum = Math.max(1, Number(sp.get("page") ?? "1") || 1)
  const from = (pageNum - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  const f = parsePlanFilteri(sp)

  let listQuery = supabase
    .from("termini_view")
    .select("*", { count: "exact" })
    .order("rok_dospijeca", { ascending: true })

  if (f.status && f.status !== "svi") listQuery = listQuery.eq("status_izvedeni", f.status)
  if (f.q) {
    const safe = f.q.replace(/[(),]/g, " ")
    listQuery = listQuery.or(`klijent_naziv.ilike.%${safe}%,lokacija_naziv.ilike.%${safe}%`)
  }
  if (f.klijentId) listQuery = listQuery.eq("klijent_id", f.klijentId)
  if (f.lokacijaId) listQuery = listQuery.eq("lokacija_id", f.lokacijaId)
  if (f.vrstaId) listQuery = listQuery.eq("vrsta_provjere_id", f.vrstaId)
  const r = mjesecRange(f)
  if (r) listQuery = listQuery.gte("rok_dospijeca", r.from).lte("rok_dospijeca", r.to)

  listQuery = listQuery.range(from, to)

  const [statsRes, listRes, klijentiRes, vrsteRes, lokacijeRes] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    listQuery,
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
    supabase.from("lokacije").select("id, naziv, klijent_id").order("naziv"),
  ])

  if (listRes.error) {
    return NextResponse.json({ error: listRes.error }, { status: 400 })
  }

  return NextResponse.json({
    rows: listRes.data ?? [],
    total: listRes.count ?? 0,
    stats: statsRes.data?.[0] ?? null,
    klijenti: klijentiRes.data ?? [],
    vrste: vrsteRes.data ?? [],
    lokacije: lokacijeRes.data ?? [],
  })
}
```
(Ukloni stari JSDoc dio o `mjesec "1".."12"` ili dopuni da spominje "tn" — opciono.)

- [ ] **Step 2: UI default "tn" + setMjesec** (`components/domain/TerminiFilters.tsx`)

(a) Promijeni default mjeseca:
```ts
const mjesec = params.get("mjesec") ?? "tn"
```
(b) `mjesecItems` više NE treba poseban "svi" na vrhu jer je "tn" u `MONTHS_BS_OPTION`; dodaj "svi" eksplicitno:
```ts
const mjesecItems: Record<string, string> = { svi: "Svi mjeseci", ...Object.fromEntries(MONTHS_BS_OPTION.map((m) => [m.value, m.label])) }
```
(c) Dodaj namjenski `setMjesec` (uvijek SET-uje, jer je default "tn" ≠ odsustvo "svi"):
```ts
function setMjesec(value: string) {
  const next = new URLSearchParams(params.toString())
  next.set("mjesec", value) // uvijek eksplicitno (tn|svi|1..12)
  next.delete("page")
  next.delete("selected")
  startTransition(() => router.push(`/plan-aktivnosti?${next.toString()}`))
}
```
(d) Mjesec dropdown: `onValueChange={(v) => setMjesec(v ?? "tn")}`, i u `SelectContent` ostavi `<SelectItem value="svi">Svi mjeseci</SelectItem>` + map nad `MONTHS_BS_OPTION` (koji sad uključuje "tn" kao prvu stavku). Ukloni eventualni dupli "tn" ručni unos.
(e) Godina vidljiva samo za numerički mjesec:
```ts
{mjesec !== "svi" && mjesec !== "tn" && (
  /* ... Godina Select ... */
)}
```

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 4: Commit**

```bash
git add "app/api/plan-aktivnosti/lista/route.ts" components/domain/TerminiFilters.tsx
git commit -m "feat(plan): lista koristi dijeljeni filter; default period = tekući+naredni"
```

---

### Task 3: Izvoz builderi (PlanRed + xlsx + pdf) + pdf-lib

**Files:**
- Modify: `package.json` (dodaj `pdf-lib`)
- Create: `lib/plan-izvoz/types.ts`
- Create: `lib/plan-izvoz/xlsx.ts`
- Test: `lib/plan-izvoz/xlsx.test.ts`
- Create: `lib/plan-izvoz/pdf.ts`
- Test: `lib/plan-izvoz/pdf.test.ts`

**Interfaces:**
- Produces:
  - `type PlanRed = { klijent: string; lokacija: string; usluga: string; rok: string; status: string; periodikaMj: number | null; odgovorna: string }`
  - `type IzvozMeta = { naslov: string; period: string }`
  - `planToXlsx(rows: PlanRed[], meta: IzvozMeta): Promise<Buffer>`
  - `planToPdf(rows: PlanRed[], meta: IzvozMeta): Promise<Buffer>`

- [ ] **Step 1: Instaliraj pdf-lib**

Run: `pnpm add pdf-lib`
Expected: dodato u `dependencies`.

- [ ] **Step 2: Tipovi** (`lib/plan-izvoz/types.ts`)

```ts
export type PlanRed = {
  klijent: string
  lokacija: string
  usluga: string
  rok: string
  status: string
  periodikaMj: number | null
  odgovorna: string
}

export type IzvozMeta = { naslov: string; period: string }

export const PLAN_KOLONE = ["Klijent", "Lokacija", "Usluga", "Rok", "Status", "Periodika (mj)", "Odgovorna osoba"] as const
```

- [ ] **Step 3: Testovi za buildere** (`lib/plan-izvoz/xlsx.test.ts` i `pdf.test.ts`)

`lib/plan-izvoz/xlsx.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { planToXlsx } from "./xlsx"
import type { PlanRed } from "./types"

const ROW: PlanRed = { klijent: "AS", lokacija: "BL", usluga: "Hidranti", rok: "15.07.2026.", status: "Kasni", periodikaMj: 12, odgovorna: "Pero" }

describe("planToXlsx", () => {
  it("vraća validan .xlsx s headerom i redom", async () => {
    const buf = await planToXlsx([ROW], { naslov: "Tehpro", period: "tekući + naredni mjesec" })
    expect(buf.length).toBeGreaterThan(100)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet("Plan aktivnosti")!
    expect(ws.getCell("A4").value).toBe("Klijent")
    expect(ws.getCell("A5").value).toBe("AS")
    expect(ws.getCell("D5").value).toBe("15.07.2026.")
  })
})
```

`lib/plan-izvoz/pdf.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { planToPdf } from "./pdf"
import type { PlanRed } from "./types"

const ROW: PlanRed = { klijent: "AS", lokacija: "BL", usluga: "Hidranti", rok: "15.07.2026.", status: "Kasni", periodikaMj: 12, odgovorna: "Pero" }

describe("planToPdf", () => {
  it("vraća ne-prazan PDF buffer (%PDF magic)", async () => {
    const buf = await planToPdf([ROW], { naslov: "Tehpro", period: "tekući + naredni mjesec" })
    expect(buf.length).toBeGreaterThan(500)
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })
  it("radi i s praznim redovima", async () => {
    const buf = await planToPdf([], { naslov: "Tehpro", period: "svi mjeseci" })
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })
})
```

- [ ] **Step 4: Pokreni — mora pasti**

Run: `pnpm vitest run lib/plan-izvoz/`
Expected: FAIL (moduli ne postoje).

- [ ] **Step 5: Implementiraj `lib/plan-izvoz/xlsx.ts`**

```ts
import ExcelJS from "exceljs"
import type { PlanRed, IzvozMeta } from "./types"
import { PLAN_KOLONE } from "./types"

export async function planToXlsx(rows: PlanRed[], meta: IzvozMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Plan aktivnosti")
  ws.addRow([meta.naslov])
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.addRow([`Plan aktivnosti — ${meta.period}`])
  ws.addRow([])
  const header = ws.addRow([...PLAN_KOLONE])
  header.font = { bold: true }
  for (const r of rows) {
    ws.addRow([r.klijent, r.lokacija, r.usluga, r.rok, r.status, r.periodikaMj ?? "", r.odgovorna])
  }
  const sirine = [28, 20, 24, 14, 16, 14, 22]
  sirine.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
```

- [ ] **Step 6: Implementiraj `lib/plan-izvoz/pdf.ts`**

```ts
import { PDFDocument, StandardFonts } from "pdf-lib"
import type { PlanRed, IzvozMeta } from "./types"

const KOLONE = [
  { label: "Klijent", w: 150 },
  { label: "Lokacija", w: 110 },
  { label: "Usluga", w: 140 },
  { label: "Rok", w: 70 },
  { label: "Status", w: 90 },
  { label: "Periodika", w: 70 },
  { label: "Odgovorna", w: 152 },
] as const

export async function planToPdf(rows: PlanRed[], meta: IzvozMeta): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const W = 842, H = 595, margin = 30, rowH = 18, size = 9
  let page = pdf.addPage([W, H])
  let y = H - margin

  const skratiti = (s: string, w: number) => {
    let t = s
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -1)
    return t.length < s.length ? `${t.slice(0, -1)}…` : t
  }
  const zaglavlje = () => {
    page.drawText(meta.naslov, { x: margin, y: y - 12, size: 14, font: bold })
    page.drawText(`Plan aktivnosti — ${meta.period}`, { x: margin, y: y - 28, size: 10, font })
    y -= 44
    let x = margin
    for (const c of KOLONE) { page.drawText(c.label, { x: x + 2, y: y - 12, size, font: bold }); x += c.w }
    y -= rowH
  }
  zaglavlje()
  for (const r of rows) {
    if (y < margin + rowH) { page = pdf.addPage([W, H]); y = H - margin; zaglavlje() }
    const vals = [r.klijent, r.lokacija, r.usluga, r.rok, r.status, r.periodikaMj == null ? "—" : String(r.periodikaMj), r.odgovorna]
    let x = margin
    vals.forEach((v, i) => { page.drawText(skratiti(String(v ?? "—"), KOLONE[i]!.w), { x: x + 2, y: y - 12, size, font }); x += KOLONE[i]!.w })
    y -= rowH
  }
  if (rows.length === 0) page.drawText("Nema aktivnosti za odabrane filtere.", { x: margin, y: y - 12, size: 10, font })
  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
```

- [ ] **Step 7: Pokreni — mora proći**

Run: `pnpm vitest run lib/plan-izvoz/`
Expected: PASS (3 testa).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml lib/plan-izvoz/
git commit -m "feat(plan): izvoz builderi (exceljs xlsx + pdf-lib pdf)"
```

---

### Task 4: Izvoz ruta + UI dugmad

**Files:**
- Create: `app/api/plan-aktivnosti/izvoz/route.ts`
- Create: `components/domain/PlanIzvozDugmad.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/page.tsx`

**Interfaces:**
- Consumes: `parsePlanFilteri`/`mjesecRange` (Task 1), `planToXlsx`/`planToPdf`/`PlanRed` (Task 3), `STATUS_LABEL`/`toDerivedStatus` (`lib/termini`), `MONTHS_BS` + `formatDatum` (`lib/date`), `APP_NAME` (`lib/brand`).

- [ ] **Step 1: Izvoz ruta** (`app/api/plan-aktivnosti/izvoz/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, mjesecRange } from "@/lib/plan-filteri"
import { planToXlsx } from "@/lib/plan-izvoz/xlsx"
import { planToPdf } from "@/lib/plan-izvoz/pdf"
import type { PlanRed } from "@/lib/plan-izvoz/types"
import { formatDatum, MONTHS_BS } from "@/lib/date"
import { STATUS_LABEL, toDerivedStatus } from "@/lib/termini"
import { APP_NAME } from "@/lib/brand"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function periodLabel(mjesec: string, godina: number): string {
  if (mjesec === "tn") return "tekući + naredni mjesec"
  if (mjesec === "svi") return "svi mjeseci"
  const mn = Number(mjesec)
  return mn >= 1 && mn <= 12 ? `${MONTHS_BS[mn - 1]} ${godina}` : "svi mjeseci"
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx"
  const f = parsePlanFilteri(sp)
  const supabase = await createServerSupabaseClient()

  let q = supabase.from("termini_view").select("*").order("rok_dospijeca", { ascending: true })
  if (f.status && f.status !== "svi") q = q.eq("status_izvedeni", f.status)
  if (f.q) {
    const safe = f.q.replace(/[(),]/g, " ")
    q = q.or(`klijent_naziv.ilike.%${safe}%,lokacija_naziv.ilike.%${safe}%`)
  }
  if (f.klijentId) q = q.eq("klijent_id", f.klijentId)
  if (f.lokacijaId) q = q.eq("lokacija_id", f.lokacijaId)
  if (f.vrstaId) q = q.eq("vrsta_provjere_id", f.vrstaId)
  const r = mjesecRange(f)
  if (r) q = q.gte("rok_dospijeca", r.from).lte("rok_dospijeca", r.to)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: PlanRed[] = (data ?? []).map((t) => ({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? "—",
    usluga: t.vrsta_naziv ?? "—",
    rok: formatDatum(t.rok_dospijeca),
    status: STATUS_LABEL[toDerivedStatus(t.status_izvedeni)],
    periodikaMj: t.interval_mjeseci ?? null,
    odgovorna: t.zaduzeni ?? "—",
  }))

  const meta = { naslov: APP_NAME, period: periodLabel(f.mjesec, f.godina) }
  const buf = format === "pdf" ? await planToPdf(rows, meta) : await planToXlsx(rows, meta)
  const ext = format === "pdf" ? "pdf" : "xlsx"
  const ct = format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": ct, "Content-Disposition": `attachment; filename="plan-aktivnosti.${ext}"` },
  })
}
```
> Ako `t` u `.map((t) => …)` typecheck prijavi `null`-kolone na view-u, ostaje `?? "—"`/`?? null` koji to već pokriva. Ako PostgREST `or()` tip zatraži uži tip, ostaviti kako lista ruta već radi (isti obrazac).

- [ ] **Step 2: UI dugmad** (`components/domain/PlanIzvozDugmad.tsx`)

```tsx
"use client"
import { useSearchParams } from "next/navigation"

export function PlanIzvozDugmad() {
  const params = useSearchParams()
  const href = (format: string) => {
    const next = new URLSearchParams(params.toString())
    next.delete("view")
    next.delete("page")
    next.delete("selected")
    next.set("format", format)
    return `/api/plan-aktivnosti/izvoz?${next.toString()}`
  }
  const klasa = "px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50"
  return (
    <div className="flex items-center gap-2">
      <a href={href("xlsx")} className={klasa} data-testid="izvoz-excel">Izvoz Excel</a>
      <a href={href("pdf")} className={klasa} data-testid="izvoz-pdf">Izvoz PDF</a>
    </div>
  )
}
```

- [ ] **Step 3: Renderuj dugmad u header** (`app/(dashboard)/plan-aktivnosti/page.tsx`)

Dodaj import + Suspense wrap (jer `useSearchParams` u client komponenti traži Suspense granicu):
```tsx
import { Suspense } from "react"
import { PlanIzvozDugmad } from "@/components/domain/PlanIzvozDugmad"
// ...
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Plan aktivnosti</h1>
        <div className="flex items-center gap-3">
          <Suspense fallback={null}><PlanIzvozDugmad /></Suspense>
          <PlanViewSwitcher current={view} />
        </div>
      </div>
```

- [ ] **Step 4: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka; build uspješan (nova ruta + `pdf-lib` se bundle-uju).

- [ ] **Step 5: Commit**

```bash
git add "app/api/plan-aktivnosti/izvoz/route.ts" components/domain/PlanIzvozDugmad.tsx "app/(dashboard)/plan-aktivnosti/page.tsx"
git commit -m "feat(plan): izvoz ruta (Excel/PDF) + dugmad u toolbaru"
```

---

### Task 5: Završna verifikacija + deploy

**Files:** (bez izmjena koda osim eventualnih e2e doradi)

- [ ] **Step 1: Pun unit set s DB**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:unit`
Expected: svi PASS (uklj. nove date/plan-filteri/plan-izvoz testove).

- [ ] **Step 2: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka, build OK.

- [ ] **Step 3: Ručna provjera (lokalni dev)**

Run: `pnpm dev` (podsjetnik: `--webpack` je u skripti). Otvori `/plan-aktivnosti`:
- Default filter mjeseca = "Tekući + naredni mjesec"; lista prikazuje termine `rok_dospijeca` u tom opsegu.
- Klikni "Izvoz Excel" → skine `.xlsx` s tim redovima; "Izvoz PDF" → `.pdf`. Promijeni filter (npr. klijent) pa ponovo izvezi → fajl odražava filter.

- [ ] **Step 4: E2E plan spec**

Run: `pnpm exec playwright test tests/e2e/20-plan-aktivnosti.spec.ts`
Expected: zeleno. Ako neki test pretpostavlja stari default ("Svi mjeseci"/sve redove), ažuriraj ga da očekuje novi default "tn" (promijeni očekivanu vrijednost filtera/skup redova), pa commit.

- [ ] **Step 5: Commit (ako je bilo e2e doradi) + sažetak**

```bash
git add -A && git commit -m "test(plan): e2e uskladi s novim default periodom" || echo "nema izmjena"
```

---

## Napomene za rollout
- **Bez DB migracije.** Merge u `main` → auto-deploy (Vercel). Provjeriti da `/api/plan-aktivnosti/izvoz` radi na produkciji (skine fajl).
- `pdf-lib` je čisti JS (serverless-safe, ugrađeni StandardFonts) — nema font-fajl problema.
- `kalendar`/`matrica` rute nepromijenjene (već fallback-uju na tekući mjesec za "tn"/"svi").

## Van obima
Statusi §10 koji fale; generisanje izvještaja; obuke; obilasci auto-2/mjesec; mobilna; Outlook/.ics; izvoz kalendar/matrica prikaza (izvozi se plan-lista, tabela iz dokumenta).
