# Dedup termina — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ukloniti duplikate termina (Excel ponavlja godišnju matricu kroz 12 mjesečnih sheetova) — dedup u parseru za buduće importe + in-place čišćenje postojećih cloud podataka, uz pravilo "zadrži izvršeno".

**Architecture:** Dvije čiste, testabilne funkcije: `dedupeTermini` (parser-nivo, ključ firma+vrsta+lokacija+datum, izvrseno > planirano) i `odaberiCuvara` (cleanup-nivo, bira jedan red po grupi: dokument-bearing > status-prioritet > stabilno). Parser poziva `dedupeTermini` prije return-a; skripta `dedup-termini.ts` primjenjuje `odaberiCuvara` na cloud i briše višak.

**Tech Stack:** TypeScript, Supabase (cloud), `tsx` skripte (`--env-file=.env.local`), vitest unit, pnpm.

## Global Constraints

- Grana: `fix/dedup-termini` (NE `main`). Već kreirana i aktivna.
- Cloud Supabase — skripte/provjere protiv cloud-a (`.env.local`, `SUPABASE_SERVICE_ROLE_KEY`). Bez lokalnog Dockera.
- Dedup logika je čista funkcija (DRY); bez duplirane logike.
- Pravilo: po (klijent+vrsta+lokacija+rok) zadrži jedan; izvršeno ima prednost. `STATUS_PRIO`: izvrseno 4 > zakazano 3 > planirano 2 > otkazano 1. Cleanup čuvar-prioritet: ima-dokument > status-prio > stabilno (id).
- ESLint zabranjuje `no-await-in-loop` — u skripti scoped `// eslint-disable-next-line no-await-in-loop` na awaited delete u petlji (namjerno sekvencijalno, jednokratna skripta).
- AGENTS.md: NIJE standardni Next.js — ali ovo je plain TS u `lib/`/`scripts/`; kod iz plana je tačan.
- Unit runner: `pnpm exec vitest run <fajl>`. Skripte: `pnpm <script>`.

---

### Task 1: `dedupeTermini` (parser dedup) + integracija

**Files:**
- Modify: `lib/excel/parser.ts` (dodati `dedupeTermini` export; pozvati u `parseTehproExcel` prije return-a, ~linija 432)
- Test: `lib/excel/parser.test.ts` (dodati `describe("dedupeTermini")`; ako postojeći test broji termine sa duplikatima, ažurirati)

**Interfaces:**
- Consumes: `ParsedTermin` (`{ firma_naziv, lokacija_naziv, vrsta_naziv, sheet_naziv, datum, izvor }`, `izvor: "izvrseno" | "planirano"`) iz `./parser.types`.
- Produces: `dedupeTermini(termini: ParsedTermin[]): ParsedTermin[]` (named export iz `lib/excel/parser.ts`).

- [ ] **Step 1: Napisati padajuće testove**

Provjeriti prvo postoji li `lib/excel/parser.test.ts`:
Run: `ls lib/excel/*.test.ts`

Ako postoji, dodati u njega (uz postojeći import `parseTehproExcel`, dodati `dedupeTermini`); ako ne postoji, kreirati `lib/excel/parser.test.ts` sa:
```ts
import { describe, it, expect } from "vitest"
import { dedupeTermini } from "./parser"
import type { ParsedTermin } from "./parser.types"

const t = (over: Partial<ParsedTermin>): ParsedTermin => ({
  firma_naziv: "AS", lokacija_naziv: null, vrsta_naziv: "Akt o procjeni rizika - revizija",
  sheet_naziv: "Januar", datum: "2026-12-31", izvor: "planirano", ...over,
})

describe("dedupeTermini", () => {
  it("kolabira identične iz više sheetova u jedan", () => {
    const res = dedupeTermini([
      t({ sheet_naziv: "Januar" }), t({ sheet_naziv: "Februar" }), t({ sheet_naziv: "Mart" }),
    ])
    expect(res).toHaveLength(1)
  })
  it("izvrseno pobjeđuje planirano na isti (firma,vrsta,lokacija,datum)", () => {
    const res = dedupeTermini([
      t({ izvor: "planirano" }), t({ izvor: "izvrseno" }),
    ])
    expect(res).toHaveLength(1)
    expect(res[0]!.izvor).toBe("izvrseno")
  })
  it("različit datum / lokacija / vrsta NIJE duplikat", () => {
    const res = dedupeTermini([
      t({ datum: "2026-01-10" }), t({ datum: "2026-02-10" }),
      t({ lokacija_naziv: "BIJELJINA", datum: "2026-01-10" }),
      t({ vrsta_naziv: "Obilazak", datum: "2026-01-10" }),
    ])
    expect(res).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti (nema `dedupeTermini`)**

Run: `pnpm exec vitest run lib/excel/parser.test.ts`
Expected: FAIL ("dedupeTermini is not a function" / import error).

- [ ] **Step 3: Implementirati `dedupeTermini` u `lib/excel/parser.ts`**

Dodati (npr. iznad `parseTehproExcel`):
```ts
/** Dedupe termina: jedan po (firma|vrsta|lokacija|datum); izvrseno ima prednost nad planirano. */
export function dedupeTermini(termini: ParsedTermin[]): ParsedTermin[] {
  const map = new Map<string, ParsedTermin>()
  for (const t of termini) {
    const key = `${t.firma_naziv}||${t.vrsta_naziv}||${t.lokacija_naziv ?? "∅"}||${t.datum}`
    const post = map.get(key)
    if (!post) { map.set(key, t); continue }
    if (post.izvor !== "izvrseno" && t.izvor === "izvrseno") map.set(key, t)
  }
  return Array.from(map.values())
}
```
NAPOMENA: provjeriti da je `ParsedTermin` već importovan u `parser.ts` (jeste — koristi se za `termini` niz). Ako tip nije eksplicitno importovan, dodati `import type { ParsedTermin } from "./parser.types"` (vjerovatno već postoji preko postojećeg importa).

- [ ] **Step 4: Integrisati u `parseTehproExcel`**

Pronaći `return {` blok (oko linije 432) i zamijeniti `termini,` sa `termini: dedupeTermini(termini),`:
```ts
  return {
    firme: Array.from(firmeSet),
    lokacije: lokacijeArr,
    vrste: Array.from(vrsteSet),
    termini: dedupeTermini(termini),
    skipped,
  }
```
(Tačna imena polja preuzeti iz postojećeg return-a; promijeniti SAMO `termini` liniju.)

- [ ] **Step 5: Pokrenuti — mora proći**

Run: `pnpm exec vitest run lib/excel/parser.test.ts`
Expected: PASS. Ako je postojeći test u istom fajlu tvrdio tačan broj termina iz fixture-a (sad manji nakon dedup-a), ažurirati to očekivanje na novi (deduplicirani) broj i navesti u izvještaju.

- [ ] **Step 6: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 7: Commit**

```bash
git add lib/excel/parser.ts lib/excel/parser.test.ts
git commit -m "feat(dedup): dedupeTermini u parseru (izvrseno > planirano, ključ firma+vrsta+lokacija+datum)"
```

---

### Task 2: `odaberiCuvara` + cleanup skripta + pokretanje na cloud-u

**Files:**
- Create: `lib/dedup.ts` (čista `odaberiCuvara` + `STATUS_PRIO` + tip `TerminRed`)
- Test: `lib/dedup.test.ts`
- Create: `scripts/dedup-termini.ts`
- Modify: `package.json` (npm script `dedup:termini`)

**Interfaces:**
- Consumes: `createAdminSupabaseClient` iz `../lib/supabase/admin`.
- Produces: `odaberiCuvara(rows: TerminRed[], docIds: Set<string>): { keep: TerminRed; drop: TerminRed[] }`.

- [ ] **Step 1: Napisati padajuće testove u `lib/dedup.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { odaberiCuvara, type TerminRed } from "./dedup"

const r = (over: Partial<TerminRed>): TerminRed => ({
  id: "a", klijent_id: "k", vrsta_provjere_id: "v", lokacija_id: null,
  rok_dospijeca: "2026-06-21", status: "planirano", ...over,
})

describe("odaberiCuvara", () => {
  it("zadrži izvrseno nad planirano/kasni", () => {
    const { keep, drop } = odaberiCuvara(
      [r({ id: "a", status: "planirano" }), r({ id: "b", status: "izvrseno" })],
      new Set()
    )
    expect(keep.id).toBe("b")
    expect(drop.map((d) => d.id)).toEqual(["a"])
  })
  it("dokument-bearing red pobjeđuje status prioritet", () => {
    const { keep } = odaberiCuvara(
      [r({ id: "a", status: "izvrseno" }), r({ id: "b", status: "planirano" })],
      new Set(["b"])
    )
    expect(keep.id).toBe("b")
  })
  it("status prioritet: zakazano > planirano > otkazano", () => {
    const { keep } = odaberiCuvara(
      [r({ id: "a", status: "otkazano" }), r({ id: "b", status: "zakazano" }), r({ id: "c", status: "planirano" })],
      new Set()
    )
    expect(keep.id).toBe("b")
  })
  it("stabilno po id kad je sve izjednačeno", () => {
    const { keep } = odaberiCuvara([r({ id: "z" }), r({ id: "a" })], new Set())
    expect(keep.id).toBe("a")
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm exec vitest run lib/dedup.test.ts`
Expected: FAIL (modul `./dedup` ne postoji).

- [ ] **Step 3: Implementirati `lib/dedup.ts`**

```ts
export type TerminRed = {
  id: string
  klijent_id: string | null
  vrsta_provjere_id: string | null
  lokacija_id: string | null
  rok_dospijeca: string
  status: string
}

export const STATUS_PRIO: Record<string, number> = {
  izvrseno: 4, zakazano: 3, planirano: 2, otkazano: 1,
}

/** Ključ grupe: isti klijent+vrsta+lokacija+rok. */
export function grupaKljuc(t: TerminRed): string {
  return `${t.klijent_id ?? "∅"}|${t.vrsta_provjere_id ?? "∅"}|${t.lokacija_id ?? "∅"}|${t.rok_dospijeca}`
}

/** Bira jedan red (keep) po grupi: dokument-bearing > status-prioritet > stabilno (id). */
export function odaberiCuvara(rows: TerminRed[], docIds: Set<string>): { keep: TerminRed; drop: TerminRed[] } {
  const sorted = [...rows].sort((a, b) => {
    const ad = docIds.has(a.id) ? 1 : 0, bd = docIds.has(b.id) ? 1 : 0
    if (ad !== bd) return bd - ad
    const ap = STATUS_PRIO[a.status] ?? 0, bp = STATUS_PRIO[b.status] ?? 0
    if (ap !== bp) return bp - ap
    return a.id.localeCompare(b.id)
  })
  return { keep: sorted[0]!, drop: sorted.slice(1) }
}
```

- [ ] **Step 4: Pokrenuti — mora proći**

Run: `pnpm exec vitest run lib/dedup.test.ts`
Expected: PASS (4 testa).

- [ ] **Step 5: Napisati `scripts/dedup-termini.ts`**

```ts
/**
 * In-place dedup postojećih termina: jedan po (klijent,vrsta,lokacija,rok).
 * Čuvar: dokument-bearing > status-prioritet > stabilno. Briše ostale.
 * Pokretanje: pnpm dedup:termini
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { odaberiCuvara, grupaKljuc, type TerminRed } from "../lib/dedup"

async function main() {
  const sb = createAdminSupabaseClient()
  const { data: termini, error } = await sb
    .from("termini")
    .select("id, klijent_id, vrsta_provjere_id, lokacija_id, rok_dospijeca, status")
  if (error) throw new Error(`select termini failed: ${error.message}`)
  const rows = (termini ?? []) as TerminRed[]

  const { data: dok, error: dErr } = await sb.from("dokumenti").select("termin_id")
  if (dErr) throw new Error(`select dokumenti failed: ${dErr.message}`)
  const docIds = new Set((dok ?? []).map((d) => d.termin_id as string).filter(Boolean))

  const grupe = new Map<string, TerminRed[]>()
  for (const t of rows) {
    const k = grupaKljuc(t)
    const a = grupe.get(k) ?? []
    a.push(t)
    grupe.set(k, a)
  }

  const zaBrisanje: string[] = []
  let grupaSaDup = 0
  for (const g of grupe.values()) {
    if (g.length <= 1) continue
    grupaSaDup++
    const { drop } = odaberiCuvara(g, docIds)
    zaBrisanje.push(...drop.map((d) => d.id))
  }

  console.log(`Grupa sa duplikatima: ${grupaSaDup}; za brisanje: ${zaBrisanje.length} redova`)

  const BATCH = 100
  for (let i = 0; i < zaBrisanje.length; i += BATCH) {
    const slice = zaBrisanje.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error: delErr } = await sb.from("termini").delete().in("id", slice)
    if (delErr) throw new Error(`delete batch failed: ${delErr.message}`)
  }

  const { count } = await sb.from("termini").select("id", { count: "exact", head: true })
  console.log(`✅ Gotovo. Obrisano ${zaBrisanje.length}; preostalo termina: ${count}`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
```

- [ ] **Step 6: Dodati npm script u `package.json`**

U `"scripts"` (uz `"backfill:grad"`):
```json
    "dedup:termini": "tsx --env-file=.env.local scripts/dedup-termini.ts",
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 8: Pokrenuti čišćenje na cloud-u**

Run: `pnpm dedup:termini`
Expected: izlaz tipa `Grupa sa duplikatima: ~360; za brisanje: ~285 redova` → `✅ Gotovo. Obrisano ~285; preostalo termina: ~560`.

- [ ] **Step 9: Verifikacija u bazi (nema više dup grupa; dokumenti očuvani)**

Napisati privremenu provjeru (obrisati nakon) ili inline node skriptom: grupiši preostale termine po (klijent,vrsta,lokacija,rok) i potvrdi da nijedna grupa nema >1; i da oba `termini` iz `dokumenti.termin_id` i dalje postoje.
```bash
cat > ./_verify.mjs <<'EOF'
import { createClient } from "@supabase/supabase-js"; import { readFileSync } from "fs"
const env=Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY)
const {data:t}=await sb.from("termini").select("id,klijent_id,vrsta_provjere_id,lokacija_id,rok_dospijeca")
const m=new Map(); for(const x of t){const k=`${x.klijent_id}|${x.vrsta_provjere_id}|${x.lokacija_id}|${x.rok_dospijeca}`; m.set(k,(m.get(k)||0)+1)}
const dup=[...m.values()].filter(v=>v>1).length
console.log("termina:",t.length,"| grupa sa >1:",dup)
const {data:d}=await sb.from("dokumenti").select("termin_id")
const ids=[...new Set(d.map(x=>x.termin_id))]
const {data:post}=await sb.from("termini").select("id").in("id",ids)
console.log("dokument-termina prije:",ids.length,"| i dalje postoje:",post.length)
EOF
node ./_verify.mjs; rm -f ./_verify.mjs
```
Expected: `grupa sa >1: 0`; `dokument-termina ... i dalje postoje: 2` (jednako broju prije).

- [ ] **Step 10: Commit**

```bash
git add lib/dedup.ts lib/dedup.test.ts scripts/dedup-termini.ts package.json
git commit -m "feat(dedup): in-place čišćenje duplikata termina na cloud-u (odaberiCuvara)"
```

---

### Task 3: Regresija e2e + brojevi po tabovima

**Files:**
- (po potrebi) Modify: postojeći e2e koji su pretpostavljali napuhane brojeve

**Interfaces:** nema novih.

- [ ] **Step 1: Pokrenuti relevantne e2e protiv cloud-a (zagrijan server)**

Zagrijati dev server (`ZAPISNIK_DRY_RUN=1 CHAT_DRY_RUN=1 pnpm dev`, čekati Ready, curl `/obilasci?period=godina&godina=2026` i `/termini` dvaput), pa:
Run: `pnpm exec playwright test tests/e2e/12-obilasci.spec.ts tests/e2e/15-obilasci-dorada.spec.ts tests/e2e/03-termini.spec.ts tests/e2e/10-pregled.spec.ts tests/e2e/05-matrix-plan.spec.ts --workers=1 --reporter=line`
Expected: sve zeleno. (webkit `--workers=1` zbog Turbopack cold-start.)

- [ ] **Step 2: Ako neki test tvrdi konkretan (napuhan) broj termina**

Pronaći i ažurirati svaku tvrdnju koja je zavisila od duplikata (npr. fiksni count "1000"/"849" ili broj redova u tabeli/grupi). Zamijeniti deterministički robusnim asercijama (npr. `> 0`, ili tačan novi broj). Pokazati promjenu u commitu. Ako nijedan test ne pada, preskočiti ovaj korak i navesti to u izvještaju.

- [ ] **Step 3: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka.

- [ ] **Step 4: Ugasiti dev server**

Run: `lsof -ti:3000 | xargs kill`

- [ ] **Step 5: Commit (ako je bilo izmjena testova)**

```bash
git add tests/e2e/
git commit -m "test(dedup): ažuriraj e2e brojeve nakon uklanjanja duplikata"
```
(Ako nije bilo izmjena, preskočiti commit.)

---

## Završna verifikacija (cijela grana)

- [ ] `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka.
- [ ] `pnpm exec vitest run lib/excel/parser.test.ts lib/dedup.test.ts` — unit zeleno.
- [ ] Cloud: nijedna `(klijent+vrsta+lokacija+rok)` grupa nema >1; finalni broj ~560; oba dokument-termina očuvana.
- [ ] Relevantni e2e zeleni; brojevi po tabovima više nisu naduvani.
