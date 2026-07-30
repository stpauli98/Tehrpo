# Yoink batch 2026-07-30 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Odraditi 9 zahtjeva prikupljenih kroz Yoink 30.07.2026 — od promjene default taba do popravke propusta zbog kojeg termin unesen kroz plan aktivnosti ne postoji nigdje na kartici klijenta.

**Architecture:** Sve promjene su aditivne nad postojećim obrascima MVP-a. Dvije migracije (`ugovori.na_neodredjeno`, prebacivanje ravnih kontakata lokacije u `kontakt_osobe` + drop kolona) idu prve jer sve ostalo zavisi od regenerisanog `db/types.ts`. Čista logika ide u `lib/*.ts` sa Vitest testovima; ponašanje formi i akcija se pokriva Playwright E2E testovima, jer je Vitest u ovom repou ograničen na `lib/**/*.test.ts`.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), React 19 Server Actions, Supabase (Postgres + RLS), Zod, next-intl, shadcn `base-nova` + Base UI, Tailwind, Vitest, Playwright, pnpm.

## Global Constraints

- **Grana:** `feat/yoink-batch-2026-07-30`. **Nikad ne push-uj `main`** — merge u `main` je produkcijski deploy na tri Vercel projekta odjednom.
- **Package manager je `pnpm`.** Nikad `npm`/`yarn`.
- **`pnpm dev` mora ostati `next dev --webpack`.** Turbopack puca jer putanja projekta sadrži razmak (`Ai Forward`).
- **Next.js 16 nije onaj iz training podataka.** Prije pisanja Next.js koda pročitaj relevantni vodič u `node_modules/next/dist/docs/`.
- **Domenski jezik je bosanski/srpski latinica.** Nazivi tabela, kolona, ruta, identifikatora i UI stringova — poštuj to.
- **Migracije:** `supabase/migrations/*.sql` je izvor istine. Primjenjuj na cloud JEDNU PO JEDNU sa `pnpm db:apply-cloud --demo <fajl>`. **Nikad na PROD u ovom planu.** Poslije svake migracije `pnpm db:types` (`db/types.ts` je auto-generisan — nikad ga ne diraj rukom).
- **Baza:** lokalni dev i E2E rade nad cloud **DEMO** ref `mtwwotmwrasozmcgqwhc`. PROD je `fqtqkehjidkzeasiegnq` i u ovom planu ga NE diramo.
- **next-intl provjerava ključeve tipovima.** Svaki novi ključ mora ući u **sva tri** kataloga `messages/{sr,en,de}.json` u **istoj** promjeni koja ga koristi, inače je `tsc` hard error. Ne koristi ICU `one` plural kategoriju za `sr`.
- **Zabranjeni Tailwind breakpointi `sm:` i `md:`** (ESLint `no-restricted-syntax`) — aplikacija je desktop-only. Koristi `lg:`/`xl:`/`2xl:` ili bez breakpointa.
- **`no-await-in-loop: error`** svugdje osim u `scripts/`.
- **Nikad service-role klijent u `app/` ili `components/`.** Server Components / Route Handlers / Server Actions koriste `createServerSupabaseClient()`.
- **`pregled` uloga je read-only.** Write kontrole se gate-uju sa `useMozeUrediti()`, i to **poslije svih hook poziva** (Rules of Hooks). Sakriva se samo write kontrola, nikad read prikaz.
- **Server Action oblik je krut:** `'use server'` → Zod `safeParse(Object.fromEntries(formData))` → potpis `(_prev, formData)` → `ActionResult` (`{ok:true} | {ok:false, errors?|message?}`) → mutacija preko SSR klijenta → `revalidatePath(...)`.
- **Poslije svakog taska:** `pnpm lint && pnpm typecheck` moraju proći prije commita.
- **Commit poslije svakog taska.** Bez batch-anja više taskova u jedan commit.

## Odluke koje je korisnik potvrdio (30.07.2026)

| Stavka | Odluka |
|---|---|
| 3 — uloge i ovlaštenja | **Preskače se u potpunosti.** Nema taska u ovom planu. |
| 4 — Novi klijent | Puna forma **+ prva prava lokacija** koja se upisuje u tabelu `lokacije`. |
| 5 — ugovor na neodređeno | **Dodaje se kolona u bazi** (migracija), ne samo UI interpretacija praznog datuma. |
| 6 — važenje ugovora | Dropdown 6/12/24/36/60 + „na neodređeno" **+ mogućnost custom broja mjeseci**. |
| 8+9 — ravni kontakti lokacije | Prvo **prebaci postojeće podatke** u `kontakt_osobe`, pa tek onda drop kolona. |
| 10 — „Prima podsjetnike za ovu lokaciju" | Ostaje, ali **neklikabilan** kad je slanje ugašeno, uz opis da ga je admin ugasio u Postavkama. |
| 11 — usluga iz plana aktivnosti | **(b) + (c).** Zatečenih 25+ termina **ostaje kao jednokratni** — bez backfill-a. |

## File Structure

**Nove datoteke**

| Fajl | Odgovornost |
|---|---|
| `supabase/migrations/20260730120000_ugovori_na_neodredjeno.sql` | Kolona `na_neodredjeno` + CHECK protiv kolizije sa `datum_isteka` |
| `supabase/migrations/20260730121000_lokacije_kontakti_u_kontakt_osobe.sql` | Prebacivanje 14 ravnih kontakata u `kontakt_osobe`, pa drop tri kolone |
| `lib/ugovori-vazenje.ts` | Čista logika opcija važenja (preseti + custom + neodređeno) |
| `lib/ugovori-vazenje.test.ts` | Vitest za gore |
| `lib/termini-jednokratni.ts` | Čista logika: spajanje profil-stavki i jednokratnih termina u jedan spisak usluga |
| `lib/termini-jednokratni.test.ts` | Vitest za gore |
| `tests/e2e/38-yoink-batch.spec.ts` | E2E za sve UI promjene iz ovog batch-a |

**Izmijenjene datoteke**

| Fajl | Šta se mijenja |
|---|---|
| `app/(dashboard)/klijenti/[id]/page.tsx` | Default tab; fetch `salji_podsjetnik_klijentu` + `postavke.salji_klijentima`; spajanje jednokratnih termina u spisak usluga |
| `components/domain/KlijentTabs.tsx` | Fallback taba u `onValueChange` |
| `components/domain/UgovorSheet.tsx` | Checkbox „na neodređeno" + dropdown važenja sa custom opcijom |
| `components/domain/UgovoriTab.tsx` | Prikaz „na neodređeno" umjesto praznog datuma isteka |
| `components/domain/LokacijaSheet.tsx` | Brisanje tri ravna kontakt polja; gating checkboxa podsjetnika |
| `components/domain/LokacijeTab.tsx` | Brisanje kolone koja čita `kontakt_osoba`; prosljeđivanje flagova podsjetnika |
| `components/domain/KontaktSheet.tsx` | Radio „postojeća / nova lokacija" + polja naziv/grad/adresa |
| `components/domain/NoviKlijentButton.tsx` | Puna polja firme + sekcija prve lokacije |
| `components/domain/NoviTerminDialog.tsx` | Radio „jednokratno / ponavljajuće" |
| `components/domain/ProfilTab.tsx` | Prikaz jednokratnih stavki + badge |
| `components/domain/IdKartaTab.tsx` | Isto, u sekciji Usluge |
| `app/(dashboard)/klijenti/actions.ts` | Schema/insert za ugovor, lokaciju, kontakt, klijenta |
| `app/(dashboard)/termini/actions.ts` | `createTermin` opciono kreira `klijent_provjere` |
| `messages/{sr,en,de}.json` | Svi novi ključevi + preimenovanje Profil → Usluge |
| `tests/e2e/04-klijenti.spec.ts` | Ispravke zbog default taba i uklonjenih polja |

---

### Task 1: Default tab na klijentu = ID karta

**Yoink stavka 1.**

**Files:**
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx:64`
- Modify: `components/domain/KlijentTabs.tsx:25`
- Test: `tests/e2e/04-klijenti.spec.ts:79-87`

**Interfaces:**
- Consumes: ništa (prvi task)
- Produces: default tab je `"id-karta"`. Task 11 se oslanja na to da se sekcija Usluge u ID karti vidi bez `?tab=`.

- [ ] **Step 1: Prepiši postojeći E2E test da očekuje ID kartu**

U `tests/e2e/04-klijenti.spec.ts` zamijeni test `"otvara detalje i prikazuje termini tab sa podacima"` ovim:

```ts
  test("otvara detalje i podrazumijevano prikazuje ID kartu", async ({ page }) => {
    await otvoriKlijent(page, fx.naziv)
    await expect(page.getByTestId("klijent-naziv")).toContainText(fx.naziv)
    // Default tab je ID karta (yoink 2026-07-30, stavka 1)
    await expect(page.getByTestId("tab-id-karta-content")).toBeVisible()
    await expect(page.getByTestId("tab-termini-content")).toHaveCount(0)
  })

  test("termini tab se otvara klikom i ima podatke", async ({ page }) => {
    await otvoriKlijent(page, fx.naziv)
    await page.getByTestId("tab-termini").click()
    await expect(page.getByTestId("tab-termini-content")).toBeVisible()
    // fikstura ima termine → tabela ima redove (ne empty state)
    await expect(page.getByTestId("tab-termini-content").getByRole("row").first()).toBeVisible()
    await expect(page.getByTestId("tab-termini-content")).not.toContainText("Nema termina")
  })
```

- [ ] **Step 2: Dodaj `data-testid` na ID karta sadržaj**

`IdKartaTab.tsx` trenutno nema wrapper testid. Otvori `components/domain/IdKartaTab.tsx`, nađi najspoljniji vraćeni `<div>` i dodaj mu atribut:

```tsx
    <div data-testid="tab-id-karta-content" className="space-y-6">
```

(Ako wrapper već ima `className`, samo dopiši `data-testid` — ne mijenjaj klase.)

- [ ] **Step 3: Pokreni test da vidiš da pada**

```bash
pnpm exec playwright test tests/e2e/04-klijenti.spec.ts -g "podrazumijevano prikazuje ID kartu" --project=chromium
```

Očekivano: FAIL — vidi se `tab-termini-content`, a `tab-id-karta-content` nije prisutan.

- [ ] **Step 4: Promijeni default u page.tsx**

`app/(dashboard)/klijenti/[id]/page.tsx`, linija 64:

```ts
  const tab = typeof sp.tab === "string" && VALID_TABS.includes(sp.tab) ? sp.tab : "id-karta"
```

- [ ] **Step 5: Promijeni fallback u KlijentTabs.tsx**

`components/domain/KlijentTabs.tsx`, linija 25:

```tsx
      onValueChange={(v) => router.push(href(`/klijenti/${klijentId}?tab=${v ?? "id-karta"}`))}
```

- [ ] **Step 6: Pokreni testove da prođu**

```bash
pnpm exec playwright test tests/e2e/04-klijenti.spec.ts --project=chromium
```

Očekivano: PASS. Ako padne test iz `21-info-tooltips.spec.ts`, provjeri i njega:

```bash
pnpm exec playwright test tests/e2e/21-info-tooltips.spec.ts --project=chromium
```

- [ ] **Step 7: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add -A
git commit -m "feat(klijenti): default tab je ID karta umjesto Termini"
```

---

### Task 2: Preimenuj tab „Profil" u „Usluge"

**Yoink stavka 2.**

**Odluka o obimu (potvrdi ako se ne slažeš prije izvršenja):** mijenja se **samo vidljivi tekst**. Interna vrijednost taba ostaje `profil` — to znači da URL i dalje glasi `?tab=profil`, a `data-testid` ostaje `tab-profil`. Razlog: promjena vrijednosti bi pokvarila postojeće bookmarke, `VALID_TABS`, i pet E2E testova, bez ikakve koristi za korisnika.

**Files:**
- Modify: `messages/sr.json`
- Modify: `messages/en.json`
- Modify: `messages/de.json`
- Test: `tests/e2e/38-yoink-batch.spec.ts` (novi fajl)

**Interfaces:**
- Consumes: ništa
- Produces: `klijenti.tabs.profil.label` = „Usluge" / „Services" / „Leistungen"

- [ ] **Step 1: Napiši failing E2E test**

Kreiraj `tests/e2e/38-yoink-batch.spec.ts`:

```ts
import { test, expect } from "@playwright/test"
import { otvoriKlijent } from "./helpers"

test.describe("Yoink batch 2026-07-30", () => {
  test("tab se zove Usluge, ne Profil", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await expect(page.getByTestId("tab-profil")).toContainText("Usluge")
    await expect(page.getByTestId("tab-profil")).not.toContainText("Profil")
  })
})
```

> Ako `./helpers` ne izvozi `otvoriKlijent` ili se `klijent-card` testid razlikuje, otvori `tests/e2e/04-klijenti.spec.ts` i prekopiraj tačan način navigacije koji taj fajl već koristi. Ne izmišljaj nove helpere.

- [ ] **Step 2: Pokreni test da vidiš da pada**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "zove Usluge" --project=chromium
```

Očekivano: FAIL — tab piše „Profil".

- [ ] **Step 3: Izmijeni sve tri kataloga**

`messages/sr.json`:

```json
"klijenti.tabs.profil.label"        → "Usluge"
"klijenti.tabs.profil.info"         → "Definicija ponavljajućih usluga za klijenta: koja vrsta provjere se radi, na kojoj lokaciji i kojim intervalom. Iz ovih stavki se automatski generišu termini. „Zadnji put” je posljednje stvarno izvršenje, „Sljedeći rok” je rok aktivnog termina."
"klijenti.tabs.termini.info"        → "...Termini se generišu iz usluga definisanih u tabu Usluge."   (zamijeni samo završnu rečenicu)
"klijenti.idKarta.usluge.info"      → "Sažetak usluga iz taba Usluge sa sljedećim rokom za svaku — brzi uvid u to šta je ugovoreno i šta prvo dolazi na red."
"klijenti.idKarta.usluge.prazno"    → "Nema definisanih usluga. Dodajte ih kroz tab Usluge."
"klijenti.profil.prazno"            → "Nema definisanih usluga. Dodajte uslugu da generišete termine."
"klijenti.obrisiProfil.tooltip"     → "Ukloni uslugu"
"klijenti.obrisiProfil.dialogNaslov"→ "Ukloniti uslugu?"
"klijenti.obrisiProfil.dialogOpis"  → "Uklanja uslugu sa spiska. Postojeći termini ostaju (vode se kroz Termini)."
"klijenti.dodajProvjeru.naslov"     → "Dodaj uslugu"
"klijenti.dodajProvjeru.bezIntervalaKraj"     → "prije dodavanja usluge."
"klijenti.dodajProvjeru.bezIntervalaOperater" → "Ova vrsta nema podrazumijevani interval — javi se adminu da ga postavi prije dodavanja usluge."
"klijenti.actions.provjeraVecPostoji"         → "Ova usluga već postoji."
```

`messages/en.json` — isti ključevi:

```json
"klijenti.tabs.profil.label"        → "Services"
"klijenti.idKarta.usluge.prazno"    → "No services defined. Add them via the Services tab."
"klijenti.profil.prazno"            → "No services defined. Add a service to generate appointments."
"klijenti.obrisiProfil.tooltip"     → "Remove service"
"klijenti.obrisiProfil.dialogNaslov"→ "Remove service?"
"klijenti.obrisiProfil.dialogOpis"  → "Removes the service from the list. Existing appointments remain (tracked under Appointments)."
"klijenti.dodajProvjeru.naslov"     → "Add service"
"klijenti.actions.provjeraVecPostoji" → "This service already exists."
```
(Preostale `info` i `bezIntervala*` stringove prevedi po istom obrascu — zamijeni „Profile" sa „Services".)

`messages/de.json` — isti ključevi:

```json
"klijenti.tabs.profil.label"        → "Leistungen"
"klijenti.idKarta.usluge.prazno"    → "Keine Leistungen definiert. Fügen Sie sie über den Tab Leistungen hinzu."
"klijenti.profil.prazno"            → "Keine Leistungen definiert. Fügen Sie eine Leistung hinzu, um Termine zu erstellen."
"klijenti.obrisiProfil.tooltip"     → "Leistung entfernen"
"klijenti.obrisiProfil.dialogNaslov"→ "Leistung entfernen?"
"klijenti.obrisiProfil.dialogOpis"  → "Entfernt die Leistung aus der Liste. Bestehende Termine bleiben erhalten (werden unter Termine geführt)."
"klijenti.dodajProvjeru.naslov"     → "Leistung hinzufügen"
"klijenti.actions.provjeraVecPostoji" → "Diese Leistung existiert bereits."
```
(Preostale stringove po istom obrascu — „Profil" → „Leistungen".)

**Ne dodaješ i ne brišeš nijedan ključ** — samo mijenjaš vrijednosti. Struktura ostaje identična u sva tri fajla.

- [ ] **Step 4: Provjeri paritet ključeva**

```bash
python3 -c "
import json
ks=[]
for loc in ['sr','en','de']:
    m=json.load(open(f'messages/{loc}.json')); s=set()
    def w(o,p=''):
        if isinstance(o,dict):
            for k,v in o.items(): w(v,p+'.'+k if p else k)
        else: s.add(p)
    w(m); ks.append(s)
print('sr==en:', ks[0]==ks[1], ' sr==de:', ks[0]==ks[2])
print('razlika:', (ks[0]^ks[1])|(ks[0]^ks[2]))
"
```

Očekivano: `sr==en: True  sr==de: True` i prazan skup razlike.

- [ ] **Step 5: Pokreni test da prođe**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "zove Usluge" --project=chromium
```

Očekivano: PASS.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add -A
git commit -m "feat(klijenti): tab Profil preimenovan u Usluge (sr/en/de)"
```

---

### Task 3: Migracija — `ugovori.na_neodredjeno`

**Yoink stavka 5, dio 1 (baza).**

**Files:**
- Create: `supabase/migrations/20260730120000_ugovori_na_neodredjeno.sql`
- Modify: `db/types.ts` (auto-generisan — nastaje komandom, ne rukom)

**Interfaces:**
- Consumes: ništa
- Produces: `ugovori.na_neodredjeno: boolean` (NOT NULL, default `false`). Task 4 ga koristi u formi i Zod schemi.

- [ ] **Step 1: Napiši migraciju**

Kreiraj `supabase/migrations/20260730120000_ugovori_na_neodredjeno.sql`:

```sql
-- supabase/migrations/20260730120000_ugovori_na_neodredjeno.sql
-- Yoink 2026-07-30, stavka 5: ugovor na neodređeno.
--
-- Zašto zasebna kolona a ne "prazan datum_isteka":
-- prazan datum trenutno znači i "bezročan ugovor" i "još nisam unio istek".
-- Bez eksplicitnog flaga ta dva stanja se ne mogu razlikovati, pa ni prikazati
-- ni izvijestiti različito.

alter table ugovori
  add column if not exists na_neodredjeno bool not null default false;

-- Neodređeno i konkretan istek se međusobno isključuju.
alter table ugovori drop constraint if exists chk_ugovori_neodredjeno;
alter table ugovori add constraint chk_ugovori_neodredjeno
  check (not (na_neodredjeno and datum_isteka is not null));

comment on column ugovori.na_neodredjeno is
  'Ugovor bez datuma isteka (na neodređeno). Isključuje datum_isteka.';
```

- [ ] **Step 2: Primijeni na DEMO**

```bash
pnpm db:apply-cloud --demo supabase/migrations/20260730120000_ugovori_na_neodredjeno.sql
```

Očekivano: skript potvrdi da je ciljni ref `mtwwotmwrasozmcgqwhc` i izvrši bez greške.

- [ ] **Step 3: Provjeri da je kolona stvarno tu**

```bash
cat > scripts/_tmp-provjera.ts <<'EOF'
import { Client } from "pg"
const url = process.env.DATABASE_URL_DEMO
if (!url || !url.includes("mtwwotmwrasozmcgqwhc")) throw new Error("Nije DEMO ref")
async function main() {
  const c = new Client({ connectionString: url }); await c.connect()
  const { rows } = await c.query(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name='ugovori' and column_name='na_neodredjeno'`)
  console.table(rows)
  const { rows: cons } = await c.query(`
    select conname from pg_constraint where conname='chk_ugovori_neodredjeno'`)
  console.table(cons)
  await c.end()
}
main()
EOF
pnpm exec tsx --env-file=.env.development.local scripts/_tmp-provjera.ts
rm -f scripts/_tmp-provjera.ts
```

Očekivano: jedan red `na_neodredjeno | boolean | NO | false` i jedan red `chk_ugovori_neodredjeno`.

- [ ] **Step 4: Regeneriši tipove**

```bash
pnpm db:types
git diff --stat db/types.ts
```

Očekivano: `db/types.ts` sadrži `na_neodredjeno: boolean` u `ugovori.Row`.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add supabase/migrations/20260730120000_ugovori_na_neodredjeno.sql db/types.ts
git commit -m "feat(ugovori): kolona na_neodredjeno + CHECK protiv kolizije sa datum_isteka"
```

---

### Task 4: Ugovor — „na neodređeno" i dropdown važenja sa custom unosom

**Yoink stavke 5 (UI) i 6.**

**Files:**
- Create: `lib/ugovori-vazenje.ts`
- Create: `lib/ugovori-vazenje.test.ts`
- Modify: `components/domain/UgovorSheet.tsx:79-102`
- Modify: `components/domain/UgovoriTab.tsx:83-88`
- Modify: `app/(dashboard)/klijenti/actions.ts:420-440`
- Modify: `messages/{sr,en,de}.json`

**Interfaces:**
- Consumes: `ugovori.na_neodredjeno` iz Taska 3
- Produces:
  - `VAZENJE_PRESETI: readonly number[]` = `[6, 12, 24, 36, 60]`
  - `normalizujVazenje(izbor: string, custom: string): { vazenje: number | null; greska: "opseg" | null }`

- [ ] **Step 1: Napiši failing Vitest**

Kreiraj `lib/ugovori-vazenje.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { VAZENJE_PRESETI, normalizujVazenje } from "./ugovori-vazenje"

describe("VAZENJE_PRESETI", () => {
  it("nudi uobičajena trajanja ugovora", () => {
    expect(VAZENJE_PRESETI).toEqual([6, 12, 24, 36, 60])
  })
})

describe("normalizujVazenje", () => {
  it("preset vrijednost prolazi kao broj", () => {
    expect(normalizujVazenje("12", "")).toEqual({ vazenje: 12, greska: null })
  })

  it("prazan izbor daje null (polje nije popunjeno)", () => {
    expect(normalizujVazenje("", "")).toEqual({ vazenje: null, greska: null })
  })

  it("custom izbor uzima broj iz custom polja", () => {
    expect(normalizujVazenje("custom", "18")).toEqual({ vazenje: 18, greska: null })
  })

  it("custom izvan opsega 1-600 je greska", () => {
    expect(normalizujVazenje("custom", "0")).toEqual({ vazenje: null, greska: "opseg" })
    expect(normalizujVazenje("custom", "601")).toEqual({ vazenje: null, greska: "opseg" })
  })

  it("custom koji nije cijeli broj je greska", () => {
    expect(normalizujVazenje("custom", "12.5")).toEqual({ vazenje: null, greska: "opseg" })
    expect(normalizujVazenje("custom", "abc")).toEqual({ vazenje: null, greska: "opseg" })
  })

  it("custom sa praznim poljem daje null bez greske", () => {
    expect(normalizujVazenje("custom", "")).toEqual({ vazenje: null, greska: null })
  })

  it("na neodredjeno nema vazenje u mjesecima", () => {
    expect(normalizujVazenje("neodredjeno", "")).toEqual({ vazenje: null, greska: null })
  })
})
```

- [ ] **Step 2: Pokreni test da vidiš da pada**

```bash
pnpm vitest run lib/ugovori-vazenje.test.ts
```

Očekivano: FAIL — `Cannot find module './ugovori-vazenje'`.

- [ ] **Step 3: Napiši implementaciju**

Kreiraj `lib/ugovori-vazenje.ts`:

```ts
/**
 * Trajanje ugovora — preseti + slobodan unos.
 *
 * Yoink 2026-07-30, stavka 6: number input 1–600 zamijenjen je dropdownom sa
 * uobičajenim trajanjima, uz „custom" granu za sve ostalo. DB CHECK
 * (`chk_ugovori_vazenje`) i dalje drži opseg 1–600 — ovo je samo prva linija.
 */

/** Uobičajena trajanja ugovora u mjesecima. */
export const VAZENJE_PRESETI = [6, 12, 24, 36, 60] as const

export const VAZENJE_MIN = 1
export const VAZENJE_MAX = 600

export type VazenjeRezultat = { vazenje: number | null; greska: "opseg" | null }

/**
 * Pretvara izbor iz forme u broj mjeseci.
 *
 * `izbor` je vrijednost dropdowna: preset broj kao string, `"custom"`,
 * `"neodredjeno"`, ili prazno. `custom` je sadržaj slobodnog polja i čita se
 * samo kad je `izbor === "custom"`.
 *
 * Prazan custom NIJE greška — korisnik je izabrao „drugo" pa još nije upisao.
 * Greška je samo nešto upisano što nije cijeli broj u opsegu.
 */
export function normalizujVazenje(izbor: string, custom: string): VazenjeRezultat {
  if (izbor === "neodredjeno" || izbor === "") return { vazenje: null, greska: null }

  const sirovo = izbor === "custom" ? custom.trim() : izbor
  if (sirovo === "") return { vazenje: null, greska: null }

  const n = Number(sirovo)
  if (!Number.isInteger(n) || n < VAZENJE_MIN || n > VAZENJE_MAX) {
    return { vazenje: null, greska: "opseg" }
  }
  return { vazenje: n, greska: null }
}
```

- [ ] **Step 4: Pokreni test da prođe**

```bash
pnpm vitest run lib/ugovori-vazenje.test.ts
```

Očekivano: PASS, 7 testova.

- [ ] **Step 5: Dodaj i18n ključeve u sva tri kataloga**

U `klijenti.ugovorSheet` dodaj (sr / en / de):

```
poljeNaNeodredjeno   = "Ugovor na neodređeno"           / "Open-ended contract"        / "Unbefristeter Vertrag"
vazenjeNeodredjeno   = "Na neodređeno"                  / "Open-ended"                 / "Unbefristet"
vazenjeCustom        = "Drugo (upiši broj mjeseci)"     / "Other (enter months)"       / "Andere (Monate eingeben)"
vazenjeOdaberi       = "Odaberi trajanje"               / "Select duration"            / "Dauer wählen"
vazenjePreset        = "{count} mj."                    / "{count} mo."                / "{count} Mon."
vazenjeGreskaOpseg   = "Broj mjeseci mora biti cijeli broj između 1 i 600."
                       / "Months must be a whole number between 1 and 600."
                       / "Die Monate müssen eine ganze Zahl zwischen 1 und 600 sein."
istekNeodredjeno     = "Datum isteka se ne unosi za ugovor na neodređeno."
                       / "No expiry date for an open-ended contract."
                       / "Bei unbefristeten Verträgen entfällt das Ablaufdatum."
```

U `klijenti.ugovori` (katalog koji koristi `UgovoriTab`) dodaj:

```
naNeodredjeno = "na neodređeno" / "open-ended" / "unbefristet"
```

> `vazenjePreset` koristi `{count}` kao običan broj, **ne** ICU plural — `sr` ne smije koristiti `one` kategoriju.

- [ ] **Step 6: Proširi Zod schemu ugovora**

`app/(dashboard)/klijenti/actions.ts`, u objektu koji definiše polja ugovora (oko linije 427 gdje stoji `vazenje_mjeseci: intOrNull(1, 600)`), zamijeni to polje i dodaj novo:

```ts
  vazenje_mjeseci: intOrNull(1, 600),
  na_neodredjeno: z.literal("on").optional().transform((v) => v === "on"),
```

Zatim u tijelu `createUgovor` i `updateUgovor`, prije upisa, dodaj normalizaciju i provjeru — traži mjesto gdje se sklapa objekat za `insert`/`update` i dopuni ga:

```ts
  // Neodređeno i konkretan istek se isključuju (isto pravilo kao DB CHECK) —
  // hvatamo ga ovdje da korisnik dobije poruku umjesto sirove PG greške.
  if (f.na_neodredjeno && f.datum_isteka) {
    return { ok: false, errors: { datum_isteka: [t("ugovorIstekNeodredjeno")] } }
  }
```

i u sam `insert`/`update` objekat dodaj:

```ts
    na_neodredjeno: f.na_neodredjeno,
    datum_isteka: f.na_neodredjeno ? null : f.datum_isteka,
```

Dodaj i prevod `klijenti.actions.ugovorIstekNeodredjeno` u sva tri kataloga (tekst = `istekNeodredjeno` odozgo).

- [ ] **Step 7: Prepravi UgovorSheet**

`components/domain/UgovorSheet.tsx`. Dodaj importe na vrh:

```tsx
import { VAZENJE_PRESETI, normalizujVazenje } from "@/lib/ugovori-vazenje"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
```

Unutar komponente, poslije `const [open, setOpen] = useState(false)`, dodaj stanje:

```tsx
  // „na neodređeno" gasi i datum isteka i trajanje u mjesecima.
  const [naNeodredjeno, setNaNeodredjeno] = useState(ugovor?.na_neodredjeno ?? false)
  // Zatečena vrijednost koja nije u presetima → forma se otvara u „custom" grani.
  const zatecenoVazenje = ugovor?.vazenje_mjeseci ?? null
  const zatecenoJePreset =
    zatecenoVazenje != null && (VAZENJE_PRESETI as readonly number[]).includes(zatecenoVazenje)
  const [vazenjeIzbor, setVazenjeIzbor] = useState(
    ugovor?.na_neodredjeno ? "neodredjeno"
      : zatecenoVazenje == null ? ""
      : zatecenoJePreset ? String(zatecenoVazenje)
      : "custom",
  )
  const [vazenjeCustom, setVazenjeCustom] = useState(
    zatecenoVazenje != null && !zatecenoJePreset ? String(zatecenoVazenje) : "",
  )
  const vazenjeGreska = normalizujVazenje(vazenjeIzbor, vazenjeCustom).greska
```

Zamijeni blok `<label>` za `datum_isteka` (linije 79-83) ovim:

```tsx
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("poljeDatumIsteka")}</span>
              <Input
                type="date"
                name="datum_isteka"
                defaultValue={ugovor?.datum_isteka ?? ""}
                disabled={naNeodredjeno}
                data-testid="ugovor-istek"
                aria-describedby={opisano("datum_isteka")}
              />
              <FieldError id={errId("datum_isteka")} errors={errors?.datum_isteka} />
            </label>
```

Zamijeni blok `<label>` za `vazenje_mjeseci` (linije 84-88) ovim:

```tsx
            <div className="space-y-1 text-sm">
              <span className="block text-muted-foreground">{t("poljeVazenje")}</span>
              <Select
                value={vazenjeIzbor}
                onValueChange={(v) => {
                  const iz = String(v ?? "")
                  setVazenjeIzbor(iz)
                  // Dropdown i checkbox su jedan te isti izbor — drži ih usaglašenim.
                  setNaNeodredjeno(iz === "neodredjeno")
                }}
                items={vazenjeItems}
              >
                <SelectTrigger className="w-full" data-testid="ugovor-vazenje">
                  <SelectValue placeholder={t("vazenjeOdaberi")} />
                </SelectTrigger>
                <SelectContent>
                  {VAZENJE_PRESETI.map((m) => (
                    <SelectItem key={m} value={String(m)}>{t("vazenjePreset", { count: m })}</SelectItem>
                  ))}
                  <SelectItem value="custom">{t("vazenjeCustom")}</SelectItem>
                  <SelectItem value="neodredjeno">{t("vazenjeNeodredjeno")}</SelectItem>
                </SelectContent>
              </Select>
              {vazenjeIzbor === "custom" && (
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={vazenjeCustom}
                  onChange={(e) => setVazenjeCustom(e.target.value)}
                  data-testid="ugovor-vazenje-custom"
                  aria-invalid={vazenjeGreska ? true : undefined}
                  aria-describedby={vazenjeGreska ? "ugovor-vazenje-custom-err" : undefined}
                />
              )}
              {vazenjeGreska && (
                <p id="ugovor-vazenje-custom-err" className="text-sm text-destructive" role="alert">
                  {t("vazenjeGreskaOpseg")}
                </p>
              )}
              <FieldError id={errId("vazenje_mjeseci")} errors={errors?.vazenje_mjeseci} />
            </div>
```

Iznad `return`, uz ostale `items` mape, dodaj:

```tsx
  // base-ui SelectValue prikazuje labelu iz mape kad je select zatvoren.
  const vazenjeItems: Record<string, string> = {
    ...Object.fromEntries(VAZENJE_PRESETI.map((m) => [String(m), t("vazenjePreset", { count: m })])),
    custom: t("vazenjeCustom"),
    neodredjeno: t("vazenjeNeodredjeno"),
  }
```

Dodaj checkbox „na neodređeno" odmah iznad checkboxa `automatsko_obnavljanje` (linija 95):

```tsx
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              name="na_neodredjeno"
              value="on"
              checked={naNeodredjeno}
              onCheckedChange={(v) => {
                const b = Boolean(v)
                setNaNeodredjeno(b)
                setVazenjeIzbor(b ? "neodredjeno" : "")
              }}
              data-testid="ugovor-neodredjeno"
            />
            <span className="text-muted-foreground">{t("poljeNaNeodredjeno")}</span>
          </label>
```

Konačno, u `<form action={...}>` propu (linija 61), prije `action(fd)`, upiši normalizovanu vrijednost:

```tsx
          action={(fd) => {
            const { vazenje, greska } = normalizujVazenje(vazenjeIzbor, vazenjeCustom)
            if (greska) return // poruka se već prikazuje inline
            fd.set("vazenje_mjeseci", vazenje == null ? "" : String(vazenje))
            submitted.current = true
            action(fd)
          }}
```

- [ ] **Step 8: Prikaži „na neodređeno" u UgovoriTab**

`components/domain/UgovoriTab.tsx`, linija 84 — zamijeni prikaz raspona datuma:

```tsx
                {u.datum_potpisivanja ? formatDatum(u.datum_potpisivanja) : "—"} → {u.na_neodredjeno ? t("naNeodredjeno") : u.datum_isteka ? formatDatum(u.datum_isteka) : "—"}
```

- [ ] **Step 9: Napiši E2E test**

Dodaj u `tests/e2e/38-yoink-batch.spec.ts`, unutar postojećeg `describe`:

```ts
  test("ugovor se moze staviti na neodredjeno", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-id-karta").click()
    await page.getByTestId("novi-ugovor-btn").click()

    await expect(page.getByTestId("ugovor-sheet")).toBeVisible()
    await page.getByTestId("ugovor-neodredjeno").click()
    // Datum isteka postaje neaktivan
    await expect(page.getByTestId("ugovor-istek")).toBeDisabled()
  })

  test("vazenje nudi custom broj mjeseci", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-id-karta").click()
    await page.getByTestId("novi-ugovor-btn").click()

    await page.getByTestId("ugovor-vazenje").click()
    await page.getByRole("option", { name: /Drugo/ }).click()
    await expect(page.getByTestId("ugovor-vazenje-custom")).toBeVisible()
    await page.getByTestId("ugovor-vazenje-custom").fill("18")
    await expect(page.getByTestId("ugovor-vazenje-custom")).toHaveValue("18")
  })
```

- [ ] **Step 10: Pokreni sve testove**

```bash
pnpm vitest run lib/ugovori-vazenje.test.ts
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts --project=chromium
```

Očekivano: oba PASS.

- [ ] **Step 11: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add -A
git commit -m "feat(ugovori): na neodređeno + dropdown važenja sa custom brojem mjeseci"
```

---

### Task 5: Ravni kontakti lokacije — migracija u `kontakt_osobe` i čišćenje koda

**Yoink stavke 8+9, cijele (baza + kod).**

**Zašto je ovo jedan task a ne dva:** shema i kod koji je čita ne mogu se razdvojiti. Čim migracija obriše tri kolone, `pnpm typecheck` puca na svakom mjestu koje ih čita. Kad bi to bila dva taska, međukomit ne bi prolazio provjere iz Global Constraints. Zato migracija i čišćenje idu zajedno, u jednom commitu.

**Kontekst iz DEMO baze (izmjereno 30.07.2026):** od 15 lokacija, **14 ima popunjen ravni kontakt**, i **nijedna od njih nema vezan `kontakt_osobe` red**. Znači migracija pravi 14 novih redova i nema kolizija. Svaki red sa bilo kojim kontakt podatkom ima i `kontakt_osoba` popunjen, ali `ime` je NOT NULL pa fallback ipak ide.

**Files:**
- Create: `supabase/migrations/20260730121000_lokacije_kontakti_u_kontakt_osobe.sql` (prebacivanje)
- Create: `supabase/migrations/20260730122000_lokacije_drop_kontakt_kolone.sql` (drop, TEK poslije provjere)
- Modify: `db/types.ts` (auto-generisan)
- Modify: `components/domain/LokacijaSheet.tsx:64-72`
- Modify: `components/domain/LokacijeTab.tsx:42-95`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx:378-420`
- Modify: `app/(dashboard)/klijenti/actions.ts:158-162, 236-244, 272-280`
- Modify: `tests/e2e/04-klijenti.spec.ts`

**Interfaces:**
- Consumes: ništa
- Produces: kolone `lokacije.kontakt_osoba`, `lokacije.kontakt_email`, `lokacije.kontakt_telefon` **više ne postoje** ni u bazi ni u kodu. Jedini put do kontakta lokacije je `kontakt_osobe` preko fieldseta „Kontakt za lokaciju".

- [ ] **Step 1: Snimi stanje prije migracije**

```bash
cat > scripts/_tmp-prije.ts <<'EOF'
import { Client } from "pg"
const url = process.env.DATABASE_URL_DEMO
if (!url || !url.includes("mtwwotmwrasozmcgqwhc")) throw new Error("Nije DEMO ref")
async function main() {
  const c = new Client({ connectionString: url }); await c.connect()
  const { rows } = await c.query(`
    select count(*) filter (where coalesce(btrim(kontakt_osoba),'')<>''
                              or coalesce(btrim(kontakt_email),'')<>''
                              or coalesce(btrim(kontakt_telefon),'')<>'') as za_prebaciti,
           count(*) as lokacija_ukupno from lokacije`)
  console.table(rows)
  const { rows: ko } = await c.query(`select count(*) as kontakt_osobe_prije from kontakt_osobe`)
  console.table(ko)
  await c.end()
}
main()
EOF
pnpm exec tsx --env-file=.env.development.local scripts/_tmp-prije.ts
rm -f scripts/_tmp-prije.ts
```

Zapiši brojeve — Step 4 ih poredi.

- [ ] **Step 2: Napiši migraciju**

Kreiraj `supabase/migrations/20260730121000_lokacije_kontakti_u_kontakt_osobe.sql`:

```sql
-- supabase/migrations/20260730121000_lokacije_kontakti_u_kontakt_osobe.sql
-- Yoink 2026-07-30, stavke 8+9: uklanjanje ravnih kontakt polja sa lokacije.
--
-- Kontekst: lokacije su imale kontakt_osoba/_email/_telefon kao slobodna tekst
-- polja, PARALELNO sa pravim kontakt_osobe redovima vezanim preko lokacija_id.
-- Ravna polja nisu pokretala ništa — podsjetnici čitaju isključivo
-- kontakt_osobe.podsjetnik_primalac. Komentar u actions.ts je to i najavljivao:
-- „ona ostaju dok se podaci ne presele u kontakt_osobe".
--
-- Ova migracija preseljava podatke pa briše kolone.

-- 1) Prebaci svaki popunjen ravni kontakt u pravi kontakt_osobe red.
--    podsjetnik_primalac = false: zatečeni podaci nikad nisu ni slali podsjetnike,
--    pa ih uključivanje ovdje bi tiho proširilo krug primalaca.
insert into kontakt_osobe (klijent_id, ime, email, telefon, lokacija_id, podsjetnik_primalac)
select
  l.klijent_id,
  coalesce(nullif(btrim(l.kontakt_osoba), ''), l.naziv),  -- ime je NOT NULL
  nullif(btrim(l.kontakt_email), ''),
  nullif(btrim(l.kontakt_telefon), ''),
  l.id,
  false
from lokacije l
where (
        coalesce(btrim(l.kontakt_osoba), '')   <> ''
     or coalesce(btrim(l.kontakt_email), '')   <> ''
     or coalesce(btrim(l.kontakt_telefon), '') <> ''
      )
  -- Idempotentno: ne diraj lokaciju koja već ima vezan kontakt sa istim imenom.
  -- Zagrade oko OR grupe su OBAVEZNE — AND veže jače od OR, pa bi bez njih
  -- provjera postojanja važila samo za posljednji uslov i migracija bi pri
  -- ponovnom pokretanju napravila duplikate.
  and not exists (
    select 1 from kontakt_osobe ko
    where ko.lokacija_id = l.id
      and lower(btrim(ko.ime)) = lower(btrim(coalesce(nullif(btrim(l.kontakt_osoba), ''), l.naziv)))
  );

-- Drop kolona NIJE ovdje — ide zasebnom migracijom TEK poslije provjere da su
-- svi podaci stvarno prebačeni. Vidi 20260730122000_lokacije_drop_kontakt_kolone.sql.
```

**Zašto dvije migracije a ne jedna:** verifikacija mora stajati IZMEĐU prebacivanja i brisanja. Da su u istom fajlu, provjera „je li prebačeno 14 redova" izvršila bi se tek nakon što su kolone već nepovratno obrisane — ako insert zakaže, podataka više nema odakle vratiti.

- [ ] **Step 3: Primijeni SAMO migraciju prebacivanja na DEMO**

```bash
pnpm db:apply-cloud --demo supabase/migrations/20260730121000_lokacije_kontakti_u_kontakt_osobe.sql
```

Očekivano: potvrda DEMO ref-a i izvršenje bez greške. Kolone u ovom trenutku i dalje postoje — to je namjerno.

- [ ] **Step 4: Provjeri rezultat**

```bash
cat > scripts/_tmp-poslije.ts <<'EOF'
import { Client } from "pg"
const url = process.env.DATABASE_URL_DEMO
if (!url || !url.includes("mtwwotmwrasozmcgqwhc")) throw new Error("Nije DEMO ref")
async function main() {
  const c = new Client({ connectionString: url }); await c.connect()
  // Svaka lokacija koja JOŠ ima ravni kontakt mora sada imati i vezani kontakt_osobe red.
  const { rows: nepokriveni } = await c.query(`
    select l.id, l.naziv, l.kontakt_osoba
    from lokacije l
    where (coalesce(btrim(l.kontakt_osoba),'')<>''
        or coalesce(btrim(l.kontakt_email),'')<>''
        or coalesce(btrim(l.kontakt_telefon),'')<>'')
      and not exists (select 1 from kontakt_osobe ko where ko.lokacija_id = l.id)`)
  console.log("NEPREBAČENE lokacije (MORA biti prazno prije drop-a):")
  console.table(nepokriveni)
  const { rows: ko } = await c.query(`
    select count(*)::int as vezanih_za_lokaciju from kontakt_osobe where lokacija_id is not null`)
  console.table(ko)
  const { rows: uzorak } = await c.query(`
    select ko.ime, ko.email, ko.telefon, l.naziv as lokacija, ko.podsjetnik_primalac
    from kontakt_osobe ko join lokacije l on l.id = ko.lokacija_id
    order by l.naziv limit 20`)
  console.table(uzorak)
  if (nepokriveni.length > 0) {
    console.error(`STOP: ${nepokriveni.length} lokacija nije prebačeno — NE pokrećI drop migraciju.`)
    process.exitCode = 1
  }
  await c.end()
}
main()
EOF
pnpm exec tsx --env-file=.env.development.local scripts/_tmp-poslije.ts
rm -f scripts/_tmp-poslije.ts
```

Očekivano: **prazan spisak nepokrivenih lokacija**; `vezanih_za_lokaciju` ≥ 14; uzorak pokazuje imena poput „Sabine Wagner", „Anja Löffler", „Goran Jović" sa `podsjetnik_primalac = false`.

**Ako spisak nepokrivenih NIJE prazan — stani i ne pokreći drop migraciju.** Kolone su još tu i podaci nisu izgubljeni; vrati se na Step 2, popravi upit, ponovo primijeni (migracija je idempotentna) i tek onda nastavi.

- [ ] **Step 5: Napiši i primijeni drop migraciju**

Tek kad je Step 4 čist, kreiraj `supabase/migrations/20260730122000_lokacije_drop_kontakt_kolone.sql`:

```sql
-- supabase/migrations/20260730122000_lokacije_drop_kontakt_kolone.sql
-- Yoink 2026-07-30, stavke 8+9, drugi korak: uklanjanje ravnih kontakt kolona.
--
-- Odvojeno od 20260730121000 namjerno: prebacivanje podataka mora biti
-- provjereno PRIJE nego što se izvor nepovratno obriše.

alter table lokacije drop column if exists kontakt_osoba;
alter table lokacije drop column if exists kontakt_email;
alter table lokacije drop column if exists kontakt_telefon;
```

```bash
pnpm db:apply-cloud --demo supabase/migrations/20260730122000_lokacije_drop_kontakt_kolone.sql
```

- [ ] **Step 6: Regeneriši tipove**

```bash
pnpm db:types
```

Očekivano: `db/types.ts` više nema `kontakt_osoba`/`kontakt_email`/`kontakt_telefon` u `lokacije`. `pnpm typecheck` sada puca na mjestima koja ih čitaju — to je očekivano i zatvara se u sljedećim koracima. **Ne commit-uj ovdje** — commit ide tek na kraju taska, kad kod i shema opet budu u skladu.

- [ ] **Step 7: Potvrdi da typecheck pada i gdje**

```bash
pnpm typecheck 2>&1 | grep -E "kontakt_osoba|kontakt_email|kontakt_telefon" | head -20
```

Očekivano: greške u `LokacijaSheet.tsx`, `LokacijeTab.tsx`, `klijenti/[id]/page.tsx`, `klijenti/actions.ts`. To je tvoja radna lista.

- [ ] **Step 8: Skrati FIELDS u LokacijaSheet**

`components/domain/LokacijaSheet.tsx`, linije 64-72 — zamijeni cijeli `FIELDS` niz:

```tsx
  // [name, label, obavezno, inputType]. Kontakt polja su uklonjena 2026-07-30 —
  // kontakt lokacije živi isključivo u kontakt_osobe (fieldset ispod).
  const FIELDS: readonly [string, string, boolean, "text" | "email" | "tel"][] = [
    ["naziv", t("poljeNaziv"), true, "text"],
    ["grad", t("poljeGrad"), false, "text"],
    ["regija", t("poljeRegija"), false, "text"],
    ["adresa", t("poljeAdresa"), false, "text"],
  ]
```

- [ ] **Step 9: Očisti Zod schemu i upise u actions.ts**

`app/(dashboard)/klijenti/actions.ts`:

Iz `lokacijaFields` obriši tri linije (oko 160-162):

```ts
  kontakt_osoba: optionalText(200),
  kontakt_email: optionalEmail(200),
  kontakt_telefon: optionalText(60),
```

U `createLokacija`, iz `insert` objekta obriši tri linije:

```ts
    kontakt_osoba: f.kontakt_osoba ?? null,
    kontakt_email: f.kontakt_email ?? null,
    kontakt_telefon: f.kontakt_telefon ?? null,
```

U `updateLokacija`, obriši tri `if` linije:

```ts
  if (formData.has("kontakt_osoba")) patch.kontakt_osoba = f.kontakt_osoba ?? null
  if (formData.has("kontakt_email")) patch.kontakt_email = f.kontakt_email ?? null
  if (formData.has("kontakt_telefon")) patch.kontakt_telefon = f.kontakt_telefon ?? null
```

- [ ] **Step 10: Pojednostavi kolonu Kontakt u LokacijeTab**

`components/domain/LokacijeTab.tsx`, zamijeni cijelu `<td>` za kontakt (linije 67-95) ovim:

```tsx
                  <td className="px-3 py-2.5">
                    {vezani(l.id).length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      vezani(l.id).map((k) => (
                        <Link
                          key={k.id}
                          href={href(`/klijenti/${klijentId}?tab=kontakti&highlight=${k.id}`)}
                          scroll={false}
                          className="group/tt relative mt-1 flex items-center gap-1 font-medium text-brand transition-colors motion-reduce:transition-none hover:underline"
                          data-testid={`lokacija-vezani-kontakt-${l.id}`}
                        >
                          <User className="h-[18px] w-[18px] shrink-0" aria-hidden />
                          {k.ime}
                          <Tooltip>{t("kontaktLinkTitle")}</Tooltip>
                        </Link>
                      ))
                    )}
                  </td>
```

> Highlight sada cilja `k.id` (kontakt), ne `l.id` (lokaciju) — u tabu Kontakti se highlightuju kontakti.

- [ ] **Step 11: Ukloni sekciju „kontakti po lokacijama" sa stranice klijenta**

`app/(dashboard)/klijenti/[id]/page.tsx` — obriši cijeli blok od linije 378 (`{lokacije.some((l) => l.kontakt_osoba || ...)`) do zatvarajuće `)}` na liniji 420. Ta sekcija je postojala samo da prikaže ravne kontakte; sada su svi kontakti u `KontaktiKlijentList` iznad nje.

Poslije brisanja provjeri da su `MapPin` i `InfoIkona` importi još u upotrebi na toj stranici; ako nisu, obriši i njih (ESLint će ih prijaviti kao neiskorištene).

Obriši i sada neiskorištene i18n ključeve `klijenti.detalj.kontaktiTab.naslovLokacije`, `.infoLokacije`, `.urediULokacijama` iz **sva tri** kataloga.

- [ ] **Step 12: Popravi E2E koji puni obrisana polja**

`tests/e2e/04-klijenti.spec.ts` — nađi dvije linije koje pune `lokacija-kontakt_osoba`:

```ts
await page.getByTestId("lokacija-kontakt_osoba").fill("Ana A.")
await page.getByTestId("lokacija-kontakt_osoba").fill("Marko M.")
```

Zamijeni ih vezivanjem pravog kontakta kroz fieldset (za oba mjesta, sa odgovarajućim imenom):

```ts
await page.getByTestId("lokacija-kontakt-izbor").getByRole("radio", { name: /Novi/ }).click()
await page.getByTestId("lokacija-kontakt-ime").fill("Ana A.")
```

Ako test poslije toga asertira da se „Ana A." vidi u tabeli lokacija, ta asercija i dalje važi — `vezani()` renderuje isto ime.

- [ ] **Step 13: Typecheck mora proći**

```bash
pnpm typecheck
```

Očekivano: 0 grešaka. Ako još ima referenci na obrisane kolone, ponovi Step 1 da ih nađeš.

- [ ] **Step 14: Pokreni E2E**

```bash
pnpm exec playwright test tests/e2e/04-klijenti.spec.ts --project=chromium
```

Očekivano: PASS.

- [ ] **Step 15: Lint, typecheck i commit**

Migracija i čišćenje koda idu u **jedan** commit — shema bez koda koji je prati ne prolazi provjere.

```bash
pnpm lint && pnpm typecheck
git add -A
git commit -m "refactor(lokacije): ravni kontakti prebačeni u kontakt_osobe, kolone i kod uklonjeni"
```

---

### Task 6: Kontakt forma može kreirati novu lokaciju

**Yoink stavka 7.**

**Files:**
- Modify: `components/domain/KontaktSheet.tsx`
- Modify: `app/(dashboard)/klijenti/actions.ts` (`createKontakt`)
- Modify: `messages/{sr,en,de}.json`
- Test: `tests/e2e/38-yoink-batch.spec.ts`

**Interfaces:**
- Consumes: `createLokacija` obrazac dedupa iz Taska 6 (`normalizujNaziv`)
- Produces: `createKontakt` prihvata `lokacija_izbor` ∈ `{"postojeca","nova"}` + `nova_lokacija_naziv` / `nova_lokacija_grad` / `nova_lokacija_adresa`

- [ ] **Step 1: Napiši failing E2E test**

Dodaj u `tests/e2e/38-yoink-batch.spec.ts`:

```ts
  test("novi kontakt moze kreirati novu lokaciju", async ({ page }) => {
    const sufiks = String(Date.now()).slice(-6)
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-kontakti").click()
    await page.getByTestId("novi-kontakt-btn").click()

    await page.getByTestId("kontakt-ime").fill(`E2E Kontakt ${sufiks}`)
    await page.getByTestId("kontakt-lokacija-izbor").getByRole("radio", { name: /Nova/ }).click()
    await page.getByTestId("kontakt-nova-lokacija-naziv").fill(`E2E Lokacija ${sufiks}`)
    await page.getByTestId("kontakt-nova-lokacija-grad").fill("Banja Luka")
    await page.getByTestId("kontakt-nova-lokacija-adresa").fill("Testna 1")
    await page.getByTestId("kontakt-submit").click()

    // Lokacija se pojavljuje u tabu Lokacije
    await page.getByTestId("tab-lokacije").click()
    await expect(page.getByTestId("lokacije-table")).toContainText(`E2E Lokacija ${sufiks}`)
  })
```

- [ ] **Step 2: Pokreni test da vidiš da pada**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "kreirati novu lokaciju" --project=chromium
```

Očekivano: FAIL — `kontakt-lokacija-izbor` ne postoji.

- [ ] **Step 3: Dodaj i18n ključeve**

U `klijenti.kontaktSheet` dodaj (sr / en / de):

```
lokacijaIzborPostojeca = "Postojeća lokacija"   / "Existing location"  / "Bestehender Standort"
lokacijaIzborNova      = "Nova lokacija"        / "New location"       / "Neuer Standort"
novaLokacijaNaziv      = "Naziv lokacije"       / "Location name"      / "Standortname"
novaLokacijaGrad       = "Grad"                 / "City"               / "Stadt"
novaLokacijaAdresa     = "Adresa"               / "Address"            / "Adresse"
novaLokacijaPomoc      = "Nova lokacija se odmah upisuje u tab Lokacije i kontakt se veže za nju."
                         / "The new location is added to the Locations tab and the contact is linked to it."
                         / "Der neue Standort wird sofort im Tab Standorte angelegt und der Kontakt damit verknüpft."
```

U `klijenti.actions` dodaj:

```
lokacijaNazivObavezan = "Naziv nove lokacije je obavezan."
                        / "The new location name is required."
                        / "Der Name des neuen Standorts ist erforderlich."
```

- [ ] **Step 4: Proširi `createKontakt` u actions.ts**

`app/(dashboard)/klijenti/actions.ts`. Nađi `createKontaktSchema` i dodaj polja:

```ts
  lokacija_izbor: z.enum(["postojeca", "nova"]).optional(),
  nova_lokacija_naziv: optionalText(200),
  nova_lokacija_grad: optionalText(120),
  nova_lokacija_adresa: optionalText(300),
```

U tijelu `createKontakt`, **prije** `insert` u `kontakt_osobe`, dodaj granu koja kreira lokaciju:

```ts
  // Yoink 2026-07-30, stavka 7: kontakt može povući novu lokaciju sa sobom.
  // Ista dedup provjera kao createLokacija — bez nje se ista lokacija unese
  // dvaput samo zbog razmaka ili veličine slova.
  let lokacijaId = f.lokacija_id || null
  if (f.lokacija_izbor === "nova") {
    const naziv = (f.nova_lokacija_naziv ?? "").trim()
    if (!naziv) return { ok: false, errors: { nova_lokacija_naziv: [t("lokacijaNazivObavezan")] } }

    const { data: postojece, error: dupErr } = await supabase
      .from("lokacije").select("id, naziv").eq("klijent_id", klijent_id)
    if (dupErr) return { ok: false, message: friendlyDbError(dupErr) }

    const vec = (postojece ?? []).find((l) => normalizujNaziv(l.naziv) === normalizujNaziv(naziv))
    if (vec) {
      // Lokacija sa tim nazivom već postoji → veži se na nju umjesto duplikata.
      lokacijaId = vec.id
    } else {
      const { data: nova, error: lokErr } = await supabase.from("lokacije").insert({
        klijent_id,
        naziv,
        grad: f.nova_lokacija_grad ?? null,
        adresa: f.nova_lokacija_adresa ?? null,
      }).select("id").single()
      if (lokErr) return { ok: false, message: friendlyDbError(lokErr) }
      lokacijaId = nova.id
    }
  }
```

Zatim u `insert` u `kontakt_osobe` koristi `lokacija_id: lokacijaId` umjesto dosadašnje vrijednosti, i na kraju proširi revalidaciju:

```ts
  revalidatePath("/klijenti", "layout")
```

(`"layout"` je nužan jer se mijenja i broj lokacija u listi klijenata.)

- [ ] **Step 5: Prepravi KontaktSheet**

`components/domain/KontaktSheet.tsx`. Dodaj import:

```tsx
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
```

Dodaj stanje uz ostale `useState`:

```tsx
  // Firma bez ijedne lokacije nema šta birati → forma odmah nudi kreiranje nove.
  const [lokacijaIzbor, setLokacijaIzbor] = useState(lokacije.length > 0 ? "postojeca" : "nova")
```

Zamijeni cijeli blok `{lokacije.length > 0 && (...)}` (linije 101-123) ovim:

```tsx
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("poljeLokacija")}
            </legend>
            <RadioGroup
              name="lokacija_izbor"
              value={lokacijaIzbor}
              onValueChange={(v) => setLokacijaIzbor(String(v))}
              data-testid="kontakt-lokacija-izbor"
            >
              {lokacije.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="postojeca" /> {t("lokacijaIzborPostojeca")}
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="nova" /> {t("lokacijaIzborNova")}
              </label>
            </RadioGroup>

            {lokacijaIzbor === "postojeca" && lokacije.length > 0 && (
              <Select name="lokacija_id" defaultValue={kontakt?.lokacija_id ?? ""} items={lokacijaItems}>
                <SelectTrigger className="w-full" data-testid="kontakt-lokacija">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("lokacijaSve")}</SelectItem>
                  {lokacije.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {lokacijaIzbor === "nova" && (
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="text-muted-foreground">{t("novaLokacijaNaziv")}</span>
                  <Input name="nova_lokacija_naziv" required data-testid="kontakt-nova-lokacija-naziv" />
                  <FieldError id="kontakt-nova-lokacija-naziv-err" errors={errors?.nova_lokacija_naziv} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    <span className="text-muted-foreground">{t("novaLokacijaGrad")}</span>
                    <Input name="nova_lokacija_grad" data-testid="kontakt-nova-lokacija-grad" />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted-foreground">{t("novaLokacijaAdresa")}</span>
                    <Input name="nova_lokacija_adresa" data-testid="kontakt-nova-lokacija-adresa" />
                  </label>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {lokacijaIzbor === "nova" ? t("novaLokacijaPomoc") : t("lokacijaPomoc")}
            </p>
          </fieldset>
```

- [ ] **Step 6: Pokreni test da prođe**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "kreirati novu lokaciju" --project=chromium
```

Očekivano: PASS.

- [ ] **Step 7: Očisti testne podatke, lint, commit**

```bash
pnpm cleanup:test-data
pnpm lint && pnpm typecheck
git add -A
git commit -m "feat(kontakti): nova lokacija (naziv/grad/adresa) direktno iz kontakt forme"
```

---

### Task 7: „Novi klijent" — puna forma + prva lokacija

**Yoink stavka 4.**

**Files:**
- Modify: `components/domain/NoviKlijentButton.tsx`
- Modify: `app/(dashboard)/klijenti/page.tsx` (prosljeđivanje `korisnici` u dugme)
- Modify: `app/(dashboard)/klijenti/actions.ts` (`createKlijent`)
- Modify: `messages/{sr,en,de}.json`
- Test: `tests/e2e/38-yoink-batch.spec.ts`

**Interfaces:**
- Consumes: `updateKlijentSchema` oblik polja (isti set)
- Produces: `createKlijent` prihvata `pib`, `maticni_broj`, `sifra_djelatnosti`, `zaduzeni_tehpro_id`, `tip_odnosa`, `lokacija_naziv`, `lokacija_grad`, `lokacija_adresa`

- [ ] **Step 1: Napiši failing E2E test**

Dodaj u `tests/e2e/38-yoink-batch.spec.ts`:

```ts
  test("novi klijent ima puna polja i kreira prvu lokaciju", async ({ page }) => {
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Firma ${sufiks}`
    await page.goto("/klijenti")
    await page.getByTestId("novi-klijent-btn").click()

    await page.getByTestId("novi-klijent-naziv").fill(naziv)
    await page.getByTestId("novi-klijent-adresa").fill("Kralja Petra 1")
    await page.getByTestId("novi-klijent-telefon").fill("051111222")
    await page.getByTestId("novi-klijent-email").fill(`e2e${sufiks}@tehpro.test`)
    // Polja koja su ranije postojala SAMO u edit formi
    await page.getByTestId("novi-klijent-pib").fill("4400000000001")
    await page.getByTestId("novi-klijent-maticni_broj").fill("11111111")
    await page.getByTestId("novi-klijent-sifra_djelatnosti").fill("4321")
    // Prva lokacija
    await page.getByTestId("novi-klijent-lokacija-naziv").fill("Centrala")
    await page.getByTestId("novi-klijent-lokacija-grad").fill("Banja Luka")
    await page.getByTestId("novi-klijent-submit").click()

    await page.getByTestId("klijenti-search").fill(naziv)
    await page.getByText(naziv).first().click()
    // Matični broj je sačuvan
    await page.getByTestId("uredi-klijent-btn").click()
    await expect(page.getByTestId("edit-klijent-maticni_broj")).toHaveValue("11111111")
    await page.keyboard.press("Escape")
    // Prva lokacija postoji
    await page.getByTestId("tab-lokacije").click()
    await expect(page.getByTestId("lokacije-table")).toContainText("Centrala")
  })
```

> Ako `klijenti-search` testid ne postoji, pogledaj `components/domain/KlijentiSearch.tsx` i upotrijebi stvarni.

- [ ] **Step 2: Pokreni test da vidiš da pada**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "puna polja" --project=chromium
```

Očekivano: FAIL — `novi-klijent-pib` ne postoji.

- [ ] **Step 3: Dodaj i18n ključeve**

U `klijenti.noviKlijent` dodaj (sr / en / de):

```
poljePib            = "PIB"                / "VAT ID"              / "USt-IdNr."
poljeMaticniBroj    = "Matični broj"       / "Company number"      / "Handelsregisternummer"
poljeSifraDjelatnosti = "Šifra djelatnosti"/ "Activity code"       / "Tätigkeitsschlüssel"
poljeZaduzeni       = "Zadužena osoba ({appName})" / "Assigned person ({appName})" / "Zuständige Person ({appName})"
poljeTipOdnosa      = "Tip odnosa"         / "Relationship type"   / "Beziehungstyp"
nijePostavljeno     = "Nije postavljeno"   / "Not set"             / "Nicht festgelegt"
tipUgovor           = "Ugovor"             / "Contract"            / "Vertrag"
tipPonuda           = "Ponuda"             / "Offer"               / "Angebot"
lokacijaNaslov      = "Prva lokacija"      / "First location"      / "Erster Standort"
lokacijaNaziv       = "Naziv lokacije"     / "Location name"       / "Standortname"
lokacijaGrad        = "Grad"               / "City"                / "Stadt"
lokacijaAdresa      = "Adresa"             / "Address"             / "Adresse"
lokacijaPomoc       = "Usluge se uvijek vezuju za lokaciju — bez nje klijentu ne možeš dodati nijednu."
                      / "Services are always tied to a location — without one you cannot add any."
                      / "Leistungen sind immer einem Standort zugeordnet — ohne Standort ist keine möglich."
```

- [ ] **Step 4: Proširi `createKlijent`**

`app/(dashboard)/klijenti/actions.ts`. Zamijeni `createKlijentSchema`:

```ts
const createKlijentSchema = z.object({
  ...klijentObavezniFields,
  napomena: optionalText(2000),
  // Polja koja su do 2026-07-30 postojala samo u edit formi (yoink stavka 4).
  pib: optionalText(40),
  maticni_broj: optionalText(40),
  sifra_djelatnosti: optionalText(40),
  zaduzeni_tehpro_id: UUID_OR_EMPTY,
  tip_odnosa: z
    .union([z.enum(["ugovor", "ponuda"]), z.literal("none"), z.literal(""), z.null()])
    .transform((v) => (v === "none" || v === "" ? null : v))
    .optional(),
  // Prva lokacija — opciona, ali preporučena: klijent bez lokacije ne može
  // dobiti nijednu uslugu (createProfilProvjere odbija stavku bez lokacije).
  lokacija_naziv: optionalText(200),
  lokacija_grad: optionalText(120),
  lokacija_adresa: optionalText(300),
})
```

> `UUID_OR_EMPTY` je definisan **ispod** `createKlijentSchema` u trenutnom fajlu. Premjesti njegovu deklaraciju iznad `createKlijentSchema` da ne dobiješ TDZ grešku.

Zamijeni tijelo `createKlijent`:

```ts
export async function createKlijent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const f = parsed.data
  const supabase = await createServerSupabaseClient()
  const { data: novi, error } = await supabase.from("klijenti").insert({
    naziv: f.naziv,
    adresa: f.adresa,
    telefon: f.telefon,
    email: f.email,
    napomena: f.napomena ?? null,
    pib: f.pib ?? null,
    maticni_broj: f.maticni_broj ?? null,
    sifra_djelatnosti: f.sifra_djelatnosti ?? null,
    zaduzeni_tehpro_id: f.zaduzeni_tehpro_id ?? null,
    tip_odnosa: f.tip_odnosa ?? null,
  }).select("id").single()
  if (error) {
    // UNIQUE constraint na naziv → prijateljska poruka
    const msg = /duplicate|unique/i.test(error.message)
      ? t("klijentNazivPostoji")
      : friendlyDbError(error)
    return { ok: false, message: msg }
  }

  // Prva lokacija je best-effort: klijent je već kreiran i to je vidljivo, pa
  // pad ovog upisa vraća poruku umjesto da poništi cijelo kreiranje.
  const lokNaziv = (f.lokacija_naziv ?? "").trim()
  if (lokNaziv) {
    const { error: lokErr } = await supabase.from("lokacije").insert({
      klijent_id: novi.id,
      naziv: lokNaziv,
      grad: f.lokacija_grad ?? null,
      adresa: f.lokacija_adresa ?? null,
    })
    if (lokErr) {
      revalidatePath("/klijenti", "layout")
      return { ok: false, message: friendlyDbError(lokErr) }
    }
  }

  revalidatePath("/klijenti", "layout")
  return { ok: true }
}
```

- [ ] **Step 5: Proširi NoviKlijentButton**

`components/domain/NoviKlijentButton.tsx`. Promijeni potpis komponente:

```tsx
export function NoviKlijentButton({ korisnici = [] }: { korisnici?: { id: string; ime: string }[] }) {
```

Dodaj importe:

```tsx
import { APP_NAME } from "@/lib/brand"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
```

Iznad `return`, dodaj items mape (isti razlog kao u `KlijentEditForm` — bez njih zatvoren select prikaže sirovi UUID):

```tsx
  const nijePostavljeno = t("nijePostavljeno")
  const zaduzeniItems: Record<string, string> = {
    none: nijePostavljeno,
    ...Object.fromEntries(korisnici.map((k) => [k.id, k.ime])),
  }
  const tipOdnosaItems: Record<string, string> = {
    none: nijePostavljeno,
    ugovor: t("tipUgovor"),
    ponuda: t("tipPonuda"),
  }
```

Poslije postojećeg `napomena` polja (linija 109), dodaj nova polja:

```tsx
          {([
            ["pib", t("poljePib")],
            ["maticni_broj", t("poljeMaticniBroj")],
            ["sifra_djelatnosti", t("poljeSifraDjelatnosti")],
          ] as const).map(([name, label]) => (
            <label key={name} className="block text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Input name={name} data-testid={`novi-klijent-${name}`} aria-describedby={opisano(name)} />
              <FieldError id={`novi-klijent-${name}-err`} errors={errors?.[name]} />
            </label>
          ))}

          <div className="space-y-1">
            <span className="block text-sm text-muted-foreground">{t("poljeZaduzeni", { appName: APP_NAME })}</span>
            <Select name="zaduzeni_tehpro_id" defaultValue="none" items={zaduzeniItems}>
              <SelectTrigger data-testid="novi-klijent-zaduzeni" className="w-full">
                <SelectValue placeholder={nijePostavljeno} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{nijePostavljeno}</SelectItem>
                {korisnici.map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.ime}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <span className="block text-sm text-muted-foreground">{t("poljeTipOdnosa")}</span>
            <Select name="tip_odnosa" defaultValue="none" items={tipOdnosaItems}>
              <SelectTrigger data-testid="novi-klijent-tip-odnosa" className="w-full">
                <SelectValue placeholder={nijePostavljeno} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{nijePostavljeno}</SelectItem>
                <SelectItem value="ugovor">{t("tipUgovor")}</SelectItem>
                <SelectItem value="ponuda">{t("tipPonuda")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("lokacijaNaslov")}
            </legend>
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("lokacijaNaziv")}</span>
              <Input name="lokacija_naziv" data-testid="novi-klijent-lokacija-naziv" />
              <FieldError id="novi-klijent-lokacija_naziv-err" errors={errors?.lokacija_naziv} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("lokacijaGrad")}</span>
                <Input name="lokacija_grad" data-testid="novi-klijent-lokacija-grad" />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("lokacijaAdresa")}</span>
                <Input name="lokacija_adresa" data-testid="novi-klijent-lokacija-adresa" />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">{t("lokacijaPomoc")}</p>
          </fieldset>
```

- [ ] **Step 6: Proslijedi `korisnici` iz stranice**

`app/(dashboard)/klijenti/page.tsx` — nađi gdje se renderuje `<NoviKlijentButton />`. Stranica mora dohvatiti aktivne korisnike istim RPC-om koji koristi detalj stranica (RLS na `korisnici` je self-select, pa direktan `from()` operateru vraća samo njega):

```tsx
  const { data: korisniciRaw } = await supabase.rpc("get_aktivni_korisnici")
  const korisnici = (korisniciRaw ?? []).map((k) => ({ id: k.id, ime: k.ime }))
```

Dodaj taj poziv u postojeći `Promise.all` te stranice (ne pravi zaseban serijski await), pa proslijedi:

```tsx
  <NoviKlijentButton korisnici={korisnici} />
```

- [ ] **Step 7: Pokreni test da prođe**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "puna polja" --project=chromium
```

Očekivano: PASS.

- [ ] **Step 8: Očisti, lint, commit**

```bash
pnpm cleanup:test-data
pnpm lint && pnpm typecheck
git add -A
git commit -m "feat(klijenti): Novi klijent ima sva polja edit forme + prvu lokaciju"
```

---

### Task 8: „Prima podsjetnike za ovu lokaciju" — neklikabilan kad je slanje ugašeno

**Yoink stavka 10.**

**Kontekst (provjereno):** checkbox radi. Lanac je `kontakt_prima` → `kontakt_osobe.podsjetnik_primalac` → `buildRecipientIndex` → `firmaRecipientsZa`, pokriven sa 28 prolazećih testova u `lib/reminders/recipients.test.ts`. Ali efekat je nevidljiv dok su oba nadređena prekidača ugašena: globalni `postavke.salji_klijentima` i per-firma `klijenti.salji_podsjetnik_klijentu`. Ovaj task to čini vidljivim.

**Files:**
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx`
- Modify: `components/domain/LokacijeTab.tsx`
- Modify: `components/domain/LokacijaSheet.tsx:209-222`
- Modify: `messages/{sr,en,de}.json`
- Test: `tests/e2e/38-yoink-batch.spec.ts`

**Interfaces:**
- Consumes: ništa iz ranijih taskova
- Produces: `LokacijaSheet` prima novi prop `slanjeUgaseno: boolean`

- [ ] **Step 1: Dodaj i18n ključeve**

U `klijenti.lokacijaSheet` dodaj (sr / en / de):

```
kontaktPrimaUgaseno = "Slanje podsjetnika klijentima je ugašeno u Postavkama — dok ga administrator ne uključi, ovaj kontakt neće dobijati mejlove."
                      / "Sending reminders to clients is turned off in Settings — until an administrator enables it, this contact will receive no emails."
                      / "Der Versand von Erinnerungen an Kunden ist in den Einstellungen deaktiviert — bis ein Administrator ihn aktiviert, erhält dieser Kontakt keine E-Mails."
```

- [ ] **Step 2: Dovuci oba prekidača na stranicu klijenta**

`app/(dashboard)/klijenti/[id]/page.tsx`:

U `klijentTabelaRes` select (linija 100) dodaj kolonu:

```ts
    supabase.from("klijenti").select("tip_odnosa, adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id, salji_podsjetnik_klijentu").eq("id", id).maybeSingle(),
```

U isti `Promise.all` dodaj još jedan član (samo kad je tab „lokacije" — drugi tabovi ga ne trebaju):

```ts
    tab === "lokacije"
      ? supabase.from("postavke").select("salji_klijentima").eq("id", 1).maybeSingle()
      : prazno,
```

Dodaj i odgovarajuću varijablu u destrukturiranje niza (`postavkeRes`) i izvedi flag:

```ts
  // Checkbox „prima podsjetnike" ima efekta samo ako su OBA prekidača uključena:
  // globalni (postavke) i per-firma. Inače ga prikazujemo neaktivnog sa objašnjenjem.
  const slanjeUgaseno =
    !(postavkeRes.data as { salji_klijentima?: boolean } | null)?.salji_klijentima ||
    !klijentPolja?.salji_podsjetnik_klijentu
```

Proslijedi ga u `LokacijeTab`:

```tsx
            <LokacijeTab
              klijentId={id}
              lokacije={lokacije}
              kontakti={kontakti.map((k) => ({ id: k.id, ime: k.ime, lokacija_id: k.lokacija_id }))}
              slanjeUgaseno={slanjeUgaseno}
            />
```

- [ ] **Step 3: Provuci prop kroz LokacijeTab**

`components/domain/LokacijeTab.tsx` — dodaj u props tip i proslijedi u oba `LokacijaSheet` poziva:

```tsx
  slanjeUgaseno = false,
}: {
  klijentId: string
  lokacije: LokacijaRow[]
  kontakti?: { id: string; ime: string; lokacija_id: string | null }[]
  /** Oba prekidača (globalni + per-firma) nisu uključena → checkbox podsjetnika je bez efekta. */
  slanjeUgaseno?: boolean
}) {
```

```tsx
        <LokacijaSheet klijentId={klijentId} kontakti={kontakti} slanjeUgaseno={slanjeUgaseno} />
```
```tsx
                      <LokacijaSheet klijentId={klijentId} lokacija={l} kontakti={kontakti} slanjeUgaseno={slanjeUgaseno} />
```

- [ ] **Step 4: Onemogući checkbox u LokacijaSheet**

`components/domain/LokacijaSheet.tsx` — dodaj `slanjeUgaseno = false` u props (uz tip `slanjeUgaseno?: boolean`), pa zamijeni blok `{kontaktIzbor !== "bez" && (...)}` (linije 209-221):

```tsx
            {kontaktIzbor !== "bez" && (
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="kontakt_prima"
                    value="1"
                    defaultChecked={!slanjeUgaseno}
                    disabled={slanjeUgaseno}
                    data-testid="lokacija-kontakt-prima"
                    aria-describedby={slanjeUgaseno ? "lokacija-kontakt-prima-ugaseno" : undefined}
                    className="size-4 rounded border-input disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className={slanjeUgaseno ? "text-muted-foreground" : undefined}>
                    {t("kontaktPrima")}
                  </span>
                </label>
                {slanjeUgaseno && (
                  <p
                    id="lokacija-kontakt-prima-ugaseno"
                    className="text-xs text-muted-foreground"
                    data-testid="lokacija-kontakt-prima-ugaseno"
                  >
                    {t("kontaktPrimaUgaseno")}
                  </p>
                )}
              </div>
            )}
```

- [ ] **Step 5: Napiši E2E test**

Dodaj u `tests/e2e/38-yoink-batch.spec.ts`:

```ts
  test("checkbox podsjetnika je neaktivan uz objasnjenje kad je slanje ugaseno", async ({ page }) => {
    // Test sam postavlja preduslov umjesto da se oslanja na zatečeno stanje baze —
    // inače bi prolazio i kad funkcija uopšte nije implementirana.
    // Suite ionako ide sa --workers=1 jer specovi dijele globalni postavke id=1.
    // Pročitaj-pa-vrati: bez restore-a bi ovaj spec tiho mijenjao ponašanje
    // svih kasnijih specova (dijeljeni singleton red postavke id=1).
    const prije = await getPostavkeV2()
    await setPostavkeV2({ salji_klijentima: false })
    try {
      await page.goto("/klijenti")
      await page.getByTestId("klijent-card").first().click()
      await page.getByTestId("tab-lokacije").click()
      await page.getByTestId("nova-lokacija-btn").click()
      await page.getByTestId("lokacija-kontakt-izbor").getByRole("radio", { name: /Novi/ }).click()

      await expect(page.getByTestId("lokacija-kontakt-prima")).toBeDisabled()
      await expect(page.getByTestId("lokacija-kontakt-prima-ugaseno")).toContainText("Postavkama")
    } finally {
      await setPostavkeV2({ salji_klijentima: prije.salji_klijentima })
    }
  })
```

`getPostavkeV2` i `setPostavkeV2` već postoje u `tests/e2e/db.ts` — ne piši nove helpere. Dodaj ih u import na vrhu spec fajla:

```ts
import { getPostavkeV2, setPostavkeV2 } from "./db"
```
```

- [ ] **Step 6: Pokreni test**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "checkbox podsjetnika" --project=chromium
```

Očekivano: PASS.

- [ ] **Step 7: Potvrdi da logika primalaca nije pokvarena**

```bash
pnpm vitest run lib/reminders/
```

Očekivano: svi testovi prolaze (`recipients.test.ts` 28/28 i ostali).

- [ ] **Step 8: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add -A
git commit -m "feat(lokacije): checkbox podsjetnika neaktivan uz objašnjenje kad je slanje ugašeno"
```

---

### Task 9: Novi termin — izbor „jednokratno / ponavljajuće"

**Yoink stavka 11, dio (b).**

**Kontekst (provjereno u DEMO bazi):** `createProfilProvjere` piše i `klijent_provjere` i `termini`; `createTermin` piše **samo** `termini`. Zato termin unesen kroz plan aktivnosti nema profil-stavku, ne pojavljuje se u ID karti ni u Uslugama, i po izvršenju ne generiše sljedeći rok. Od 60 termina u DEMO bazi, najmanje 25 je takvih.

**Files:**
- Modify: `app/(dashboard)/termini/actions.ts` (`createTermin`)
- Modify: `components/domain/NoviTerminDialog.tsx`
- Modify: `messages/{sr,en,de}.json`
- Test: `tests/e2e/38-yoink-batch.spec.ts`

**Interfaces:**
- Consumes: ništa iz ranijih taskova
- Produces: `createTermin` prihvata `ponavlja_se: "on" | undefined`. Kad je `"on"` i postoji `lokacija_id`, kreira i `klijent_provjere` red.

- [ ] **Step 1: Napiši failing E2E test**

Dodaj u `tests/e2e/38-yoink-batch.spec.ts`:

```ts
  test("novi termin sa oznakom ponavljajuce zavrsi i u tabu Usluge", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("novi-termin-btn").click()
    await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()

    // Izbor postoji i podrazumijevano je jednokratno
    const izbor = page.getByTestId("novi-termin-ponavljanje")
    await expect(izbor).toBeVisible()
    await expect(izbor.getByRole("radio", { name: /Jednokratno/ })).toBeChecked()
    await expect(izbor.getByRole("radio", { name: /Ponavlja/ })).not.toBeChecked()
  })
```

> Ako `novi-termin-btn` testid ne postoji na `plan-aktivnosti`, pogledaj `components/domain/NoviTerminButton.tsx` i upotrijebi stvarni.

- [ ] **Step 2: Pokreni test da vidiš da pada**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "ponavljajuce" --project=chromium
```

Očekivano: FAIL — `novi-termin-ponavljanje` ne postoji.

- [ ] **Step 3: Dodaj i18n ključeve**

U `termini.noviTermin` dodaj (sr / en / de):

```
ponavljanjeNaslov   = "Vrsta unosa"        / "Entry type"          / "Eintragsart"
ponavljanjeJednom   = "Jednokratno"        / "One-off"             / "Einmalig"
ponavljanjePonavlja = "Ponavlja se"        / "Recurring"           / "Wiederkehrend"
ponavljanjePomoc    = "Ponavljajući termin se upisuje i u tab Usluge, pa se po izvršenju automatski računa sljedeći rok. Zahtijeva lokaciju."
                      / "A recurring appointment is also added to the Services tab, so the next due date is computed automatically after completion. Requires a location."
                      / "Ein wiederkehrender Termin wird auch im Tab Leistungen angelegt, sodass die nächste Frist nach Erledigung automatisch berechnet wird. Erfordert einen Standort."
```

U `termini.actions` dodaj:

```
ponavljanjeTraziLokaciju = "Ponavljajući termin mora imati lokaciju."
                           / "A recurring appointment must have a location."
                           / "Ein wiederkehrender Termin muss einen Standort haben."
ponavljanjeVrstaBezIntervala = "Ova vrsta nema podrazumijevani interval — javi se adminu da ga postavi, ili unesi termin kao jednokratni."
                           / "This type has no default interval — ask an admin to set it, or enter the appointment as one-off."
                           / "Diese Art hat kein Standardintervall — bitten Sie einen Administrator, es festzulegen, oder erfassen Sie den Termin als einmalig."
```

- [ ] **Step 4: Proširi `createTermin`**

`app/(dashboard)/termini/actions.ts`. U `createSchema` dodaj polje:

```ts
  ponavlja_se: z.literal("on").optional(),
```

U tijelu `createTermin`, **poslije** uspješnog `insert`-a termina i **prije** `dodijeliFirmuZaduzenom`, dodaj:

```ts
  // Yoink 2026-07-30, stavka 11: ponavljajući unos dobija i profil-stavku, inače
  // termin ostaje siroče — ne vidi se u ID karti ni u Uslugama, i po izvršenju
  // nema intervala iz kojeg bi se izračunao sljedeći rok.
  if (parsed.data.ponavlja_se === "on") {
    if (!lokacija_id) return { ok: false, message: t("ponavljanjeTraziLokaciju") }

    const { data: vrsta } = await supabase
      .from("vrste_provjera").select("podrazumevani_interval_mjeseci")
      .eq("id", vrsta_provjere_id).maybeSingle()
    if (!vrsta?.podrazumevani_interval_mjeseci) {
      return { ok: false, message: t("ponavljanjeVrstaBezIntervala") }
    }

    // Profil-stavka je best-effort: termin je već upisan i vidljiv. 23505 znači
    // da stavka već postoji (uq_klijent_provjere) — to je uspjeh, ne greška.
    const { error: kpErr } = await supabase.from("klijent_provjere").insert({
      klijent_id,
      vrsta_provjere_id,
      lokacija_id,
      interval_mjeseci: null, // null = prati podrazumijevani interval vrste
      zadnji_datum: null,
    })
    if (kpErr && kpErr.code !== "23505") {
      return { ok: false, message: friendlyDbError(kpErr) }
    }
  }
```

Provjeri da je `friendlyDbError` već importovan u tom fajlu; ako nije, dodaj `import { friendlyDbError } from "@/lib/db-errors"`.

Na kraj funkcije, prije `return { ok: true }`, dodaj revalidaciju kartice klijenta:

```ts
  revalidatePath(`/klijenti/${klijent_id}`)
```

(Provjeri da je `revalidatePath` importovan iz `next/cache`.)

- [ ] **Step 5: Dodaj izbor u NoviTerminDialog**

`components/domain/NoviTerminDialog.tsx`. Dodaj import:

```tsx
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
```

Dodaj stanje uz ostale `useState`:

```tsx
  // Podrazumijevano jednokratno: ad-hoc termin ne smije tiho postati trajna obaveza.
  const [ponavljanje, setPonavljanje] = useState("jednom")
```

Dodaj reset u `useEffect` koji čisti formu poslije uspjeha (uz `setZakazan("")`):

```tsx
      setPonavljanje("jednom")
```

Umetni blok odmah poslije polja „Vrsta" (poslije `FieldError id="greska-novi-vrsta"`, linija 227):

```tsx
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("ponavljanjeNaslov")}
            </legend>
            <RadioGroup
              value={ponavljanje}
              onValueChange={(v) => setPonavljanje(String(v ?? "jednom"))}
              data-testid="novi-termin-ponavljanje"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="jednom" /> {t("ponavljanjeJednom")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="ponavlja" /> {t("ponavljanjePonavlja")}
              </label>
            </RadioGroup>
            {ponavljanje === "ponavlja" && (
              <p className="text-xs text-muted-foreground">{t("ponavljanjePomoc")}</p>
            )}
          </fieldset>
```

U `<form action={...}>` propu, uz ostale `fd.set` pozive, dodaj:

```tsx
            if (ponavljanje === "ponavlja") fd.set("ponavlja_se", "on")
```

- [ ] **Step 6: Pokreni test da prođe**

```bash
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts -g "ponavljajuce" --project=chromium
```

Očekivano: PASS.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add -A
git commit -m "feat(termini): izbor jednokratno/ponavljajuće — ponavljajući kreira i profil-stavku"
```

---

### Task 10: Prikaži jednokratne termine u ID karti i Uslugama

**Yoink stavka 11, dio (c).** Ovim 25+ zatečenih termina prestaje biti nevidljivo, bez ijedne izmjene podataka.

**Files:**
- Create: `lib/termini-jednokratni.ts`
- Create: `lib/termini-jednokratni.test.ts`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx`
- Modify: `components/domain/ProfilTab.tsx`
- Modify: `components/domain/IdKartaTab.tsx`
- Modify: `messages/{sr,en,de}.json`
- Test: `tests/e2e/38-yoink-batch.spec.ts`

**Interfaces:**
- Consumes: `ProfilStavka` tip iz `components/domain/ProfilTab.tsx`
- Produces: `spojiJednokratne(profil, termini)` → `StavkaUsluge[]`, gdje je `StavkaUsluge = ProfilStavka & { jednokratna: boolean }`

- [ ] **Step 1: Napiši failing Vitest**

Kreiraj `lib/termini-jednokratni.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { spojiJednokratne, type TerminZaSpajanje } from "./termini-jednokratni"

const profil = [
  {
    id: "p1", vrsta_provjere_id: "v1", lokacija_id: "l1",
    vrsta_naziv: "PP aparati", lokacija_naziv: "Glavna baza",
    interval_mjeseci: 6, zadnji_datum: "2026-01-15",
    sljedeci_rok: "2026-07-15", termin_status: "planirano",
  },
]

const T = (o: Partial<TerminZaSpajanje>): TerminZaSpajanje => ({
  id: "t1", vrsta_provjere_id: "v1", lokacija_id: "l1",
  vrsta_naziv: "PP aparati", lokacija_naziv: "Glavna baza",
  rok_dospijeca: "2026-07-15", status: "planirano", status_izvedeni: "planirano",
  datum_izvrsenja: null, ...o,
})

describe("spojiJednokratne", () => {
  it("termin koji ima profil-stavku se ne duplira", () => {
    const r = spojiJednokratne(profil, [T({})])
    expect(r).toHaveLength(1)
    expect(r[0].jednokratna).toBe(false)
  })

  it("termin bez profil-stavke se dodaje kao jednokratna usluga", () => {
    const r = spojiJednokratne(profil, [T({}), T({ id: "t2", vrsta_provjere_id: "v2", vrsta_naziv: "Test" })])
    expect(r).toHaveLength(2)
    const jed = r.find((s) => s.vrsta_naziv === "Test")
    expect(jed?.jednokratna).toBe(true)
    expect(jed?.interval_mjeseci).toBeNull()
    expect(jed?.sljedeci_rok).toBe("2026-07-15")
  })

  it("razlicita lokacija znaci razlicita stavka", () => {
    const r = spojiJednokratne(profil, [T({ id: "t3", lokacija_id: "l2", lokacija_naziv: "Pogon" })])
    expect(r).toHaveLength(2)
    expect(r.find((s) => s.lokacija_naziv === "Pogon")?.jednokratna).toBe(true)
  })

  it("NULL lokacija se poklapa samo sa NULL lokacijom", () => {
    const r = spojiJednokratne(profil, [T({ id: "t4", lokacija_id: null, lokacija_naziv: null })])
    expect(r).toHaveLength(2)
  })

  it("vise jednokratnih termina istog para daje jednu stavku sa najranijim rokom", () => {
    const r = spojiJednokratne([], [
      T({ id: "t5", vrsta_provjere_id: "v9", rok_dospijeca: "2026-09-01" }),
      T({ id: "t6", vrsta_provjere_id: "v9", rok_dospijeca: "2026-08-01" }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0].sljedeci_rok).toBe("2026-08-01")
  })

  it("otkazan termin se ne prikazuje kao usluga", () => {
    const r = spojiJednokratne([], [T({ id: "t7", vrsta_provjere_id: "v9", status: "otkazano", status_izvedeni: "otkazano" })])
    expect(r).toEqual([])
  })

  it("izvrsen jednokratni termin ostaje vidljiv sa datumom izvrsenja", () => {
    const r = spojiJednokratne([], [
      T({ id: "t8", vrsta_provjere_id: "v9", status: "izvrseno", status_izvedeni: "izvrseno", datum_izvrsenja: "2026-06-01" }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0].zadnji_datum).toBe("2026-06-01")
  })
})
```

- [ ] **Step 2: Pokreni test da vidiš da pada**

```bash
pnpm vitest run lib/termini-jednokratni.test.ts
```

Očekivano: FAIL — `Cannot find module './termini-jednokratni'`.

- [ ] **Step 3: Napiši implementaciju**

Kreiraj `lib/termini-jednokratni.ts`:

```ts
/**
 * Spajanje profil-stavki (klijent_provjere) i „siročadi" — termina koji nemaju
 * odgovarajuću profil-stavku.
 *
 * Yoink 2026-07-30, stavka 11c. Do sada su takvi termini bili vidljivi samo u
 * tabu Termini: ID karta i Usluge čitaju isključivo klijent_provjere, pa je
 * usluga unesena kroz plan aktivnosti djelovala kao da ne postoji. Ovo ih
 * prikazuje bez ijedne izmjene podataka — označene kao jednokratne.
 */

/** Minimalni oblik profil-stavke koji spajanje treba (podskup ProfilStavka). */
export type ProfilZaSpajanje = {
  id: string
  vrsta_provjere_id: string
  lokacija_id: string | null
  vrsta_naziv: string
  lokacija_naziv: string | null
  interval_mjeseci: number | null
  zadnji_datum: string | null
  sljedeci_rok: string | null
  termin_status: string | null
}

/** Minimalni oblik reda iz termini_view koji spajanje treba. */
export type TerminZaSpajanje = {
  id: string
  vrsta_provjere_id: string | null
  lokacija_id: string | null
  vrsta_naziv: string | null
  lokacija_naziv: string | null
  rok_dospijeca: string | null
  status: string | null
  status_izvedeni: string | null
  datum_izvrsenja: string | null
}

export type StavkaUsluge = ProfilZaSpajanje & { jednokratna: boolean }

/** Otkazani termini nisu obaveza — ne prikazuju se kao usluga. */
const SKRIVENI_STATUSI = new Set(["otkazano"])

const kljuc = (vrstaId: string | null, lokacijaId: string | null) =>
  `${vrstaId ?? ""}|${lokacijaId ?? ""}`

/**
 * Vraća profil-stavke (nepromijenjene) plus po jednu izvedenu stavku za svaki
 * par (vrsta, lokacija) koji ima termine ali nema profil-stavku.
 *
 * Dates su ISO `yyyy-mm-dd` pa se porede leksikografski.
 */
export function spojiJednokratne(
  profil: ProfilZaSpajanje[],
  termini: TerminZaSpajanje[],
): StavkaUsluge[] {
  const pokriveni = new Set(profil.map((p) => kljuc(p.vrsta_provjere_id, p.lokacija_id)))
  const izvedene = new Map<string, StavkaUsluge>()

  for (const t of termini) {
    if (SKRIVENI_STATUSI.has(t.status ?? "")) continue
    const k = kljuc(t.vrsta_provjere_id, t.lokacija_id)
    if (pokriveni.has(k)) continue

    const postojeca = izvedene.get(k)
    if (!postojeca) {
      izvedene.set(k, {
        id: `jednokratna:${k}`,
        vrsta_provjere_id: t.vrsta_provjere_id ?? "",
        lokacija_id: t.lokacija_id,
        vrsta_naziv: t.vrsta_naziv ?? "—",
        lokacija_naziv: t.lokacija_naziv,
        interval_mjeseci: null, // jednokratna nema periodiku
        zadnji_datum: t.status === "izvrseno" ? t.datum_izvrsenja : null,
        sljedeci_rok: t.rok_dospijeca,
        termin_status: t.status_izvedeni,
        jednokratna: true,
      })
      continue
    }

    // Najraniji rok je „sljedeći", najkasnije izvršenje je „zadnji put".
    if (t.rok_dospijeca && (!postojeca.sljedeci_rok || t.rok_dospijeca < postojeca.sljedeci_rok)) {
      postojeca.sljedeci_rok = t.rok_dospijeca
      postojeca.termin_status = t.status_izvedeni
    }
    if (
      t.status === "izvrseno" && t.datum_izvrsenja &&
      (!postojeca.zadnji_datum || t.datum_izvrsenja > postojeca.zadnji_datum)
    ) {
      postojeca.zadnji_datum = t.datum_izvrsenja
    }
  }

  return [
    ...profil.map((p) => ({ ...p, jednokratna: false })),
    ...izvedene.values(),
  ]
}
```

- [ ] **Step 4: Pokreni test da prođe**

```bash
pnpm vitest run lib/termini-jednokratni.test.ts
```

Očekivano: PASS, 7 testova.

- [ ] **Step 5: Dodaj i18n ključeve**

U `klijenti.profil` dodaj (sr / en / de):

```
jednokratna     = "jednokratno"  / "one-off"  / "einmalig"
jednokratnaInfo = "Termin unesen ručno, bez definisane periodike — po izvršenju se ne generiše sljedeći rok."
                  / "Manually entered appointment with no periodicity — no next due date is generated after completion."
                  / "Manuell erfasster Termin ohne Periodizität — nach Erledigung wird keine nächste Frist erzeugt."
```

U `klijenti.idKarta.usluge` dodaj isti par ključeva `jednokratna` / `jednokratnaInfo` (iste vrijednosti).

- [ ] **Step 6: Spoji na stranici klijenta**

`app/(dashboard)/klijenti/[id]/page.tsx`:

Dodaj import:

```ts
import { spojiJednokratne } from "@/lib/termini-jednokratni"
```

Odmah poslije postojećeg `const profilStavke = (profilRes.data ?? []).map(...)` bloka (koji se završava na liniji 213), dodaj:

```ts
  // Termini bez profil-stavke (npr. uneseni kroz plan aktivnosti) inače ne bi
  // bili vidljivi nigdje osim u tabu Termini — v. lib/termini-jednokratni.ts.
  const stavkeUsluga = spojiJednokratne(
    profilStavke.map((p) => ({
      ...p,
      vrsta_provjere_id: (profilRes.data ?? []).find((r) => r.id === p.id)?.vrsta_provjere_id ?? "",
      lokacija_id: (profilRes.data ?? []).find((r) => r.id === p.id)?.lokacija_id ?? null,
    })),
    termini.map((t) => ({
      id: t.id ?? "",
      vrsta_provjere_id: t.vrsta_provjere_id ?? null,
      lokacija_id: t.lokacija_id ?? null,
      vrsta_naziv: t.vrsta_naziv ?? null,
      lokacija_naziv: t.lokacija_naziv ?? null,
      rok_dospijeca: t.rok_dospijeca ?? null,
      status: t.status ?? null,
      status_izvedeni: t.status_izvedeni ?? null,
      datum_izvrsenja: t.datum_izvrsenja ?? null,
    })),
  )
```

Zamijeni `usluge` prop u `IdKartaTab` (linija 303):

```tsx
              usluge={stavkeUsluga.map((p) => ({
                vrsta_naziv: p.vrsta_naziv,
                lokacija_naziv: p.lokacija_naziv,
                sljedeci_rok: p.sljedeci_rok,
                jednokratna: p.jednokratna,
              }))}
```

Zamijeni `stavke` prop u `ProfilTab` (linija 492):

```tsx
            <ProfilTab klijentId={id} stavke={stavkeUsluga} vrste={vrsteOpcije} lokacije={lokacijeOpcije} admini={admini} />
```

- [ ] **Step 7: Prikaži badge u ProfilTab**

`components/domain/ProfilTab.tsx`. Proširi tip stavki:

```tsx
export type ProfilStavka = {
  id: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  interval_mjeseci: number | null
  zadnji_datum: string | null
  sljedeci_rok: string | null
  termin_status: string | null
  /** Termin bez profil-stavke — nema periodiku, ne generiše sljedeći rok. */
  jednokratna?: boolean
}
```

U ćeliji sa nazivom vrste (linija 59) dodaj badge:

```tsx
                  <td className="px-3 py-2 text-foreground">
                    {s.vrsta_naziv}
                    {s.jednokratna && (
                      <span
                        className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                        title={t("jednokratnaInfo")}
                        data-testid="usluga-jednokratna"
                      >
                        {t("jednokratna")}
                      </span>
                    )}
                  </td>
```

Jednokratna stavka nema `klijent_provjere` red pa se ne može obrisati kroz `ObrisiProfilButton` — u koloni akcija ga sakrij:

```tsx
                    {!s.jednokratna && <ObrisiProfilButton id={s.id} />}
```

> Provjeri tačan prop naziv `ObrisiProfilButton`-a u postojećem kodu i zadrži ga; mijenja se samo uslov renderovanja.

- [ ] **Step 8: Prikaži badge u IdKartaTab**

`components/domain/IdKartaTab.tsx`. Proširi tip `usluge` (linija 34):

```tsx
  usluge: { vrsta_naziv: string; lokacija_naziv: string | null; sljedeci_rok: string | null; jednokratna?: boolean }[]
```

U `items` mapiranju (linija 109) dodaj badge uz naziv usluge — odmah poslije `{u.vrsta_naziv}`:

```tsx
                {u.jednokratna && (
                  <span
                    className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                    title={t("usluge.jednokratnaInfo")}
                    data-testid="idkarta-usluga-jednokratna"
                  >
                    {t("usluge.jednokratna")}
                  </span>
                )}
```

- [ ] **Step 9: Napiši E2E test**

Dodaj u `tests/e2e/38-yoink-batch.spec.ts`:

```ts
  test("jednokratni termin je vidljiv u tabu Usluge", async ({ page }) => {
    // DEMO baza ima 25+ termina bez profil-stavke; badge mora postojati bar negdje.
    await page.goto("/klijenti")
    const kartice = page.getByTestId("klijent-card")
    const broj = await kartice.count()
    let nadjen = false
    for (let i = 0; i < Math.min(broj, 6); i++) {
      await page.goto("/klijenti")
      await kartice.nth(i).click()
      await page.getByTestId("tab-profil").click()
      if (await page.getByTestId("usluga-jednokratna").first().isVisible().catch(() => false)) {
        nadjen = true
        break
      }
    }
    expect(nadjen, "nijedan klijent nema jednokratnu uslugu — provjeri spojiJednokratne").toBe(true)
  })
```

- [ ] **Step 10: Pokreni sve testove ovog taska**

```bash
pnpm vitest run lib/termini-jednokratni.test.ts
pnpm exec playwright test tests/e2e/38-yoink-batch.spec.ts --project=chromium
```

Očekivano: oba PASS.

- [ ] **Step 11: Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add -A
git commit -m "feat(klijenti): jednokratni termini vidljivi u ID karti i Uslugama"
```

---

### Task 11: Završna verifikacija cijelog batch-a

**Files:** nijedan (samo provjere)

- [ ] **Step 1: Cijeli unit paket**

```bash
pnpm test:unit
```

Očekivano: svi testovi prolaze. Zabilježi ukupan broj.

- [ ] **Step 2: Cijeli E2E paket**

```bash
pnpm test:e2e
```

Očekivano: svi testovi prolaze na chromium i webkit. Ovo traje — ne prekidaj.

Ako neki test padne, **nemoj ga preskočiti ni oslabiti asertaciju**. Nađi uzrok, popravi kod, ponovi.

- [ ] **Step 3: Lint i typecheck**

```bash
pnpm lint && pnpm typecheck
```

Očekivano: 0 grešaka, 0 warninga.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Očekivano: build prolazi.

- [ ] **Step 5: Očisti testne podatke sa DEMO baze**

```bash
pnpm cleanup:test-data
```

- [ ] **Step 6: Provjeri da PROD nije dirnut**

```bash
git log --oneline main..HEAD
```

Očekivano: 11 commitova, svi na `feat/yoink-batch-2026-07-30`. Migracije su primijenjene **samo** na DEMO — PROD ostaje na staroj shemi dok korisnik ne odluči.

- [ ] **Step 7: Push grane (bez merge-a u main)**

```bash
git push -u origin feat/yoink-batch-2026-07-30
```

Ne otvaraj PR i ne merge-uj bez izričite potvrde korisnika.

---

## Šta plan NAMJERNO ne radi

- **Stavka 3 (uloge i ovlaštenja)** — korisnik ju je preskočio u potpunosti. Rupa koju analiza je našla (šabloni izvještaja i bilješki su hardkodirani u `lib/zapisnik/template.ts`, admin ih ne može mijenjati bez programera) ostaje otvorena i nije dio nijednog taska.
- **Backfill zatečenih termina** — 25+ termina bez profil-stavke ostaje jednokratno. Task 11 ih čini vidljivim, ali ne mijenja nijedan red u bazi.
- **PROD migracije** — obje migracije idu samo na DEMO. Primjena na PROD (`POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`) je zasebna odluka korisnika, poslije verifikacije na DEMO-u.
- **Preimenovanje `tab=profil` u `tab=usluge`** u URL-u i `data-testid`-ovima — samo vidljivi tekst se mijenja (obrazloženje u Tasku 2).
