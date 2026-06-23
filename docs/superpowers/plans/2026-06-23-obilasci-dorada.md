# Dorada Obilasci taba — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Učiniti da Obilasci tab stvarno grupiše termine po gradu (izvlačenjem grada iz naziva lokacije), uz filter statusa i broj termina po gradu.

**Architecture:** Jedna deterministička funkcija `izvediGrad` (whitelist BiH gradova) je izvor istine; koriste je parser (budući importi) i backfill skripta (postojeći cloud podaci). `termini_view` već izlaže `lokacija_grad`, pa grupisanje proradi čim se `lokacije.grad` popuni. UX: status filter (default "Aktivni") + broj po gradu u zaglavlju grupe.

**Tech Stack:** Next.js 16 App Router (server components), TypeScript, Tailwind v4, base-ui Select, Supabase (cloud), `tsx` skripte (`--env-file=.env.local`), vitest unit, Playwright e2e (cloud), pnpm.

## Global Constraints

- Grana: `fix/obilasci-dorada` (NE `main`). Već kreirana i aktivna.
- Cloud Supabase — e2e i backfill protiv cloud-a (`.env.local`, `SUPABASE_SERVICE_ROLE_KEY`). Bez lokalnog Dockera.
- Desktop-only: zabranjen `sm:`/`md:` breakpoint (ESLint). ESLint zabranjuje i `no-await-in-loop` (u testovima koristiti `Promise.all(...map())`).
- `izvediGrad` je jedini izvor istine za izvlačenje grada (DRY: parser + backfill).
- Whitelist = pravi BiH gradovi; market/negeo nazivi (Kort, Delta, RS, FBiH, Centrala, PJ…) → "Bez grada".
- Default filter statusa: **Aktivni** = `status_izvedeni NOT IN (izvrseno, otkazano)`.
- AGENTS.md: NIJE standardni Next.js — kod iz plana je tačan za ovaj codebase; ako nešto odstupa, konsultovati `node_modules/next/dist/docs/`.
- Dev server (vizuelna provjera): `ZAPISNIK_DRY_RUN=1 CHAT_DRY_RUN=1 pnpm dev` na portu 3000; ugasiti kad ne treba. Zagrijati rutu prije webkit e2e (cold-start flake).

---

### Task 1: `izvediGrad` + jedinični testovi

**Files:**
- Modify: `lib/obilasci.ts` (dodati `GRADOVI_BIH`, `foldGrad`, `izvediGrad`; `groupByGrad` ostaje)
- Test: `lib/obilasci.test.ts` (dodati `describe("izvediGrad")`)

**Interfaces:**
- Produces: `izvediGrad(naziv: string | null, postojeciGrad?: string | null): string | null` (named export iz `@/lib/obilasci`). Vraća kanonski grad ili `null` ("Bez grada").

- [ ] **Step 1: Napisati padajuće testove u `lib/obilasci.test.ts`**

Dodati na kraj fajla (uz postojeći `groupByGrad` describe), import proširiti na `import { groupByGrad, izvediGrad, type ObilazakItem } from "./obilasci"`:

```ts
describe("izvediGrad", () => {
  it("čist grad → kanonski oblik (case/dijakritika)", () => {
    expect(izvediGrad("PRIJEDOR")).toBe("Prijedor")
    expect(izvediGrad("BRČKO")).toBe("Brčko")
    expect(izvediGrad("GRADIŠKA")).toBe("Gradiška")
    expect(izvediGrad("ISTOČNO SARAJEVO")).toBe("Istočno Sarajevo")
  })
  it("'Grad - Objekat' → grad iz prefiksa", () => {
    expect(izvediGrad("Banja Luka - Kort")).toBe("Banja Luka")
    expect(izvediGrad("Banja Luka - Delta")).toBe("Banja Luka")
    expect(izvediGrad("Banja Luka - Emporium")).toBe("Banja Luka")
  })
  it("višegradski naziv (zarez) → prvi segment", () => {
    expect(izvediGrad("ZVORNIK, BRČKO, BIJELJINA")).toBe("Zvornik")
  })
  it("market/negeo nazivi → null (Bez grada)", () => {
    expect(izvediGrad("KORT, DELTA")).toBeNull()
    expect(izvediGrad("RS")).toBeNull()
    expect(izvediGrad("FBiH - kancelarija")).toBeNull()
    expect(izvediGrad("Centrala")).toBeNull()
    expect(izvediGrad("PJ 20")).toBeNull()
  })
  it("postojeći grad se zadržava (ne gazi se)", () => {
    expect(izvediGrad("Dom zdravlja", "Laktasi")).toBe("Laktasi")
    expect(izvediGrad("BRČKO", "Doboj")).toBe("Doboj")
  })
  it("prazan/null naziv → null", () => {
    expect(izvediGrad(null)).toBeNull()
    expect(izvediGrad("   ")).toBeNull()
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti (nema `izvediGrad`)**

Run: `pnpm test -- lib/obilasci.test.ts`
Expected: FAIL ("izvediGrad is not a function" / import error).

- [ ] **Step 3: Implementirati `izvediGrad` u `lib/obilasci.ts`**

Dodati na vrh fajla (iznad ili ispod `groupByGrad`):

```ts
// Whitelist pravih BiH gradova (fold ključ → kanonski oblik za prikaz)
const GRADOVI_BIH: Record<string, string> = {
  "banja luka": "Banja Luka", "bijeljina": "Bijeljina", "brcko": "Brčko",
  "derventa": "Derventa", "doboj": "Doboj", "gradiska": "Gradiška",
  "istocno sarajevo": "Istočno Sarajevo", "prijedor": "Prijedor",
  "prnjavor": "Prnjavor", "trebinje": "Trebinje", "zvornik": "Zvornik",
  "laktasi": "Laktaši", "sarajevo": "Sarajevo", "mostar": "Mostar",
  "tuzla": "Tuzla", "zenica": "Zenica",
}

// lowercase + skini dijakritiku za poređenje s whitelistom
function foldGrad(s: string): string {
  return s
    .toLowerCase()
    .replace(/dž/g, "dz")
    .replace(/[čć]/g, "c")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .replace(/đ/g, "d")
    .trim()
}

/**
 * Izvlači grad iz naziva lokacije (whitelist BiH gradova; market/negeo → null).
 * Zadržava već postavljeni postojeciGrad.
 */
export function izvediGrad(naziv: string | null, postojeciGrad?: string | null): string | null {
  const pg = postojeciGrad?.trim()
  if (pg) return pg
  if (!naziv?.trim()) return null
  let s = naziv.trim()
  if (s.includes(",")) s = s.split(",")[0]!.trim()        // višegradski → prvi
  if (s.includes(" - ")) s = s.split(" - ")[0]!.trim()    // "Grad - Objekat" → grad
  return GRADOVI_BIH[foldGrad(s)] ?? null
}
```

- [ ] **Step 4: Pokrenuti — mora proći**

Run: `pnpm test -- lib/obilasci.test.ts`
Expected: PASS (svi `izvediGrad` + postojeći `groupByGrad` testovi).

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 6: Commit**

```bash
git add lib/obilasci.ts lib/obilasci.test.ts
git commit -m "feat(obilasci): izvediGrad — whitelist BiH gradova iz naziva lokacije"
```

---

### Task 2: Parser + seed popunjavaju `grad`

**Files:**
- Modify: `lib/excel/parser.types.ts` (tip `lokacije` + `grad`)
- Modify: `lib/excel/parser.ts` (poziv `izvediGrad` pri građenju lokacije)
- Modify: `scripts/seed-from-excel.ts` (`LokacijaRow` + upis `grad`)

**Interfaces:**
- Consumes: `izvediGrad` iz Taska 1.
- Produces: `ParseResult.lokacije` je sada `{ firma_naziv: string; lokacija_naziv: string; grad: string | null }[]`; seed upisuje `grad` u `lokacije` tabelu.

- [ ] **Step 1: Proširiti tip u `lib/excel/parser.types.ts`**

Linija 14 trenutno:
```ts
  lokacije: { firma_naziv: string; lokacija_naziv: string }[] // dedup pari
```
Zamijeniti sa:
```ts
  lokacije: { firma_naziv: string; lokacija_naziv: string; grad: string | null }[] // dedup pari
```

- [ ] **Step 2: U `lib/excel/parser.ts` popuniti `grad` pri građenju lokacije**

Na vrhu fajla dodati import (provjeriti stil postojećih importa — koriste relativne putanje, npr. `./parser.types`):
```ts
import { izvediGrad } from "../obilasci"
```

U `addFirmaLokacija` (oko linije 251), zamijeniti:
```ts
        lokacijeArr.push({ firma_naziv: firma, lokacija_naziv: lokacija })
```
sa:
```ts
        lokacijeArr.push({ firma_naziv: firma, lokacija_naziv: lokacija, grad: izvediGrad(lokacija) })
```

- [ ] **Step 3: U `scripts/seed-from-excel.ts` upisati `grad`**

Linija 103 (`LokacijaRow` tip) zamijeniti:
```ts
  type LokacijaRow = { klijent_id: string; naziv: string }
```
sa:
```ts
  type LokacijaRow = { klijent_id: string; naziv: string; grad: string | null }
```

Linija 113 (push) zamijeniti:
```ts
    lokacijeRows.push({ klijent_id: klijentId, naziv: lok.lokacija_naziv })
```
sa:
```ts
    lokacijeRows.push({ klijent_id: klijentId, naziv: lok.lokacija_naziv, grad: lok.grad })
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 grešaka. (Ovo je integraciona izmjena tipova; typecheck je glavna provjera. Postojeći parser unit testovi, ako provjeravaju strukturu lokacije, mogu zahtijevati `grad` polje — ako padnu, ažurirati očekivanja u testu da uključe `grad`.)

- [ ] **Step 5: Pokrenuti parser unit testove (ako postoje)**

Run: `pnpm test -- lib/excel`
Expected: PASS. Ako neki test poredi cijeli `lokacije` objekat i ne očekuje `grad`, dopuniti očekivanje sa `grad: <izvedeni>` (npr. za "Banja Luka - Delta" → `grad: "Banja Luka"`). Ako nema parser testova koji diraju strukturu lokacije, preskočiti.

- [ ] **Step 6: Commit**

```bash
git add lib/excel/parser.types.ts lib/excel/parser.ts scripts/seed-from-excel.ts
git commit -m "feat(obilasci): parser i seed popunjavaju lokacije.grad preko izvediGrad"
```

---

### Task 3: Backfill skripta + pokretanje na cloud-u

**Files:**
- Create: `scripts/backfill-lokacija-grad.ts`
- Modify: `package.json` (npm script `backfill:grad`)

**Interfaces:**
- Consumes: `createAdminSupabaseClient` iz `../lib/supabase/admin`, `izvediGrad` iz `../lib/obilasci`.
- Produces: popunjen `lokacije.grad` u cloud bazi (preduslov za e2e u Tasku 5).

- [ ] **Step 1: Napisati `scripts/backfill-lokacija-grad.ts`**

```ts
/**
 * Backfill lokacije.grad iz naziva lokacije (izvediGrad).
 * Ne dira termine; termini_view već izlaže lokacija_grad.
 * Pokretanje: pnpm backfill:grad
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { izvediGrad } from "../lib/obilasci"

async function main() {
  const sb = createAdminSupabaseClient()
  const { data, error } = await sb.from("lokacije").select("id, naziv, grad")
  if (error) throw new Error(`select lokacije failed: ${error.message}`)
  const lokacije = data ?? []

  let azurirano = 0
  let bezGrada = 0
  const dist: Record<string, number> = {}

  for (const l of lokacije) {
    const noviGrad = izvediGrad(l.naziv as string | null, l.grad as string | null)
    const trenutni = (l.grad as string | null) ?? null
    if (noviGrad !== trenutni) {
      const { error: upErr } = await sb
        .from("lokacije")
        .update({ grad: noviGrad })
        .eq("id", l.id)
      if (upErr) throw new Error(`update ${l.id} failed: ${upErr.message}`)
      azurirano++
    }
    if (noviGrad) dist[noviGrad] = (dist[noviGrad] ?? 0) + 1
    else bezGrada++
  }

  console.log(`✅ Backfill gotov: ${azurirano} ažurirano, ${lokacije.length} ukupno`)
  console.log(`   Bez grada: ${bezGrada}`)
  console.log(`   Distribucija:`, dist)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
```

- [ ] **Step 2: Dodati npm script u `package.json`**

U `"scripts"` blok (uz `"seed"`) dodati:
```json
    "backfill:grad": "tsx --env-file=.env.local scripts/backfill-lokacija-grad.ts",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 4: Pokrenuti backfill na cloud-u**

Run: `pnpm backfill:grad`
Expected: izlaz tipa `✅ Backfill gotov: ~28 ažurirano, 33 ukupno` + distribucija s više gradova (Banja Luka, Prijedor, Zvornik…). Provjeriti da `Bez grada` broj odgovara negeo/market lokacijama (RS, FBiH×2, Centrala×N, PJ 20, KORT/DELTA).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-lokacija-grad.ts package.json
git commit -m "feat(obilasci): backfill skripta za lokacije.grad (cloud)"
```

---

### Task 4: Status filter u toolbaru + upitu

**Files:**
- Modify: `components/domain/ObilasciToolbar.tsx` (status `Select`)
- Modify: `app/(dashboard)/obilasci/page.tsx` (čita `status`, filtrira upit)
- Test: `tests/e2e/15-obilasci-dorada.spec.ts` (kreira se ovdje; status filter test)

**Interfaces:**
- Consumes: postojeći `setParam` helper u toolbaru; `searchParams.status`.
- Produces: `data-testid="obilasci-status"` (SelectTrigger). Default vrijednost `"aktivni"`.

- [ ] **Step 1: Napisati padajući e2e test u novom `tests/e2e/15-obilasci-dorada.spec.ts`**

```ts
import { test, expect } from "@playwright/test"

test.describe("Obilasci dorada — status filter", () => {
  test("default je Aktivni (bez izvršenih); Svi vraća izvršene", async ({ page }) => {
    await page.goto("/obilasci?period=godina&godina=2026")
    // default Aktivni → nijedna kartica nema status badge "Izvršen"
    await expect(page.getByTestId("obilasci-status")).toBeVisible()
    const izvrseniDefault = page.getByTestId("obilasci-card").locator('[data-status="izvrseno"]')
    await expect(izvrseniDefault).toHaveCount(0)
    // prebaci na Svi → pojave se izvršeni
    await page.getByTestId("obilasci-status").click()
    await page.getByRole("option", { name: "Svi" }).click()
    await page.waitForURL(/status=svi/)
    await expect(page.getByTestId("obilasci-card").locator('[data-status="izvrseno"]').first()).toBeVisible()
  })
})
```

NAPOMENA: `StatusBadge` renderuje `data-status` na span-u (postojeći testid `status-badge` ima `data-status`). Kartica `obilasci-card` sadrži `StatusBadge`, pa `[data-status="izvrseno"]` unutar kartice cilja izvršene.

- [ ] **Step 2: Pokrenuti — mora pasti (nema `obilasci-status`)**

Run: `pnpm exec playwright test tests/e2e/15-obilasci-dorada.spec.ts -g "status filter" --reporter=line`
Expected: FAIL (timeout na `obilasci-status`).

- [ ] **Step 3: Dodati status `Select` u `ObilasciToolbar.tsx`**

Pročitati `status` iz searchParams uz ostale (oko linije 26-29):
```ts
  const status = sp.get("status") ?? "aktivni"
```

Dodati `statusItems` mapu (uz `periodItems`, oko linije 33):
```ts
  const statusItems: Record<string, string> = {
    aktivni: "Aktivni", svi: "Svi", kasni: "Kasni", planirano: "Planirano",
    zakazano: "Zakazano", izvrseno: "Izvršeno", otkazano: "Otkazano",
  }
```

Dodati `Select` u toolbar (npr. odmah poslije period `Select`-a, prije mjesec/kvartal):
```tsx
      <Select value={status} onValueChange={(v) => setParam("status", v ?? "")} items={statusItems}>
        <SelectTrigger data-testid="obilasci-status" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="aktivni">Aktivni</SelectItem>
          <SelectItem value="svi">Svi</SelectItem>
          <SelectItem value="kasni">Kasni</SelectItem>
          <SelectItem value="planirano">Planirano</SelectItem>
          <SelectItem value="zakazano">Zakazano</SelectItem>
          <SelectItem value="izvrseno">Izvršeno</SelectItem>
          <SelectItem value="otkazano">Otkazano</SelectItem>
        </SelectContent>
      </Select>
```

NAPOMENA: `setParam` već briše prazan param. Pošto je default "aktivni" ne-prazan, biranje "aktivni" će postaviti `?status=aktivni` — to je OK (server tretira odsustvo i "aktivni" isto, vidi Step 5).

- [ ] **Step 4: Čitati `status` i filtrirati upit u `obilasci/page.tsx`**

Uz ostale `sp` čitanja (oko linije 14-19) dodati:
```ts
  const status = typeof sp.status === "string" ? sp.status : "aktivni"
```

Zamijeniti postojeći upit (linije 24-30) tako da se filter primijeni prije `.order`:
```ts
  let q = supabase
    .from("termini_view")
    .select("id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, status_izvedeni")
    .gte("rok_dospijeca", od)
    .lte("rok_dospijeca", doIso)
  if (status === "aktivni") q = q.not("status_izvedeni", "in", "(izvrseno,otkazano)")
  else if (status !== "svi") q = q.eq("status_izvedeni", status)
  const { data } = await q
    .order("lokacija_grad", { ascending: true })
    .order("rok_dospijeca", { ascending: true })
```

- [ ] **Step 5: Proslijediti `status` u toolbar (ako je potrebno) i pokrenuti test**

`ObilasciToolbar` čita `status` direktno iz `useSearchParams`, pa nije potreban novi prop. Pokrenuti test:

Run: `pnpm exec playwright test tests/e2e/15-obilasci-dorada.spec.ts -g "status filter" --reporter=line`
Expected: PASS (1 test × 2 browsera = 2 passed). (Zagrijati dev server prije ako webkit prijavi navigation timeout.)

- [ ] **Step 6: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 7: Commit**

```bash
git add components/domain/ObilasciToolbar.tsx "app/(dashboard)/obilasci/page.tsx" tests/e2e/15-obilasci-dorada.spec.ts
git commit -m "feat(obilasci): filter statusa (default Aktivni)"
```

---

### Task 5: Broj po gradu + e2e grupisanja

**Files:**
- Modify: `app/(dashboard)/obilasci/page.tsx` (broj u zaglavlju grupe)
- Test: `tests/e2e/15-obilasci-dorada.spec.ts` (dodati grupisanje + broj test)

**Interfaces:**
- Consumes: `g.items.length` (već dostupno u mapi grupa).
- Produces: zaglavlje grupe prikazuje `{grad} (N)`; `data-testid="obilasci-grupa"` ostaje.

- [ ] **Step 1: Dodati e2e test (grupisanje proradilo + broj) u `tests/e2e/15-obilasci-dorada.spec.ts`**

Dodati novi `test.describe` blok:
```ts
test.describe("Obilasci dorada — grupisanje po gradu", () => {
  test("ima više grupa gradova (ne samo 'Bez grada') i broj u zaglavlju", async ({ page }) => {
    await page.goto("/obilasci?period=godina&godina=2026&status=svi")
    const grupe = page.getByTestId("obilasci-grupa")
    expect(await grupe.count()).toBeGreaterThan(1)
    // bar jedno zaglavlje sadrži grad Banja Luka ili Prijedor
    await expect(page.getByRole("heading", { name: /Banja Luka|Prijedor|Zvornik/ }).first()).toBeVisible()
    // zaglavlje prikazuje broj u zagradama, npr. "(3)"
    await expect(page.getByTestId("obilasci-grupa").first().getByText(/\(\d+\)/).first()).toBeVisible()
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti (nema broja u zaglavlju)**

Run: `pnpm exec playwright test tests/e2e/15-obilasci-dorada.spec.ts -g "grupisanje" --reporter=line`
Expected: FAIL na asercji broja `(\d+)` (zaglavlje još nema broj). *(Asercija „više od 1 grupe" prolazi tek nakon backfilla iz Taska 3 — koji je već urađen.)*

- [ ] **Step 3: Dodati broj u zaglavlje grupe u `obilasci/page.tsx`**

Zamijeniti `<h2>` u zaglavlju grupe (oko linije 60):
```tsx
              <h2 className="font-semibold">{g.grad}</h2>
```
sa:
```tsx
              <h2 className="font-semibold">
                {g.grad} <span className="text-slate-400 font-normal">({g.items.length})</span>
              </h2>
```

- [ ] **Step 4: Pokrenuti — mora proći**

Run: `pnpm exec playwright test tests/e2e/15-obilasci-dorada.spec.ts -g "grupisanje" --reporter=line`
Expected: PASS (1 test × 2 browsera = 2 passed).

- [ ] **Step 5: Regresija — postojeći `12-obilasci` + cijeli novi spec**

Run: `pnpm exec playwright test tests/e2e/12-obilasci.spec.ts tests/e2e/15-obilasci-dorada.spec.ts --reporter=line`
Expected: PASS. Ako neki `12-obilasci` test tvrdi da je sve "Bez grada" ili broji grupe na stari način, ažurirati ga da odražava novo grupisanje (npr. očekuje ≥1 grupu s pravim gradom). Pokazati promjenu u commitu.

- [ ] **Step 6: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka, build prolazi.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/obilasci/page.tsx" tests/e2e/15-obilasci-dorada.spec.ts tests/e2e/12-obilasci.spec.ts
git commit -m "feat(obilasci): broj termina po gradu u zaglavlju + e2e grupisanja"
```

---

## Završna verifikacija (cijela grana)

- [ ] `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka.
- [ ] `pnpm test -- lib/obilasci.test.ts` — unit zeleno.
- [ ] `pnpm exec playwright test tests/e2e/12-obilasci.spec.ts tests/e2e/15-obilasci-dorada.spec.ts` — zeleno (flake ponoviti na zagrijanom serveru).
- [ ] Vizuelno (dev server): `/obilasci` prikazuje grupe pravih gradova s brojem; status filter default skriva izvršene; "Svi" ih vraća. Market nazivi (Kort/Delta) vidljivi kao detalj kartice pod gradom.
- [ ] Ugasiti dev server (`lsof -ti:3000 | xargs kill`).
