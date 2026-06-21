# Tehpro MVP — Faza 4: Klijenti CRUD + Lokacije (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implementirati `/klijenti` (cards grid + trigram-friendly search + paginacija) i `/klijenti/[id]` (detalji sa tabovima: Termini, Lokacije, Kontakti, Dokumenti), plus klijent + lokacija CRUD preko Server Actions. Čitanje iz novog `klijenti_view` (agregatni read-model), pisanje u `klijenti`/`lokacije` tabele.

**Architecture:** RSC stranice čitaju server-side iz `klijenti_view` (flat, sa per-klijent count agregatima) i `termini_view`/`lokacije` za detalje. Mutacije kroz Server Actions (`'use server'`) u `app/(dashboard)/klijenti/actions.ts` → pišu u `klijenti`/`lokacije` tabele + `revalidatePath`. Lista search je URL-param (`?q=`), paginacija (`?page=`). Detalji tabovi su URL-param (`?tab=`) preko tankog klijent `KlijentTabs` wrappera. Sve prati ustaljene Faza 3 paterne (ActionResult, formData.has patch guard, Promise.all, ?selected/ pattern gdje treba).

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions) · React 19 (`useActionState`) · TypeScript strict · Tailwind v4 · shadcn base-nova (@base-ui/react) · Supabase JS SDK · zod · Playwright + vitest · pnpm.

**Spec:** `docs/superpowers/specs/2026-06-20-tehpro-mvp-design.md` §7.2 E/F, §7.5
**Prethodne faze:** [phase-3](./2026-06-20-tehpro-mvp-phase-3-termini-crud.md) (Termini CRUD, v0.3.0). Reuse: StatusBadge, StatCard, formatDatum, Server Action + read-model paterni.

---

## Global Constraints

- **Node ≥ 20, pnpm.** Next.js 16, React 19, TS strict + `noUncheckedIndexedAccess`.
- **DB driver:** SAMO `@supabase/supabase-js`. READ iz `klijenti_view`/`termini_view`/`lokacije`; WRITE u `klijenti`/`lokacije` tabele kroz Server Actions.
- **Query-by-page rule (§5):** Glavni podaci max 2 round-tripa. `/klijenti` lista = 1 (klijenti_view sa `count:exact`). `/klijenti/[id]` = 1× `Promise.all` od 3 paralelna fetch-a (klijent, termini_view, lokacije) — fan-out, NE N+1. Per-klijent count-ovi dolaze iz view-a, NIKAD per-row query.
- **No await-in-loop**, no per-element queries. Counts preko `klijenti_view` agregata.
- **Trigram/search:** `.ilike('naziv', '%q%')` (escape meta-znakova). NE `%`/similarity operator (0.3 threshold prestrog, `set_limit` session-global=unsafe). ilike koristi GIN trgm indeks.
- **Tailwind breakpoints:** SAMO `lg:`/`xl:`/`2xl:`. `sm:`/`md:` = ESLint error.
- **Brand tokeni:** `#2563eb` brand. Tip badge (mockup): `po ugovoru`→`bg-blue-100 text-blue-700`, `po ponudi`→`bg-slate-100 text-slate-600`. **NAPOMENA:** naša `klijenti` shema NEMA `tip`/`grad` kolone (mockup ih je imao kao mock). Kartice prikazuju samo ono što imamo: naziv + count badge-evi. Ne izmišljaj tip/grad.
- **Bosanski jezik** za sav UI. Datumi `DD.MM.YYYY.` preko `formatDatum`.
- **Status workflow:** isti kao Faza 3 (kasni izvedeni u termini_view).
- **base-ui testid quirk:** Button/Input/SelectTrigger forward-uju `data-testid`; SelectItem/Value/Tabs panel NE pouzdano → u testovima koristi `getByRole("tab"/"option")`.
- **FK pravila (Faza 2):** `termini.klijent_id` → klijenti = **ON DELETE RESTRICT** (klijent sa terminima se NE može obrisati). `lokacije.klijent_id` → klijenti = CASCADE. `termini.lokacija_id` → lokacije = SET NULL (brisanje lokacije nulira termini.lokacija_id).
- **Commit style:** `feat(phase-4): <bosanski>` / `test(phase-4): ...`. Push na `origin/main`. Tag `v0.4.0`.
- **NEMA Vercel/cloud** — sve lokalno, Docker Supabase. Git push DA.
- **test:e2e** već koristi `--workers=1`; novi spec ima `test.describe.configure({ mode: "serial" })`.

## Poznati podaci / quirk-ovi (iz Faze 2/3)

- `klijenti`: 51 redova. `lokacije`: **0 redova** (prazna u seed-u — Excel nema lokacijske detalje). Lokacije se unose ručno.
- `termini`: ~1004. Status raspodjela: planirano 418, izvrseno 334, kasni 252.
- Seed ima duple unose različitog case-a (npr. "Ekonomski institut" i "EKONOMSKI INSTITUT" su dva klijenta — UNIQUE je na tačan tekst). Kozmetički, ne diramo u Fazi 4.
- Top klijenti po broju termina: WAIKIKI BANJA LUKA - DELTA (194), CARMEUSE (91), itd.

---

## File Structure (kreirano/mijenjano)

```
tehpro-mvp/
├── supabase/migrations/
│   └── <ts>_klijenti_read_model.sql          # klijenti_view (agregatni counts)
├── db/types.ts                                # REGEN nakon migracije
├── app/(dashboard)/klijenti/
│   ├── page.tsx                               # lista: cards grid + search + paginacija
│   ├── actions.ts                             # klijent + lokacija CRUD Server Actions
│   └── [id]/page.tsx                          # detalji: header + tabovi
├── components/domain/
│   ├── KlijentCard.tsx                        # kartica klijenta (KlijentRow type)
│   ├── KlijentiSearch.tsx                     # URL-state search (client)
│   ├── NoviKlijentButton.tsx                  # create klijent (Sheet)
│   ├── KlijentTabs.tsx                        # URL ?tab= wrapper (client)
│   ├── KlijentEditForm.tsx                    # inline edit naziv/napomena (client)
│   ├── ObrisiKlijentButton.tsx               # delete sa RESTRICT guard (client)
│   ├── LokacijeTab.tsx                        # lokacije lista + empty state
│   ├── LokacijaSheet.tsx                      # create/edit lokacija (client)
│   └── ObrisiLokacijuButton.tsx              # delete lokacija (client)
└── tests/e2e/
    └── 04-klijenti.spec.ts                    # E2E (raste kroz taskove)
```

---

## Task Map

| # | Task | Deliverable | Verifikacija |
|---|---|---|---|
| 1 | klijenti_view migracija + regen types | agregatni read-model | psql + typecheck |
| 2 | /klijenti lista (KlijentCard + search + paginacija) | cards grid radi, search WAIK→WAIKIKI | E2E lista |
| 3 | klijenti/actions.ts + createKlijent + NoviKlijentButton | kreiranje klijenta | E2E create |
| 4 | /klijenti/[id] detalji + KlijentTabs + Termini/Kontakti/Dokumenti tabovi | detalji + tabovi | E2E detalji/tabovi |
| 5 | Lokacije CRUD (actions + Lokacije tab + LokacijaSheet) | lokacija create/edit/delete | E2E lokacije |
| 6 | klijent edit + delete (RESTRICT guard) | edit naziv/napomena, delete fresh klijent | E2E edit/delete |
| 7 | Comprehensive E2E + phase gate + tag v0.4.0 | sve zeleno | fresh-agent gate |

**Ukupno: 7 tasks. Procjena: 2-3 dana.**

---

## Task 1: klijenti_view migracija + regen types

**Files:**
- Create: `supabase/migrations/<ts>_klijenti_read_model.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces: `klijenti_view` sa kolonama: `id, naziv, napomena, created_at, updated_at, broj_lokacija, broj_termina, broj_aktivnih, broj_kasni, broj_izvrseno`; regen `Database` type uključuje view.

- [ ] **Step 1.1: Provjeri Supabase**
```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && supabase status | head -3
```
Ako nije up: `supabase start`.

- [ ] **Step 1.2: Kreiraj migraciju**
```bash
supabase migration new klijenti_read_model
```

- [ ] **Step 1.3: SQL (testiran GROUP BY + FILTER agregat)**
```sql
-- Read-model za Klijenti ekran (Faza 4): per-klijent agregatni count-ovi
-- u jednom scanu (broj lokacija, termina, aktivnih, kasnih, izvršenih).

create view klijenti_view as
select
  k.id,
  k.naziv,
  k.napomena,
  k.created_at,
  k.updated_at,
  count(distinct l.id)                                                       as broj_lokacija,
  count(tv.id)                                                               as broj_termina,
  count(tv.id) filter (where tv.status_izvedeni in ('planirano','zakazano')) as broj_aktivnih,
  count(tv.id) filter (where tv.status_izvedeni = 'kasni')                    as broj_kasni,
  count(tv.id) filter (where tv.status = 'izvrseno')                         as broj_izvrseno
  -- NAPOMENA: broj_aktivnih koristi status_izvedeni (NE status) → isključuje
  -- prekoračene (kasni) termine, pa su broj_aktivnih i broj_kasni međusobno
  -- isključivi (nema dvostrukog brojanja na kartici).
from klijenti k
left join lokacije l       on l.klijent_id = k.id
left join termini_view tv  on tv.klijent_id = k.id
group by k.id, k.naziv, k.napomena, k.created_at, k.updated_at;
```

- [ ] **Step 1.4: Primijeni + seed**
```bash
supabase db reset && pnpm seed
```
`db reset` briše podatke; `pnpm seed` vraća 51 klijent + ~1004 termina.

- [ ] **Step 1.5: Sanity check view**
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select naziv, broj_lokacija, broj_termina, broj_aktivnih, broj_kasni from klijenti_view order by broj_termina desc limit 5;"
```
Expected: WAIKIKI/CARMEUSE na vrhu sa broj_termina > 0; broj_lokacija = 0 (lokacije prazne); broj_kasni > 0 za neke.

- [ ] **Step 1.6: Regen types**
```bash
pnpm db:types && grep -E "klijenti_view|broj_lokacija" db/types.ts | head
```
Expected: `klijenti_view` Row sa `broj_lokacija`/`broj_termina`/`broj_aktivnih`/`broj_kasni`/`broj_izvrseno` (svi `number | null` jer su view kolone).

- [ ] **Step 1.7: Build/typecheck/lint**
```bash
pnpm build && pnpm typecheck && pnpm lint
```

- [ ] **Step 1.8: Commit**
```bash
git add supabase/migrations/ db/types.ts && git commit -m "feat(phase-4): klijenti_view read-model (agregatni count-ovi)

- klijenti_view: per-klijent broj_lokacija/termina/aktivnih/kasni/izvrseno
  (LEFT JOIN lokacije + termini_view, GROUP BY) — jedan scan, bez N+1
- regen db/types.ts"
```

---

## Task 2: /klijenti lista — KlijentCard + cards grid + search + paginacija

**Files:**
- Create: `components/domain/KlijentCard.tsx`, `components/domain/KlijentiSearch.tsx`, `app/(dashboard)/klijenti/page.tsx`
- Create: `tests/e2e/04-klijenti.spec.ts`

**Interfaces:**
- Produces:
  - `type KlijentRow = Database["public"]["Views"]["klijenti_view"]["Row"]` (exportovan iz KlijentCard.tsx)
  - `<KlijentCard klijent={KlijentRow} />` — kartica, link na `/klijenti/{id}`
  - `<KlijentiSearch />` — client, URL `?q=` (Enter commit)
  - `/klijenti` RSC: lista iz klijenti_view (ilike filter, count:exact, paginacija 24/str)

- [ ] **Step 2.1: Kreiraj `components/domain/KlijentCard.tsx`**
```tsx
import Link from "next/link"
import { Users, MapPin, AlertTriangle } from "lucide-react"
import type { Database } from "@/db/types"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type KlijentRow = Database["public"]["Views"]["klijenti_view"]["Row"]

export function KlijentCard({ klijent }: { klijent: KlijentRow }) {
  const kasni = klijent.broj_kasni ?? 0
  return (
    <Link
      href={`/klijenti/${klijent.id}`}
      data-testid="klijent-card"
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl"
    >
      <Card className="h-full transition hover:border-slate-300">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-slate-900 leading-tight">{klijent.naziv}</h3>
            {/* Kasni badge UVIJEK prikazan (spec §7.2 E); crven kad >0, neutralan kad 0 */}
            <span
              data-testid="klijent-kasni-badge"
              data-kasni={kasni}
              className={cn(
                "inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset",
                kasni > 0
                  ? "bg-red-50 text-red-700 ring-red-600/20"
                  : "bg-slate-50 text-slate-500 ring-slate-400/20"
              )}
            >
              <AlertTriangle className="w-3 h-3" aria-hidden />
              {kasni} kasni
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" aria-hidden />
              {klijent.broj_lokacija ?? 0} lok.
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" aria-hidden />
              {klijent.broj_aktivnih ?? 0} aktivnih
            </span>
            <span className={cn("ml-auto tabular-nums", "text-slate-400")}>
              {klijent.broj_termina ?? 0} ukupno
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
```

- [ ] **Step 2.2: Kreiraj `components/domain/KlijentiSearch.tsx`**
```tsx
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { Input } from "@/components/ui/input"

export function KlijentiSearch() {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const q = params.get("q") ?? ""

  function commit(value: string) {
    const next = new URLSearchParams(params.toString())
    if (value.trim()) next.set("q", value.trim())
    else next.delete("q")
    next.delete("page")
    startTransition(() => router.push(`/klijenti?${next.toString()}`))
  }

  return (
    <Input
      key={q}
      type="search"
      placeholder="Pretraga firme..."
      defaultValue={q}
      data-testid="klijenti-search"
      data-pending={pending}
      className="w-64"
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value)
      }}
    />
  )
}
```

- [ ] **Step 2.3: Kreiraj `app/(dashboard)/klijenti/page.tsx`**
```tsx
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { KlijentCard, type KlijentRow } from "@/components/domain/KlijentCard"
import { KlijentiSearch } from "@/components/domain/KlijentiSearch"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const PER_PAGE = 24

export default async function KlijentiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = typeof sp.q === "string" ? sp.q.trim() : ""
  const pageNum = Math.max(1, Number(typeof sp.page === "string" ? sp.page : "1") || 1)
  const from = (pageNum - 1) * PER_PAGE
  const to = from + PER_PAGE - 1

  const supabase = await createServerSupabaseClient()

  let query = supabase
    .from("klijenti_view")
    .select("*", { count: "exact" })
    .order("naziv", { ascending: true })
  if (q) {
    const safe = q.replace(/[%_,()]/g, " ") // escape LIKE wildcards (% _) + or() meta
    query = query.ilike("naziv", `%${safe}%`)
  }
  query = query.range(from, to)

  const { data, count } = await query
  const rows = (data ?? []) as KlijentRow[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : []
    )
  ).toString()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("page", String(p))
    return `/klijenti?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Klijenti</h1>
        <KlijentiSearch />
      </div>

      {rows.length === 0 ? (
        <div data-testid="klijenti-empty" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          Nema klijenata za zadanu pretragu.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="klijenti-grid">
          {rows.map((k) => <KlijentCard key={k.id ?? ""} klijent={k} />)}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-slate-600" data-testid="klijenti-pagination">
        <span data-testid="klijenti-total">Ukupno klijenata: {total}</span>
        <div className="flex items-center gap-2">
          {pageNum <= 1 ? (
            <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Prethodna</span>
          ) : (
            <Link href={pageHref(pageNum - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Prethodna</Link>
          )}
          <span data-testid="klijenti-page">Strana {pageNum} / {totalPages}</span>
          {pageNum >= totalPages ? (
            <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Sljedeća</span>
          ) : (
            <Link href={pageHref(pageNum + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Sljedeća</Link>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2.4: Kreiraj `tests/e2e/04-klijenti.spec.ts` (lista)**
```ts
import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("Faza 4 — Klijenti lista", () => {
  test("prikazuje grid klijenata", async ({ page }) => {
    await page.goto("/klijenti")
    await expect(page.getByRole("heading", { name: "Klijenti" })).toBeVisible()
    await expect(page.getByTestId("klijenti-grid")).toBeVisible()
    expect(await page.getByTestId("klijent-card").count()).toBeGreaterThan(0)
    const total = await page.getByTestId("klijenti-total").textContent()
    expect(total).toMatch(/Ukupno klijenata:\s*\d+/)
  })

  test("pretraga 'WAIK' vraća WAIKIKI klijente", async ({ page }) => {
    await page.goto("/klijenti")
    const input = page.getByTestId("klijenti-search")
    await input.fill("WAIK")
    await input.press("Enter")
    await page.waitForURL(/q=WAIK/)
    const cards = page.getByTestId("klijent-card")
    expect(await cards.count()).toBeGreaterThan(0)
    await expect(cards.first()).toContainText(/WAIKIKI/i)
  })

  test("paginacija Sljedeća mijenja stranu", async ({ page }) => {
    await page.goto("/klijenti")
    await expect(page.getByTestId("klijenti-page")).toContainText("Strana 1")
    const next = page.getByRole("link", { name: "Sljedeća" })
    if (await next.count()) {
      await next.click()
      await expect(page.getByTestId("klijenti-page")).toContainText("Strana 2")
    }
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/klijenti")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
```

- [ ] **Step 2.5: Pokreni E2E + full check**
```bash
pnpm test:e2e tests/e2e/04-klijenti.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```
51 klijenata / 24 po strani = 3 strane (paginacija test prolazi). Ako neki E2E loop koristi for-await, koristi Promise.all (no-await-in-loop).

- [ ] **Step 2.6: Commit**
```bash
git add components/domain/KlijentCard.tsx components/domain/KlijentiSearch.tsx app/ tests/e2e/04-klijenti.spec.ts && git commit -m "feat(phase-4): /klijenti lista — KlijentCard grid + search + paginacija

- KlijentCard: naziv + broj lokacija/aktivnih/ukupno + kasni badge (crveni)
- KlijentiSearch: URL ?q= (ilike, key={q} remount)
- lista iz klijenti_view (count:exact, 24/str, sortirano po nazivu)
- 04-klijenti.spec.ts: grid, search WAIK→WAIKIKI, paginacija"
```

---

## Task 3: klijenti/actions.ts + createKlijent + NoviKlijentButton

**Files:**
- Create: `app/(dashboard)/klijenti/actions.ts`
- Create: `components/domain/NoviKlijentButton.tsx`
- Modify: `app/(dashboard)/klijenti/page.tsx` (CTA u header)
- Modify: `tests/e2e/04-klijenti.spec.ts`

**Interfaces:**
- Produces:
  - `type ActionResult = { ok: true } | { ok: false; errors?: ...; message?: string }`
  - `createKlijent(prev, formData): Promise<ActionResult>` — insert naziv (+napomena)
  - `<NoviKlijentButton />` — CTA → Sheet sa formom

- [ ] **Step 3.1: Kreiraj `app/(dashboard)/klijenti/actions.ts`**
```ts
'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const optionalText = (max: number) =>
  z.string().max(max).optional().or(z.literal("").transform(() => undefined))

const createKlijentSchema = z.object({
  naziv: z.string().min(1, "Naziv je obavezan").max(200),
  napomena: optionalText(2000),
})

export async function createKlijent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijenti").insert({
    naziv: parsed.data.naziv,
    napomena: parsed.data.napomena ?? null,
  })
  if (error) {
    // UNIQUE constraint na naziv → prijateljska poruka
    const msg = /duplicate|unique/i.test(error.message)
      ? "Klijent sa tim nazivom već postoji."
      : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/klijenti")
  return { ok: true }
}
```

- [ ] **Step 3.2: Kreiraj `components/domain/NoviKlijentButton.tsx`**
```tsx
"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createKlijent, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function NoviKlijentButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(createKlijent, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button data-testid="novi-klijent-btn"><Plus className="w-4 h-4" aria-hidden /> Novi klijent</Button>} />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="novi-klijent-sheet">
        <SheetHeader><SheetTitle>Novi klijent</SheetTitle></SheetHeader>
        <form
          action={(fd) => { submitted.current = true; action(fd) }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="novi-klijent-form"
        >
          <label className="block text-sm">
            <span className="text-slate-600">Naziv *</span>
            <Input name="naziv" required placeholder="npr. WAIKIKI Banja Luka" data-testid="novi-klijent-naziv" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Napomena</span>
            <Input name="napomena" data-testid="novi-klijent-napomena" />
          </label>
          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="novi-klijent-submit">
            {pending ? "Kreiram…" : "Kreiraj klijenta"}
          </Button>
        </form>
        <SheetFooter>
          <SheetClose render={<Button variant="outline" data-testid="novi-klijent-cancel">Otkaži</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3.3: Dodaj CTA u `klijenti/page.tsx` header**
Zamijeni header div:
```tsx
import { NoviKlijentButton } from "@/components/domain/NoviKlijentButton"
// ...
<div className="flex items-center justify-between gap-4">
  <h1 className="text-2xl font-semibold">Klijenti</h1>
  <div className="flex items-center gap-3">
    <KlijentiSearch />
    <NoviKlijentButton />
  </div>
</div>
```

- [ ] **Step 3.4: E2E create**
Dodaj describe blok:
```ts
test.describe("Faza 4 — Novi klijent", () => {
  test("kreira klijenta koji se pojavi u listi", async ({ page }) => {
    const naziv = "E2E Test Klijent " + Date.now()
    await page.goto("/klijenti")
    const before = Number((await page.getByTestId("klijenti-total").textContent())?.match(/\d+/)?.[0] ?? "0")
    await page.getByTestId("novi-klijent-btn").click()
    await expect(page.getByTestId("novi-klijent-sheet")).toBeVisible()
    await page.getByTestId("novi-klijent-naziv").fill(naziv)
    await page.getByTestId("novi-klijent-submit").click()
    await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
    const after = Number((await page.getByTestId("klijenti-total").textContent())?.match(/\d+/)?.[0] ?? "0")
    expect(after).toBe(before + 1)
  })
})
```
**Napomena:** `Date.now()` u testu — Workflow skripte zabranjuju `Date.now()`, ali E2E Playwright testovi su obični Node i smiju ga koristiti za jedinstven naziv (izbjegava UNIQUE sudar pri ponovljenom runu).

- [ ] **Step 3.5: Full check**
```bash
pnpm test:e2e tests/e2e/04-klijenti.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 3.6: Commit**
```bash
git add app/ components/domain/NoviKlijentButton.tsx tests/e2e/04-klijenti.spec.ts && git commit -m "feat(phase-4): createKlijent action + NoviKlijentButton

- actions.ts: createKlijent (zod, UNIQUE→prijateljska poruka, revalidatePath)
- NoviKlijentButton: CTA → Sheet, submitted-flag close + refresh
- CTA u /klijenti header
- E2E: kreiraj klijenta, ukupno +1, sheet zatvoren"
```

---

## Task 4: /klijenti/[id] detalji + KlijentTabs + Termini/Kontakti/Dokumenti tabovi

**Files:**
- Create: `app/(dashboard)/klijenti/[id]/page.tsx`, `components/domain/KlijentTabs.tsx`
- Modify: `tests/e2e/04-klijenti.spec.ts`

**Interfaces:**
- Consumes: klijenti table, termini_view (Faza 3), lokacije
- Produces:
  - `/klijenti/[id]` RSC: header + 4 taba; `?tab=` URL state
  - `<KlijentTabs activeTab klijentId />` — client wrapper (URL navigacija)
  - Termini tab: lista termina iz termini_view; Kontakti tab: iz lokacija; Dokumenti: placeholder; Lokacije tab: **stub u T4, puni u T5**

- [ ] **Step 4.1: Kreiraj `components/domain/KlijentTabs.tsx`**
```tsx
"use client"

import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const TABS = [
  { value: "termini", label: "Termini" },
  { value: "lokacije", label: "Lokacije" },
  { value: "kontakti", label: "Kontakti" },
  { value: "dokumenti", label: "Dokumenti" },
] as const

export function KlijentTabs({ activeTab, klijentId }: { activeTab: string; klijentId: string }) {
  const router = useRouter()
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => router.push(`/klijenti/${klijentId}?tab=${v ?? "termini"}`)}
    >
      <TabsList variant="line">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
```
**Napomena:** base-ui `onValueChange` daje `value` (tip `any | null`) + `eventDetails` (drugi arg, ignorišemo). Null guard `v ?? "termini"` je već u kodu (sprječava `?tab=null` u URL-u). Panel sadržaj renderuje server stranica preko `?tab=` (ne koristimo `TabsContent` — tabovi voze navigaciju, server re-renderuje).

- [ ] **Step 4.2: Kreiraj `app/(dashboard)/klijenti/[id]/page.tsx`**
```tsx
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { KlijentTabs } from "@/components/domain/KlijentTabs"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { formatDatum } from "@/lib/date"
import type { Database } from "@/db/types"

type TerminViewRow = Database["public"]["Views"]["termini_view"]["Row"]
type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

const VALID_TABS = ["termini", "lokacije", "kontakti", "dokumenti"]

export default async function KlijentDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const tab = typeof sp.tab === "string" && VALID_TABS.includes(sp.tab) ? sp.tab : "termini"

  const supabase = await createServerSupabaseClient()
  // Čitamo iz klijenti_view OD POČETKA (daje naziv/napomena + broj_termina za T6 delete guard).
  // 3 paralelna fetch-a = fan-out, nije N+1.
  const [klijentRes, terminiRes, lokacijeRes] = await Promise.all([
    supabase.from("klijenti_view").select("*").eq("id", id).maybeSingle(),
    supabase.from("termini_view").select("*").eq("klijent_id", id).order("rok_dospijeca", { ascending: true }),
    supabase.from("lokacije").select("*").eq("klijent_id", id).order("naziv", { ascending: true }),
  ])

  const klijent = klijentRes.data
  // klijenti_view kolone su nullable u TS; guard narrowuje id/naziv na string (notFound() vraća never)
  if (!klijent || !klijent.id || !klijent.naziv) notFound()
  const termini = (terminiRes.data ?? []) as TerminViewRow[]
  const lokacije = (lokacijeRes.data ?? []) as LokacijaRow[]

  return (
    <div className="space-y-6">
      <Link href="/klijenti" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" data-testid="nazad-klijenti">
        <ChevronLeft className="w-4 h-4" aria-hidden /> Klijenti
      </Link>

      <div>
        <h1 className="text-2xl font-semibold" data-testid="klijent-naziv">{klijent.naziv}</h1>
        {klijent.napomena && <p className="mt-1 text-sm text-slate-500">{klijent.napomena}</p>}
      </div>

      <KlijentTabs activeTab={tab} klijentId={id} />

      {tab === "termini" && (
        <div data-testid="tab-termini-content" className="rounded-xl border border-slate-200 overflow-hidden">
          {termini.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Nema termina za ovog klijenta.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Datum roka", "Vrsta", "Lokacija", "Status", "Zaduženi"].map((c) => (
                    <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {termini.map((t) => (
                  <tr key={t.id ?? ""} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatDatum(t.rok_dospijeca)}</td>
                    <td className="px-3 py-2 text-slate-600">{t.vrsta_naziv ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{t.lokacija_naziv ?? "—"}</td>
                    <td className="px-3 py-2"><StatusBadge status={t.status_izvedeni} /></td>
                    <td className="px-3 py-2 text-slate-600">{t.zaduzeni ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "kontakti" && (
        <div data-testid="tab-kontakti-content" className="space-y-3">
          {lokacije.filter((l) => l.kontakt_osoba || l.kontakt_email || l.kontakt_telefon).length === 0 ? (
            <p className="text-sm text-slate-500">Nema kontakata. Dodajte ih kroz lokacije.</p>
          ) : (
            lokacije.map((l) => (
              (l.kontakt_osoba || l.kontakt_email || l.kontakt_telefon) && (
                <div key={l.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-medium">{l.naziv}{l.grad ? ` · ${l.grad}` : ""}</p>
                  <div className="mt-1 text-slate-600 space-y-0.5">
                    {l.kontakt_osoba && <p>{l.kontakt_osoba}</p>}
                    {l.kontakt_email && <p>{l.kontakt_email}</p>}
                    {l.kontakt_telefon && <p>{l.kontakt_telefon}</p>}
                  </div>
                </div>
              )
            ))
          )}
        </div>
      )}

      {tab === "dokumenti" && (
        <div data-testid="tab-dokumenti-content" className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Upload i AI generisanje zapisnika dolazi u Fazi 7.
        </div>
      )}

      {tab === "lokacije" && (
        <div data-testid="tab-lokacije-content" className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Lokacije se popunjavaju u Task 5.
        </div>
      )}
    </div>
  )
}
```
**Napomena:** Lokacije tab je stub u T4, T5 ga zamjenjuje pravim CRUD-om.

- [ ] **Step 4.3: E2E detalji/tabovi**
```ts
test.describe("Faza 4 — Klijent detalji i tabovi", () => {
  test("otvara detalje i prikazuje termini tab sa podacima", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
    await expect(page.getByTestId("klijent-naziv")).toContainText(/WAIKIKI/i)
    await expect(page.getByTestId("tab-termini-content")).toBeVisible()
    // WAIKIKI ima termine → tabela ima redove (ne empty state)
    await expect(page.getByTestId("tab-termini-content").getByRole("row").first()).toBeVisible()
    await expect(page.getByTestId("tab-termini-content")).not.toContainText("Nema termina")
  })

  test("prebacivanje Lokacije / Dokumenti tab (§9.1 detail prikazuje lokacije)", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\//)
    // Lokacije tab (T5 ga puni; ovdje bar potvrdi da se sadržaj prikazuje — empty ili lista)
    await page.getByRole("tab", { name: "Lokacije" }).click()
    await page.waitForURL(/tab=lokacije/)
    await expect(page.getByTestId("tab-lokacije-content")).toBeVisible()
    // Dokumenti placeholder
    await page.getByRole("tab", { name: "Dokumenti" }).click()
    await page.waitForURL(/tab=dokumenti/)
    await expect(page.getByTestId("tab-dokumenti-content")).toContainText("Fazi 7")
  })
})
```

- [ ] **Step 4.4: Full check**
```bash
pnpm test:e2e tests/e2e/04-klijenti.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 4.5: Commit**
```bash
git add app/ components/domain/KlijentTabs.tsx tests/e2e/04-klijenti.spec.ts && git commit -m "feat(phase-4): /klijenti/[id] detalji + tabovi (Termini/Kontakti/Dokumenti)

- detail RSC: header + Promise.all(klijent, termini_view, lokacije)
- KlijentTabs: URL ?tab= wrapper (base-ui line tabs)
- Termini tab: lista iz termini_view; Kontakti tab: iz lokacija;
  Dokumenti placeholder (Faza 7); Lokacije stub (T5)
- E2E: otvori detalje, termini tab, tab switch"
```

---

## Task 5: Lokacije CRUD (actions + Lokacije tab + LokacijaSheet)

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts` (lokacija actions)
- Create: `components/domain/LokacijeTab.tsx`, `components/domain/LokacijaSheet.tsx`, `components/domain/ObrisiLokacijuButton.tsx`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (zamijeni Lokacije stub)
- Modify: `tests/e2e/04-klijenti.spec.ts`

**Interfaces:**
- Produces:
  - `createLokacija/updateLokacija/deleteLokacija(prev, formData): Promise<ActionResult>`
  - `<LokacijeTab klijentId lokacije={LokacijaRow[]} />` — lista + Nova lokacija + edit/delete
  - `<LokacijaSheet klijentId lokacija? />` — create/edit Sheet
  - `<ObrisiLokacijuButton lokacijaId />` — delete sa potvrdom

- [ ] **Step 5.1: Dodaj lokacija actions u `actions.ts`**
```ts
import type { Database } from "@/db/types"
type LokacijeUpdate = Database["public"]["Tables"]["lokacije"]["Update"]

const lokacijaFields = {
  naziv: z.string().min(1, "Naziv je obavezan").max(200),
  grad: optionalText(120),
  regija: optionalText(120),
  adresa: optionalText(300),
  kontakt_osoba: optionalText(200),
  kontakt_email: optionalText(200),
  kontakt_telefon: optionalText(60),
}

const createLokacijaSchema = z.object({ klijent_id: z.string().uuid(), ...lokacijaFields })
const updateLokacijaSchema = z.object({ id: z.string().uuid(), ...lokacijaFields })

export async function createLokacija(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createLokacijaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("lokacije").insert({
    klijent_id,
    naziv: f.naziv,
    grad: f.grad ?? null, regija: f.regija ?? null, adresa: f.adresa ?? null,
    kontakt_osoba: f.kontakt_osoba ?? null, kontakt_email: f.kontakt_email ?? null, kontakt_telefon: f.kontakt_telefon ?? null,
  })
  if (error) return { ok: false, message: error.message }
  // 'layout' revalidira i /klijenti listu (broj_lokacija count) i /klijenti/[id] detalje
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

export async function updateLokacija(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateLokacijaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, ...f } = parsed.data
  const patch: LokacijeUpdate = {}
  if (formData.has("naziv") && f.naziv) patch.naziv = f.naziv
  if (formData.has("grad")) patch.grad = f.grad ?? null
  if (formData.has("regija")) patch.regija = f.regija ?? null
  if (formData.has("adresa")) patch.adresa = f.adresa ?? null
  if (formData.has("kontakt_osoba")) patch.kontakt_osoba = f.kontakt_osoba ?? null
  if (formData.has("kontakt_email")) patch.kontakt_email = f.kontakt_email ?? null
  if (formData.has("kontakt_telefon")) patch.kontakt_telefon = f.kontakt_telefon ?? null
  if (Object.keys(patch).length === 0) return { ok: true }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("lokacije").update(patch).eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

const deleteLokacijaSchema = z.object({ id: z.string().uuid() })
export async function deleteLokacija(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = deleteLokacijaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("lokacije").delete().eq("id", parsed.data.id)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}
```
**Napomena:** `revalidatePath("/klijenti", "layout")` osvježava i detalje (dinamička ruta) bez znanja klijent id-a u update/delete. Provjeri Next 16 signaturu; alternativa: proslijedi klijent_id u formi i revalidiraj specifičnu rutu.

- [ ] **Step 5.2: Kreiraj `components/domain/LokacijaSheet.tsx`**
```tsx
"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createLokacija, updateLokacija, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]
const initial: ActionResult = { ok: true }
const FIELDS = [
  ["naziv", "Naziv *", true], ["grad", "Grad", false], ["regija", "Regija", false], ["adresa", "Adresa", false],
  ["kontakt_osoba", "Kontakt osoba", false], ["kontakt_email", "Email", false], ["kontakt_telefon", "Telefon", false],
] as const

export function LokacijaSheet({ klijentId, lokacija }: { klijentId: string; lokacija?: LokacijaRow }) {
  const router = useRouter()
  const isEdit = !!lokacija
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(isEdit ? updateLokacija : createLokacija, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false; setOpen(false); router.refresh()
    }
  }, [state, pending, router])

  const trigger = isEdit
    ? <Button variant="outline" size="sm" data-testid={`uredi-lokaciju-${lokacija!.id}`}>Uredi</Button>
    : <Button data-testid="nova-lokacija-btn"><Plus className="w-4 h-4" aria-hidden /> Nova lokacija</Button>

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="lokacija-sheet">
        <SheetHeader><SheetTitle>{isEdit ? "Uredi lokaciju" : "Nova lokacija"}</SheetTitle></SheetHeader>
        <form
          key={lokacija?.id ?? "new"}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="lokacija-form"
        >
          {isEdit
            ? <input type="hidden" name="id" value={lokacija!.id} />
            : <input type="hidden" name="klijent_id" value={klijentId} />}
          {FIELDS.map(([name, label, req]) => (
            <label key={name} className="block text-sm">
              <span className="text-slate-600">{label}</span>
              <Input
                name={name}
                required={req}
                defaultValue={isEdit ? (lokacija![name] ?? "") : ""}
                data-testid={`lokacija-${name}`}
              />
            </label>
          ))}
          {state.ok === false && state.message && <p className="text-sm text-red-600" role="alert">{state.message}</p>}
          <Button type="submit" disabled={pending} data-testid="lokacija-submit">
            {pending ? "Spremam…" : isEdit ? "Spremi izmjene" : "Kreiraj lokaciju"}
          </Button>
        </form>
        <SheetFooter><SheetClose render={<Button variant="outline">Otkaži</Button>} /></SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 5.3: Kreiraj `components/domain/ObrisiLokacijuButton.tsx`**
```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { deleteLokacija, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function ObrisiLokacijuButton({ lokacijaId }: { lokacijaId: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteLokacija, initial)
  const submitted = useRef(false)
  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; router.refresh() }
  }, [state, pending, router])

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive" size="sm" data-testid={`obrisi-lokaciju-${lokacijaId}`}>Obriši</Button>} />
      <DialogContent data-testid="obrisi-lokaciju-dialog">
        <DialogHeader><DialogTitle>Obrisati lokaciju?</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600">Brisanje lokacije će ukloniti vezu sa postojećim terminima (termin ostaje, lokacija postaje prazna).</p>
        {state.ok === false && state.message && <p className="text-sm text-red-600" role="alert">{state.message}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
          <form action={(fd) => { submitted.current = true; action(fd) }}>
            <input type="hidden" name="id" value={lokacijaId} />
            <Button type="submit" variant="destructive" disabled={pending} data-testid="obrisi-lokaciju-potvrdi">
              {pending ? "Brišem…" : "Obriši"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5.4: Kreiraj `components/domain/LokacijeTab.tsx`**
```tsx
import type { Database } from "@/db/types"
import { LokacijaSheet } from "@/components/domain/LokacijaSheet"
import { ObrisiLokacijuButton } from "@/components/domain/ObrisiLokacijuButton"

type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

export function LokacijeTab({ klijentId, lokacije }: { klijentId: string; lokacije: LokacijaRow[] }) {
  return (
    <div data-testid="tab-lokacije-content" className="space-y-4">
      <div className="flex justify-end">
        <LokacijaSheet klijentId={klijentId} />
      </div>
      {lokacije.length === 0 ? (
        <div data-testid="lokacije-empty" className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Nema lokacija. Dodajte prvu lokaciju za ovog klijenta.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="lokacije-table">
            <thead className="bg-slate-50">
              <tr>
                {["Naziv", "Grad", "Kontakt", "Akcije"].map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lokacije.map((l) => (
                <tr key={l.id} data-testid="lokacija-row" className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{l.naziv}</td>
                  <td className="px-3 py-2 text-slate-600">{l.grad ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{l.kontakt_osoba ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <LokacijaSheet klijentId={klijentId} lokacija={l} />
                      <ObrisiLokacijuButton lokacijaId={l.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5.5: Zamijeni Lokacije stub u `[id]/page.tsx`**
```tsx
import { LokacijeTab } from "@/components/domain/LokacijeTab"
// zamijeni {tab === "lokacije" && (...)} blok sa:
{tab === "lokacije" && <LokacijeTab klijentId={id} lokacije={lokacije} />}
```

- [ ] **Step 5.6: E2E lokacije CRUD**
```ts
test.describe("Faza 4 — Lokacije CRUD", () => {
  test("kreira, uređuje i briše lokaciju", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\//)
    await page.getByRole("tab", { name: "Lokacije" }).click()
    await page.waitForURL(/tab=lokacije/)
    // create
    await page.getByTestId("nova-lokacija-btn").click()
    await expect(page.getByTestId("lokacija-sheet")).toBeVisible()
    await page.getByTestId("lokacija-naziv").fill("Test Lokacija")
    await page.getByTestId("lokacija-grad").fill("Banja Luka")
    await page.getByTestId("lokacija-kontakt_osoba").fill("Marko M.")
    await page.getByTestId("lokacija-submit").click()
    await expect(page.getByTestId("lokacija-sheet")).toBeHidden({ timeout: 5000 })
    await expect(page.getByTestId("lokacije-table")).toContainText("Test Lokacija")
    // edit — promijeni grad
    const row = page.getByTestId("lokacija-row").filter({ hasText: "Test Lokacija" })
    await row.getByRole("button", { name: "Uredi" }).click()
    await expect(page.getByTestId("lokacija-sheet")).toBeVisible()
    await page.getByTestId("lokacija-grad").fill("Prijedor")
    await page.getByTestId("lokacija-submit").click()
    await expect(page.getByTestId("lokacija-sheet")).toBeHidden({ timeout: 5000 })
    await expect(page.getByTestId("lokacija-row").filter({ hasText: "Test Lokacija" })).toContainText("Prijedor")
    // delete — pozitivna provjera: red sa "Test Lokacija" nestane
    await row.getByRole("button", { name: "Obriši" }).click()
    await page.getByTestId("obrisi-lokaciju-potvrdi").click()
    await expect(page.getByTestId("lokacija-row").filter({ hasText: "Test Lokacija" })).toHaveCount(0)
  })
})
```

- [ ] **Step 5.7: Full check**
```bash
pnpm test:e2e tests/e2e/04-klijenti.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 5.8: Commit**
```bash
git add app/ components/domain/Lokacija*.tsx components/domain/LokacijeTab.tsx components/domain/ObrisiLokacijuButton.tsx tests/e2e/04-klijenti.spec.ts && git commit -m "feat(phase-4): Lokacije CRUD (create/edit/delete + tab)

- actions: createLokacija/updateLokacija/deleteLokacija (zod, patch guard)
- LokacijaSheet (create+edit), ObrisiLokacijuButton (Dialog potvrda),
  LokacijeTab (lista + empty state + Nova lokacija)
- E2E: kreiraj+obriši lokaciju"
```

---

## Task 6: klijent edit + delete (RESTRICT guard)

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts` (updateKlijent, deleteKlijent)
- Create: `components/domain/KlijentEditForm.tsx`, `components/domain/ObrisiKlijentButton.tsx`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (header: edit + delete)
- Modify: `tests/e2e/04-klijenti.spec.ts`

**Interfaces:**
- Produces:
  - `updateKlijent(prev, formData): Promise<ActionResult>` — naziv/napomena patch
  - `deleteKlijent(prev, formData): Promise<ActionResult>` — delete; RESTRICT FK → prijateljska poruka
  - `<KlijentEditForm klijent />`, `<ObrisiKlijentButton klijentId brojTermina />`

- [ ] **Step 6.1: Dodaj klijent update/delete u `actions.ts`**
```ts
type KlijentiUpdate = Database["public"]["Tables"]["klijenti"]["Update"]

const updateKlijentSchema = z.object({
  id: z.string().uuid(),
  naziv: z.string().min(1, "Naziv je obavezan").max(200).optional(),
  napomena: optionalText(2000),
})

export async function updateKlijent(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, ...f } = parsed.data
  const patch: KlijentiUpdate = { updated_at: new Date().toISOString() }
  if (formData.has("naziv") && f.naziv) patch.naziv = f.naziv
  if (formData.has("napomena")) patch.napomena = f.napomena ?? null
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijenti").update(patch).eq("id", id)
  if (error) {
    const msg = /duplicate|unique/i.test(error.message) ? "Klijent sa tim nazivom već postoji." : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

const deleteKlijentSchema = z.object({ id: z.string().uuid() })
export async function deleteKlijent(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = deleteKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijenti").delete().eq("id", parsed.data.id)
  if (error) {
    // FK RESTRICT (termini postoje)
    const msg = /foreign key|violates|restrict/i.test(error.message)
      ? "Ne možete obrisati klijenta koji ima termine."
      : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/klijenti")
  return { ok: true }
}
```
**Napomena:** `new Date().toISOString()` u Server Action je OK (runtime kod, ne Workflow skripta).

- [ ] **Step 6.2: Kreiraj `components/domain/KlijentEditForm.tsx`**
(Sheet pattern, trigger "Uredi", forma naziv+napomena, useActionState→updateKlijent, key={klijent.id}, submitted-flag close + refresh. data-testid: `uredi-klijent-btn`, `klijent-edit-sheet`, `klijent-edit-form`, `edit-klijent-naziv`, `edit-klijent-napomena`, `edit-klijent-submit`. Mirror NoviKlijentButton structure but with hidden `id` + defaultValue from klijent.)

```tsx
"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateKlijent, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

// Minimalni prop type — edit forma treba samo id/naziv/napomena (ne created_at/updated_at),
// pa nema rekonstrukcije iz nullable klijenti_view sa `!` asercijama.
export function KlijentEditForm({ klijent }: { klijent: { id: string; naziv: string; napomena: string | null } }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(updateKlijent, initial)
  const submitted = useRef(false)
  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; setOpen(false); router.refresh() }
  }, [state, pending, router])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="sm" data-testid="uredi-klijent-btn"><Pencil className="w-3.5 h-3.5" aria-hidden /> Uredi</Button>} />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="klijent-edit-sheet">
        <SheetHeader><SheetTitle>Uredi klijenta</SheetTitle></SheetHeader>
        <form key={klijent.id} action={(fd) => { submitted.current = true; action(fd) }} className="flex-1 overflow-auto px-4 space-y-3" data-testid="klijent-edit-form">
          <input type="hidden" name="id" value={klijent.id} />
          <label className="block text-sm"><span className="text-slate-600">Naziv *</span>
            <Input name="naziv" required defaultValue={klijent.naziv} data-testid="edit-klijent-naziv" /></label>
          <label className="block text-sm"><span className="text-slate-600">Napomena</span>
            <Input name="napomena" defaultValue={klijent.napomena ?? ""} data-testid="edit-klijent-napomena" /></label>
          {state.ok === false && state.message && <p className="text-sm text-red-600" role="alert">{state.message}</p>}
          <Button type="submit" disabled={pending} data-testid="edit-klijent-submit">{pending ? "Spremam…" : "Spremi izmjene"}</Button>
        </form>
        <SheetFooter><SheetClose render={<Button variant="outline">Otkaži</Button>} /></SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 6.3: Kreiraj `components/domain/ObrisiKlijentButton.tsx`**
```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { deleteKlijent, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function ObrisiKlijentButton({ klijentId, brojTermina }: { klijentId: string; brojTermina: number }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteKlijent, initial)
  const submitted = useRef(false)
  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; router.push("/klijenti") }
  }, [state, pending, router])

  // Klijent sa terminima se NE može obrisati (FK RESTRICT) — disable + objašnjenje
  if (brojTermina > 0) {
    return (
      <Button variant="outline" size="sm" disabled title="Klijent ima termine i ne može se obrisati" data-testid="obrisi-klijent-disabled">
        Obriši
      </Button>
    )
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive" size="sm" data-testid="obrisi-klijent-btn">Obriši</Button>} />
      <DialogContent data-testid="obrisi-klijent-dialog">
        <DialogHeader><DialogTitle>Obrisati klijenta?</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600">Ova radnja je trajna. Lokacije klijenta će takođe biti obrisane.</p>
        {state.ok === false && state.message && <p className="text-sm text-red-600" role="alert">{state.message}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
          <form action={(fd) => { submitted.current = true; action(fd) }}>
            <input type="hidden" name="id" value={klijentId} />
            <Button type="submit" variant="destructive" disabled={pending} data-testid="obrisi-klijent-potvrdi">{pending ? "Brišem…" : "Obriši"}</Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6.4: Dodaj edit+delete u `[id]/page.tsx` header**
Fetch je VEĆ `klijenti_view` sa `notFound()` guard-om (iz T4) — `klijent.id`/`klijent.naziv` su narrow-ovani na `string`, `broj_termina` dostupan. NE mijenjaj fetch. Samo dodaj dugmad u header:
```tsx
import { KlijentEditForm } from "@/components/domain/KlijentEditForm"
import { ObrisiKlijentButton } from "@/components/domain/ObrisiKlijentButton"
// header div postaje (klijent.naziv je string nakon guard-a):
<div className="flex items-start justify-between gap-4">
  <div>
    <h1 className="text-2xl font-semibold" data-testid="klijent-naziv">{klijent.naziv}</h1>
    {klijent.napomena && <p className="mt-1 text-sm text-slate-500">{klijent.napomena}</p>}
  </div>
  <div className="flex items-center gap-2">
    <KlijentEditForm klijent={{ id: klijent.id, naziv: klijent.naziv, napomena: klijent.napomena ?? null }} />
    <ObrisiKlijentButton klijentId={klijent.id} brojTermina={klijent.broj_termina ?? 0} />
  </div>
</div>
```
**Napomena:** nema `!` asercija — `notFound()` guard u T4 (`if (!klijent || !klijent.id || !klijent.naziv) notFound()`) je već narrow-ovao `id`/`naziv` na `string`. KlijentEditForm prima minimalni `{id, naziv, napomena}`.

- [ ] **Step 6.5: E2E edit + delete guard**
```ts
test.describe("Faza 4 — Klijent edit i delete", () => {
  test("uređuje napomenu klijenta", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\//)
    await page.getByTestId("uredi-klijent-btn").click()
    await expect(page.getByTestId("klijent-edit-sheet")).toBeVisible()
    await page.getByTestId("edit-klijent-napomena").fill("E2E napomena " + Date.now())
    await page.getByTestId("edit-klijent-submit").click()
    await expect(page.getByTestId("klijent-edit-sheet")).toBeHidden({ timeout: 5000 })
  })

  test("delete je onemogućen za klijenta sa terminima", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\//)
    await expect(page.getByTestId("obrisi-klijent-disabled")).toBeVisible()
  })

  test("kreiran prazan klijent se može obrisati", async ({ page }) => {
    const naziv = "Brisivi Klijent " + Date.now()
    await page.goto("/klijenti")
    await page.getByTestId("novi-klijent-btn").click()
    await page.getByTestId("novi-klijent-naziv").fill(naziv)
    await page.getByTestId("novi-klijent-submit").click()
    await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
    await page.goto("/klijenti?q=" + encodeURIComponent("Brisivi"))
    await page.getByTestId("klijent-card").filter({ hasText: naziv }).first().click()
    await page.waitForURL(/\/klijenti\//)
    await page.getByTestId("obrisi-klijent-btn").click()
    await page.getByTestId("obrisi-klijent-potvrdi").click()
    await page.waitForURL(/\/klijenti(\?|$)/)
    await expect(page.getByRole("heading", { name: "Klijenti" })).toBeVisible()
  })
})
```

- [ ] **Step 6.6: Full check**
```bash
pnpm test:e2e tests/e2e/04-klijenti.spec.ts && pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 6.7: Commit**
```bash
git add app/ components/domain/KlijentEditForm.tsx components/domain/ObrisiKlijentButton.tsx tests/e2e/04-klijenti.spec.ts && git commit -m "feat(phase-4): klijent edit + delete (RESTRICT guard)

- actions: updateKlijent (UNIQUE→poruka), deleteKlijent (FK RESTRICT→poruka)
- KlijentEditForm (Sheet), ObrisiKlijentButton (disabled kad broj_termina>0)
- detail header dohvaća klijenti_view (broj_termina za guard)
- E2E: edit napomena, delete disabled (sa terminima), delete fresh klijent"
```

---

## Task 7: Comprehensive E2E + phase gate + tag v0.4.0

**Files:**
- Modify: `tests/e2e/04-klijenti.spec.ts` (vizuelni smoke + Kontakti tab)

- [ ] **Step 7.1: Dodaj vizuelni smoke + Kontakti provjeru**
```ts
test.describe("Faza 4 — Vizuelni smoke", () => {
  test("klijenti ekran screenshot @ 1440x900", async ({ page }) => {
    await page.goto("/klijenti")
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("klijenti-grid")).toBeVisible()
    await page.screenshot({ path: "test-results/klijenti-faza4.png", fullPage: true })
  })

  test("Kontakti tab prikazuje kontakt iz lokacije", async ({ page }) => {
    // kreiraj klijenta + lokaciju sa kontaktom, pa provjeri Kontakti tab
    const naziv = "Kontakt Klijent " + Date.now()
    await page.goto("/klijenti")
    await page.getByTestId("novi-klijent-btn").click()
    await page.getByTestId("novi-klijent-naziv").fill(naziv)
    await page.getByTestId("novi-klijent-submit").click()
    await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
    await page.goto("/klijenti?q=" + encodeURIComponent("Kontakt"))
    await page.getByTestId("klijent-card").filter({ hasText: naziv }).first().click()
    await page.waitForURL(/\/klijenti\//)
    await page.getByRole("tab", { name: "Lokacije" }).click()
    await page.getByTestId("nova-lokacija-btn").click()
    await page.getByTestId("lokacija-naziv").fill("Centrala")
    await page.getByTestId("lokacija-kontakt_osoba").fill("Ana A.")
    await page.getByTestId("lokacija-submit").click()
    await expect(page.getByTestId("lokacija-sheet")).toBeHidden({ timeout: 5000 })
    await page.getByRole("tab", { name: "Kontakti" }).click()
    await page.waitForURL(/tab=kontakti/)
    await expect(page.getByTestId("tab-kontakti-content")).toContainText("Ana A.")
  })
})
```

- [ ] **Step 7.2: Pun E2E (clean seed)**
```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && pnpm db:reset && pnpm seed && pnpm test:e2e
```
Svi spec-ovi (01-04) pass na Chromium + WebKit, --workers=1.

- [ ] **Step 7.3: Full check**
```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e
```

- [ ] **Step 7.4: Commit + push**
```bash
git add tests/e2e/04-klijenti.spec.ts && git commit -m "test(phase-4): comprehensive 04-klijenti + vizuelni smoke + Kontakti" && git push origin main
```

- [ ] **Step 7.5: Phase 4 Gate — fresh agent**
Dispatch novi `general-purpose` agent, prazan kontekst:
```
You are an independent verifier for Phase 4 of the Tehpro MVP. NO context. Validate ONLY Phase 4 (Klijenti CRUD + Lokacije).
Inputs: codebase /Users/nmil/Desktop/Ai Forward/tehpro-mvp/, spec §7.2 E/F, plan docs/superpowers/plans/2026-06-21-tehpro-mvp-phase-4-klijenti-lokacije.md. LOCAL ONLY (Docker Supabase).
Tasks:
1. supabase start if down; pnpm install; pnpm db:reset && pnpm seed
2. pnpm build && pnpm lint && pnpm typecheck (exit 0)
3. pnpm test:unit (vitest pass)
4. pnpm test:e2e (ALL pass Chromium+WebKit, note count)
5. DB: psql -c "select naziv, broj_lokacija, broj_termina, broj_kasni from klijenti_view order by broj_termina desc limit 3;" — view returns aggregates
6. Manual via mcp__playwright__*: /klijenti grid renders; search WAIK→WAIKIKI; open detail; tabs Termini/Lokacije/Kontakti/Dokumenti switch; create klijent (+1); create lokacija in Lokacije tab; delete disabled for klijent with termini; zero console errors; screenshot.
7. Inventory: app/(dashboard)/klijenti/{page.tsx,actions.ts,[id]/page.tsx}, components/domain/{KlijentCard,KlijentiSearch,NoviKlijentButton,KlijentTabs,KlijentEditForm,ObrisiKlijentButton,LokacijeTab,LokacijaSheet,ObrisiLokacijuButton}.tsx, migration *_klijenti_read_model.sql. grep no sm:/md:.
8. Git: clean, ~8 commits since v0.3.0, pushed.
Return STRICT JSON: {phase:4, gate_1:{build,lint,typecheck}, gate_2_unit, gate_3_e2e, gate_4_view, gate_5_manual:[...], gate_6_inventory, gate_6_no_sm_md, gate_7_git, commits_since_v0_3_0, blockers:[], non_blockers:[]}
Do NOT suggest improvements. Stop dev server when done.
```
Ako blockers → fiks → re-run. Ako čisto → tag.

- [ ] **Step 7.6: Tag v0.4.0**
```bash
git tag -a v0.4.0 -m "Phase 4 — Klijenti CRUD + Lokacije complete

T1: klijenti_view read-model (agregatni counts)
T2: /klijenti lista (KlijentCard grid + search + paginacija)
T3: createKlijent + NoviKlijentButton
T4: /klijenti/[id] detalji + tabovi (Termini/Kontakti/Dokumenti)
T5: Lokacije CRUD (create/edit/delete + tab)
T6: klijent edit + delete (RESTRICT guard)
T7: comprehensive E2E + phase gate

Phase Gate: ALL PASS. Repo: https://github.com/stpauli98/Tehrpo" && git push origin v0.4.0
```

---

## Self-Review

**1. Spec coverage:**
- §7.2 E (/klijenti): search ✓ (T2 ilike), cards grid sa naziv + broj lokacija + broj aktivnih + broj kasnih (crveni badge) ✓ (KlijentCard, T2). **Razlika:** spec "Cards grid" — koristimo cards (ne tabela), match. Tip/grad NISU u shemi (mockup mock) — dokumentovano, kartice prikazuju samo realne podatke.
- §7.2 F (/klijenti/[id] tabovi Termini/Lokacije/Dokumenti/Kontakti): sva 4 taba ✓ (T4+T5). Termini=lista, Lokacije=CRUD, Kontakti=derived, Dokumenti=placeholder(Faza 7).
- §7.5 KlijentCard: ✓ (T2). Dodatne komponente (KlijentiSearch, NoviKlijentButton, KlijentTabs, LokacijaSheet, itd.) potrebne za CRUD.
- §8 scope "List, trigram search, detail, lokacije tabovi": sve ✓.
- §9.1 04-klijenti.spec.ts (search WAIK→WAIKIKI, detail prikazuje lokacije): ✓ (T2 search, T5 lokacije).

**2. Placeholder scan:**
- Dokumenti tab = placeholder Faza 7 (eksplicitno odložen, ne TODO). OK.
- Lokacije tab stub u T4 → zamijenjen pravim CRUD-om u T5 (sekvencijalni razvoj, ne placeholder na kraju). OK.
- Kontakti tab je derived iz lokacija (prazno stanje dok nema lokacija sa kontaktom) — realan feature, ne stub. OK.
- Nema "TBD"/"implement later" u plan kodu. KlijentEditForm/ObrisiKlijentButton imaju kompletan kod.

**3. Type consistency:**
- `KlijentRow` = klijenti_view Row (T2, KlijentCard) — koristi se u page liste. Detalji koristi klijenti table Row za edit + klijenti_view za header counts (T6). Konzistentno.
- `ActionResult` iz klijenti/actions.ts (T3) → svi klijent/lokacija client komponenti. Match.
- `LokacijaRow` = lokacije table Row — u LokacijeTab/LokacijaSheet/[id] page. Match.
- klijenti_view kolone (broj_*) nullable u TS → guard sa `?? 0` svuda (KlijentCard, header). OK.
- createLokacija/updateLokacija/deleteLokacija/createKlijent/updateKlijent/deleteKlijent — imena konzistentna actions↔komponente. Match.

**Rizici flagovani za implementera (iz understand faze):**
1. base-ui Tabs/Select `data-testid` možda ne stigne na DOM — testovi koriste `getByRole("tab"/"option")`. Plan to već radi.
2. Trigram threshold — koristimo `.ilike` (ne similarity operator). Riješeno u T2.
3. Lokacije prazne u seed-u — empty state + E2E kreira lokaciju prije edit/delete. Riješeno u T5.
4. Klijent delete RESTRICT — disable kad broj_termina>0 + FK error poruka. Riješeno u T6.
5. `revalidatePath(path, "layout")` Next 16 signatura — verifikovati; fallback proslijedi klijent_id i revalidiraj specifičnu rutu.
6. base-ui `onValueChange` daje `string | null` — guard `v ?? "termini"` već u KlijentTabs kodu.
7. klijenti_view nullable kolone — riješeno: `notFound()` guard u T4 narrowuje id/naziv; KlijentEditForm prima minimalni `{id, naziv, napomena}` (bez `!`).

**Prihvaćene odluke / divergencije (nakon adversarial 3-lens critique):**
- **Next.js 16** (ne spec §3.1 "Next 15") — Faza 1 scaffold je uzeo `@latest`=16; usklađeno kroz sve faze. Svjesna divergencija od Faze 1.
- **broj_aktivnih** koristi `status_izvedeni` (ne `status`) → međusobno isključivo sa `broj_kasni` (nema dvostrukog brojanja na kartici).
- **Kasni badge** uvijek prikazan na kartici (crven >0, neutralan =0) — spec §7.2 E traži "broj kasnih" kao stalno polje.
- **regija** dodana u LokacijaSheet formu (shema/actions je već imaju).
- **Termini tab** renderuje sve termine klijenta bez paginacije (WAIKIKI ~194 redova). Prihvatljivo za MVP (query-by-page je o round-trips, ne render-rows); paginacija tab-a je backlog.
- **Tabs bez TabsContent/Panel** — server renderuje panele preko `?tab=`; tabovi voze navigaciju. Funkcionalno ispravno; ARIA `role=tabpanel` wrapper je opcioni nice-to-have, odložen.
- **revalidatePath("/klijenti", "layout")** — potvrđeno valjano (revalidira /klijenti + /klijenti/[id] podstablo); koristi se u svim lokacija/klijent mutacijama uključujući createLokacija (da se broj_lokacija na listi osvježi).
