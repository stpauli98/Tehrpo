# ⓘ info tooltipovi na klijent stranici — implementacioni plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hover na malu ⓘ ikonu pored labele taba / naslova sekcije na `/klijenti/[id]` prikazuje objašnjenje šta taj dio prikazuje i čemu služi.

**Architecture:** Nova server-safe komponenta `InfoIkona` (lucide `Info` + postojeći CSS-only tooltip obrazac `group/tt` iz `components/ui/ikona-tooltip.tsx`, ali sa prelomom teksta). Ubacuje se u `KlijentTabs` (6 tabova) i pored naslova sekcija u ID karti i Kontaktima. Tekstovi su fiksirani u specu `docs/superpowers/specs/2026-07-04-info-tooltips-klijent-design.md`.

**Tech Stack:** Next.js 16 (App Router, **uvijek `--webpack`**), React, Tailwind, Base UI tabs (shadcn base-nova), lucide-react, Playwright e2e.

## Global Constraints

- Grana: `feat/info-tooltips` (stacked na `fix/bugovi-konzistentnost`).
- Domenski jezik je bosanski/srpski (latinica) — identifikatori i UI stringovi na domenskom jeziku.
- Zabranjeni Tailwind breakpointi `sm:`/`md:` (lint error) — ovdje ne trebaju nikakvi.
- Nema novih dependency-ja.
- E2E boota svoj dev server i gađa CLOUD Supabase; test podaci se čiste u `finally` bloku (obrazac `E2E-TMP ` + `Date.now()`).
- `pnpm lint && pnpm typecheck` prije svakog commita.
- **Ne mijenjati** postojeće `data-testid` atribute ni tekst labela tabova.
- ⓘ wrapper mora biti `aria-hidden` — `aria-label` na spanu unutar `TabsTrigger` bi zagadio accessible name taba, a e2e koristi `getByRole("tab", { name: "..." })`. (Ovo je svjesna dopuna speca; tooltip je vizuelni afordans u internom desktop alatu.)

**Gotchas otkriveni u analizi (bitni za Task 1):**
- `TabsTrigger` (components/ui/tabs.tsx) ima `[&_svg]:pointer-events-none` — hover mora hvatati wrapper **span**, ne svg (span prima evente jer svg propušta).
- `TabsTrigger` ima `[&_svg:not([class*='size-'])]:size-4` — ikona MORA koristiti `size-3.5` klasu (ne `h-3.5 w-3.5`), inače je trigger nasilno poveća na size-4.
- `TabsTrigger` već ima `gap-1.5`, a h3 naslovi sekcija `gap-2` — InfoIkoni ne treba margin.
- Tooltip mora imati `w-max max-w-72 whitespace-normal` — bez `w-max` bi se apsolutno pozicionirani tooltip uz desnu ivicu skupio na širinu roditelja.

---

### Task 1: `InfoIkona` komponenta + ⓘ u tab traci

**Files:**
- Create: `components/ui/info-ikona.tsx`
- Modify: `components/domain/KlijentTabs.tsx`
- Test: `tests/e2e/21-info-tooltips.spec.ts`

**Interfaces:**
- Consumes: `cn` iz `@/lib/utils`, `Info` iz `lucide-react`, e2e helpere `insertKlijent`, `deleteKlijentByNaziv` iz `tests/e2e/db.ts`.
- Produces: `InfoIkona({ tekst, className, testId }: { tekst: string; className?: string; testId?: string })` — Taskovi 2 i 3 je importuju iz `@/components/ui/info-ikona`. E2E testid konvencija za tabove: `info-tab-<value>` (npr. `info-tab-profil`).

- [ ] **Step 1: Napiši padajući e2e test**

Kreiraj `tests/e2e/21-info-tooltips.spec.ts`:

```ts
import { test, expect } from "@playwright/test"
import { insertKlijent, deleteKlijentByNaziv } from "./db"

test.describe("Info tooltipovi — tab traka", () => {
  test("hover na ⓘ taba Profil prikazuje objašnjenje; klik na tab i dalje radi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()

      const ikona = page.getByTestId("info-tab-profil")
      await expect(ikona).toBeVisible()
      await ikona.hover()
      await expect(page.getByText("Definicija ponavljajućih provjera")).toBeVisible()

      // ⓘ ne smije pokvariti prebacivanje tabova ni accessible name taba
      await page.getByRole("tab", { name: "Termini" }).click()
      await expect(page.getByTestId("tab-termini-content")).toBeVisible()
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm exec playwright test tests/e2e/21-info-tooltips.spec.ts --project=chromium`
Expected: FAIL — `getByTestId("info-tab-profil")` nije vidljiv (element ne postoji).

- [ ] **Step 3: Kreiraj `components/ui/info-ikona.tsx`**

```tsx
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * ⓘ ikona sa hover objašnjenjem (isti CSS-only obrazac kao ikona-tooltip.tsx,
 * ali sa prelomom teksta za rečenice). Wrapper je aria-hidden da ne zagadi
 * accessible name roditelja (npr. TabsTrigger dugmeta).
 */
export function InfoIkona({
  tekst,
  className,
  testId,
}: {
  tekst: string
  className?: string
  testId?: string
}) {
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={cn("group/tt relative inline-flex items-center", className)}
    >
      <Info className="size-3.5 text-slate-400 transition-colors group-hover/tt:text-slate-600" />
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 hidden w-max max-w-72 -translate-x-1/2 whitespace-normal rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-xs font-medium leading-relaxed text-white shadow-md group-hover/tt:block">
        {tekst}
      </span>
    </span>
  )
}
```

- [ ] **Step 4: Ubaci ⓘ u `components/domain/KlijentTabs.tsx`**

Zamijeni cijeli sadržaj fajla:

```tsx
"use client"

import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InfoIkona } from "@/components/ui/info-ikona"

const TABS = [
  {
    value: "id-karta",
    label: "ID karta",
    info: "Lična karta klijenta na jednom mjestu: osnovni podaci firme, ugovori, ključni kontakti i pregled ugovorenih usluga sa sljedećim rokovima.",
  },
  {
    value: "termini",
    label: "Termini",
    info: "Svi konkretni rokovi za ovog klijenta — prošli i budući. Svaki red je jedan termin sa datumom roka, statusom (planirano, zakazano, kasni, izvršeno) i zaduženom osobom. Termini se generišu iz provjera definisanih u Profilu.",
  },
  {
    value: "lokacije",
    label: "Lokacije",
    info: "Objekti i poslovne jedinice klijenta na kojima se vrše provjere i obilasci. Svaka lokacija može imati svoju adresu i kontakt osobu, a termini se mogu vezati za konkretnu lokaciju.",
  },
  {
    value: "kontakti",
    label: "Kontakti",
    info: "Sve kontakt osobe klijenta: kontakti firme (direktor, odgovorna lica…) i kontakti pojedinačnih lokacija. Kontakti lokacija se uređuju u tabu Lokacije.",
  },
  {
    value: "dokumenti",
    label: "Dokumenti",
    info: "Svi dokumenti vezani za klijenta — ručno dodati fajlovi i AI-generisani zapisnici. Kolona Izvor pokazuje da li je dokument nastao uploadom ili ga je generisao AI.",
  },
  {
    value: "profil",
    label: "Profil",
    info: "Definicija ponavljajućih provjera za klijenta: koja vrsta provjere se radi, na kojoj lokaciji i kojim intervalom. Iz ovih stavki se automatski generišu termini. „Zadnji put” je posljednje stvarno izvršenje, „Sljedeći rok” je rok aktivnog termina.",
  },
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
            <InfoIkona tekst={t.info} testId={`info-tab-${t.value}`} />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
```

Napomena: labela i `data-testid` tabova su nepromijenjeni; `gap-1.5` triggera daje razmak.

- [ ] **Step 5: Pokreni test — mora proći**

Run: `pnpm exec playwright test tests/e2e/21-info-tooltips.spec.ts --project=chromium`
Expected: PASS (1 test).

- [ ] **Step 6: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 7: Commit**

```bash
git add components/ui/info-ikona.tsx components/domain/KlijentTabs.tsx tests/e2e/21-info-tooltips.spec.ts
git commit -m "feat(klijenti): InfoIkona komponenta + ⓘ objašnjenja na tabovima klijenta"
```

---

### Task 2: ⓘ pored naslova sekcija ID karte

**Files:**
- Modify: `components/domain/IdKartaTab.tsx` (naslovi „Osnovni podaci” i „Ugovorene usluge” + prosljeđivanje `info` propova)
- Modify: `components/domain/UgovoriTab.tsx` (novi opcioni prop `info`)
- Modify: `components/domain/KontaktiKlijentList.tsx` (novi opcioni prop `info`)
- Test: `tests/e2e/21-info-tooltips.spec.ts` (drugi test)

**Interfaces:**
- Consumes: `InfoIkona` iz Taska 1.
- Produces: `UgovoriTab` prima `info?: string`; `KontaktiKlijentList` prima `info?: string` (Task 3 ga koristi iz `page.tsx`). E2E testid konvencija za sekcije: `info-sekcija-<naziv>` (`info-sekcija-osnovni`, `info-sekcija-ugovori`, `info-sekcija-kontakti-firma`, `info-sekcija-usluge`, `info-sekcija-kontakti-lokacija`).

- [ ] **Step 1: Dopiši padajući e2e test**

Dodaj u `tests/e2e/21-info-tooltips.spec.ts` novi describe blok:

```ts
test.describe("Info tooltipovi — sekcije ID karte", () => {
  test("hover na ⓘ sekcije Ugovori prikazuje objašnjenje", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=id-karta`)
      await expect(page.getByTestId("tab-id-karta-content")).toBeVisible()

      const ikona = page.getByTestId("info-sekcija-ugovori")
      await expect(ikona).toBeVisible()
      await ikona.hover()
      await expect(page.getByText("Samo jedan ugovor može biti aktivan")).toBeVisible()

      await expect(page.getByTestId("info-sekcija-osnovni")).toBeVisible()
      await expect(page.getByTestId("info-sekcija-kontakti-firma")).toBeVisible()
      await expect(page.getByTestId("info-sekcija-usluge")).toBeVisible()
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm exec playwright test tests/e2e/21-info-tooltips.spec.ts --project=chromium`
Expected: novi test FAIL (`info-sekcija-ugovori` ne postoji), test iz Taska 1 PASS.

- [ ] **Step 3: Dodaj `info` prop u `UgovoriTab.tsx`**

U `components/domain/UgovoriTab.tsx`:

Import (dodaj):
```tsx
import { InfoIkona } from "@/components/ui/info-ikona"
```

Potpis komponente — zamijeni:
```tsx
export function UgovoriTab({ klijentId, ugovori }: { klijentId: string; ugovori: UgovorRow[] }) {
```
sa:
```tsx
export function UgovoriTab({ klijentId, ugovori, info }: { klijentId: string; ugovori: UgovorRow[]; info?: string }) {
```

Naslov — zamijeni:
```tsx
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FileText className="h-4 w-4 text-slate-400" aria-hidden /> Ugovori
        </h3>
```
sa:
```tsx
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FileText className="h-4 w-4 text-slate-400" aria-hidden /> Ugovori
          {info && <InfoIkona tekst={info} testId="info-sekcija-ugovori" />}
        </h3>
```

- [ ] **Step 4: Dodaj `info` prop u `KontaktiKlijentList.tsx`**

U `components/domain/KontaktiKlijentList.tsx`:

Import (dodaj):
```tsx
import { InfoIkona } from "@/components/ui/info-ikona"
```

Props — zamijeni:
```tsx
export function KontaktiKlijentList({
  klijentId,
  kontakti,
  searchable = false,
  previewLimit,
  seeAllHref,
}: {
  klijentId: string
  kontakti: KontaktRow[]
  searchable?: boolean
  previewLimit?: number
  seeAllHref?: string
}) {
```
sa:
```tsx
export function KontaktiKlijentList({
  klijentId,
  kontakti,
  searchable = false,
  previewLimit,
  seeAllHref,
  info,
}: {
  klijentId: string
  kontakti: KontaktRow[]
  searchable?: boolean
  previewLimit?: number
  seeAllHref?: string
  info?: string
}) {
```

Naslov — zamijeni:
```tsx
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Users className="h-4 w-4 text-slate-400" aria-hidden /> Kontakt osobe (firma)
        </h3>
```
sa:
```tsx
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Users className="h-4 w-4 text-slate-400" aria-hidden /> Kontakt osobe (firma)
          {info && <InfoIkona tekst={info} testId="info-sekcija-kontakti-firma" />}
        </h3>
```

- [ ] **Step 5: Ubaci ⓘ u `IdKartaTab.tsx`**

U `components/domain/IdKartaTab.tsx`:

Import (dodaj):
```tsx
import { InfoIkona } from "@/components/ui/info-ikona"
```

Naslov „Osnovni podaci” — zamijeni:
```tsx
          <h3 className="text-sm font-semibold text-slate-700">Osnovni podaci</h3>
```
sa:
```tsx
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Osnovni podaci
            <InfoIkona
              tekst="Registracioni i kontakt podaci firme (adresa, PIB, matični broj…) i osoba zadužena za klijenta. Uređuje se preko dugmeta Uredi u zaglavlju."
              testId="info-sekcija-osnovni"
            />
          </h3>
```

Poziv `UgovoriTab` — zamijeni:
```tsx
        <UgovoriTab klijentId={klijentId} ugovori={ugovori} />
```
sa:
```tsx
        <UgovoriTab
          klijentId={klijentId}
          ugovori={ugovori}
          info="Ugovori sklopljeni sa klijentom. Samo jedan ugovor može biti aktivan; stariji ostaju kao istorija."
        />
```

Poziv `KontaktiKlijentList` — zamijeni:
```tsx
        <KontaktiKlijentList
          klijentId={klijentId}
          kontakti={kontakti}
          previewLimit={4}
          seeAllHref={`/klijenti/${klijentId}?tab=kontakti`}
        />
```
sa:
```tsx
        <KontaktiKlijentList
          klijentId={klijentId}
          kontakti={kontakti}
          previewLimit={4}
          seeAllHref={`/klijenti/${klijentId}?tab=kontakti`}
          info="Skraćeni pregled kontakata firme (prvih nekoliko). Puni spisak i pretraga su u tabu Kontakti."
        />
```

Naslov „Ugovorene usluge” — zamijeni:
```tsx
          <h3 className="text-sm font-semibold text-slate-700">Ugovorene usluge</h3>
```
sa:
```tsx
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Ugovorene usluge
            <InfoIkona
              tekst="Sažetak provjera iz Profila sa sljedećim rokom za svaku — brzi uvid u to šta je ugovoreno i šta prvo dolazi na red."
              testId="info-sekcija-usluge"
            />
          </h3>
```

- [ ] **Step 6: Pokreni test — mora proći**

Run: `pnpm exec playwright test tests/e2e/21-info-tooltips.spec.ts --project=chromium`
Expected: PASS (2 testa).

- [ ] **Step 7: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 8: Commit**

```bash
git add components/domain/IdKartaTab.tsx components/domain/UgovoriTab.tsx components/domain/KontaktiKlijentList.tsx tests/e2e/21-info-tooltips.spec.ts
git commit -m "feat(klijenti): ⓘ objašnjenja na sekcijama ID karte"
```

---

### Task 3: ⓘ na sekcijama Kontakti taba + završna provjera

**Files:**
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (Kontakti tab: `info` prop za listu firme + ⓘ pored „Kontakti lokacija”)
- Test: `tests/e2e/21-info-tooltips.spec.ts` (treći test)

**Interfaces:**
- Consumes: `InfoIkona` (Task 1); `KontaktiKlijentList` sa `info?: string` (Task 2).
- Produces: ništa novo — završni task.

- [ ] **Step 1: Dopiši padajući e2e test**

Dodaj u `tests/e2e/21-info-tooltips.spec.ts`:

```ts
test.describe("Info tooltipovi — Kontakti tab", () => {
  test("hover na ⓘ sekcije Kontakt osobe (firma) prikazuje objašnjenje", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible()

      const ikona = page.getByTestId("info-sekcija-kontakti-firma")
      await expect(ikona).toBeVisible()
      await ikona.hover()
      await expect(page.getByText("Puni spisak kontakata firme sa pretragom")).toBeVisible()
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
```

Napomena: sekcija „Kontakti lokacija” se renderuje samo kad lokacija ima kontakt podatke, a e2e helper `insertLokacija` ih ne postavlja — taj ⓘ pokrivaju typecheck i ručna provjera (Step 5), bez dodatnog test fixture-a.

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm exec playwright test tests/e2e/21-info-tooltips.spec.ts --project=chromium`
Expected: novi test FAIL — `info-sekcija-kontakti-firma` postoji samo na ID karti (`?tab=id-karta`), ne u Kontakti tabu, jer `page.tsx` još ne prosljeđuje `info`.

- [ ] **Step 3: Izmijeni `app/(dashboard)/klijenti/[id]/page.tsx`**

Import (dodaj uz postojeće importe):
```tsx
import { InfoIkona } from "@/components/ui/info-ikona"
```

U Kontakti tabu — zamijeni:
```tsx
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <KontaktiKlijentList klijentId={id} kontakti={kontakti} searchable />
          </section>
```
sa:
```tsx
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <KontaktiKlijentList
              klijentId={id}
              kontakti={kontakti}
              searchable
              info="Puni spisak kontakata firme sa pretragom po imenu i funkciji."
            />
          </section>
```

Naslov „Kontakti lokacija” — zamijeni:
```tsx
              <div className="mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-400" aria-hidden />
                <h3 className="text-sm font-semibold text-slate-700">Kontakti lokacija</h3>
              </div>
```
sa:
```tsx
              <div className="mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-400" aria-hidden />
                <h3 className="text-sm font-semibold text-slate-700">Kontakti lokacija</h3>
                <InfoIkona
                  tekst="Kontakt osobe pojedinačnih lokacija, izvedene iz podataka lokacije. Uređuju se u tabu Lokacije."
                  testId="info-sekcija-kontakti-lokacija"
                />
              </div>
```

- [ ] **Step 4: Pokreni cijeli spec (oba browsera) — mora proći**

Run: `pnpm exec playwright test tests/e2e/21-info-tooltips.spec.ts`
Expected: PASS (3 testa × chromium + webkit = 6).

- [ ] **Step 5: Regresija susjednih specova + lint/typecheck + ručna provjera**

Run: `pnpm exec playwright test tests/e2e/04-klijenti.spec.ts tests/e2e/16-profil.spec.ts tests/e2e/19-id-karta.spec.ts --project=chromium`
Expected: PASS (tabovi se i dalje biraju preko `getByRole("tab", ...)`).

Run: `pnpm lint && pnpm typecheck`
Expected: bez grešaka.

Ručno (`pnpm dev`, otvori klijenta): hover preko ⓘ na svih 6 tabova i naslovima sekcija — tooltip se otvara ispod ikone, tekst se prelama, ne izlazi iz ekrana; klik na tab i dalje mijenja tab.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/klijenti/[id]/page.tsx" tests/e2e/21-info-tooltips.spec.ts
git commit -m "feat(klijenti): ⓘ objašnjenja na sekcijama Kontakti taba"
```

- [ ] **Step 7: Ažuriraj spec (aria odluka) + commit**

U `docs/superpowers/specs/2026-07-04-info-tooltips-klijent-design.md` zamijeni:
```
- Props: `tekst: string`, opciono `className`. `aria-label={tekst}` na spanu.
```
sa:
```
- Props: `tekst: string`, opciono `className`, opciono `testId`. Wrapper je
  `aria-hidden` — `aria-label` bi zagadio accessible name TabsTrigger dugmeta
  na koji se oslanjaju e2e selektori (`getByRole("tab", { name })`).
```

```bash
git add docs/superpowers/specs/2026-07-04-info-tooltips-klijent-design.md
git commit -m "docs(spec): info-tooltips — aria-hidden umjesto aria-label (accessible name tabova)"
```
