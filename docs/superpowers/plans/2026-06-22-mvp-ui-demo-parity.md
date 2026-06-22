# MVP UI parnost sa demo prototipom — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vratiti u MVP četiri demo-UI vrijednosti: dashboard kao početni ekran, cross-klijent mjesečnu matricu, Obilasci ekran, i "po ugovoru/po ponudi" badge — gradeći na postojećem backendu i komponentama.

**Architecture:** Vertikalni slajsovi (Approach A, reuse-first). Svaka faza je nezavisno isporučiva. Čista logika (pivot, grupisanje, period-range) se izvlači u `lib/` i pokriva vitest unit testovima (TDD); stranice i komponente se verifikuju Playwright E2E testovima sa `data-testid` konvencijom kao u postojećim testovima.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, Supabase (lokalno preko Dockera), Tailwind v4 + shadcn/Base UI, vitest (unit), Playwright (e2e), pnpm.

## Global Constraints

- **Docker za backend:** lokalni Supabase mora biti pokrenut prije migracija/e2e; `supabase` se build-uje sa `.env` fajlom (`--env-file=.env.local`). Bez cloud Supabase / bez Vercel.
- **Bez dummy podataka:** koristiti postojeći seed (`pnpm seed`); ne izmišljati podatke u kodu.
- **Grana:** rad ide na `feature/mvp-ui-demo-parity` (već kreirana, NE na `main`).
- **Brend boja se ne mijenja** (plava `#2563eb`).
- **Naziv rute dashboarda:** `/pregled`; stari AI-zapisnici ekran ide na `/zapisnici`.
- **Termini filter param imena (verbatim):** `status`, `klijent_id`, `lokacija`, `vrsta_id`, `mjesec` (vrijednost `"1".."12"`), `q`, `page`. Linkovi MORAJU koristiti ova imena.
- **Postojeći reuse (ne mijenjati signature):** `get_termini_stats()`, `get_opterecenje(godina)`, `termini_view` (ima `klijent_id, klijent_naziv, lokacija_naziv, lokacija_grad, vrsta_provjere_id, vrsta_naziv, rok_dospijeca, status, status_izvedeni, datum_izvrsenja`), `MONTHS_BS`, `currentYear()`, `todayIso()`, `toDerivedStatus()`, `DerivedStatus`, `MatrixCell`.
- **Komande:**
  - Unit: `pnpm vitest run <path>`
  - E2E: `pnpm test:e2e tests/e2e/<file>` (Playwright, `--workers=1`)
  - Migracija + tipovi: `pnpm db:reset && pnpm db:types && pnpm seed` (Docker mora raditi)
  - Gate faze: `pnpm lint && pnpm typecheck && pnpm build` + relevantni e2e + vizualna provjera.

## Prerequisites (jednom prije početka)

- [ ] Pokrenuti lokalni Supabase: `supabase start` (Docker).
- [ ] Provjeriti `.env.local` postoji.
- [ ] `pnpm db:reset && pnpm db:types && pnpm seed` — čista baza + seed + svježi `db/types.ts`.
- [ ] `pnpm dev` radi na `:3000`; smoke e2e prolazi: `pnpm test:e2e tests/e2e/01-smoke.spec.ts`.

---

## Phase 1 — Badge "po ugovoru / po ponudi"

### Task 1.1: Migracija `klijenti.tip_odnosa` + read model + tipovi

**Files:**
- Create: `supabase/migrations/20260622140000_klijenti_tip_odnosa.sql`
- Modify: `db/types.ts` (regen — ne ručno)
- Test: postojeći `tests/e2e/07-temelj.spec.ts` (ne smije puknuti)

**Interfaces:**
- Produces: kolona `klijenti.tip_odnosa text` (`'ugovor'|'ponuda'|null`); polje `tip_odnosa` u view-u `klijenti_read_model`.

- [ ] **Step 1: Napisati migraciju**

Najprije pogledati postojeću definiciju `klijenti_read_model` view-a da se reprodukuje 1:1 uz dodatak kolone:

Run: `grep -rl "klijenti_read_model" supabase/migrations/ | xargs grep -iA40 "create.*view klijenti_read_model"`

Zatim kreirati `supabase/migrations/20260622140000_klijenti_tip_odnosa.sql`:

```sql
-- Tip poslovnog odnosa sa klijentom: ugovor (periodični) ili ponuda (jednokratno).
alter table klijenti
  add column tip_odnosa text
  check (tip_odnosa in ('ugovor', 'ponuda'));

comment on column klijenti.tip_odnosa is 'po ugovoru | po ponudi; null = nije postavljeno';

-- Izložiti tip_odnosa u read modelu (KlijentCard čita odavde).
-- VAŽNO: kopirati postojeću definiciju klijenti_read_model iz ranije migracije
-- i dodati "k.tip_odnosa" u select listu. Primjer (prilagoditi stvarnoj definiciji):
drop view if exists klijenti_read_model;
create view klijenti_read_model as
select
  k.id,
  k.naziv,
  k.napomena,
  k.tip_odnosa,                      -- <— DODANO
  -- ... ostatak postojećih kolona/agregata 1:1 iz originalne migracije ...
  (select count(*) from lokacije l where l.klijent_id = k.id)            as broj_lokacija,
  (select count(*) from termini t where t.klijent_id = k.id)            as broj_termina,
  (select count(*) from termini_view tv
     where tv.klijent_id = k.id and tv.status_izvedeni <> 'izvrseno')   as broj_aktivnih,
  (select count(*) from termini_view tv
     where tv.klijent_id = k.id and tv.status_izvedeni = 'kasni')       as broj_kasni
from klijenti k;
```

> Napomena: gornji select je ilustrativan — implementator MORA prekopirati stvarne kolone iz originalne `klijenti_read_model` migracije i dodati samo `k.tip_odnosa`. Ne smije se izgubiti nijedna postojeća kolona.

- [ ] **Step 2: Primijeniti migraciju i regenerisati tipove**

Run: `pnpm db:reset && pnpm db:types && pnpm seed`
Expected: bez grešaka; `db/types.ts` sada ima `tip_odnosa` u `klijenti` Row tipu.

Provjera: `grep -n "tip_odnosa" db/types.ts`
Expected: barem 2 pogotka (klijenti tabela + klijenti_read_model view).

- [ ] **Step 3: Regresija temelj e2e**

Run: `pnpm test:e2e tests/e2e/07-temelj.spec.ts`
Expected: PASS (read model i dalje radi).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622140000_klijenti_tip_odnosa.sql db/types.ts
git commit -m "feat(db): dodaj klijenti.tip_odnosa + izloži u read modelu"
```

---

### Task 1.2: Uređivanje tipa odnosa (actions + KlijentEditForm)

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts`
- Modify: `components/domain/KlijentEditForm.tsx`
- Test: `tests/e2e/04-klijenti.spec.ts` (dodati test)

**Interfaces:**
- Consumes: `klijenti.tip_odnosa` (Task 1.1).
- Produces: forma sprema `tip_odnosa` (`'ugovor'|'ponuda'|null`).

- [ ] **Step 1: Napisati failing e2e test**

Dodati u `tests/e2e/04-klijenti.spec.ts` novi `describe`:

```ts
test.describe("Faza badge — tip odnosa", () => {
  test("uređivanje postavlja tip odnosa na 'po ugovoru'", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
    await page.getByRole("button", { name: "Uredi" }).click()
    await page.getByTestId("klijent-tip-odnosa").click()
    await page.getByRole("option", { name: "Po ugovoru" }).click()
    await page.getByRole("button", { name: /Spremi/ }).click()
    await expect(page.getByTestId("tip-odnosa-badge")).toContainText("po ugovoru")
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm test:e2e tests/e2e/04-klijenti.spec.ts -g "tip odnosa"`
Expected: FAIL (nema `klijent-tip-odnosa` polja).

- [ ] **Step 3: Proširiti zod šemu u `actions.ts`**

U `app/(dashboard)/klijenti/actions.ts`, u šemi za create/update klijenta dodati polje:

```ts
tip_odnosa: z
  .union([z.enum(["ugovor", "ponuda"]), z.literal(""), z.null()])
  .transform((v) => (v === "" ? null : v))
  .optional(),
```

I osigurati da se `tip_odnosa` prosljeđuje u `.update({ ... })` / `.insert({ ... })` payload prema `klijenti`.

- [ ] **Step 4: Dodati Select u `KlijentEditForm.tsx`**

Unutar forme (uz postojeća polja), reuse `Select` iz `components/ui/select`:

```tsx
<div className="space-y-1">
  <label className="text-sm text-slate-600">Tip odnosa</label>
  <Select name="tip_odnosa" defaultValue={klijent.tip_odnosa ?? ""}>
    <SelectTrigger data-testid="klijent-tip-odnosa" className="w-full">
      <SelectValue placeholder="— (nije postavljeno)" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">— (nije postavljeno)</SelectItem>
      <SelectItem value="ugovor">Po ugovoru</SelectItem>
      <SelectItem value="ponuda">Po ponudi</SelectItem>
    </SelectContent>
  </Select>
</div>
```

> Ako forma koristi kontrolisani state umjesto `name`, dodati `tip_odnosa` u state i u submit payload — pratiti postojeći obrazac forme.

- [ ] **Step 5: Pokrenuti test — mora proći**

Run: `pnpm test:e2e tests/e2e/04-klijenti.spec.ts -g "tip odnosa"`
Expected: PASS.

> Napomena: ovaj test zavisi i od Task 1.3 (badge prikaz). Ako se izvršava prije 1.3, očekuje se da padne na `tip-odnosa-badge` assertu — u tom slučaju spojiti korak verifikacije sa 1.3. Preporuka: raditi 1.2 i 1.3 kao par prije commita.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/klijenti/actions.ts" components/domain/KlijentEditForm.tsx tests/e2e/04-klijenti.spec.ts
git commit -m "feat(klijenti): uređivanje tip_odnosa u formi + zod validacija"
```

---

### Task 1.3: Prikaz badge-a (TipOdnosaBadge na kartici i detalju)

**Files:**
- Create: `components/domain/TipOdnosaBadge.tsx`
- Modify: `components/domain/KlijentCard.tsx`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx`
- Test: `tests/e2e/04-klijenti.spec.ts` (test iz 1.2 pokriva)

**Interfaces:**
- Consumes: `tip_odnosa` iz `klijenti_read_model` (kartica) i iz `klijenti` (detalj).
- Produces: `<TipOdnosaBadge tip={...} />` sa `data-testid="tip-odnosa-badge"`.

- [ ] **Step 1: Kreirati `TipOdnosaBadge.tsx`**

```tsx
import { cn } from "@/lib/utils"

export function TipOdnosaBadge({ tip }: { tip: "ugovor" | "ponuda" | null }) {
  if (!tip) return null
  const isUgovor = tip === "ugovor"
  return (
    <span
      data-testid="tip-odnosa-badge"
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        isUgovor
          ? "bg-blue-100 text-blue-700"
          : "bg-slate-100 text-slate-600"
      )}
    >
      {isUgovor ? "po ugovoru" : "po ponudi"}
    </span>
  )
}
```

- [ ] **Step 2: Dodati badge na `KlijentCard.tsx`**

Pored naziva (gore-desno), reuse postojećeg layouta kartice:

```tsx
<div className="flex items-start justify-between gap-2">
  <h3 className="font-semibold">{klijent.naziv}</h3>
  <TipOdnosaBadge tip={klijent.tip_odnosa ?? null} />
</div>
```

Osigurati da tip kartice (`KlijentCardData` ili sl.) uključuje `tip_odnosa: "ugovor" | "ponuda" | null`. Postojeći "kasni" badge ostaje u redu metrika — ne dirati ga.

- [ ] **Step 3: Dodati badge u header detalja `klijenti/[id]/page.tsx`**

Pored naslova klijenta:

```tsx
<div className="flex items-center gap-3">
  <h1 className="text-2xl font-semibold">{klijent.naziv}</h1>
  <TipOdnosaBadge tip={klijent.tip_odnosa ?? null} />
</div>
```

Osigurati da upit detalja selektuje `tip_odnosa` (ako koristi `select("*")`, već je uključeno).

- [ ] **Step 4: Pokrenuti puni klijenti e2e — mora proći**

Run: `pnpm test:e2e tests/e2e/04-klijenti.spec.ts`
Expected: PASS (uključujući "tip odnosa" test i "bez console grešaka").

- [ ] **Step 5: Gate faze 1**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: bez grešaka.
Vizualna provjera: otvoriti `/klijenti`, postaviti tip jednom klijentu, potvrditi badge na kartici i u detalju.

- [ ] **Step 6: Commit**

```bash
git add components/domain/TipOdnosaBadge.tsx components/domain/KlijentCard.tsx "app/(dashboard)/klijenti/[id]/page.tsx"
git commit -m "feat(klijenti): prikaži tip odnosa badge na kartici i detalju"
```

---

## Phase 2 — Preimenovanje `/pregled` → `/zapisnici`

### Task 2.1: Premjestiti AI-zapisnici ekran na `/zapisnici` + Sidebar

**Files:**
- Rename: `app/(dashboard)/pregled/` → `app/(dashboard)/zapisnici/`
- Modify: svi fajlovi sa linkom na `/pregled?preview=` ili `/pregled`
- Modify: `components/shell/Sidebar.tsx`
- Test: `tests/e2e/08-dokumenti.spec.ts` (ažurirati rute ako referiše `/pregled`)

**Interfaces:**
- Produces: ruta `/zapisnici` (stari sadržaj), nav stavka "Zapisnici".

- [ ] **Step 1: Pronaći sve reference na `/pregled`**

Run: `grep -rn "/pregled" app components lib tests`
Zabilježiti svaku (linkovi u zapisnici akcijama, dokumenti, TerminSheet "Generiši zapisnik", e2e).

- [ ] **Step 2: Premjestiti folder**

```bash
git mv "app/(dashboard)/pregled" "app/(dashboard)/zapisnici"
```

- [ ] **Step 3: Zamijeniti sve `/pregled` → `/zapisnici`**

U svakom fajlu iz Step 1 zamijeniti `"/pregled"` i `` `/pregled` `` rute (uključujući `?preview=`). Provjera:

Run: `grep -rn "/pregled" app components lib tests`
Expected: 0 pogodaka (osim u planu/spec dokumentima).

- [ ] **Step 4: Ažurirati Sidebar (privremeno bez dashboarda)**

U `components/shell/Sidebar.tsx`, u `NAV_ITEMS` zamijeniti stavku Pregled stavkom Zapisnici (dashboard se dodaje u Task 3.2):

```ts
{ href: "/zapisnici", label: "Zapisnici", icon: FileText },
```

(zadržati `FileText` import.)

- [ ] **Step 5: E2E — `/zapisnici` radi, stari `/pregled` više ne**

Ažurirati `tests/e2e/08-dokumenti.spec.ts` (ako koristi `/pregled`) na `/zapisnici`. Dodati provjeru:

```ts
test("zapisnici ruta se učita", async ({ page }) => {
  await page.goto("/zapisnici")
  await expect(page.getByRole("heading", { name: /Zapisnici|Pregled/ })).toBeVisible()
})
```

Run: `pnpm test:e2e tests/e2e/08-dokumenti.spec.ts`
Expected: PASS.

> Naslov stranice unutar `zapisnici/page.tsx` po želji preimenovati u "Zapisnici" radi konzistentnosti; nije obavezno za prolaz.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(rute): premjesti AI-zapisnici sa /pregled na /zapisnici"
```

---

## Phase 3 — Dashboard (`/pregled`)

### Task 3.1: Lib upiti + HitnoKasniList komponenta

**Files:**
- Modify: `lib/termini.ts`
- Create: `components/domain/HitnoKasniList.tsx`
- Test: pokriveno e2e u Task 3.2

**Interfaces:**
- Produces:
  - `getPredstojeciCount(supabase, dana?: number): Promise<number>`
  - `getHitnoKasni(supabase, limit?: number): Promise<HitnoKasniItem[]>`
  - `type HitnoKasniItem = { id: string; klijent_id: string; klijent_naziv: string; vrsta_naziv: string; rok_dospijeca: string; status_izvedeni: string }`
  - `<HitnoKasniList items={HitnoKasniItem[]} ukupnoPredstojeci={number} />`

- [ ] **Step 1: Dodati upite u `lib/termini.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import { todayIso } from "@/lib/date"

export type HitnoKasniItem = {
  id: string
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  rok_dospijeca: string
  status_izvedeni: string
}

function isoPlusDays(days: number): string {
  const d = new Date(todayIso())
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function getPredstojeciCount(
  supabase: SupabaseClient,
  dana = 30
): Promise<number> {
  const { count } = await supabase
    .from("termini_view")
    .select("id", { count: "exact", head: true })
    .gte("rok_dospijeca", todayIso())
    .lte("rok_dospijeca", isoPlusDays(dana))
    .neq("status_izvedeni", "izvrseno")
  return count ?? 0
}

export async function getHitnoKasni(
  supabase: SupabaseClient,
  limit = 8
): Promise<HitnoKasniItem[]> {
  const { data } = await supabase
    .from("termini_view")
    .select("id, klijent_id, klijent_naziv, vrsta_naziv, rok_dospijeca, status_izvedeni")
    .or(`status_izvedeni.eq.kasni,and(rok_dospijeca.lte.${isoPlusDays(30)},status_izvedeni.neq.izvrseno)`)
    .order("rok_dospijeca", { ascending: true })
    .limit(limit)
  return (data ?? []) as HitnoKasniItem[]
}
```

> `todayIso()` već postoji u `lib/date.ts`. Ako `SupabaseClient` tip nije dostupan, koristiti `Awaited<ReturnType<typeof createServerSupabaseClient>>`.

- [ ] **Step 2: Kreirati `HitnoKasniList.tsx`**

```tsx
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { formatDatum } from "@/lib/date"
import type { HitnoKasniItem } from "@/lib/termini"

export function HitnoKasniList({
  items,
  ukupnoPredstojeci,
}: {
  items: HitnoKasniItem[]
  ukupnoPredstojeci: number
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
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/termini?klijent_id=${t.klijent_id}`}
                data-testid="hitno-kasni-row"
                className="flex items-center justify-between py-2 hover:bg-slate-50 -mx-2 px-2 rounded"
              >
                <span>
                  <span className="font-medium">{t.klijent_naziv}</span>
                  <span className="block text-xs text-slate-500">{t.vrsta_naziv}</span>
                </span>
                <span
                  className={
                    t.status_izvedeni === "kasni"
                      ? "text-sm text-red-600"
                      : "text-sm text-slate-600"
                  }
                >
                  {formatDatum(t.rok_dospijeca)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-400">
        + {ukupnoPredstojeci} termina dospijeva u narednih 30 dana
      </p>
    </div>
  )
}
```

> Provjeriti tačan naziv formatera u `lib/date.ts` (`grep -n "export function format" lib/date.ts`); ako se zove drukčije (npr. `formatDate`), koristiti taj. Ako ne postoji, koristiti `t.rok_dospijeca` direktno.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 4: Commit**

```bash
git add lib/termini.ts components/domain/HitnoKasniList.tsx
git commit -m "feat(dashboard): lib upiti predstojeci/hitno-kasni + HitnoKasniList"
```

---

### Task 3.2: Dashboard stranica + nav + redirect

**Files:**
- Create: `app/(dashboard)/pregled/page.tsx`
- Modify: `app/(dashboard)/page.tsx`
- Modify: `components/shell/Sidebar.tsx`
- Test: `tests/e2e/10-pregled.spec.ts` (novi)

**Interfaces:**
- Consumes: `get_termini_stats`, `get_opterecenje`, `getPredstojeciCount`, `getHitnoKasni`, `StatCard`, `OpterecenjeChart`, `HitnoKasniList`.

- [ ] **Step 1: Napisati failing e2e (`tests/e2e/10-pregled.spec.ts`)**

```ts
import { test, expect } from "@playwright/test"

test.describe("Faza dashboard — Pregled", () => {
  test("/ redirect-uje na /pregled", async ({ page }) => {
    await page.goto("/")
    await page.waitForURL(/\/pregled$/)
    await expect(page.getByRole("heading", { name: "Pregled" })).toBeVisible()
  })

  test("prikazuje 4 KPI kartice, chart i hitno/kasni listu", async ({ page }) => {
    await page.goto("/pregled")
    expect(await page.getByTestId("stat-card").count()).toBe(4)
    await expect(page.getByTestId("dashboard-chart")).toBeVisible()
    await expect(page.getByTestId("hitno-kasni-list")).toBeVisible()
  })

  test("klik 'Kasni rokovi' vodi na filtriran /termini", async ({ page }) => {
    await page.goto("/pregled")
    await page.getByRole("link", { name: /Kasni rokovi/ }).click()
    await page.waitForURL(/\/termini\?status=kasni/)
  })

  test("nav 'Pregled' je aktivan", async ({ page }) => {
    await page.goto("/pregled")
    await expect(page.getByRole("link", { name: "Pregled" })).toHaveAttribute("aria-current", "page")
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/pregled")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
```

> Provjeriti da `StatCard` renderuje `data-testid="stat-card"`. Ako ne, dodati taj testid u `StatCard` (i provjeriti da postojeća Termini stranica i dalje prolazi — `pnpm test:e2e tests/e2e/03-termini.spec.ts`).

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm test:e2e tests/e2e/10-pregled.spec.ts`
Expected: FAIL (nema `/pregled`).

- [ ] **Step 3: Kreirati `app/(dashboard)/pregled/page.tsx`**

```tsx
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { StatCard } from "@/components/domain/StatCard"
import { OpterecenjeChart, type OpterecenjeRow } from "@/components/domain/OpterecenjeChart"
import { HitnoKasniList } from "@/components/domain/HitnoKasniList"
import { getPredstojeciCount, getHitnoKasni } from "@/lib/termini"
import { currentYear, todayIso } from "@/lib/date"

export default async function PregledPage() {
  const supabase = await createServerSupabaseClient()
  const godina = currentYear()
  const mjesec = Number(todayIso().slice(5, 7))

  const [statsRes, opterecenjeRes, predstojeci, hitnoKasni] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    supabase.rpc("get_opterecenje", { godina }),
    getPredstojeciCount(supabase),
    getHitnoKasni(supabase),
  ])

  const stats = (statsRes.data?.[0] ?? {
    ukupno: 0, ovog_mjeseca: 0, kasni: 0, izvrseno_ovog_mjeseca: 0,
  }) as { ukupno: number; ovog_mjeseca: number; kasni: number; izvrseno_ovog_mjeseca: number }
  const opterecenje = (opterecenjeRes.data ?? []) as OpterecenjeRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pregled</h1>
        <p className="text-sm text-slate-500">Rokovi i opterećenje</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Link href={`/termini?mjesec=${mjesec}`}>
          <StatCard label="Termini ovog mjeseca" value={stats.ovog_mjeseca} />
        </Link>
        <Link href="/termini?status=kasni" aria-label="Kasni rokovi">
          <StatCard label="Kasni rokovi" value={stats.kasni} tone="danger" sub="zahtijevaju akciju" />
        </Link>
        <Link href="/termini?status=izvrseno">
          <StatCard label="Izvršeno ovog mjeseca" value={stats.izvrseno_ovog_mjeseca} tone="success" />
        </Link>
        <Link href="/termini">
          <StatCard label="Predstojeći (30 dana)" value={predstojeci} tone="warning" sub="podsjetnici aktivni" />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 p-4" data-testid="dashboard-chart">
          <OpterecenjeChart
            data={opterecenje}
            currentMonth={mjesec}
          />
        </div>
        <HitnoKasniList items={hitnoKasni} ukupnoPredstojeci={predstojeci} />
      </div>
    </div>
  )
}
```

> Uskladiti `StatCard` props sa stvarnom signaturom (`grep -n "export function StatCard\|type.*StatCard\|props" components/domain/StatCard.tsx`). Ako `tone`/`sub` ne postoje, koristiti postojeće props ili ih dodati nedestruktivno. `OpterecenjeRow` se importuje iz `OpterecenjeChart`.

- [ ] **Step 4: Promijeniti redirect u `app/(dashboard)/page.tsx`**

```tsx
import { redirect } from "next/navigation"

export default function DashboardIndex() {
  redirect("/pregled")
}
```

- [ ] **Step 5: Dodati "Pregled" nav stavku na vrh `Sidebar.tsx`**

Dodati import `LayoutDashboard` iz `lucide-react` i kao prvu stavku u `NAV_ITEMS`:

```ts
{ href: "/pregled",  label: "Pregled",  icon: LayoutDashboard },
```

- [ ] **Step 6: Pokrenuti dashboard e2e — mora proći**

Run: `pnpm test:e2e tests/e2e/10-pregled.spec.ts`
Expected: PASS.

- [ ] **Step 7: Regresija termini (StatCard testid promjena)**

Run: `pnpm test:e2e tests/e2e/03-termini.spec.ts`
Expected: PASS.

- [ ] **Step 8: Gate faze 3**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Vizualna provjera: `/` otvara dashboard; KPI, chart, lista izgledaju kao demo.

- [ ] **Step 9: Commit**

```bash
git add "app/(dashboard)/pregled/page.tsx" "app/(dashboard)/page.tsx" components/shell/Sidebar.tsx components/domain/StatCard.tsx tests/e2e/10-pregled.spec.ts
git commit -m "feat(dashboard): novi /pregled dashboard + redirect + nav"
```

---

## Phase 4 — Cross-klijent matrica u `/prikaz`

### Task 4.1: Izdvojiti čisti `buildMatrix` + generalizovati `MatrixGrid`

**Files:**
- Create: `lib/matrix.ts`
- Create: `lib/matrix.test.ts`
- Modify: `components/domain/MatrixGrid.tsx`
- Modify: `app/(dashboard)/prikaz/page.tsx` (per-klijent grana koristi novi helper)
- Test: `lib/matrix.test.ts` (unit), `tests/e2e/05-matrix-plan.spec.ts` (regresija)

**Interfaces:**
- Produces:
  - `type MatrixInput = { id: string; vrstaId: string; vrstaNaziv: string; columnKey: string; dan: number; status: DerivedStatus }`
  - `type MatrixColumn = { id: string; label: string; isCurrent?: boolean }`
  - `type MatrixRow = { rowId: string; rowLabel: string; cells: Record<string, MatrixCell | null> }`
  - `buildMatrix(items: MatrixInput[]): MatrixRow[]`
  - `MatrixGrid({ columns, rows, currentSearch, emptyMessage })`

- [ ] **Step 1: Napisati failing unit test (`lib/matrix.test.ts`)**

```ts
import { describe, it, expect } from "vitest"
import { buildMatrix, type MatrixInput } from "@/lib/matrix"

const base = (over: Partial<MatrixInput>): MatrixInput => ({
  id: "t1", vrstaId: "v1", vrstaNaziv: "Hidranti", columnKey: "1", dan: 5, status: "planirano", ...over,
})

describe("buildMatrix", () => {
  it("grupiše po vrsti u redove", () => {
    const rows = buildMatrix([
      base({ id: "a", vrstaId: "v1", vrstaNaziv: "Hidranti", columnKey: "1" }),
      base({ id: "b", vrstaId: "v2", vrstaNaziv: "Lift", columnKey: "2" }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.rowLabel).sort()).toEqual(["Hidranti", "Lift"])
  })

  it("u istoj ćeliji bira najurgentniji status (kasni > planirano)", () => {
    const rows = buildMatrix([
      base({ id: "a", columnKey: "1", status: "planirano", dan: 5 }),
      base({ id: "b", columnKey: "1", status: "kasni", dan: 9 }),
    ])
    const cell = rows[0].cells["1"]!
    expect(cell.status).toBe("kasni")
    expect(cell.dan).toBe(9)
    expect(cell.brojUCeliji).toBe(2)
  })

  it("različiti columnKey daju različite ćelije", () => {
    const rows = buildMatrix([
      base({ columnKey: "1" }),
      base({ columnKey: "klijent-xyz" }),
    ])
    expect(Object.keys(rows[0].cells).sort()).toEqual(["1", "klijent-xyz"])
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm vitest run lib/matrix.test.ts`
Expected: FAIL (`lib/matrix` ne postoji).

- [ ] **Step 3: Implementirati `lib/matrix.ts`**

```ts
import type { DerivedStatus } from "@/lib/termini"
import type { MatrixCell } from "@/components/domain/MatrixGrid"

export type MatrixInput = {
  id: string
  vrstaId: string
  vrstaNaziv: string
  columnKey: string
  dan: number
  status: DerivedStatus
}

export type MatrixRow = {
  rowId: string
  rowLabel: string
  cells: Record<string, MatrixCell | null>
}

const STATUS_PRIORITET: Record<DerivedStatus, number> = {
  kasni: 4, planirano: 3, zakazano: 3, izvrseno: 2, otkazano: 1,
}

export function buildMatrix(items: MatrixInput[]): MatrixRow[] {
  const byVrsta = new Map<string, MatrixRow>()
  for (const it of items) {
    let row = byVrsta.get(it.vrstaId)
    if (!row) {
      row = { rowId: it.vrstaId, rowLabel: it.vrstaNaziv, cells: {} }
      byVrsta.set(it.vrstaId, row)
    }
    const existing = row.cells[it.columnKey]
    if (!existing) {
      row.cells[it.columnKey] = { terminId: it.id, dan: it.dan, status: it.status, brojUCeliji: 1 }
    } else {
      existing.brojUCeliji += 1
      if (STATUS_PRIORITET[it.status] > STATUS_PRIORITET[existing.status]) {
        existing.terminId = it.id
        existing.dan = it.dan
        existing.status = it.status
      }
    }
  }
  return Array.from(byVrsta.values())
}
```

- [ ] **Step 4: Pokrenuti — mora proći**

Run: `pnpm vitest run lib/matrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Generalizovati `MatrixGrid.tsx`**

Zamijeniti `MatrixRow`/props da budu kolone-agnostični (zadržati `MatrixCell`, `CELL_CLASS`, `cellLabel`):

```tsx
export type MatrixColumn = { id: string; label: string; isCurrent?: boolean }
// MatrixRow se sada importuje iz lib/matrix (rowId/rowLabel/cells)
import type { MatrixRow } from "@/lib/matrix"

export function MatrixGrid({
  columns, rows, currentSearch, emptyMessage = "Nema podataka.",
}: {
  columns: MatrixColumn[]
  rows: MatrixRow[]
  currentSearch: string
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return (
      <div data-testid="matrix-empty" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200 overflow-x-auto">
      <table className="text-xs border-collapse" data-testid="prikaz-matrix">
        <thead className="bg-slate-50">
          <tr>
            <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600 border-r border-slate-200 min-w-[220px]">
              Vrsta pregleda / ispitivanja
            </th>
            {columns.map((c) => (
              <th key={c.id} className={cn("px-3 py-2 text-center font-medium text-slate-600", c.isCurrent && "ring-2 ring-brand rounded")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowId} className="border-t border-slate-100">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 border-r border-slate-200">{row.rowLabel}</td>
              {columns.map((c) => {
                const cell = row.cells[c.id]
                if (!cell) return <td key={c.id} className="text-center text-slate-200">·</td>
                return (
                  <td key={c.id} className="text-center">
                    <Link href={`/prikaz?${withParam(currentSearch, "selected", cell.terminId)}`}
                          className={cn("inline-block w-full px-2 py-1", CELL_CLASS[cell.status])}>
                      {cellLabel(cell)}
                    </Link>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

> Zadržati postojeće `MatrixCell`, `CELL_CLASS`, `cellLabel`, `withParam`, `cn`, `Link` importe. Stari `MatrixRow` tip (sa `mjeseci`) ukloniti — sada dolazi iz `lib/matrix`.

- [ ] **Step 6: Refaktorisati per-klijent granu u `prikaz/page.tsx` da koristi `buildMatrix`**

Zamijeniti inline pivot mapiranjem termina u `MatrixInput[]` (columnKey = broj mjeseca) i pozivom `buildMatrix`, te konstruisati kolone:

```ts
import { buildMatrix, type MatrixInput } from "@/lib/matrix"
import { MONTHS_BS } from "@/lib/date"
// ...
const inputs: MatrixInput[] = termini
  .filter((t) => t.id && t.vrsta_provjere_id && t.rok_dospijeca)
  .map((t) => ({
    id: t.id!, vrstaId: t.vrsta_provjere_id!, vrstaNaziv: t.vrsta_naziv ?? "—",
    columnKey: String(Number(t.rok_dospijeca!.slice(5, 7))),
    dan: Number(t.rok_dospijeca!.slice(8, 10)),
    status: toDerivedStatus(t.status_izvedeni),
  }))
const matrixRows = buildMatrix(inputs)
const mjeseciKolone = MONTHS_BS.map((label, i) => ({
  id: String(i + 1), label,
  isCurrent: godina === currentYear() && i + 1 === Number(todayIso().slice(5, 7)),
}))
```

A poziv komponente:

```tsx
<MatrixGrid columns={mjeseciKolone} rows={matrixRows} currentSearch={currentSearch}
  emptyMessage="Ovaj klijent nema termina u izabranoj godini." />
```

> Provjeriti je li `MONTHS_BS` puni nazivi ili skraćenice; za kolone matrice koristiti skraćeni oblik (npr. `MONTHS_BS[i].slice(0,3)`) ako su puni.

- [ ] **Step 7: Regresija matrice (per-klijent ponašanje očuvano)**

Run: `pnpm vitest run lib/matrix.test.ts && pnpm test:e2e tests/e2e/05-matrix-plan.spec.ts`
Expected: PASS (ista matrica kao ranije).

- [ ] **Step 8: Commit**

```bash
git add lib/matrix.ts lib/matrix.test.ts components/domain/MatrixGrid.tsx "app/(dashboard)/prikaz/page.tsx"
git commit -m "refactor(prikaz): izdvoj buildMatrix + generalizuj MatrixGrid (kolone-agnostično)"
```

---

### Task 4.2: Mod toggle + Mjesec dropdown u `PrikazToolbar`

**Files:**
- Modify: `components/domain/PrikazToolbar.tsx`
- Test: pokriveno e2e u Task 4.3

**Interfaces:**
- Consumes: postojeći `klijenti`, `godine`, `godina` props; čita `?mode`, `?mjesec`.
- Produces: toggle koji postavlja `?mode=klijent|mjesec`; Mjesec `Select` koji postavlja `?mjesec=1..12`.

- [ ] **Step 1: Dodati mode toggle i uslovne kontrole**

U `PrikazToolbar` (client komponenta, čita `useSearchParams`/`usePathname`/`useRouter` kao postojeća), dodati:

```tsx
// dvije pill-tipke
<div className="inline-flex rounded-lg border border-slate-200 p-0.5" data-testid="prikaz-mode-toggle">
  <button data-testid="prikaz-mode-klijent" onClick={() => setParam("mode", "klijent")}
    className={cn("px-3 py-1 text-sm rounded-md", mode === "klijent" && "bg-slate-900 text-white")}>
    Po klijentu
  </button>
  <button data-testid="prikaz-mode-mjesec" onClick={() => setParam("mode", "mjesec")}
    className={cn("px-3 py-1 text-sm rounded-md", mode === "mjesec" && "bg-slate-900 text-white")}>
    Po mjesecu
  </button>
</div>
```

Uslovno renderovanje:
- `mode === "klijent"` → postojeći Klijent `Select` + Godina `Select`.
- `mode === "mjesec"` → Mjesec `Select` (`data-testid="prikaz-mjesec"`, opcije `MONTHS_BS` value `"1".."12"`) + Godina `Select`.

`setParam(key, value)` gradi novi URLSearchParams iz trenutnih, postavlja ključ, i `router.push(\`/prikaz?\${params}\`)`. Default `mode` = `"klijent"` ako param fali.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 3: Commit**

```bash
git add components/domain/PrikazToolbar.tsx
git commit -m "feat(prikaz): mod toggle (po klijentu / po mjesecu) + Mjesec dropdown"
```

---

### Task 4.3: `mode=mjesec` grana u `prikaz/page.tsx` + e2e

**Files:**
- Modify: `app/(dashboard)/prikaz/page.tsx`
- Test: `tests/e2e/11-prikaz-mjesec.spec.ts` (novi)

**Interfaces:**
- Consumes: `buildMatrix`, `MatrixGrid` (Task 4.1), toggle (Task 4.2), `termini_view`.

- [ ] **Step 1: Napisati failing e2e (`tests/e2e/11-prikaz-mjesec.spec.ts`)**

```ts
import { test, expect } from "@playwright/test"

test.describe("Faza matrica — po mjesecu", () => {
  test("toggle 'Po mjesecu' prikaže matricu vrste×firme", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-mode-mjesec").click()
    await page.waitForURL(/mode=mjesec/)
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    // header mora sadržati bar jednu firmu iz seeda
    await expect(page.getByTestId("prikaz-matrix")).toContainText(/WAIKIKI/i)
  })

  test("povratak 'Po klijentu' radi", async ({ page }) => {
    await page.goto("/prikaz?mode=mjesec&mjesec=2")
    await page.getByTestId("prikaz-mode-klijent").click()
    await page.waitForURL(/mode=klijent/)
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
  })

  test("bez console grešaka u mjesec modu", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/prikaz?mode=mjesec&mjesec=2")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm test:e2e tests/e2e/11-prikaz-mjesec.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Dodati `mode=mjesec` granu u `prikaz/page.tsx`**

Pročitati `mode` (default `"klijent"`) i `mjesec` iz `sp`. Za `mode=mjesec`:

```ts
const mode = typeof sp.mode === "string" ? sp.mode : "klijent"
const mjesec = Number(typeof sp.mjesec === "string" ? sp.mjesec : "") || (Number(todayIso().slice(5, 7)))

let matrixRows: MatrixRow[] = []
let kolone: MatrixColumn[] = []
let emptyMessage = "Izaberite klijenta za prikaz godišnje matrice."

if (mode === "mjesec") {
  const od = `${godina}-${String(mjesec).padStart(2, "0")}-01`
  const doIso = `${godina}-${String(mjesec).padStart(2, "0")}-31`
  const { data } = await supabase
    .from("termini_view")
    .select("id, vrsta_provjere_id, vrsta_naziv, klijent_id, rok_dospijeca, status_izvedeni")
    .gte("rok_dospijeca", od).lte("rok_dospijeca", doIso)
  const termini = (data ?? []) as TerminRow[]
  const inputs: MatrixInput[] = termini
    .filter((t) => t.id && t.vrsta_provjere_id && t.klijent_id && t.rok_dospijeca)
    .map((t) => ({
      id: t.id!, vrstaId: t.vrsta_provjere_id!, vrstaNaziv: t.vrsta_naziv ?? "—",
      columnKey: t.klijent_id!, dan: Number(t.rok_dospijeca!.slice(8, 10)),
      status: toDerivedStatus(t.status_izvedeni),
    }))
  matrixRows = buildMatrix(inputs)
  kolone = klijenti.map((k) => ({ id: k.id, label: k.naziv }))
  emptyMessage = "Nema termina za izabrani mjesec."
} else if (klijentId) {
  // ... per-klijent grana iz Task 4.1 (kolone = mjeseci) ...
}
```

Render: ako `mode === "mjesec"` ILI (`mode === "klijent"` && `klijentId`) → `<MatrixGrid columns={kolone} rows={matrixRows} currentSearch={currentSearch} emptyMessage={emptyMessage} />`; inače per-klijent empty (`prikaz-empty`).

> `MatrixColumn` import iz `MatrixGrid`, `MatrixRow`/`MatrixInput`/`buildMatrix` iz `lib/matrix`. `klijenti` lista se već dohvaća na vrhu stranice.

- [ ] **Step 4: Pokrenuti e2e — mora proći**

Run: `pnpm test:e2e tests/e2e/11-prikaz-mjesec.spec.ts`
Expected: PASS.

- [ ] **Step 5: Regresija**

Run: `pnpm test:e2e tests/e2e/05-matrix-plan.spec.ts`
Expected: PASS.

- [ ] **Step 6: Gate faze 4**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Vizualna provjera: toggle "Po mjesecu" → kolone su firme, ćelije obojene; klik ćelije otvara `TerminSheet`.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/prikaz/page.tsx" tests/e2e/11-prikaz-mjesec.spec.ts
git commit -m "feat(prikaz): cross-klijent matrica vrste×firme za mjesec"
```

---

## Phase 5 — Obilasci (`/obilasci`)

### Task 5.1: `periodRange` helper + unit testovi

**Files:**
- Modify: `lib/date.ts`
- Test: `lib/date.test.ts` (dodati)

**Interfaces:**
- Produces: `periodRange(period: "mjesec"|"kvartal"|"godina", godina: number, mjesec?: number, kvartal?: number): { od: string; do: string }` (ISO `YYYY-MM-DD`).

- [ ] **Step 1: Napisati failing unit testove (`lib/date.test.ts`)**

```ts
import { describe, it, expect } from "vitest"
import { periodRange } from "@/lib/date"

describe("periodRange", () => {
  it("mjesec → prvi do zadnji dan mjeseca", () => {
    expect(periodRange("mjesec", 2026, 2)).toEqual({ od: "2026-02-01", do: "2026-02-28" })
  })
  it("kvartal Q2 → april–jun", () => {
    expect(periodRange("kvartal", 2026, undefined, 2)).toEqual({ od: "2026-04-01", do: "2026-06-30" })
  })
  it("godina → 01-01 do 12-31", () => {
    expect(periodRange("godina", 2026)).toEqual({ od: "2026-01-01", do: "2026-12-31" })
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm vitest run lib/date.test.ts`
Expected: FAIL (`periodRange` ne postoji).

- [ ] **Step 3: Implementirati `periodRange` u `lib/date.ts`**

```ts
export function periodRange(
  period: "mjesec" | "kvartal" | "godina",
  godina: number,
  mjesec?: number,
  kvartal?: number
): { od: string; do: string } {
  const last = (y: number, m: number) => new Date(y, m, 0).getDate() // m = 1..12
  const pad = (n: number) => String(n).padStart(2, "0")
  if (period === "godina") {
    return { od: `${godina}-01-01`, do: `${godina}-12-31` }
  }
  if (period === "kvartal") {
    const q = kvartal ?? 1
    const startM = (q - 1) * 3 + 1
    const endM = startM + 2
    return { od: `${godina}-${pad(startM)}-01`, do: `${godina}-${pad(endM)}-${pad(last(godina, endM))}` }
  }
  const m = mjesec ?? 1
  return { od: `${godina}-${pad(m)}-01`, do: `${godina}-${pad(m)}-${pad(last(godina, m))}` }
}
```

- [ ] **Step 4: Pokrenuti — mora proći**

Run: `pnpm vitest run lib/date.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/date.ts lib/date.test.ts
git commit -m "feat(date): periodRange helper za Obilasci filter"
```

---

### Task 5.2: `groupByGrad` helper + unit testovi

**Files:**
- Create: `lib/obilasci.ts`
- Test: `lib/obilasci.test.ts`

**Interfaces:**
- Produces:
  - `type ObilazakItem = { id: string; klijent_id: string; klijent_naziv: string; vrsta_naziv: string; lokacija_naziv: string | null; lokacija_grad: string | null; rok_dospijeca: string; status_izvedeni: string }`
  - `groupByGrad(items: ObilazakItem[]): { grad: string; items: ObilazakItem[] }[]` — abecedno po gradu; `null` grad → "Bez grada" na kraju.

- [ ] **Step 1: Napisati failing unit testove (`lib/obilasci.test.ts`)**

```ts
import { describe, it, expect } from "vitest"
import { groupByGrad, type ObilazakItem } from "@/lib/obilasci"

const it1 = (over: Partial<ObilazakItem>): ObilazakItem => ({
  id: "x", klijent_id: "k", klijent_naziv: "Firma", vrsta_naziv: "Hidranti",
  lokacija_naziv: "L", lokacija_grad: "Doboj", rok_dospijeca: "2026-02-10", status_izvedeni: "planirano", ...over,
})

describe("groupByGrad", () => {
  it("grupiše po gradu, abecedno", () => {
    const g = groupByGrad([it1({ lokacija_grad: "Prijedor" }), it1({ lokacija_grad: "Doboj" })])
    expect(g.map((x) => x.grad)).toEqual(["Doboj", "Prijedor"])
  })
  it("null grad ide u 'Bez grada' na kraj", () => {
    const g = groupByGrad([it1({ lokacija_grad: null }), it1({ lokacija_grad: "Banja Luka" })])
    expect(g.map((x) => x.grad)).toEqual(["Banja Luka", "Bez grada"])
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm vitest run lib/obilasci.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementirati `lib/obilasci.ts`**

```ts
export type ObilazakItem = {
  id: string
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  lokacija_grad: string | null
  rok_dospijeca: string
  status_izvedeni: string
}

export function groupByGrad(items: ObilazakItem[]): { grad: string; items: ObilazakItem[] }[] {
  const map = new Map<string, ObilazakItem[]>()
  for (const it of items) {
    const key = it.lokacija_grad ?? "Bez grada"
    const arr = map.get(key) ?? []
    arr.push(it)
    map.set(key, arr)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "Bez grada") return 1
      if (b === "Bez grada") return -1
      return a.localeCompare(b)
    })
    .map(([grad, items]) => ({ grad, items }))
}
```

- [ ] **Step 4: Pokrenuti — mora proći**

Run: `pnpm vitest run lib/obilasci.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/obilasci.ts lib/obilasci.test.ts
git commit -m "feat(obilasci): groupByGrad helper"
```

---

### Task 5.3: `ObilasciToolbar` komponenta

**Files:**
- Create: `components/domain/ObilasciToolbar.tsx`
- Test: pokriveno e2e u Task 5.4

**Interfaces:**
- Consumes: `?period`, `?mjesec`, `?kvartal`, `?godina`.
- Produces: kontrole koje postavljaju te parametre i `router.push("/obilasci?…")`.

- [ ] **Step 1: Kreirati `ObilasciToolbar.tsx` (client)**

```tsx
"use client"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { MONTHS_BS, currentYear } from "@/lib/date"

export function ObilasciToolbar() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const period = sp.get("period") ?? "mjesec"
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString())
    p.set(k, v)
    router.push(`${pathname}?${p.toString()}`)
  }
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="obilasci-toolbar">
      <Select value={period} onValueChange={(v) => setParam("period", v)}>
        <SelectTrigger data-testid="obilasci-period" className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="mjesec">Mjesec</SelectItem>
          <SelectItem value="kvartal">Kvartal</SelectItem>
          <SelectItem value="godina">Godina</SelectItem>
        </SelectContent>
      </Select>

      {period === "mjesec" && (
        <Select value={sp.get("mjesec") ?? ""} onValueChange={(v) => setParam("mjesec", v)}>
          <SelectTrigger data-testid="obilasci-mjesec" className="w-40"><SelectValue placeholder="Mjesec" /></SelectTrigger>
          <SelectContent>
            {MONTHS_BS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {period === "kvartal" && (
        <Select value={sp.get("kvartal") ?? ""} onValueChange={(v) => setParam("kvartal", v)}>
          <SelectTrigger data-testid="obilasci-kvartal" className="w-32"><SelectValue placeholder="Kvartal" /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>{`Q${q}`}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Select value={sp.get("godina") ?? String(currentYear())} onValueChange={(v) => setParam("godina", v)}>
        <SelectTrigger data-testid="obilasci-godina" className="w-28"><SelectValue /></SelectTrigger>
        <SelectContent>
          {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
```

> Uskladiti API `Select`-a sa postojećom upotrebom (`value`/`onValueChange` vs `name`/`defaultValue`) — pratiti `PrikazToolbar`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 3: Commit**

```bash
git add components/domain/ObilasciToolbar.tsx
git commit -m "feat(obilasci): toolbar sa filterom po periodu"
```

---

### Task 5.4: `obilasci/page.tsx` + nav + e2e

**Files:**
- Create: `app/(dashboard)/obilasci/page.tsx`
- Modify: `components/shell/Sidebar.tsx`
- Test: `tests/e2e/12-obilasci.spec.ts` (novi)

**Interfaces:**
- Consumes: `periodRange`, `groupByGrad`, `ObilasciToolbar`, `StatusBadge`, `termini_view`.

- [ ] **Step 1: Napisati failing e2e (`tests/e2e/12-obilasci.spec.ts`)**

```ts
import { test, expect } from "@playwright/test"

test.describe("Faza obilasci", () => {
  test("učita se sa default mjesecom i grupama po gradu", async ({ page }) => {
    await page.goto("/obilasci")
    await expect(page.getByRole("heading", { name: "Obilasci" })).toBeVisible()
    await expect(page.getByTestId("obilasci-toolbar")).toBeVisible()
  })

  test("period 'Godina' prikaže termine grupisane po gradu", async ({ page }) => {
    await page.goto("/obilasci?period=godina&godina=2026")
    const grupe = page.getByTestId("obilasci-grupa")
    expect(await grupe.count()).toBeGreaterThan(0)
  })

  test("nav 'Obilasci' je aktivan", async ({ page }) => {
    await page.goto("/obilasci")
    await expect(page.getByRole("link", { name: "Obilasci" })).toHaveAttribute("aria-current", "page")
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/obilasci?period=godina&godina=2026")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm test:e2e tests/e2e/12-obilasci.spec.ts`
Expected: FAIL (nema `/obilasci`).

- [ ] **Step 3: Kreirati `app/(dashboard)/obilasci/page.tsx`**

```tsx
import Link from "next/link"
import { MapPin } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { ObilasciToolbar } from "@/components/domain/ObilasciToolbar"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { groupByGrad, type ObilazakItem } from "@/lib/obilasci"
import { periodRange, currentYear, todayIso, formatDatum } from "@/lib/date"

export default async function ObilasciPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const period = (typeof sp.period === "string" ? sp.period : "mjesec") as "mjesec" | "kvartal" | "godina"
  const godina = Number(typeof sp.godina === "string" ? sp.godina : "") || currentYear()
  const mjesec = Number(typeof sp.mjesec === "string" ? sp.mjesec : "") || Number(todayIso().slice(5, 7))
  const kvartal = Number(typeof sp.kvartal === "string" ? sp.kvartal : "") || 1
  const { od, do: doIso } = periodRange(period, godina, mjesec, kvartal)

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from("termini_view")
    .select("id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, status_izvedeni")
    .gte("rok_dospijeca", od).lte("rok_dospijeca", doIso)
    .order("lokacija_grad", { ascending: true })
    .order("rok_dospijeca", { ascending: true })

  const grupe = groupByGrad((data ?? []) as ObilazakItem[])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Obilasci</h1>
        <p className="text-sm text-slate-500">Grupisano po gradu za efikasniji raspored izlazaka.</p>
      </div>

      <ObilasciToolbar />

      {grupe.length === 0 ? (
        <div data-testid="obilasci-empty" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          Nema termina u izabranom periodu.
        </div>
      ) : (
        grupe.map((g) => (
          <section key={g.grad} data-testid="obilasci-grupa" className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-red-600" aria-hidden />
              <h2 className="font-semibold">{g.grad}</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {g.items.map((t) => (
                <Link key={t.id} href={`/termini?klijent_id=${t.klijent_id}`}
                  data-testid="obilasci-card"
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                  <span>
                    <span className="font-medium">{t.klijent_naziv}</span>
                    <span className="block text-xs text-slate-500">
                      {t.vrsta_naziv}{t.lokacija_naziv ? ` · ${t.lokacija_naziv}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-sm text-slate-600">
                    {formatDatum(t.rok_dospijeca)}
                    <StatusBadge status={t.status_izvedeni} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
```

> Uskladiti `StatusBadge` props sa stvarnom signaturom (`grep -n "export function StatusBadge" components/domain/StatusBadge.tsx`). Uskladiti `formatDatum` naziv (Task 3.1 napomena).

- [ ] **Step 4: Dodati "Obilasci" u Sidebar (između Plan i Klijenti)**

Import `Map` iz `lucide-react`, ubaciti stavku iza `/plan`:

```ts
{ href: "/obilasci", label: "Obilasci", icon: Map },
```

- [ ] **Step 5: Pokrenuti e2e — mora proći**

Run: `pnpm test:e2e tests/e2e/12-obilasci.spec.ts`
Expected: PASS.

- [ ] **Step 6: Gate faze 5 (puni regresijski prolaz)**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Run: `pnpm vitest run`
Run: `pnpm test:e2e`
Expected: sve PASS.
Vizualna provjera: `/obilasci` grupiše po gradu, badge-vi statusa, promjena perioda mijenja prikaz; cijeli sidebar (9 stavki) radi.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/obilasci/page.tsx" components/shell/Sidebar.tsx tests/e2e/12-obilasci.spec.ts
git commit -m "feat(obilasci): ekran sa grupisanjem po gradu i filterom po periodu"
```

---

## Self-Review (popunjeno tokom pisanja plana)

**Spec coverage:**
- Sekcija 1 (nav/rute) → Task 2.1 (rename), 3.2 (redirect + Pregled nav), 5.4 (Obilasci nav). ✓
- Sekcija 2 (badge) → Task 1.1–1.3. ✓
- Sekcija 3 (dashboard) → Task 3.1–3.2. ✓
- Sekcija 4 (cross-klijent matrica) → Task 4.1–4.3. ✓
- Sekcija 5 (Obilasci) → Task 5.1–5.4. ✓

**Type consistency:** `MatrixInput`/`MatrixRow`/`MatrixColumn`/`buildMatrix` definisani u Task 4.1 i korišteni u 4.3 sa istim potpisom; `HitnoKasniItem` definisan u 3.1, korišten u 3.2; `ObilazakItem`/`groupByGrad` u 5.2, korišteni u 5.4; `periodRange` u 5.1, korišten u 5.4.

**Otvorene napomene za implementatora (provjeriti prije upotrebe, ne placeholder-i):**
- Tačni props `StatCard` i `StatusBadge` (grep prije upotrebe).
- Tačan naziv formatera datuma u `lib/date.ts`.
- Tačna definicija `klijenti_read_model` view-a (kopirati 1:1 + dodati `tip_odnosa`).
- `Select` API (`value/onValueChange` vs `name/defaultValue`) — pratiti `PrikazToolbar`.
- Je li `MONTHS_BS` pun naziv ili skraćenica (za zaglavlja matrice).
