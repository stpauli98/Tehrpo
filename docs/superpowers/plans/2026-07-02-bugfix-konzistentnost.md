# Bugfix & konzistentnost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Popraviti 6 verifikovanih bugova (tihe greške, debounce leak, poruke) i ukloniti duplikaciju/nekonzistentnost (DRY helperi, dijeljene konstante, Pagination komponenta) — bez promjene vidljivog ponašanja osim ispravki.

**Architecture:** Ciljane izmjene po fajlu; nova zajednička logika u `lib/` (`applyPlanFilteri`, `friendlyDbError`, `TERMINI_PER_PAGE`, `STATUS_ORDER`) i nova prezentaciona komponenta `components/domain/Pagination.tsx`. Svaki task je samostalno testabilan; verifikacija kroz `pnpm typecheck`, ciljane Vitest unit testove (za čiste funkcije) i postojeće Playwright E2E specove (regresija).

**Tech Stack:** Next.js 16 (webpack), React, Supabase (@supabase/postgrest-js), Tailwind, Vitest, Playwright.

## Global Constraints

- Kod MORA i dalje prolaziti `pnpm typecheck` i `pnpm lint` (0 grešaka) nakon svakog taska.
- NE mijenjati nijedan `data-testid` niti `aria-label` (E2E se oslanja na njih).
- Bez `sm:`/`md:` Tailwind breakpointa (eslint `no-restricted-syntax`) — koristiti `lg:`+ ili bez.
- `no-await-in-loop: error` svuda osim `scripts/`.
- Domenski jezik bosanski (klijenti/termini/…); nazivi identifikatora prate postojeći kod.
- Vitest samo za `lib/**/*.test.ts` (node env, čista logika); UI/behavior verifikovati kroz Playwright E2E (`--project=chromium`) + typecheck.
- E2E ide protiv DEMO projekta (dev server + `tests/e2e/db.ts` čitaju `.env.development.local`).
- Commit poruke prefiks `fix(...)` za bugove, `refactor(...)`/`feat(ui)` za poboljšanja; svaki task jedan commit.

---

## Faza A — Bugovi

### Task 1: Debounce timer cleanup u TerminiFilters (MEDIUM)

**Files:**
- Modify: `components/domain/TerminiFilters.tsx` (dodati cleanup effect uz postojeći `searchTimer` ref, ~linija 87)

**Interfaces:**
- Consumes: postojeći `searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)`.

- [ ] **Step 1: Dodati `useEffect` import ako fali**

Provjeri vrh fajla: `import { useRef, useState } from "react"` → dopuni na `import { useEffect, useRef, useState } from "react"`.

- [ ] **Step 2: Dodati cleanup effect odmah nakon deklaracije `searchTimer`**

Nađi liniju `const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)` i dodaj ispod:

```tsx
  // Otkaži pending debounce pri unmount-u — inače zaostali timer okine router.push
  // (bez view=kalendar) i poništi prebacivanje prikaza / navigaciju.
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint 2>&1 | grep -c error`
Expected: typecheck clean; `0` (nema novih lint grešaka).

- [ ] **Step 4: E2E regresija pretrage**

Run: `pnpm exec playwright test tests/e2e/03-termini.spec.ts -g "pretraga" --project=chromium`
Expected: PASS (živa pretraga i dalje radi).

- [ ] **Step 5: Commit**

```bash
git add components/domain/TerminiFilters.tsx
git commit -m "fix(plan): otkazi pending search debounce pri unmount-u TerminiFilters"
```

---

### Task 2: `createProfilProvjere` — ne gutaj greške (termin insert + dedup select)

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts` (~linije 259-267, `createProfilProvjere`)

- [ ] **Step 1: Provjeri grešku dedup-select upita i inserta termina**

Zamijeni blok:

```tsx
  let q = supabase.from("termini").select("id").eq("klijent_id", klijent_id).eq("vrsta_provjere_id", vrsta_provjere_id).not("status", "in", "(izvrseno,otkazano)")
  q = lokacija_id ? q.eq("lokacija_id", lokacija_id) : q.is("lokacija_id", null)
  const { data: postoji } = await q.limit(1)
  if (!postoji || postoji.length === 0) {
    await supabase.from("termini").insert({
      klijent_id, vrsta_provjere_id, lokacija_id,
      rok_dospijeca: rok, status: "planirano", interval_mjeseci: interval, nacin_izvrsenja,
    })
  }
```

sa:

```tsx
  let q = supabase.from("termini").select("id").eq("klijent_id", klijent_id).eq("vrsta_provjere_id", vrsta_provjere_id).not("status", "in", "(izvrseno,otkazano)")
  q = lokacija_id ? q.eq("lokacija_id", lokacija_id) : q.is("lokacija_id", null)
  const { data: postoji, error: selErr } = await q.limit(1)
  if (selErr) return { ok: false, message: "Provjera je sačuvana, ali provjera termina nije uspjela — osvježi stranicu." }
  if (!postoji || postoji.length === 0) {
    const { error: terminErr } = await supabase.from("termini").insert({
      klijent_id, vrsta_provjere_id, lokacija_id,
      rok_dospijeca: rok, status: "planirano", interval_mjeseci: interval, nacin_izvrsenja,
    })
    if (terminErr) return { ok: false, message: "Provjera je sačuvana, ali termin nije generisan: " + terminErr.message }
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: E2E regresija profila (generisanje termina)**

Run: `pnpm exec playwright test tests/e2e/16-profil.spec.ts --project=chromium`
Expected: PASS (dodavanje provjere i dalje generiše termin; happy-path nepromijenjen).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/klijenti/actions.ts"
git commit -m "fix(profil): ne gutaj gresku pri generisanju termina u createProfilProvjere"
```

---

### Task 3: lista ruta — provjeri greške pomoćnih upita

**Files:**
- Modify: `app/api/plan-aktivnosti/lista/route.ts` (~linije 40-55, nakon `Promise.all`)

- [ ] **Step 1: Nakon destrukturiranja rezultata, vrati 400 ako neki neophodan upit padne**

Nađi `if (listRes.error) { return NextResponse.json({ error: listRes.error }, { status: 400 }) }` i zamijeni sa:

```tsx
  const meta = { statsRes, klijentiRes, vrsteRes, lokacijeRes }
  const prviErr = listRes.error
    ?? Object.values(meta).map((r) => r.error).find(Boolean)
  if (prviErr) {
    return NextResponse.json({ error: prviErr.message ?? "Greška pri učitavanju" }, { status: 400 })
  }
```

(Napomena: imena `statsRes/klijentiRes/vrsteRes/lokacijeRes` moraju odgovarati destrukturiranju iznad; ako se razlikuju, uskladi.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: E2E regresija liste**

Run: `pnpm exec playwright test tests/e2e/02-data.spec.ts tests/e2e/03-termini.spec.ts -g "renderuje tabelu|učitava|stranica" --project=chromium`
Expected: PASS (lista se učitava normalno kad su svi upiti OK).

- [ ] **Step 4: Commit**

```bash
git add app/api/plan-aktivnosti/lista/route.ts
git commit -m "fix(plan): lista ruta vraca 400 kad padne pomocni upit (bez tihe degradacije)"
```

---

### Task 4: `PrimaPodsjetnikeToggle` — vrati checkbox na grešci

**Files:**
- Modify: `components/domain/PrimaPodsjetnikeToggle.tsx`

- [ ] **Step 1: Na grešci vrati vizuelno stanje checkboxa**

Zamijeni `onChange` handler:

```tsx
      onChange={(e) => {
        const el = e.currentTarget
        const next = el.checked
        start(async () => {
          const r = await postaviPrimaPodsjetnike(korisnikId, next)
          if (!r.ok) el.checked = !next // brana odbila → vrati na stvarno stanje
          toast[r.ok ? "success" : "error"](r.ok ? "Sačuvano." : (r.message ?? "Greška."))
        })
      }}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint 2>&1 | grep -c error`
Expected: clean; `0`.

- [ ] **Step 3: Commit**

```bash
git add components/domain/PrimaPodsjetnikeToggle.tsx
git commit -m "fix(postavke): vrati toggle stanje kad postaviPrimaPodsjetnike padne"
```

---

### Task 5: Poruka za istekli reset-link (`?greska=istekao`)

**Files:**
- Modify: `app/zaboravljena-lozinka/page.tsx`

- [ ] **Step 1: Pročitaj `greska` iz URL-a i prikaži poruku (komponenta je već 'use client')**

Dodaj import i banner. Zamijeni cijeli fajl:

```tsx
"use client"
import { useActionState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { posaljiReset, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: false }

export default function ZaboravljenaLozinkaPage() {
  const [state, action, pending] = useActionState(posaljiReset, initial)
  const istekao = useSearchParams().get("greska") === "istekao"
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form action={action} className="w-80 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <h1 className="text-lg font-medium">Reset lozinke</h1>
        {istekao && (
          <p className="text-sm text-amber-700" role="alert">
            Link je istekao ili je nevažeći. Unesite email da pošaljemo novi.
          </p>
        )}
        <Input name="email" type="email" placeholder="Email" required />
        {state.message && <p className="text-sm text-slate-600" role="status">{state.message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Slanje…" : "Pošalji link"}
        </Button>
        <Link href="/prijava" className="block text-center text-xs text-slate-500 hover:underline">Nazad na prijavu</Link>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (Napomena: `useSearchParams` u client komponenti na statičkoj ruti — ako build traži Suspense boundary, stranica je `min-h-screen` full-page; obmotaj `export default` sadržaj u `<Suspense fallback={null}>` ako `next build` prijavi CSR-bailout.)

- [ ] **Step 3: Commit**

```bash
git add app/zaboravljena-lozinka/page.tsx
git commit -m "fix(auth): prikazi poruku za istekli/nevazeci reset link (?greska=istekao)"
```

---

### Task 6: Uskladi limite veličine uploada (12mb framework vs 50MB provjera)

**Files:**
- Modify: `lib/supabase/storage.ts` (`MAX_BYTES` 50MB → 10MB)
- Modify: `components/domain/DokumentiSekcija.tsx` (dodati klijentsku provjeru veličine, kao u `KlijentDokumentUpload.tsx`)

**Interfaces:**
- `MAX_BYTES` se koristi u `dokumenti/actions.ts` provjerama (`file.size > MAX_BYTES`) i poruci — poruka mora reći tačan limit.

- [ ] **Step 1: Spusti `MAX_BYTES` na 10 MB (ispod bodySizeLimit 12mb; usklađeno sa komentarom u next.config)**

U `lib/supabase/storage.ts` zamijeni:

```ts
export const MAX_BYTES = 52_428_800 // 50 MiB
```

sa:

```ts
export const MAX_BYTES = 10_485_760 // 10 MiB (ispod serverActions.bodySizeLimit=12mb u next.config.ts)
```

- [ ] **Step 2: Uskladi poruke o veličini u akcijama**

U `app/(dashboard)/dokumenti/actions.ts` nađi sve poruke tipa `"Fajl je veći od 50 MB."` i zamijeni tekst na `"Fajl je veći od 10 MB."` (grep: `grep -n "50 MB" "app/(dashboard)/dokumenti/actions.ts"`).

- [ ] **Step 3: Dodaj klijentsku provjeru veličine u DokumentiSekcija (termin-level upload)**

U `components/domain/DokumentiSekcija.tsx`, u handleru koji priprema `dokument-file` upload (prije poziva `uploadAction`), dodaj provjeru po uzoru na `KlijentDokumentUpload.tsx`:

```tsx
  const MAX_MB = 10
  // unutar submit/onChange handlera, prije slanja:
  if (file && file.size > MAX_MB * 1024 * 1024) {
    toast.error(`Fajl je veći od ${MAX_MB} MB.`)
    return
  }
```

(Ako `DokumentiSekcija` nema `toast` import: `import { toast } from "sonner"`. Prilagodi tačno mjesto handleru koji već postoji — pogledaj `KlijentDokumentUpload.tsx` za obrazac.)

- [ ] **Step 4: Typecheck + E2E upload**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/08-dokumenti.spec.ts -g "upload" --project=chromium`
Expected: clean; PASS (upload validnog malog PDF-a i dalje radi).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/storage.ts "app/(dashboard)/dokumenti/actions.ts" components/domain/DokumentiSekcija.tsx
git commit -m "fix(dokumenti): uskladi limit uploada na 10MB (ispod bodySizeLimit) + klijentska provjera"
```

---

## Faza B — Konzistentnost / DRY

### Task 7: `applyPlanFilteri` helper (ukloni dupliran filter blok)

**Files:**
- Modify: `lib/plan-filteri.ts` (dodati `applyPlanFilteri`)
- Modify: `app/api/plan-aktivnosti/lista/route.ts` (zamijeniti inline filtere pozivom)
- Modify: `app/api/plan-aktivnosti/izvoz/route.ts` (zamijeniti inline filtere pozivom)
- Test: `lib/plan-filteri.test.ts` (unit)

**Interfaces:**
- Produces: `applyPlanFilteri<Q>(q: Q, f: PlanFilteri): Q` — primjenjuje status/q/klijent/lokacija/vrsta/nacin/mjesecRange na PostgREST builder i vraća ga.

- [ ] **Step 1: Napiši failing unit test sa mock builder-om**

Dodaj u `lib/plan-filteri.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { applyPlanFilteri, type PlanFilteri } from "./plan-filteri"

function mockQ() {
  const calls: [string, unknown][] = []
  const q: Record<string, (...a: unknown[]) => unknown> = {}
  for (const m of ["eq", "or", "gte", "lte"]) q[m] = (...a: unknown[]) => { calls.push([m, a]); return q }
  return { q, calls }
}
const base: PlanFilteri = { status: "svi", q: "", klijentId: "", lokacijaId: "", vrstaId: "", mjesec: "svi", godina: 2026, nacin: "svi" }

describe("applyPlanFilteri", () => {
  it("bez filtera ne poziva ništa (mjesec=svi → nema range)", () => {
    const { q, calls } = mockQ()
    applyPlanFilteri(q as never, base)
    expect(calls).toEqual([])
  })
  it("status+klijent+nacin primjenjuje eq redom", () => {
    const { q, calls } = mockQ()
    applyPlanFilteri(q as never, { ...base, status: "kasni", klijentId: "K1", nacin: "izvrsava" })
    expect(calls).toContainEqual(["eq", ["status_izvedeni", "kasni"]])
    expect(calls).toContainEqual(["eq", ["klijent_id", "K1"]])
    expect(calls).toContainEqual(["eq", ["nacin_izvrsenja", "izvrsava"]])
  })
  it("q sanitizuje zagrade/zareze i pravi .or ilike", () => {
    const { q, calls } = mockQ()
    applyPlanFilteri(q as never, { ...base, q: "a,(b)" })
    expect(calls[0][0]).toBe("or")
    expect(String(calls[0][1])).not.toMatch(/[(),]/)
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti (funkcija ne postoji)**

Run: `pnpm vitest run lib/plan-filteri.test.ts`
Expected: FAIL (`applyPlanFilteri` nije eksportovan).

- [ ] **Step 3: Implementiraj `applyPlanFilteri` u `lib/plan-filteri.ts`**

Dodaj na kraj fajla:

```ts
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js"

/** Primjenjuje sve plan-filtere na termini_view upit (DRY: isto za lista i izvoz rutu). */
export function applyPlanFilteri<
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
  const r = mjesecRange(f)
  if (r) out = out.gte("rok_dospijeca", r.from).lte("rok_dospijeca", r.to)
  return out
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/plan-filteri.test.ts`
Expected: PASS.

- [ ] **Step 5: Zamijeni inline filtere u lista ruti**

U `app/api/plan-aktivnosti/lista/route.ts`: dodaj `import { parsePlanFilteri, mjesecRange, applyPlanFilteri } from "@/lib/plan-filteri"` (mjesecRange ostaje ako se koristi za `r`; inače ukloni). Zamijeni blok `if (f.status …) … if (f.nacin …) … const r = mjesecRange(f); if (r) …` sa:

```ts
  listQuery = applyPlanFilteri(listQuery, f)
```

(zadrži `.range(from, to)` i `.order(...)` kako jesu; `applyPlanFilteri` ne dira njih.)

- [ ] **Step 6: Zamijeni inline filtere u izvoz ruti**

U `app/api/plan-aktivnosti/izvoz/route.ts`: dodaj `applyPlanFilteri` u import iz `@/lib/plan-filteri`. Zamijeni blok `if (f.status …) … const r = mjesecRange(f); if (r) q = q.gte(...).lte(...)` sa:

```ts
  q = applyPlanFilteri(q, f)
```

- [ ] **Step 7: Typecheck + E2E (lista + izvoz nepromijenjeni)**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/03-termini.spec.ts tests/e2e/20-plan-aktivnosti.spec.ts --project=chromium`
Expected: clean; PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/plan-filteri.ts lib/plan-filteri.test.ts app/api/plan-aktivnosti/lista/route.ts app/api/plan-aktivnosti/izvoz/route.ts
git commit -m "refactor(plan): applyPlanFilteri helper (DRY lista+izvoz filter blok) + unit test"
```

---

### Task 8: Dijeljena konstanta `TERMINI_PER_PAGE`

**Files:**
- Modify: `lib/plan-filteri.ts` (dodati `export const TERMINI_PER_PAGE = 50`)
- Modify: `app/(dashboard)/plan-aktivnosti/_views/lista.tsx` (koristiti je umjesto lokalne `PER_PAGE`)
- Modify: `app/api/plan-aktivnosti/lista/route.ts` (koristiti je umjesto lokalne konstante)

- [ ] **Step 1: Dodaj konstantu u `lib/plan-filteri.ts`**

```ts
/** Broj termina po strani — DIJELJENO klijent (lista.tsx) i server (lista route). */
export const TERMINI_PER_PAGE = 50
```

- [ ] **Step 2: Zamijeni lokalne definicije**

- U `app/(dashboard)/plan-aktivnosti/_views/lista.tsx`: ukloni `const PER_PAGE = 50` i dodaj u import `TERMINI_PER_PAGE`; zamijeni upotrebe `PER_PAGE` → `TERMINI_PER_PAGE`.
- U `app/api/plan-aktivnosti/lista/route.ts`: pronađi lokalnu per-page konstantu (grep `50` / `PER_PAGE` / `range`) i zamijeni je uvezenom `TERMINI_PER_PAGE`.

- [ ] **Step 3: Typecheck + E2E paginacija**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/03-termini.spec.ts -g "paginacija|učitava" --project=chromium`
Expected: clean; PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/plan-filteri.ts "app/(dashboard)/plan-aktivnosti/_views/lista.tsx" app/api/plan-aktivnosti/lista/route.ts
git commit -m "refactor(plan): jedinstvena TERMINI_PER_PAGE konstanta (klijent+server)"
```

---

### Task 9: `friendlyDbError` helper + klijenti akcije

**Files:**
- Create: `lib/db-errors.ts`
- Test: `lib/db-errors.test.ts`
- Modify: `app/(dashboard)/klijenti/actions.ts` (zamijeniti sirove `error.message` povratke)

**Interfaces:**
- Produces: `friendlyDbError(error: { code?: string; message?: string } | null | undefined): string`.

- [ ] **Step 1: Failing unit test**

`lib/db-errors.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { friendlyDbError } from "./db-errors"

describe("friendlyDbError", () => {
  it("23505 → duplikat", () => expect(friendlyDbError({ code: "23505" })).toMatch(/već postoji/i))
  it("23503 → u upotrebi", () => expect(friendlyDbError({ code: "23503" })).toMatch(/u upotrebi|povezan/i))
  it("23514 → nevažeći podaci", () => expect(friendlyDbError({ code: "23514" })).toMatch(/nevažeć/i))
  it("nepoznat kod → generička poruka (ne curi raw)", () => {
    const msg = friendlyDbError({ code: "XX999", message: "permission denied for table korisnici" })
    expect(msg).not.toMatch(/permission denied/)
  })
  it("null → generička poruka", () => expect(friendlyDbError(null)).toBeTruthy())
})
```

- [ ] **Step 2: Pokreni — FAIL**

Run: `pnpm vitest run lib/db-errors.test.ts`
Expected: FAIL (modul ne postoji).

- [ ] **Step 3: Implementiraj `lib/db-errors.ts`**

```ts
/** Mapira Postgres/PostgREST error kod na domaću poruku; nikad ne vraća sirovi interni tekst. */
export function friendlyDbError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  switch (error?.code) {
    case "23505": return "Zapis sa tim vrijednostima već postoji."
    case "23503": return "Zapis je povezan s drugim podacima i u upotrebi je."
    case "23514": return "Nevažeći podaci — provjerite unos."
    case "23502": return "Nedostaje obavezno polje."
    default: return "Došlo je do greške pri spremanju. Pokušajte ponovo."
  }
}
```

- [ ] **Step 4: Pokreni — PASS**

Run: `pnpm vitest run lib/db-errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Zamijeni sirove poruke u `klijenti/actions.ts`**

Dodaj `import { friendlyDbError } from "@/lib/db-errors"`. Nađi grane koje vraćaju `{ ok: false, message: <error>.message }` (grep: `message: .*Err.message` u tom fajlu) i zamijeni na `{ ok: false, message: friendlyDbError(<error>) }`. ZADRŽI eksplicitne domaće poruke koje već postoje (npr. `23505 → "Ova provjera već postoji…"`) — helper je samo za grane koje su vraćale sirovi `.message`.

- [ ] **Step 6: Typecheck + E2E klijenti**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/04-klijenti.spec.ts -g "kreira|uređuje|briše" --project=chromium`
Expected: clean; PASS (happy-path CRUD nepromijenjen). Napomena: 04-klijenti ima pre-postojeći WAIKIKI fail (ne od ove izmjene) — ignoriši ga, gledaj samo -g filtrirane.

- [ ] **Step 7: Commit**

```bash
git add lib/db-errors.ts lib/db-errors.test.ts "app/(dashboard)/klijenti/actions.ts"
git commit -m "refactor(klijenti): friendlyDbError helper (ne curi sirovi PG error u UI)"
```

---

### Task 10: Ukloni no-op `revalidatePath('/plan-aktivnosti')`

**Files:**
- Modify: `app/(dashboard)/termini/actions.ts` (ukloniti `revalidatePath('/plan-aktivnosti')`)
- Modify: `app/(dashboard)/dokumenti/actions.ts` (`revalidateDokumenti` — ukloniti `/plan-aktivnosti` ako je tu)

**Interfaces:**
- `/plan-aktivnosti` ekran je react-query-driven (client fetch), pa `revalidatePath('/plan-aktivnosti')` ne osvježava ništa. Stvarni cache (postavke intervala, `/klijenti/[id]`, `/zapisnici`) ostaje.

- [ ] **Step 1: Grep i ukloni samo `/plan-aktivnosti` revalidate**

Run: `grep -rn "revalidatePath(\"/plan-aktivnosti\")\|revalidatePath('/plan-aktivnosti')" "app/(dashboard)"`
Za svaku pogođenu liniju ukloni SAMO taj poziv (zadrži `revalidatePath('/zapisnici')`, `revalidatePath(\`/klijenti/${...}\`)`, `revalidateVrste()` itd.). NE diraj server-component ekrane koji zaista koriste server render (npr. postavke) ako se tamo pojavi.

- [ ] **Step 2: Typecheck + E2E mutacije termina**

Run: `pnpm typecheck && pnpm exec playwright test tests/e2e/03-termini.spec.ts -g "izvršeno|kreira novi termin|Otkaži|Datum zakazan" --project=chromium`
Expected: clean; PASS (react-query invalidacija i dalje osvježava UI; server revalidate za plan nije bio potreban).

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/termini/actions.ts" "app/(dashboard)/dokumenti/actions.ts"
git commit -m "refactor(plan): ukloni no-op revalidatePath('/plan-aktivnosti') (ekran je react-query)"
```

---

### Task 11: `Pagination` komponenta (lista + klijenti)

**Files:**
- Create: `components/domain/Pagination.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/lista.tsx` (koristiti komponentu)
- Modify: `app/(dashboard)/klijenti/page.tsx` (koristiti komponentu)

**Interfaces:**
- Produces: `Pagination({ pageNum, totalPages, hrefFor, pageTestId }: { pageNum: number; totalPages: number; hrefFor: (p: number) => string; pageTestId: string })` — renderuje strelice (Prethodna/Sljedeća, aria-label + Tooltip) + „Strana X / Y". Prikazuje kontrole samo kad `totalPages > 1`.

- [ ] **Step 1: Kreiraj komponentu (identičan markup kao trenutni, parametrizovan)**

```tsx
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/ikona-tooltip"

export function Pagination({
  pageNum, totalPages, hrefFor, pageTestId,
}: {
  pageNum: number
  totalPages: number
  hrefFor: (p: number) => string
  pageTestId: string
}) {
  if (totalPages <= 1) return null
  const cls = cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "group/tt relative")
  const disabled = cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "pointer-events-none opacity-50")
  return (
    <div className="flex items-center gap-2">
      {pageNum <= 1 ? (
        <span aria-label="Prethodna" className={disabled}><ChevronLeft className="h-4 w-4" aria-hidden /></span>
      ) : (
        <Link href={hrefFor(pageNum - 1)} aria-label="Prethodna" className={cls}>
          <ChevronLeft className="h-4 w-4" aria-hidden /><Tooltip>Prethodna</Tooltip>
        </Link>
      )}
      <span data-testid={pageTestId}>Strana {pageNum} / {totalPages}</span>
      {pageNum >= totalPages ? (
        <span aria-label="Sljedeća" className={disabled}><ChevronRight className="h-4 w-4" aria-hidden /></span>
      ) : (
        <Link href={hrefFor(pageNum + 1)} aria-label="Sljedeća" className={cls}>
          <ChevronRight className="h-4 w-4" aria-hidden /><Tooltip>Sljedeća</Tooltip>
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Koristi u lista.tsx**

U `app/(dashboard)/plan-aktivnosti/_views/lista.tsx` zamijeni cijeli `{totalPages > 1 && (<div className="flex items-center gap-2"> … </div>)}` blok sa:

```tsx
        <Pagination pageNum={pageNum} totalPages={totalPages} hrefFor={pageHref} pageTestId="termini-page" />
```

Dodaj import `import { Pagination } from "@/components/domain/Pagination"`. Ukloni sada neiskorištene importe (`ChevronLeft/ChevronRight/Tooltip/buttonVariants`) ako ih ništa drugo u fajlu ne koristi (provjeri grep prije uklanjanja).

- [ ] **Step 3: Koristi u klijenti/page.tsx**

Analogno zamijeni `{totalPages > 1 && (<div className="flex items-center gap-2"> … </div>)}` sa:

```tsx
          <Pagination pageNum={pageNum} totalPages={totalPages} hrefFor={pageHref} pageTestId="klijenti-page" />
```

Dodaj import; ukloni neiskorištene `ChevronLeft/ChevronRight/Tooltip` importe ako više nisu potrebni.

- [ ] **Step 4: Typecheck + lint + E2E paginacija (oba ekrana)**

Run: `pnpm typecheck && pnpm lint 2>&1 | grep -c error && pnpm exec playwright test tests/e2e/03-termini.spec.ts tests/e2e/04-klijenti.spec.ts -g "paginacija" --project=chromium`
Expected: clean; `0`; PASS (klik po `name:"Sljedeća"/"Prethodna"` radi — aria-label očuvan).

- [ ] **Step 5: Commit**

```bash
git add components/domain/Pagination.tsx "app/(dashboard)/plan-aktivnosti/_views/lista.tsx" "app/(dashboard)/klijenti/page.tsx"
git commit -m "refactor(ui): dijeljena Pagination komponenta (lista + klijenti)"
```

---

### Task 12: `STATUS_ORDER` (dedupe REDOSLIJED)

**Files:**
- Modify: `lib/termini.ts` (dodati `export const STATUS_ORDER`)
- Modify: `components/domain/MatrixLegenda.tsx` (koristiti import)
- Modify: druga komponenta koja definiše isti `REDOSLIJED` (grep da nađeš — vjerovatno `MatrixGrid.tsx` ili `PlanLegenda.tsx`)

- [ ] **Step 1: Nađi obje definicije `REDOSLIJED`**

Run: `grep -rn "REDOSLIJED" components lib`
Zabilježi tačan sadržaj niza (redoslijed statusa) — MORA biti identičan u obje.

- [ ] **Step 2: Dodaj `STATUS_ORDER` u `lib/termini.ts`**

Pored postojećih `STATUS_*` mapa dodaj (koristi TAČAN niz iz Step 1):

```ts
/** Redoslijed statusa za legendu/prikaz. */
export const STATUS_ORDER = ["izvrseno", "planirano", "zakazano", "kasni", "otkazano"] as const
```

(Ako se stvarni niz u kodu razlikuje, koristi taj — ne izmišljaj.)

- [ ] **Step 3: Zamijeni lokalne `REDOSLIJED` importom `STATUS_ORDER`**

U svakoj pogođenoj komponenti: ukloni lokalnu `const REDOSLIJED = [...]`, dodaj `import { STATUS_ORDER } from "@/lib/termini"`, i zamijeni upotrebe `REDOSLIJED` → `STATUS_ORDER`.

- [ ] **Step 4: Typecheck + lint + unit (termini)**

Run: `pnpm typecheck && pnpm vitest run lib/termini.test.ts`
Expected: clean; PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/termini.ts components/domain/MatrixLegenda.tsx
git commit -m "refactor(termini): jedinstven STATUS_ORDER (dedupe REDOSLIJED)"
```

---

## Self-Review

**1. Spec coverage:** 6 bugova → Task 1-6; 10 poboljšanja → najvrednija pokrivena (applyPlanFilteri T7, PER_PAGE T8, friendlyDbError T9, no-op revalidate T10, Pagination T11, STATUS_ORDER T12). Preostala 3 niža poboljšanja (TerminSheet invalidacija helper, detail „istorija" lokacija, godina/mjesec parse helper) NISU u ovom planu — svjesno odgođena kao low-value follow-up (dokumentovati u izvještaju); mogu se dodati kao Task 13-15 istim obrascem ako se odluči.

**2. Placeholder scan:** Nema TBD/„similar to Task N"; svaki kod-korak ima konkretan kod. Napomene u Task 3/8/12 traže grep-potvrdu tačnih imena prije zamjene (jer se oslanjaju na postojeća imena koja variraju) — to je namjerna sigurnosna provjera, ne placeholder.

**3. Type consistency:** `applyPlanFilteri<Q>(q,f):Q` (T7) — isto ime i potpis se koristi u T7 Step 5/6. `friendlyDbError(error):string` (T9) konzistentno. `TERMINI_PER_PAGE` (T8), `STATUS_ORDER` (T12), `Pagination({pageNum,totalPages,hrefFor,pageTestId})` (T11) — imena identična kroz sve korake.

**Rizik-napomene za izvršioca:**
- Task 3/8: imena destrukturiranih rezultata i per-page konstante u `lista/route.ts` provjeri grep-om prije izmjene.
- Task 5: ako `next build` traži Suspense oko `useSearchParams`, obmotaj sadržaj u `<Suspense>`.
- Task 11: obavezno očuvati `aria-label="Prethodna"/"Sljedeća"` (E2E klikće po role name) i `data-testid` (`termini-page`/`klijenti-page`).
- 04-klijenti ima pre-postojeći WAIKIKI fail nevezan za ove izmjene — koristi `-g` filtere pri verifikaciji.
