# Dorada Prikaz taba Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Učiniti Prikaz matricu razumljivijom i potpunom — legenda simbola/boja, (+N) ćelije vode do svih termina, mjesec-mod default popunjen, klijent reset opcija.

**Architecture:** Pristup A (mali izolovani zahvati): nova `MatrixLegenda` komponenta; `MatrixGrid` dobija opcioni `multiHref` za ćelije s više termina; `PrikazToolbar` dobija `setMode` handler + klijent reset. Bez diranja pivot-logike (`lib/matrix`).

**Tech Stack:** Next.js 16 (server + client komponente), React 19, Supabase (cloud), Playwright (e2e protiv cloud-a), Tailwind, pnpm.

## Global Constraints

- Grana: `fix/prikaz-dorada` (već kreirana, NE `main`).
- App + testovi idu protiv **cloud Supabase-a** (bez lokalnog Dockera); test DB pristup preko `tests/e2e/db.ts` (`@supabase/supabase-js`, service-role iz `.env.local`).
- Desktop-only: zabranjen `sm:`/`md:` breakpoint (koristiti `lg:`/`xl:`/`2xl:` ili bez). (ESLint pravilo `no-restricted-syntax`.)
- Termini filter param imena (verbatim): `klijent_id`, `vrsta_id`, `mjesec` ("1".."12"), `godina`.
- Cell-link: jedan termin → `?selected=<terminId>` (TerminSheet, ostaje u Prikazu); >1 termin → filtrirani `/termini`.
- Status boje matrice (verbatim, iz `MatrixGrid.tsx` `CELL_CLASS`): izvrseno `bg-green-100`, planirano `bg-blue-50`, zakazano `bg-cyan-50`, kasni `bg-red-100`, otkazano `bg-slate-100`.
- `STATUS_LABEL` (`lib/termini.ts`): Planirano/Zakazano/Izvršeno/Kasni/Otkazano.
- Komande: e2e `pnpm test:e2e tests/e2e/<file>`; gate `pnpm lint && pnpm typecheck && pnpm build`.
- **Napomena (cloud):** podaci su testni; mutacije idu na live cloud. Testovi koji ubacuju podatke MORAJU počistiti za sobom (`deleteTermin`).

## File Structure

- `components/domain/MatrixLegenda.tsx` — NOVO: čista legenda (simboli + status-boje).
- `components/domain/MatrixGrid.tsx` — IZMJENA: `multiHref?` prop; ćelija >1 termin koristi ga.
- `app/(dashboard)/prikaz/page.tsx` — IZMJENA: render `<MatrixLegenda/>` uz matricu; `multiHref` closure → `MatrixGrid`.
- `components/domain/PrikazToolbar.tsx` — IZMJENA: `setMode` handler (mjesec default) + klijent reset stavka.
- `tests/e2e/db.ts` — IZMJENA: `firstKlijentId`, `insertTermin`, `deleteTermin`.
- `tests/e2e/13-prikaz-dorada.spec.ts` — NOVO: e2e za sve 4 stavke.

---

### Task 1: Legenda matrice

**Files:**
- Create: `components/domain/MatrixLegenda.tsx`
- Modify: `app/(dashboard)/prikaz/page.tsx` (render ispod matrice)
- Test: `tests/e2e/13-prikaz-dorada.spec.ts`

**Interfaces:**
- Produces: `<MatrixLegenda />` (bez props), `data-testid="matrix-legenda"`.

- [ ] **Step 1: Napisati failing e2e (`tests/e2e/13-prikaz-dorada.spec.ts`)**

```ts
import { test, expect } from "@playwright/test"

test.describe("Prikaz — dorada", () => {
  test("legenda je vidljiva kad je matrica (po mjesecu)", async ({ page }) => {
    await page.goto("/prikaz?mode=mjesec&godina=2026&mjesec=2")
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toContainText("izvršeno")
    await expect(page.getByTestId("matrix-legenda")).toContainText("Kasni")
  })

  test("legenda NIJE vidljiva u praznom stanju (po klijentu bez izbora)", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm test:e2e tests/e2e/13-prikaz-dorada.spec.ts`
Expected: FAIL (nema `matrix-legenda`).

- [ ] **Step 3: Kreirati `components/domain/MatrixLegenda.tsx`**

```tsx
import { STATUS_LABEL, type DerivedStatus } from "@/lib/termini"

const BOJE: Record<DerivedStatus, string> = {
  izvrseno: "bg-green-100",
  planirano: "bg-blue-50",
  zakazano: "bg-cyan-50",
  kasni: "bg-red-100",
  otkazano: "bg-slate-100",
}
const REDOSLIJED: DerivedStatus[] = ["izvrseno", "planirano", "zakazano", "kasni", "otkazano"]

export function MatrixLegenda() {
  return (
    <div
      data-testid="matrix-legenda"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"
    >
      <span className="font-medium text-slate-600">Legenda:</span>
      <span>✓ izvršeno</span>
      <span>! kasni</span>
      <span>(+N) još termina</span>
      <span>· nema termina</span>
      <span className="mx-1 inline-block h-3 w-px bg-slate-200" />
      {REDOSLIJED.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded ${BOJE[s]} ring-1 ring-inset ring-black/5`} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Render u `prikaz/page.tsx`**

Pročitati `app/(dashboard)/prikaz/page.tsx`. Postoji uslov koji bira između `<MatrixGrid .../>` i praznog stanja (`prikaz-empty`) — npr. `showMatrix` (mode=mjesec ILI klijent+izabran). Dodati import i renderovati legendu UNUTAR iste (matrica-vidljiva) grane, odmah ispod `<MatrixGrid .../>`:

```tsx
import { MatrixLegenda } from "@/components/domain/MatrixLegenda"
// ...
// u grani gdje se renderuje MatrixGrid:
<MatrixGrid columns={kolone} rows={matrixRows} currentSearch={currentSearch} emptyMessage={emptyMessage} />
<MatrixLegenda />
```

> Wrapati oba u `<div className="space-y-2">` ako trenutni JSX vraća jedan element po grani; legenda se NE smije prikazati u `prikaz-empty` grani.

- [ ] **Step 5: Pokrenuti — mora proći**

Run: `pnpm test:e2e tests/e2e/13-prikaz-dorada.spec.ts`
Expected: PASS (oba legenda testa).

- [ ] **Step 6: Commit**

```bash
git add components/domain/MatrixLegenda.tsx "app/(dashboard)/prikaz/page.tsx" tests/e2e/13-prikaz-dorada.spec.ts
git commit -m "feat(prikaz): legenda matrice (simboli + status boje)"
```

---

### Task 2: (+N) ćelije → filtrirani Termini

**Files:**
- Modify: `tests/e2e/db.ts` (`firstKlijentId`, `insertTermin`, `deleteTermin`)
- Modify: `components/domain/MatrixGrid.tsx` (`multiHref` prop)
- Modify: `app/(dashboard)/prikaz/page.tsx` (`multiHref` closure)
- Test: `tests/e2e/13-prikaz-dorada.spec.ts`

**Interfaces:**
- Consumes: `MatrixCell.brojUCeliji`, `MatrixRow.rowId`, `MatrixColumn.id`.
- Produces:
  - `MatrixGrid` prop `multiHref?: (rowId: string, colId: string) => string`.
  - `db.ts`: `firstKlijentId(): Promise<string>`, `insertTermin({klijentId,vrstaId,rok}): Promise<string>`, `deleteTermin(id): Promise<void>`.

- [ ] **Step 1: Dodati helpere u `tests/e2e/db.ts`**

```ts
/** Prvi klijent (id) po nazivu. */
export async function firstKlijentId(): Promise<string> {
  const { data } = await db.from("klijenti").select("id").order("naziv").limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Ubaci planirani termin; vrati id. */
export async function insertTermin(input: {
  klijentId: string
  vrstaId: string
  rok: string
}): Promise<string> {
  const { data } = await db
    .from("termini")
    .insert({
      klijent_id: input.klijentId,
      vrsta_provjere_id: input.vrstaId,
      rok_dospijeca: input.rok,
      status: "planirano",
    })
    .select("id")
    .single()
  return (data?.id as string) ?? ""
}

/** Obriši termin po id-u (čišćenje nakon testa). */
export async function deleteTermin(id: string): Promise<void> {
  if (id) await db.from("termini").delete().eq("id", id)
}
```

- [ ] **Step 2: Napisati failing e2e (dodati u `13-prikaz-dorada.spec.ts`)**

Dodati import na vrh fajla:
```ts
import { firstKlijentId, firstActiveVrstaId, insertTermin, deleteTermin } from "./db"
```
I novi test u `describe`:
```ts
  test("(+N) ćelija vodi na filtrirane Termine", async ({ page }) => {
    const klijentId = await firstKlijentId()
    const vrstaId = await firstActiveVrstaId()
    // dva termina isti klijent+vrsta+mjesec (2035-05) → ćelija (+1); 2035 inače prazna
    const t1 = await insertTermin({ klijentId, vrstaId, rok: "2035-05-10" })
    const t2 = await insertTermin({ klijentId, vrstaId, rok: "2035-05-20" })
    try {
      await page.goto(`/prikaz?mode=klijent&klijent=${klijentId}&godina=2035`)
      await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
      // Jedina ćelija koja vodi na /termini je naša (+1); single ćelije vode na /prikaz?selected
      const multi = page.locator('a[data-testid="matrix-cell-filled"][href*="/termini"]')
      await expect(multi).toHaveCount(1)
      const href = await multi.getAttribute("href")
      expect(href).toMatch(new RegExp(`vrsta_id=${vrstaId}`))
      expect(href).toMatch(/mjesec=5/)
      expect(href).toMatch(/godina=2035/)
    } finally {
      await deleteTermin(t1)
      await deleteTermin(t2)
    }
  })
```

- [ ] **Step 3: Pokrenuti — mora pasti**

Run: `pnpm test:e2e tests/e2e/13-prikaz-dorada.spec.ts -g "vodi na filtrirane"`
Expected: FAIL (multi-ćelija i dalje vodi na `/prikaz?...selected`, ne `/termini`).

- [ ] **Step 4: Dodati `multiHref` u `MatrixGrid.tsx`**

Proširiti props i logiku ćelije. Trenutni filled-cell link:
```tsx
<Link href={`/prikaz?${withParam(currentSearch, "selected", cell.terminId)}`} ...>
```
Zamijeniti props i href:
```tsx
export function MatrixGrid({
  columns,
  rows,
  currentSearch,
  emptyMessage = "Nema podataka.",
  multiHref,
}: {
  columns: MatrixColumn[]
  rows: MatrixRow[]
  currentSearch: string
  emptyMessage?: string
  multiHref?: (rowId: string, colId: string) => string
}) {
```
A u renderu ćelije (gdje je `cell` ne-null):
```tsx
const href =
  cell.brojUCeliji > 1 && multiHref
    ? multiHref(row.rowId, c.id)
    : `/prikaz?${withParam(currentSearch, "selected", cell.terminId)}`
return (
  <td key={c.id} className="p-1 text-center align-middle" data-testid="matrix-cell" data-col={c.id}>
    {cell ? (
      <Link
        href={href}
        data-testid="matrix-cell-filled"
        data-status={cell.status}
        title={cell.brojUCeliji > 1 ? "Više termina — otvori listu" : undefined}
        className={cn("inline-block w-full rounded px-1.5 py-1 tabular-nums", CELL_CLASS[cell.status])}
      >
        {cellLabel(cell)}
      </Link>
    ) : (
      <span className="text-slate-200">·</span>
    )}
  </td>
)
```

- [ ] **Step 5: Graditi `multiHref` u `prikaz/page.tsx` i proslijediti**

Pročitati page; postoje varijable `mode`, `klijentId`, `godina`, `mjesec` (mjesec relevantan u mjesec-modu). Prije `return`, definisati:
```ts
const multiHref = (vrstaId: string, colId: string) =>
  mode === "mjesec"
    ? `/termini?klijent_id=${colId}&vrsta_id=${vrstaId}&mjesec=${mjesec}&godina=${godina}`
    : `/termini?klijent_id=${klijentId}&vrsta_id=${vrstaId}&mjesec=${colId}&godina=${godina}`
```
> `colId` je broj mjeseca (klijent-mod) ili `klijent_id` (mjesec-mod) — isto kako se grade kolone. `klijentId`/`mjesec`/`godina` su postojeće page varijable (provjeriti tačna imena; ako je `mjesec` broj, ubaciti kako jeste).

Proslijediti u oba poziva `MatrixGrid`:
```tsx
<MatrixGrid columns={kolone} rows={matrixRows} currentSearch={currentSearch} emptyMessage={emptyMessage} multiHref={multiHref} />
```

- [ ] **Step 6: Pokrenuti — mora proći + regresija**

Run: `pnpm test:e2e tests/e2e/13-prikaz-dorada.spec.ts tests/e2e/05-matrix-plan.spec.ts tests/e2e/11-prikaz-mjesec.spec.ts`
Expected: PASS (uklj. (+N) test; single-ćelije i dalje otvaraju TerminSheet).

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/db.ts components/domain/MatrixGrid.tsx "app/(dashboard)/prikaz/page.tsx" tests/e2e/13-prikaz-dorada.spec.ts
git commit -m "feat(prikaz): (+N) ćelija → filtrirani Termini (svi termini dostupni)"
```

---

### Task 3: Mjesec-mod default + klijent reset (PrikazToolbar)

**Files:**
- Modify: `components/domain/PrikazToolbar.tsx`
- Test: `tests/e2e/13-prikaz-dorada.spec.ts`

**Interfaces:**
- Consumes: postojeći `params`, `router`, `startTransition`, `setParam`, `klijentItems`.
- Produces: `setMode` handler; klijent Select ima `__svi__` reset stavku.

- [ ] **Step 1: Napisati failing e2e (dodati u `13-prikaz-dorada.spec.ts`)**

```ts
  test("'Po mjesecu' iz default-a postavi ?mjesec na tekući", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-mode-mjesec").click()
    await page.waitForURL(/mode=mjesec/)
    await page.waitForURL(/mjesec=\d+/)
    await expect(page.getByTestId("prikaz-mjesec")).toBeVisible()
  })

  test("klijent reset '— svi —' vraća na prazno stanje", async ({ page }) => {
    const { firstKlijentId } = await import("./db")
    const klijentId = await firstKlijentId()
    await page.goto(`/prikaz?mode=klijent&klijent=${klijentId}&godina=2026`)
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await page.getByTestId("prikaz-klijent").click()
    await page.getByRole("option", { name: "— svi klijenti —" }).click()
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
  })
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm test:e2e tests/e2e/13-prikaz-dorada.spec.ts -g "Po mjesecu|reset"`
Expected: FAIL (toggle ne postavlja `?mjesec`; nema "— svi —" opcije).

- [ ] **Step 3: `setMode` handler + `todayIso` import**

U `PrikazToolbar.tsx`, proširiti import:
```ts
import { MONTHS_BS, todayIso } from "@/lib/date"
```
Dodati handler (uz postojeći `setParam`):
```ts
function setMode(m: "klijent" | "mjesec") {
  const next = new URLSearchParams(params.toString())
  next.set("mode", m)
  next.delete("selected")
  if (m === "mjesec" && !next.get("mjesec")) {
    next.set("mjesec", String(Number(todayIso().slice(5, 7))))
  }
  startTransition(() => router.push(`/prikaz?${next.toString()}`))
}
```
Zamijeniti `onClick` oba mode-dugmeta:
```tsx
<button data-testid="prikaz-mode-klijent" onClick={() => setMode("klijent")} ...>Po klijentu</button>
<button data-testid="prikaz-mode-mjesec" onClick={() => setMode("mjesec")} ...>Po mjesecu</button>
```

- [ ] **Step 4: Klijent reset stavka**

`klijentItems` mapa — dodati sentinel labelu:
```ts
const klijentItems: Record<string, string> = {
  __svi__: "— svi klijenti —",
  ...Object.fromEntries(klijenti.map((k) => [k.id, k.naziv])),
}
```
Klijent `Select` — `onValueChange` mapira sentinel na prazno, i dodati prvu opciju:
```tsx
<Select
  value={klijent}
  onValueChange={(v) => setParam("klijent", v === "__svi__" ? "" : (v ?? ""))}
  items={klijentItems}
>
  <SelectTrigger className="w-72" data-testid="prikaz-klijent"><SelectValue placeholder="Izaberi klijenta" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="__svi__">— svi klijenti —</SelectItem>
    {klijenti.map((k) => <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>)}
  </SelectContent>
</Select>
```

- [ ] **Step 5: Pokrenuti — mora proći + regresija**

Run: `pnpm test:e2e tests/e2e/13-prikaz-dorada.spec.ts tests/e2e/11-prikaz-mjesec.spec.ts`
Expected: PASS.

- [ ] **Step 6: Gate**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 errors. Vizuelno (kad se digne app): legenda ispod matrice; klik (+N) ćelije → Termini lista; "Po mjesecu" odmah popuni dropdown; "— svi —" vraća prazno.

- [ ] **Step 7: Commit**

```bash
git add components/domain/PrikazToolbar.tsx tests/e2e/13-prikaz-dorada.spec.ts
git commit -m "feat(prikaz): mjesec-mod default + klijent reset opcija"
```

---

## Pokrivenost (mapiranje na spec)

| Spec sekcija | Task |
|---|---|
| 1. Legenda matrice | Task 1 |
| 2. (+N) → filtrirani Termini | Task 2 |
| 3. Mjesec-mod default | Task 3 |
| 4. Klijent reset (+ boje kroz legendu) | Task 1 (boje) + Task 3 (reset) |

## Self-Review

**Spec coverage:** sve 4 sekcije → Task 1/2/3 (tabela). ✓
**Placeholder scan:** nema TBD/TODO; sav kod konkretan. Integracione napomene ("pročitaj page, nađi showMatrix granu / tačna imena varijabli") su provjere, ne placeholderi. ✓
**Type consistency:** `multiHref(rowId, colId)` definisan u Task 2 (MatrixGrid) i korišten u istom (page closure); `firstKlijentId/insertTermin/deleteTermin` definisani u Task 2 db.ts, korišteni u Task 2/3 testovima; `MatrixLegenda` bez props (Task 1). ✓
**Napomene za izvođača (provjeriti, ne placeholder):** tačan naziv grane uslova za matricu u `prikaz/page.tsx` (vjerovatno `showMatrix`); tačna imena page varijabli `klijentId`/`mjesec`/`godina` (koristiti kako su nazvane). Potvrditi da `STATUS_LABEL` postoji u `lib/termini.ts`.
