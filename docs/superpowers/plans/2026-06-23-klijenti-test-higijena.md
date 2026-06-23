# Klijenti — Čišćenje test-podataka + test-higijena — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Očistiti junk test-klijente iz cloud baze (vratiti WAIKIKI napomenu) i refaktorisati mutacione e2e iz `04-klijenti.spec.ts` da koriste throwaway klijent i čiste se u `finally` — tako da budući runovi ne zagađuju.

**Architecture:** Jednokratna cleanup skripta (`scripts/cleanup-test-data.ts`) briše junk klijente (cascade lokacije) i resetuje test-napomene. Test refaktor uvodi throwaway-klijent obrazac (kreiraj → testiraj → `finally` obriši preko `deleteKlijentByNaziv`), čime mutacioni testovi prestaju da diraju prave klijente.

**Tech Stack:** TypeScript, Supabase (cloud), `tsx` skripte (`--env-file=.env.local`), Playwright e2e (cloud), pnpm.

## Global Constraints

- Grana: `fix/klijenti-test-higijena` (NE `main`). Već kreirana i aktivna.
- Cloud Supabase — skripte/e2e protiv cloud-a (`.env.local`, `SUPABASE_SERVICE_ROLE_KEY`). Bez lokalnog Dockera.
- ESLint zabranjuje `no-await-in-loop` (skripta: scoped `// eslint-disable-next-line no-await-in-loop` na await u petlji) i `sm:`/`md:` (nije relevantno).
- Throwaway test-klijenti: prefiks `E2E-TMP ` (npr. `"E2E-TMP " + Date.now()`).
- FK: `lokacije.klijent_id` ON DELETE CASCADE; `termini.klijent_id` ON DELETE RESTRICT (throwaway nemaju termine).
- Read-only testovi nad WAIKIKI ostaju; samo mutacioni prelaze na throwaway.
- WEBKIT COLD-START: zagrijati dev server prije e2e (`ZAPISNIK_DRY_RUN=1 CHAT_DRY_RUN=1 pnpm dev`, čekati Ready, curl `/klijenti` dvaput), pokretati Playwright sa `--workers=1`. Ako test padne SAMO na navigation/load timeout, ponoviti na zagrijanom serveru.
- AGENTS.md: NIJE standardni Next.js.

---

### Task 1: Cleanup skripta + pokretanje na cloud-u

**Files:**
- Create: `scripts/cleanup-test-data.ts`
- Modify: `package.json` (npm script `cleanup:test-data`)

**Interfaces:**
- Consumes: `createAdminSupabaseClient` iz `../lib/supabase/admin`.
- Produces: očišćen cloud (junk klijenti obrisani, test-napomene resetovane).

- [ ] **Step 1: Napisati `scripts/cleanup-test-data.ts`**

```ts
/**
 * Jednokratno čišćenje e2e test-artefakata iz cloud baze.
 * - briše junk klijente (E2E Test Klijent / Kontakt Klijent / Brisivi Klijent / E2E-TMP) — cascade lokacije
 * - resetuje napomenu koja je test-vrijednost (E2E napomena ...)
 * Pokretanje: pnpm cleanup:test-data
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"

const JUNK_KLIJENT = /^(E2E Test Klijent|Kontakt Klijent|Brisivi Klijent|E2E-TMP) /
const JUNK_NAPOMENA = /^E2E napomena /

async function main() {
  const sb = createAdminSupabaseClient()

  // 1) junk klijenti → delete (cascade lokacije)
  const { data: kl, error: kErr } = await sb.from("klijenti").select("id, naziv")
  if (kErr) throw new Error(`select klijenti: ${kErr.message}`)
  const junkIds = (kl ?? []).filter((k) => JUNK_KLIJENT.test(k.naziv as string)).map((k) => k.id)

  const BATCH = 100
  for (let i = 0; i < junkIds.length; i += BATCH) {
    const slice = junkIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("klijenti").delete().in("id", slice)
    if (error) throw new Error(`delete klijenti: ${error.message}`)
  }

  // 2) test-napomene → null
  const { data: kn, error: nErr } = await sb.from("klijenti").select("id, napomena")
  if (nErr) throw new Error(`select napomene: ${nErr.message}`)
  const napIds = (kn ?? [])
    .filter((k) => typeof k.napomena === "string" && JUNK_NAPOMENA.test(k.napomena))
    .map((k) => k.id)
  for (let i = 0; i < napIds.length; i += BATCH) {
    const slice = napIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("klijenti").update({ napomena: null }).in("id", slice)
    if (error) throw new Error(`update napomene: ${error.message}`)
  }

  const { count } = await sb.from("klijenti").select("id", { count: "exact", head: true })
  console.log(`✅ Obrisano ${junkIds.length} junk klijenata; resetovano ${napIds.length} napomena; preostalo klijenata: ${count}`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
```

- [ ] **Step 2: Dodati npm script u `package.json`**

U `"scripts"` (uz `"dedup:termini"`):
```json
    "cleanup:test-data": "tsx --env-file=.env.local scripts/cleanup-test-data.ts",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 4: Pokrenuti čišćenje na cloud-u**

Run: `pnpm cleanup:test-data`
Expected: `✅ Obrisano 12 junk klijenata; resetovano 1 napomena; preostalo klijenata: 18`.

- [ ] **Step 5: Verifikacija (nema junk-a, WAIKIKI napomena prazna)**

```bash
cat > ./_v.mjs <<'EOF'
import { createClient } from "@supabase/supabase-js"; import { readFileSync } from "fs"
const env=Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY)
const {data}=await sb.from("klijenti").select("naziv,napomena")
const junk=data.filter(k=>/^(E2E Test Klijent|Kontakt Klijent|Brisivi Klijent|E2E-TMP) /.test(k.naziv))
const tnap=data.filter(k=>typeof k.napomena==="string"&&/^E2E napomena /.test(k.napomena))
console.log("klijenata:",data.length,"| junk:",junk.length,"| test-napomena:",tnap.length)
EOF
node ./_v.mjs; rm -f ./_v.mjs
```
Expected: `klijenata: 18 | junk: 0 | test-napomena: 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/cleanup-test-data.ts package.json
git commit -m "feat(klijenti): cleanup skripta za e2e test-artefakte (junk klijenti + napomene)"
```

---

### Task 2: `deleteKlijentByNaziv` helper + refaktor mutacionih testova

**Files:**
- Modify: `tests/e2e/db.ts` (dodati `deleteKlijentByNaziv`)
- Modify: `tests/e2e/04-klijenti.spec.ts` (mutacioni testovi → throwaway + `finally`)

**Interfaces:**
- Consumes: postojeći `db` (admin Supabase) iz `tests/e2e/db.ts`.
- Produces: `deleteKlijentByNaziv(naziv: string): Promise<void>` (export iz `./db`).

- [ ] **Step 1: Dodati helper u `tests/e2e/db.ts`**

Na kraj fajla:
```ts
export async function deleteKlijentByNaziv(naziv: string): Promise<void> {
  const { error } = await db.from("klijenti").delete().eq("naziv", naziv)
  if (error) throw new Error(`deleteKlijentByNaziv(${naziv}): ${error.message}`)
}
```

- [ ] **Step 2: U `04-klijenti.spec.ts` dodati import + helpere za kreiranje/navigaciju**

Na vrh fajla (uz postojeći `import { test, expect } from "@playwright/test"`):
```ts
import { deleteKlijentByNaziv } from "./db"

async function kreirajKlijent(page: import("@playwright/test").Page, naziv: string) {
  await page.goto("/klijenti")
  await page.getByTestId("novi-klijent-btn").click()
  await page.getByTestId("novi-klijent-naziv").fill(naziv)
  await page.getByTestId("novi-klijent-submit").click()
  await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
}

async function otvoriKlijent(page: import("@playwright/test").Page, naziv: string) {
  await page.goto("/klijenti?q=" + encodeURIComponent(naziv))
  await page.getByTestId("klijent-card").filter({ hasText: naziv }).first().click()
  await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
}
```

- [ ] **Step 3: Refaktor "Novi klijent" testa (throwaway + finally)**

Zamijeniti tijelo testa "kreira klijenta koji se pojavi u listi" (linije ~108-119):
```ts
  test("kreira klijenta koji se pojavi u listi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await page.goto("/klijenti")
      const before = Number((await page.getByTestId("klijenti-total").textContent())?.match(/\d+/)?.[0] ?? "0")
      await page.getByTestId("novi-klijent-btn").click()
      await expect(page.getByTestId("novi-klijent-sheet")).toBeVisible()
      await page.getByTestId("novi-klijent-naziv").fill(naziv)
      await page.getByTestId("novi-klijent-submit").click()
      await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
      const after = Number((await page.getByTestId("klijenti-total").textContent())?.match(/\d+/)?.[0] ?? "0")
      expect(after).toBe(before + 1)
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 4: Refaktor "uređuje napomenu" — throwaway, NE WAIKIKI**

Zamijeniti tijelo testa "uređuje napomenu klijenta" (linije ~123-132):
```ts
  test("uređuje napomenu klijenta", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      await page.getByTestId("uredi-klijent-btn").click()
      await expect(page.getByTestId("klijent-edit-sheet")).toBeVisible()
      await page.getByTestId("edit-klijent-napomena").fill("E2E napomena " + Date.now())
      await page.getByTestId("edit-klijent-submit").click()
      await expect(page.getByTestId("klijent-edit-sheet")).toBeHidden({ timeout: 5000 })
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 5: Refaktor "kreiran prazan klijent se može obrisati" (E2E-TMP prefiks + finally backstop)**

Zamijeniti tijelo testa (linije ~141-155):
```ts
  test("kreiran prazan klijent se može obrisati", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      await page.getByTestId("obrisi-klijent-btn").click()
      await page.getByTestId("obrisi-klijent-potvrdi").click()
      await page.waitForURL(/\/klijenti(\?|$)/)
      await expect(page.getByRole("heading", { name: "Klijenti" })).toBeVisible()
    } finally {
      await deleteKlijentByNaziv(naziv) // backstop ako UI delete zakaže
    }
  })
```

- [ ] **Step 6: Refaktor "tip odnosa" — throwaway, NE WAIKIKI**

Zamijeniti tijelo testa "uređivanje postavlja tip odnosa na 'po ugovoru'" (linije ~159-168):
```ts
  test("uređivanje postavlja tip odnosa na 'po ugovoru'", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      await page.getByRole("button", { name: "Uredi" }).click()
      await page.getByTestId("klijent-tip-odnosa").click()
      await page.getByRole("option", { name: "Po ugovoru" }).click()
      await page.getByRole("button", { name: /Spremi/ }).click()
      await expect(page.getByTestId("tip-odnosa-badge")).toContainText("po ugovoru")
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 7: Refaktor "Kontakti tab" — throwaway + finally**

Zamijeniti tijelo testa "Kontakti tab prikazuje kontakt iz lokacije" (linije ~179-199):
```ts
  test("Kontakti tab prikazuje kontakt iz lokacije", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      await page.getByRole("tab", { name: "Lokacije" }).click()
      await page.waitForURL(/tab=lokacije/)
      await page.getByTestId("nova-lokacija-btn").click()
      await page.getByTestId("lokacija-naziv").fill("Centrala")
      await page.getByTestId("lokacija-kontakt_osoba").fill("Ana A.")
      await page.getByTestId("lokacija-submit").click()
      await expect(page.getByTestId("lokacija-sheet")).toBeHidden({ timeout: 5000 })
      await page.getByRole("tab", { name: "Kontakti" }).click()
      await page.waitForURL(/tab=kontakti/)
      await expect(page.getByTestId("tab-kontakti-content")).toContainText("Ana A.")
    } finally {
      await deleteKlijentByNaziv(naziv) // cascade briše lokaciju "Centrala"
    }
  })
```

- [ ] **Step 8: Refaktor "Lokacije CRUD" — throwaway klijent (ne WAIKIKI)**

Zamijeniti tijelo testa "kreira, uređuje i briše lokaciju" (linije ~74-104) tako da prvo kreira throwaway klijent i radi CRUD na njemu:
```ts
  test("kreira, uređuje i briše lokaciju", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
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

      // delete — red nestane
      await row.getByRole("button", { name: "Obriši" }).click()
      await page.getByTestId("obrisi-lokaciju-potvrdi").click()
      await expect(page.getByTestId("lokacija-row").filter({ hasText: "Test Lokacija" })).toHaveCount(0)
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 9: Provjeriti da read-only testovi NISU dirani**

Read-only testovi koji ostaju nepromijenjeni (ne mutiraju WAIKIKI): "prikazuje grid", "pretraga WAIK", "paginacija", "bez console grešaka", "otvara detalje ... termini tab", "prebacivanje Lokacije/Dokumenti tab", "delete je onemogućen za klijenta sa terminima", "vizuelni smoke screenshot". Potvrditi da su netaknuti.

- [ ] **Step 10: Higijena-dokaz — broj klijenata prije == poslije**

Zagrijati dev server (`ZAPISNIK_DRY_RUN=1 CHAT_DRY_RUN=1 pnpm dev`, čekati Ready, curl `/klijenti` dvaput).
Zabilježi broj:
```bash
cat > ./_n.mjs <<'EOF'
import { createClient } from "@supabase/supabase-js"; import { readFileSync } from "fs"
const env=Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY)
const {count}=await sb.from("klijenti").select("id",{count:"exact",head:true})
console.log("klijenata:",count)
EOF
node ./_n.mjs; rm -f ./_n.mjs
```
Pokreni: `pnpm exec playwright test tests/e2e/04-klijenti.spec.ts --workers=1 --reporter=line`
Expected: sve zeleno. Pa PONOVO prebroj klijente istom skriptom — **broj prije == poslije** (0 zaostalog junk-a). I provjeri `junk: 0` (regex iz Task 1 Step 5).

- [ ] **Step 11: Lint + typecheck + build + ugasiti server**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka.
Run: `lsof -ti:3000 | xargs kill`

- [ ] **Step 12: Commit**

```bash
git add tests/e2e/db.ts tests/e2e/04-klijenti.spec.ts
git commit -m "test(klijenti): throwaway klijent + finally cleanup u mutacionim testovima (ne diraj WAIKIKI)"
```

---

## Završna verifikacija (cijela grana)

- [ ] `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka.
- [ ] Cloud: 18 klijenata, junk 0, test-napomena 0.
- [ ] `04-klijenti.spec.ts` zelen; broj klijenata prije==poslije (higijena dokazana); ponovni run i dalje čist.
- [ ] Regresija: `12-obilasci`, `15-obilasci-dorada`, `10-pregled` zeleni.
