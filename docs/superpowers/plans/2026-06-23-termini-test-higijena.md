# 03-termini test-higijena — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Očistiti junk termine (rok ≥ 2030 + E2E napomene) iz cloud-a i refaktorisati mutacione testove iz `03-termini.spec.ts` da koriste throwaway klijent (insert termina → operiši → `finally` obriši), tako da suite više ne dira prave podatke.

**Architecture:** Proširenje postojeće `cleanup-test-data.ts` na termine (rok ≥ 2030, E2E napomene). Test refaktor: svaki mutacioni test kreira throwaway klijent, radi na NJEGOVIM terminima (insert preko db helpera, otvori via `?selected`), i u `finally` briše termine klijenta (uklj. auto-cycle dijete) pa klijent. Novi db helperi: `insertKlijent`, `deleteTerminiByKlijent`, `getVrstaInterval`; `setVrstaInterval` prima `number | null`.

**Tech Stack:** TypeScript, Supabase (cloud), `tsx` skripte, Playwright e2e (cloud), pnpm.

## Global Constraints

- Grana: `fix/termini-test-higijena` (NE `main`). Već kreirana i aktivna.
- Cloud Supabase — skripte/e2e protiv cloud-a (`.env.local`, `SUPABASE_SERVICE_ROLE_KEY`).
- ESLint zabranjuje `no-await-in-loop` (skripta: scoped `// eslint-disable-next-line no-await-in-loop`) i `sm:`/`md:`.
- Throwaway klijent: prefiks `E2E-TMP ` (cleanup skripta to hvata kao backstop).
- Junk termin granica: `rok_dospijeca >= '2030-01-01'`.
- FK: `lokacije.klijent_id` CASCADE; `termini.klijent_id` RESTRICT → throwaway klijent: prvo `deleteTerminiByKlijent` pa `deleteKlijentByNaziv`.
- `insertTermin` postavlja status "planirano"; rok u prošlosti → view izvodi `kasni`.
- Read-only testovi ostaju; samo mutacioni prelaze na throwaway.
- WEBKIT COLD-START: zagrijati server (`ZAPISNIK_DRY_RUN=1 CHAT_DRY_RUN=1 pnpm dev`, čekati Ready, curl `/termini` dvaput), Playwright `--workers=1`.
- AGENTS.md: NIJE standardni Next.js.

---

### Task 1: Cleanup junk termina (proširenje skripte) + pokretanje

**Files:**
- Modify: `scripts/cleanup-test-data.ts` (dodati termini čišćenje)

**Interfaces:**
- Consumes: postojeći `createAdminSupabaseClient`.
- Produces: očišćeni cloud (junk termini obrisani, test-napomene resetovane).

- [ ] **Step 1: Dodati termini čišćenje u `scripts/cleanup-test-data.ts`**

PRVO (robusnost): pošto je `termini.klijent_id` ON DELETE RESTRICT, junk klijent koji nosi termine (npr. throwaway iz 03-termini koji je ostao nakon test-crash-a) ne može se obrisati dok mu se termini ne uklone. Umetnuti — ODMAH NAKON izračuna `junkIds`, a PRIJE postojeće petlje koja briše junk klijente — brisanje njihovih termina:
```ts
  // junk klijenti mogu nositi termine (throwaway iz 03-termini nakon crash-a) → prvo termini (FK restrict)
  if (junkIds.length) {
    const { error: jtErr } = await sb.from("termini").delete().in("klijent_id", junkIds)
    if (jtErr) throw new Error(`delete junk-klijent termini: ${jtErr.message}`)
  }
```

Zatim, prije završnog `count`/`console.log` bloka (linije ~41-42), dodati:
```ts
  // 3) junk termini (rok >= 2030 — test-kreirani; pravi su 2026)
  const { data: far, error: fErr } = await sb.from("termini").select("id").gte("rok_dospijeca", "2030-01-01")
  if (fErr) throw new Error(`select far termini: ${fErr.message}`)
  const farIds = (far ?? []).map((t) => t.id)
  for (let i = 0; i < farIds.length; i += BATCH) {
    const slice = farIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("termini").delete().in("id", slice)
    if (error) throw new Error(`delete termini: ${error.message}`)
  }

  // 4) test-napomene na terminima → null
  const { data: tn, error: tErr } = await sb.from("termini").select("id, napomena").not("napomena", "is", null)
  if (tErr) throw new Error(`select termin napomene: ${tErr.message}`)
  const tnIds = (tn ?? []).filter((t) => /E2E/i.test(t.napomena as string)).map((t) => t.id)
  for (let i = 0; i < tnIds.length; i += BATCH) {
    const slice = tnIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("termini").update({ napomena: null }).in("id", slice)
    if (error) throw new Error(`update termin napomene: ${error.message}`)
  }
```

Proširiti završni `console.log` da uključi termine:
```ts
  const { count } = await sb.from("klijenti").select("id", { count: "exact", head: true })
  console.log(`✅ Klijenti: obrisano ${junkIds.length} junk, resetovano ${napIds.length} napomena (preostalo ${count}). Termini: obrisano ${farIds.length} junk (rok>=2030), resetovano ${tnIds.length} napomena.`)
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 3: Pokrenuti čišćenje na cloud-u**

Run: `pnpm cleanup:test-data`
Expected: `✅ Klijenti: obrisano 0 junk, resetovano 0 napomena (preostalo 18). Termini: obrisano 12 junk (rok>=2030), resetovano 2 napomena.`

- [ ] **Step 4: Verifikacija (nema junk termina)**

```bash
cat > ./_v.mjs <<'EOF'
import { createClient } from "@supabase/supabase-js"; import { readFileSync } from "fs"
const env=Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY)
const {data:far}=await sb.from("termini").select("id").gte("rok_dospijeca","2030-01-01")
const {data:tn}=await sb.from("termini").select("napomena").not("napomena","is",null)
const e2e=tn.filter(t=>/E2E/i.test(t.napomena||""))
const {count}=await sb.from("termini").select("id",{count:"exact",head:true})
console.log("termina:",count,"| rok>=2030:",far.length,"| E2E napomena:",e2e.length)
EOF
node ./_v.mjs; rm -f ./_v.mjs
```
Expected: `rok>=2030: 0 | E2E napomena: 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/cleanup-test-data.ts
git commit -m "feat(termini): cleanup junk termina (rok>=2030 + E2E napomene)"
```

---

### Task 2: db helperi + refaktor mutacionih testova

**Files:**
- Modify: `tests/e2e/db.ts` (`insertKlijent`, `deleteTerminiByKlijent`, `getVrstaInterval`; `setVrstaInterval` prima `number | null`)
- Modify: `tests/e2e/03-termini.spec.ts` (6 mutacionih testova → throwaway klijent + `finally`)

**Interfaces:**
- Consumes: `db` (admin Supabase) iz `tests/e2e/db.ts`; postojeći `insertTermin`, `deleteKlijentByNaziv`, `firstActiveVrstaId`.
- Produces: `insertKlijent(naziv): Promise<string>`, `deleteTerminiByKlijent(klijentId): Promise<void>`, `getVrstaInterval(vrstaId): Promise<number | null>`.

- [ ] **Step 1: Dodati helpere u `tests/e2e/db.ts`**

Na kraj fajla:
```ts
export async function insertKlijent(naziv: string): Promise<string> {
  const { data, error } = await db.from("klijenti").insert({ naziv }).select("id").single()
  if (error) throw new Error(`insertKlijent(${naziv}): ${error.message}`)
  return data.id as string
}

export async function deleteTerminiByKlijent(klijentId: string): Promise<void> {
  const { error } = await db.from("termini").delete().eq("klijent_id", klijentId)
  if (error) throw new Error(`deleteTerminiByKlijent(${klijentId}): ${error.message}`)
}

export async function getVrstaInterval(vrstaId: string): Promise<number | null> {
  const { data } = await db
    .from("vrste_provjera")
    .select("podrazumevani_interval_mjeseci")
    .eq("id", vrstaId)
    .single()
  return (data?.podrazumevani_interval_mjeseci as number | null) ?? null
}
```

Proširiti `setVrstaInterval` da prima `number | null` (za restore na null):
```ts
export async function setVrstaInterval(vrstaId: string, mjeseci: number | null): Promise<void> {
  await db
    .from("vrste_provjera")
    .update({ podrazumevani_interval_mjeseci: mjeseci })
    .eq("id", vrstaId)
}
```

- [ ] **Step 2: Proširiti import u `03-termini.spec.ts`**

Postojeći:
```ts
import { terminIdByStatus, firstActiveVrstaId, setVrstaInterval, kasniTerminForVrsta } from "./db"
```
Zamijeniti sa:
```ts
import {
  firstActiveVrstaId, setVrstaInterval, getVrstaInterval,
  insertTermin, deleteTerminiByKlijent, insertKlijent, deleteKlijentByNaziv,
} from "./db"
```
(`terminIdByStatus`/`kasniTerminForVrsta` se više ne koriste u mutacionim testovima — ukloniti iz importa ako ih nijedan preostali test ne koristi; provjeriti grep prije uklanjanja.)

- [ ] **Step 3: Refaktor "uredi napomenu i spremi" (throwaway)**

Zamijeniti tijelo testa (linije ~145-155):
```ts
  test("uredi napomenu i spremi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const vrsta = await firstActiveVrstaId()
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2027-05-01" })
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()
      await page.getByTestId("edit-napomena").fill("E2E test napomena")
      await page.getByTestId("edit-save").click()
      await expect(page.getByTestId("termin-sheet").locator("[role=alert]")).toHaveCount(0)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 4: Refaktor "označi kao izvršeno + auto-cycle" (throwaway, restore interval)**

Zamijeniti tijelo testa (linije ~157-186):
```ts
  test("označi kao izvršeno mijenja status i kreira novi ciklus", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstActiveVrstaId()
    const origInterval = await getVrstaInterval(vrsta)
    try {
      await setVrstaInterval(vrsta, 12)
      // kasni termin (rok u prošlosti) za throwaway klijent
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2025-01-15" })
      await page.goto("/termini")
      const before = Number(await page.getByTestId("stat-ukupno-value").textContent())
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("mark-done-form")).toBeVisible()
      await page.getByTestId("mark-done-submit").click()
      await expect(page.getByTestId("termin-sheet").locator("[role=alert]")).toHaveCount(0)
      await page.goto("/termini")
      const after = Number(await page.getByTestId("stat-ukupno-value").textContent())
      expect(after).toBe(before + 1)
    } finally {
      await setVrstaInterval(vrsta, origInterval)
      await deleteTerminiByKlijent(kid) // briše izvršeni + auto-cycle dijete
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 5: Refaktor "Otkaži termin → Otkazano" (throwaway)**

Zamijeniti tijelo testa (linije ~191-200):
```ts
  test("Otkaži termin → status postaje Otkazano", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const vrsta = await firstActiveVrstaId()
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2027-06-10" })
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()
      await page.getByTestId("otkazi-arm").click()
      await page.getByTestId("otkazi-submit").click()
      await expect(page.getByTestId("termin-sheet")).toContainText("Otkazano")
      await expect(page.getByTestId("otkazi-arm")).toHaveCount(0)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 6: Refaktor "uređivanje Datum zakazan → Zakazano" (throwaway)**

Zamijeniti tijelo testa (linije ~202-210):
```ts
  test("uređivanje 'Datum zakazan' prebaci planirano → Zakazano", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const vrsta = await firstActiveVrstaId()
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2027-07-20" })
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()
      await page.getByTestId("edit-datum-zakazan").fill("2030-08-01")
      await page.getByTestId("edit-save").click()
      await expect(page.getByTestId("termin-sheet")).toContainText("Zakazano")
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 7: Refaktor "kreira novi termin (UI)" (throwaway klijent biran u dropdownu)**

Zamijeniti tijelo testa (linije ~223-249):
```ts
  test("kreira novi termin koji se pojavi u listi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto("/termini")
      const before = Number(await page.getByTestId("stat-ukupno-value").textContent())
      await page.getByTestId("novi-termin-btn").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()
      await page.getByTestId("novi-klijent").click()
      await page.getByRole("option", { name: naziv }).click()
      await page.getByTestId("novi-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("novi-rok").fill("2029-03-15")
      await page.getByTestId("novi-submit").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })
      const after = Number(await page.getByTestId("stat-ukupno-value").textContent())
      expect(after).toBe(before + 1)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 8: Refaktor "duplikat" (throwaway klijent)**

Zamijeniti tijelo testa (linije ~251-273):
```ts
  test("duplikat (isti klijent+vrsta+rok) je odbijen porukom", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const rok = "2029-04-20"
    try {
      async function popuni() {
        await page.getByTestId("novi-termin-btn").click()
        await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()
        await page.getByTestId("novi-klijent").click()
        await page.getByRole("option", { name: naziv }).click()
        await page.getByTestId("novi-vrsta").click()
        await page.getByRole("option").first().click()
        await page.getByTestId("novi-rok").fill(rok)
        await page.getByTestId("novi-submit").click()
      }
      await page.goto("/termini")
      await popuni()
      await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })
      await popuni()
      await expect(page.getByText("Termin za istu firmu, vrstu i rok već postoji.")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 9: Provjeriti read-only testove (netaknuti)**

Read-only ostaju: "renderuje listu", KPI/stats, filteri, pretraga, "Detalji otvara sheet", "Zatvori sheet vraća na listu", vizuelni smoke. Potvrditi da nisu dirani i da nijedan ne koristi uklonjeni `terminIdByStatus`/`kasniTerminForVrsta` (ako koristi, ostaviti te importe).

- [ ] **Step 10: Higijena-dokaz — broj termina prije == poslije**

Zagrijati dev server (curl `/termini` dvaput). Zabilježi broj:
```bash
cat > ./_n.mjs <<'EOF'
import { createClient } from "@supabase/supabase-js"; import { readFileSync } from "fs"
const env=Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY)
const {count}=await sb.from("termini").select("id",{count:"exact",head:true})
console.log("termina:",count)
EOF
node ./_n.mjs; rm -f ./_n.mjs
```
Pokreni: `pnpm exec playwright test tests/e2e/03-termini.spec.ts --workers=1 --reporter=line`
Expected: sve zeleno. Pa PONOVO prebroj — **prije == poslije** (0 zaostalog junk-a), i `rok>=2030: 0` (regex iz Task 1 Step 4).

- [ ] **Step 11: Lint + typecheck + build + ugasiti server**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka.
Run: `lsof -ti:3000 | xargs kill`

- [ ] **Step 12: Commit**

```bash
git add tests/e2e/db.ts tests/e2e/03-termini.spec.ts
git commit -m "test(termini): throwaway klijent + finally cleanup u mutacionim testovima"
```

---

## Završna verifikacija (cijela grana)

- [ ] `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka.
- [ ] Cloud: 0 termina rok≥2030, 0 E2E napomena.
- [ ] `03-termini.spec.ts` zelen; broj termina prije==poslije (higijena dokazana); ponovni run čist.
- [ ] Regresija: `10-pregled`, `05-matrix-plan`, `04-klijenti` zeleni.
