# Obilasci gradovi iz lokacija + Kalendar dodavanje termina — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dva yoink zahtjeva (2026-07-29): (A) filter gradova na `/obilasci` nudi samo gradove u kojima klijenti STVARNO imaju lokacije (iz `lokacije.grad`), ne cijeli katalog `gradovi`; (B) klik na "+" na danu u kalendaru `/plan-aktivnosti?view=kalendar` otvara postojeći "Novi termin" dijalog sa rokom dospijeća prefilovanim na taj dan (kao dodavanje eventa u telefonskom kalendaru).

**Architecture:** (A) nova čista funkcija `distinctGradovi` + server query `dohvatiGradoveLokacija` u `lib/queries/gradovi.ts`; `obilasci/page.tsx` mijenja samo izvor opcija (katalog `gradovi` ostaje netaknut za druge namjene). (B) dijalog se ekstraktuje iz `NoviTerminButton` u kontrolisani `NoviTerminDialog` (open/onOpenChange/defaultRok); kalendar dobija podatke za formu kroz novu API rutu `/api/plan-aktivnosti/form-podaci` (isti Promise.all obrazac kao `lista` ruta) i TanStack query; `MonthCalendar` dobija opcioni `onDodajTermin` callback koji renderuje hover "+" dugme po ćeliji.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (SSR klijent + RLS), TanStack React Query, Tailwind v4, next-intl (sr/en/de), Vitest, Playwright.

## Global Constraints

- Identifikatori, komentari i domenske riječi na srpskom; UI stringovi ISKLJUČIVO kroz next-intl — svaki novi ključ ide u SVA TRI fajla `messages/{sr,en,de}.json`.
- S1 kanon: pad upita ≠ prazan rezultat — API rute vraćaju `{ error: <i18n string> }`, helperi ili bacaju ili imaju dokumentovan fallback.
- Radno stablo VEĆ sadrži nepovezane uncommitted izmjene (yoink UI/role batch) — u commit koracima `git add` SAMO fajlove eksplicitno navedene u tom tasku, NIKAD `git add -A`/`git add .`.
- Bez izmjena DB šeme/migracija — sve čita postojeće tabele (`lokacije.grad` postoji: `db/types.ts:517`).
- Package manager je `pnpm`; testovi: `pnpm test:unit` (Vitest), `npx playwright test <spec> --project=chromium --workers=1`.
- Postojeći testid-jevi se NE preimenuju (`obilasci-grad`, `plan-day-cell`, `novi-termin-btn`, `novi-termin-sheet`, `novi-*`).
- Poznati PRE-EXISTING e2e padovi (ne popravljati, ne brojati kao regresije ovog plana): `03-termini.spec.ts:38` (header "Datum roka" vs "Datum"), `09-asistent` (flaky), povremeni webkit padovi u `04-klijenti`.
- e2e treba lokalni Supabase stack (Docker) + dev server na :3000 — već rade; ništa ne restartovati.

---

### Task 1: `distinctGradovi` čista funkcija + `dohvatiGradoveLokacija` server query

**Files:**
- Modify: `lib/queries/gradovi.ts`
- Create: `lib/queries/gradovi.test.ts`

**Interfaces:**
- Consumes: postojeći `createServerSupabaseClient` iz `@/lib/supabase/server` (već importovan u fajlu).
- Produces: `export function distinctGradovi(redovi: { grad: string | null }[] | null | undefined): string[]` i `export async function dohvatiGradoveLokacija(): Promise<string[]>` — Task 2 poziva `dohvatiGradoveLokacija()`.

- [ ] **Step 1: Write the failing test**

Kreiraj `lib/queries/gradovi.test.ts` (Vitest, čista funkcija — bez mreže, isti stil kao `lib/queries/aktivni-korisnici` testovi):

```ts
import { describe, expect, it } from "vitest"
import { distinctGradovi } from "./gradovi"

describe("distinctGradovi", () => {
  it("prazan/null ulaz → prazan niz", () => {
    expect(distinctGradovi(null)).toEqual([])
    expect(distinctGradovi(undefined)).toEqual([])
    expect(distinctGradovi([])).toEqual([])
  })

  it("dedup + sort (localeCompare), whitespace se trimuje", () => {
    const redovi = [
      { grad: "Prijedor" },
      { grad: "Banja Luka" },
      { grad: "  Banja Luka  " },
      { grad: "Prijedor" },
      { grad: "Brčko" },
    ]
    expect(distinctGradovi(redovi)).toEqual(["Banja Luka", "Brčko", "Prijedor"])
  })

  it("null i prazni gradovi se preskaču (ne prave prazan unos)", () => {
    const redovi = [{ grad: null }, { grad: "" }, { grad: "   " }, { grad: "Doboj" }]
    expect(distinctGradovi(redovi)).toEqual(["Doboj"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/queries/gradovi.test.ts`
Expected: FAIL — `distinctGradovi` nije eksportovan iz `./gradovi`.

- [ ] **Step 3: Write minimal implementation**

U `lib/queries/gradovi.ts` dodaj NA KRAJ fajla (postojeći `dohvatiGradove` NE dirati — katalog ostaje fallback/izvor za druge tokove, v. `lib/obilasci.ts` komentar o `buildGradoviMapa`):

```ts
/** Čist dio: redovi lokacija → jedinstveni ne-prazni gradovi, sortirani (localeCompare). */
export function distinctGradovi(
  redovi: { grad: string | null }[] | null | undefined,
): string[] {
  const skup = new Set<string>()
  for (const red of redovi ?? []) {
    const grad = (red.grad ?? "").trim()
    if (grad !== "") skup.add(grad)
  }
  return [...skup].sort((a, b) => a.localeCompare(b))
}

/**
 * Gradovi u kojima klijenti STVARNO imaju lokacije (yoink zahtjev 2026-07-29) —
 * zamjena punog kataloga `gradovi` u obilasci FILTERU. Čita `lokacije.grad` kroz
 * RLS pozivaoca, pa operater dobija samo gradove svojih firmi (poželjno).
 *
 * Na grešku BACA — isti S1 ugovor kao `dohvatiGradove` iznad (pozivalac hvata
 * i razlikuje pad od praznog rezultata).
 */
export async function dohvatiGradoveLokacija(): Promise<string[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from("lokacije").select("grad")
  if (error) throw new Error(error.message)
  return distinctGradovi(data)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/queries/gradovi.test.ts`
Expected: PASS (3 testa).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck` — Expected: bez grešaka.

```bash
git add lib/queries/gradovi.ts lib/queries/gradovi.test.ts
git commit -m "feat(obilasci): distinctGradovi + dohvatiGradoveLokacija — gradovi iz stvarnih lokacija"
```

---

### Task 2: `/obilasci` filter koristi gradove lokacija

**Files:**
- Modify: `app/(dashboard)/obilasci/page.tsx:15` (import) i `:54-57` (poziv)
- Test: postojeći `tests/e2e/15-obilasci-dorada.spec.ts` (bez izmjena — mora i dalje prolaziti)

**Interfaces:**
- Consumes: `dohvatiGradoveLokacija(): Promise<string[]>` iz Task 1.
- Produces: ništa novo — `ObilasciToolbar` prop `gradovi: string[]` ostaje isti oblik.

- [ ] **Step 1: Zamijeni izvor gradova**

U `app/(dashboard)/obilasci/page.tsx` zamijeni import (linija 15):

```ts
// PRIJE:
import { dohvatiGradove } from "@/lib/queries/gradovi"
// POSLIJE:
import { dohvatiGradoveLokacija } from "@/lib/queries/gradovi"
```

i poziv u `Promise.all` (linije 54-57):

```ts
// PRIJE:
    // `dohvatiGradove` BACA na grešku (S1 ugovor helpera) — hvatamo je ovdje da bi se
    // razlikovala od praznog kataloga i prikazala kao greška, a ne kao „nema termina".
    dohvatiGradove().catch(() => null),
// POSLIJE:
    // `dohvatiGradoveLokacija` BACA na grešku (S1 ugovor helpera) — hvatamo je ovdje da
    // bi se razlikovala od „nijedna lokacija nema grad" i prikazala kao greška.
    // Izvor su STVARNE lokacije klijenata (yoink 2026-07-29), ne katalog `gradovi`.
    dohvatiGradoveLokacija().catch(() => null),
```

Ostatak fajla (uključujući `grad === "__bez__"` granu i `greska = gradovi === null || ...`) NE dirati — semantika identična.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck` — Expected: bez grešaka.

- [ ] **Step 3: e2e regresija filtera gradova**

Run: `npx playwright test tests/e2e/15-obilasci-dorada.spec.ts tests/e2e/12-obilasci.spec.ts --project=chromium --workers=1`
Expected: PASS — seed ima lokacije u Banja Luci itd., pa opcija "Banja Luka" i dalje postoji; opcije "Svi gradovi" i "Bez grada" dolaze iz `ObilasciToolbar` (statične), ne iz liste.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/obilasci/page.tsx"
git commit -m "feat(obilasci): filter gradova iz stvarnih lokacija klijenata umjesto kataloga"
```

---

### Task 3: Ekstrakcija `NoviTerminDialog` (kontrolisani dijalog, bez promjene ponašanja)

**Files:**
- Create: `components/domain/NoviTerminDialog.tsx`
- Modify: `components/domain/NoviTerminButton.tsx` (postaje tanki wrapper)
- Test: postojeći `tests/e2e/03-termini.spec.ts` (novi-termin tokovi na linijama ~250 i ~274 — bez izmjena, moraju prolaziti)

**Interfaces:**
- Consumes: postojeće `createTermin` server akcija, `ZaduzeniPolje`, `FieldError`, `useMozeUrediti`, `useInvalidatePlanQueries`, `useAkcijaToast` — sve već importovano u `NoviTerminButton.tsx`.
- Produces: `export function NoviTerminDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; klijenti: Opt[]; vrste: Opt[]; lokacijeByFirma: Record<string, Opt[]>; zaduzeniPrijedloziByFirma: Record<string, string[]>; sviRadnici: string[]; defaultRok?: string })` gdje je `type Opt = { id: string; naziv: string }` (eksportovati i `Opt` kao `export type Opt`). Task 5 renderuje `NoviTerminDialog` direktno.

- [ ] **Step 1: Kreiraj `NoviTerminDialog.tsx` premještanjem sadržaja**

Mehanička transformacija — sadržaj postojećeg `components/domain/NoviTerminButton.tsx` se premješta u novi fajl `components/domain/NoviTerminDialog.tsx` doslovno, uz TAČNO ove izmjene:

1. Ime komponente i potpis:

```tsx
export type Opt = { id: string; naziv: string }

export function NoviTerminDialog({
  open,
  onOpenChange,
  klijenti,
  vrste,
  lokacijeByFirma,
  zaduzeniPrijedloziByFirma,
  sviRadnici,
  defaultRok,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
  /** Imena korisnika koji imaju pristup toj firmi (za ne-admine i ograničenje na
   * serveru) — vidi docs/superpowers/specs/2026-07-29-zaduzeni-po-firmi-design.md. */
  zaduzeniPrijedloziByFirma: Record<string, string[]>
  /** Prazno za ne-admine; admin dobija sva aktivna imena (smije zadužiti bilo koga,
   * firma se radniku auto-dodijeli u termini/actions). */
  sviRadnici: string[]
  /** Prefill roka dospijeća (kalendar: klik na dan) — ISO `yyyy-mm-dd`. */
  defaultRok?: string
})
```

2. Lokalni state `open` se BRIŠE (`const [open, setOpen] = useState(false)` van) — koristi se prop `open`/`onOpenChange`. U reset-efektu poslije uspješnog submita `setOpen(false)` postaje `onOpenChange(false)`, a `setRok("")` postaje `setRok(defaultRok ?? "")`; u dependency niz efekta dodati `onOpenChange` i `defaultRok`.
3. Rok state se inicijalizuje iz propa: `const [rok, setRok] = useState(defaultRok ?? "")`.
4. JSX: `<Dialog open={open} onOpenChange={onOpenChange}>` i BRIŠE se cijeli `<DialogTrigger render={...} />` blok (i import `DialogTrigger` i `Plus` ikone); sve ostalo (form, testid-jevi `novi-termin-sheet`, `novi-klijent`, `novi-vrsta`, `novi-rok`, `novi-zakazan`, `novi-zaduzeni`, `novi-submit`, `novi-cancel`, zaduzeni hint) ostaje doslovno isto.
5. Guard `if (!mozeUrediti) return null` OSTAJE (dijalog se nikad ne renderuje za pregled ulogu).

- [ ] **Step 2: `NoviTerminButton.tsx` postaje wrapper**

Cijeli novi sadržaj fajla:

```tsx
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NoviTerminDialog, type Opt } from "@/components/domain/NoviTerminDialog"
import { useMozeUrediti } from "@/providers/korisnik-provider"

/** Dugme + kontrolisani NoviTerminDialog — forma živi u NoviTerminDialog.tsx. */
export function NoviTerminButton({
  klijenti,
  vrste,
  lokacijeByFirma,
  zaduzeniPrijedloziByFirma,
  sviRadnici,
}: {
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
  zaduzeniPrijedloziByFirma: Record<string, string[]>
  sviRadnici: string[]
}) {
  const t = useTranslations("termini.noviTermin")
  const [open, setOpen] = useState(false)
  const mozeUrediti = useMozeUrediti()
  if (!mozeUrediti) return null

  return (
    <>
      <Button data-testid="novi-termin-btn" onClick={() => setOpen(true)}>
        <Plus className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("dugme")}
      </Button>
      <NoviTerminDialog
        open={open}
        onOpenChange={setOpen}
        klijenti={klijenti}
        vrste={vrste}
        lokacijeByFirma={lokacijeByFirma}
        zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma}
        sviRadnici={sviRadnici}
      />
    </>
  )
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: bez novih grešaka (postojeći warninzi u `scripts/` su poznati).

- [ ] **Step 4: e2e regresija novog termina**

Run: `npx playwright test tests/e2e/03-termini.spec.ts --project=chromium --workers=1`
Expected: novi-termin testovi (`:250`, `:274`) PASS; pad `03-termini.spec.ts:38` je poznat PRE-EXISTING (header kolone) i NE računa se kao regresija.

- [ ] **Step 5: Commit**

```bash
git add components/domain/NoviTerminDialog.tsx components/domain/NoviTerminButton.tsx
git commit -m "refactor(termini): NoviTerminDialog ekstraktovan kao kontrolisani dijalog (priprema za kalendar)"
```

---

### Task 4: API ruta `form-podaci` + klijentski query

**Files:**
- Create: `app/api/plan-aktivnosti/form-podaci/route.ts`
- Modify: `lib/queries/plan-aktivnosti.ts` (dodati `getTerminiFormPodaci` na kraj)

**Interfaces:**
- Consumes: obrazac iz `app/api/plan-aktivnosti/lista/route.ts:33-52` (isti selecti, isti S1 `{ error }` ugovor).
- Produces: `GET /api/plan-aktivnosti/form-podaci` → `{ klijenti: {id,naziv}[]; vrste: {id,naziv}[]; lokacije: {id,naziv,klijent_id}[] }`; `export async function getTerminiFormPodaci()` sa istim tipom — Task 5 je potrošač.

- [ ] **Step 1: Kreiraj rutu**

`app/api/plan-aktivnosti/form-podaci/route.ts`:

```ts
import { NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

// S1: ruta nikad ne vraća sirovi PostgrestError — samo `{ error: <i18n string> }`.
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

/**
 * GET /api/plan-aktivnosti/form-podaci
 *
 * Skupovi za "Novi termin" formu VAN lista view-a (kalendar "+" na danu) — isti
 * selecti kao meta dio lista rute (lista/route.ts), ali bez termina/paginacije.
 * RLS scope-uje klijente/lokacije po pozivaocu.
 */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const [klijentiRes, vrsteRes, lokacijeRes] = await Promise.all([
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
    supabase.from("lokacije").select("id, naziv, klijent_id").order("naziv"),
  ])

  if (klijentiRes.error || vrsteRes.error || lokacijeRes.error) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }

  return NextResponse.json({
    klijenti: klijentiRes.data ?? [],
    vrste: vrsteRes.data ?? [],
    lokacije: lokacijeRes.data ?? [],
  })
}
```

- [ ] **Step 2: Dodaj klijentski query**

U `lib/queries/plan-aktivnosti.ts` na kraj fajla:

```ts
/** Skupovi za "Novi termin" formu (kalendar "+"). Isti S1 ugovor kao ostali fetcheri. */
export async function getTerminiFormPodaci() {
  const r = await fetch(`/api/plan-aktivnosti/form-podaci`)
  if (!r.ok) await baci(r)
  return r.json() as Promise<{
    klijenti: { id: string; naziv: string }[]
    vrste: { id: string; naziv: string }[]
    lokacije: { id: string; naziv: string; klijent_id: string }[]
  }>
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck` — Expected: bez grešaka. (Funkcionalna provjera rute ide kroz Task 5 e2e — ruta traži auth cookie pa se ne testira curl-om.)

- [ ] **Step 4: Commit**

```bash
git add app/api/plan-aktivnosti/form-podaci/route.ts lib/queries/plan-aktivnosti.ts
git commit -m "feat(plan): form-podaci API ruta + getTerminiFormPodaci za kalendar dodavanje"
```

---

### Task 5: "+" na danu kalendara → NoviTerminDialog sa prefilovanim rokom

**Files:**
- Modify: `components/domain/MonthCalendar.tsx` (novi prop `onDodajTermin` + hover "+" dugme)
- Modify: `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx` (state + query + render dijaloga)
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json` (1 novi ključ)
- Test: dodati test u `tests/e2e/20-plan-aktivnosti.spec.ts`

**Interfaces:**
- Consumes: `NoviTerminDialog` + `Opt` (Task 3), `getTerminiFormPodaci` (Task 4), postojeći `useMozeUrediti` iz `@/providers/korisnik-provider`.
- Produces: `MonthCalendar` prop `onDodajTermin?: (dan: string) => void`; testid `cell-dodaj-termin` (dugme nosi i `data-date`).

- [ ] **Step 1: i18n ključ u sva tri jezika**

`messages/sr.json` → u postojeći objekat `plan.monthCalendar` dodaj:
```json
"dodajTermin": "Dodaj termin za {datum}"
```
`messages/en.json` → `plan.monthCalendar`:
```json
"dodajTermin": "Add appointment for {datum}"
```
`messages/de.json` → `plan.monthCalendar`:
```json
"dodajTermin": "Termin hinzufügen für {datum}"
```

- [ ] **Step 2: `MonthCalendar` — prop + hover "+" dugme**

U `components/domain/MonthCalendar.tsx`:

1. Import ikone: `import { Plus } from "lucide-react"`.
2. Potpis komponente — dodaj prop:

```tsx
export function MonthCalendar({
  grid,
  terminiByDan,
  today,
  selectedDan,
  currentSearch,
  onDodajTermin,
}: {
  grid: CalDay[]
  terminiByDan: Map<string, DayTermin[]>
  today: string
  selectedDan: string | null
  currentSearch: string
  /** Kad je zadat (uloga smije uređivati), ćelija dana dobija hover "+" za novi termin. */
  onDodajTermin?: (dan: string) => void
})
```

3. Ćeliji dana (div sa `key={c.date}`, linija ~89) dodaj `"group/dan"` u `cn(...)` listu klasa.
4. U content sloju, unutar `<div className="flex items-center justify-between">` ODMAH POSLIJE `<span>` sa brojem dana (linija ~118), dodaj:

```tsx
{onDodajTermin && (
  <button
    type="button"
    data-testid="cell-dodaj-termin"
    data-date={c.date}
    aria-label={t("dodajTermin", { datum: c.date })}
    onClick={() => onDodajTermin(c.date)}
    className={cn(
      "pointer-events-auto grid size-5 place-items-center rounded-md text-muted-foreground transition-opacity",
      "opacity-0 group-hover/dan:opacity-100 focus-visible:opacity-100 hover:bg-brand hover:text-white",
      FOCUS_RING,
    )}
  >
    <Plus className="size-3.5" aria-hidden />
  </button>
)}
```

Napomena: dugme je u gornjem DESNOM uglu (justify-between ga gura desno) — e2e `05-matrix-plan.spec.ts:115` klika dan na poziciji `{x:10, y:6}` (gornji LIJEVI ugao), pa se ne sudaraju.

- [ ] **Step 3: `KalendarView` — state, query, render dijaloga**

U `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx`:

1. Importi (dodaj):

```tsx
import { useState } from "react"
import { NoviTerminDialog, type Opt } from "@/components/domain/NoviTerminDialog"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import { getTerminiKalendar, getTerminDetail, getTerminiFormPodaci, porukaGreske } from "@/lib/queries/plan-aktivnosti"
```
(zadnja linija ZAMJENJUJE postojeći import iz `@/lib/queries/plan-aktivnosti` — dodaje se samo `getTerminiFormPodaci`).

2. U tijelu komponente, poslije `const selectedDan = ...` (linija ~42):

```tsx
const mozeUrediti = useMozeUrediti()
// "+" na danu → kontrolisani NoviTerminDialog sa rokom = taj dan (yoink 2026-07-29)
const [noviZaDan, setNoviZaDan] = useState<string | null>(null)

// Skupovi za formu — mali i stabilni, prefetch čim je uloga uređivačka da "+"
// otvara dijalog bez čekanja; pregled uloga ne troši upit (enabled).
const { data: formPodaci } = useQuery({
  queryKey: ["termini-form-podaci"],
  queryFn: getTerminiFormPodaci,
  staleTime: 60_000,
  enabled: mozeUrediti,
})

const formLokacijeByFirma: Record<string, Opt[]> = {}
for (const l of formPodaci?.lokacije ?? []) {
  ;(formLokacijeByFirma[l.klijent_id] ??= []).push({ id: l.id, naziv: l.naziv })
}
```

3. `MonthCalendar` render (linija ~148) dobija prop:

```tsx
<MonthCalendar
  grid={grid}
  terminiByDan={terminiByDan}
  today={today}
  selectedDan={selectedDan}
  currentSearch={currentSearch}
  onDodajTermin={mozeUrediti && formPodaci ? setNoviZaDan : undefined}
/>
```

4. Na kraj JSX-a, ODMAH PRIJE `{selectedTermin && (<TerminSheet ...>)}` bloka:

```tsx
{/* key={noviZaDan} remount-uje dijalog po danu → svjež state sa novim defaultRok */}
{noviZaDan && formPodaci && (
  <NoviTerminDialog
    key={noviZaDan}
    open
    onOpenChange={(o) => { if (!o) setNoviZaDan(null) }}
    defaultRok={noviZaDan}
    klijenti={formPodaci.klijenti}
    vrste={formPodaci.vrste}
    lokacijeByFirma={formLokacijeByFirma}
    zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma}
    sviRadnici={sviRadnici}
  />
)}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: bez novih grešaka.

- [ ] **Step 5: Napiši e2e test (prvo ga vidi kako pada — dugme prije Step 2 ne postoji, pa ovaj korak ide poslije implementacije kao regresioni; pokreni ga sada)**

U `tests/e2e/20-plan-aktivnosti.spec.ts` dodaj na kraj:

```ts
test.describe("Kalendar — dodavanje termina sa dana", () => {
  test("hover na dan → '+' otvara Novi termin sa prefilovanim rokom", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=kalendar&godina=2026&mjesec=7")
    const cell = page.locator('[data-testid="plan-day-cell"][data-date="2026-07-15"]')
    await expect(cell).toBeVisible()
    // dugme je u istoj ćeliji (sibling content sloja) — hover po ćeliji ga otkriva
    await cell.hover()
    const plus = page.locator('[data-testid="cell-dodaj-termin"][data-date="2026-07-15"]')
    await plus.click()
    await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()
    await expect(page.getByTestId("novi-rok")).toHaveValue("2026-07-15")
    await page.getByTestId("novi-cancel").click()
    await expect(page.getByTestId("novi-termin-sheet")).not.toBeVisible()
  })
})
```

Run: `npx playwright test tests/e2e/20-plan-aktivnosti.spec.ts --project=chromium --workers=1`
Expected: PASS (uključujući novi test).

- [ ] **Step 6: e2e regresija kalendara**

Run: `npx playwright test tests/e2e/05-matrix-plan.spec.ts tests/e2e/14-plan-dorada.spec.ts --project=chromium --workers=1`
Expected: PASS — klik na dan (`?dan` sidebar), `cell-termin` linkovi i klik pri vrhu ćelije rade kao prije.

- [ ] **Step 7: Unit testovi (cijeli suite) + commit**

Run: `pnpm test:unit` — Expected: svi prolaze (865+).

```bash
git add components/domain/MonthCalendar.tsx "app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx" messages/sr.json messages/en.json messages/de.json tests/e2e/20-plan-aktivnosti.spec.ts
git commit -m "feat(kalendar): '+' na danu otvara Novi termin sa prefilovanim rokom dospijeća"
```

---

## Self-Review (izvršeno pri pisanju)

1. **Spec coverage:** yoink A (gradovi iz baze/lokacija) → Task 1+2; yoink B (klik na dan → dodavanje) → Task 3+4+5. Uloga pregled ne vidi "+" (mozeUrediti guard u view-u i u dijalogu). ✓
2. **Placeholder scan:** svi koraci imaju konkretan kod/komande; premještanje u Task 3 Step 1 je precizno nabrojano po izmjenama. ✓
3. **Type consistency:** `Opt = { id: string; naziv: string }` definisan i eksportovan u Task 3, konzumiran u Task 5; `getTerminiFormPodaci` potpis (Task 4) odgovara upotrebi u Task 5; `onDodajTermin?: (dan: string) => void` konzistentan između MonthCalendar i KalendarView. ✓
