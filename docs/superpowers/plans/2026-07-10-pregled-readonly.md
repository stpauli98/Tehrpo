# `pregled` read-only UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uloga `pregled` ne vidi write-akcije (Dodaj/Uredi/Obriši/Upload/AI-snimi) — sakriti ih preko `useMozeUrediti()`.

**Architecture:** Postojeći `KorisnikProvider` (dashboard layout) izlaže `useUloga()`. Dodaje se `useMozeUrediti()` hook; svaka write-akcijska klijentska komponenta ga koristi da sakrije akciju za pregled (pure-trigger → `return null`; miješana komponenta → uslovno renderuj SAMO akciju).

**Tech Stack:** Next.js 16 (App Router, client components), React 19, next-intl, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-10-pregled-readonly-design.md`

## Global Constraints

- **Grana:** `feat/pregled-readonly` (od `main`). Zaseban PR. Bez migracija.
- **Package manager:** `pnpm`; `next build`/dev sa `--webpack`; e2e `--workers=1`.
- **Gate hook je CLIENT-only** (`useContext`) — koristiti samo u `"use client"` komponentama. Sve ciljane write-komponente su već `"use client"`. Ako neki write-trigger živi u SERVER komponenti, gejtovati server-side (`getTrenutniKorisnik()` + `mozeUrediti`) umjesto hooka.
- **NE sakrivati READ sadržaj** — gejtovati samo write-akciju/trigger. Za miješane komponente uslovno renderovati samo dugme/formu.
- **NE gejtovati:** `MojNalogForm`, „novi razgovor"/slanje pitanja AI-u, Postavke admin sekcije (već skrivene), `ObrisiDokumentButton` (već `jeAdmin`).
- Tailwind: bez `sm:`/`md:`. **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Uniformni gate obrazac** (za pure-trigger komponente):
```tsx
import { useMozeUrediti } from "@/providers/korisnik-provider"
// ... na vrhu tijela komponente, prije returna:
const mozeUrediti = useMozeUrediti()
if (!mozeUrediti) return null
```

---

## Task 1: `useMozeUrediti` hook

**Files:**
- Modify: `providers/korisnik-provider.tsx`

**Interfaces:**
- Consumes: `useUloga()` (postoji), `mozeUrediti` iz `@/lib/auth/roles`.
- Produces: `useMozeUrediti(): boolean`.

- [ ] **Step 1: Dodaj hook**

U `providers/korisnik-provider.tsx` dodaj import i hook na kraj:
```tsx
import { mozeUrediti } from "@/lib/auth/roles"

/** true ako tekuća uloga smije uređivati (admin/operater); null/pregled → false. */
export function useMozeUrediti(): boolean {
  const u = useUloga()
  return u ? mozeUrediti(u) : false
}
```
(Zadrži postojeći `useUloga`; dodaj `mozeUrediti` u import iz `@/lib/auth/roles`.)

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: EXIT 0. (`roles.test.ts` već pokriva `mozeUrediti` logiku — hook je trivijalan wrapper, pokriva ga e2e u Task 5.)

- [ ] **Step 3: Commit**

```bash
git add providers/korisnik-provider.tsx
git commit -m "feat(auth): useMozeUrediti hook (pregled → false)"
```

---

## Task 2: Gejt klijent + lokacije write-akcija

**Files:**
- Modify: `components/domain/NoviKlijentButton.tsx`, `components/domain/ObrisiKlijentButton.tsx`, `components/domain/KlijentEditForm.tsx`, `components/domain/LokacijaSheet.tsx`, `components/domain/ObrisiLokacijuButton.tsx`

**Interfaces:**
- Consumes: `useMozeUrediti` (Task 1).

- [ ] **Step 1: Primijeni gate**

U svakom od 5 fajlova: dodaj `import { useMozeUrediti } from "@/providers/korisnik-provider"` i, na vrhu tijela glavne (default/named) komponente, prije prvog `return`:
```tsx
const mozeUrediti = useMozeUrediti()
if (!mozeUrediti) return null
```
> Prije izmjene, potvrdi da je fajl `"use client"` i da je komponenta **write-trigger** (dugme/Dialog sa vlastitim triggerom — kao `KlijentEditForm` Pencil), NE read-prikaz. Sva 5 su triggeri → `return null` je bezbjedno. Ako `LokacijaSheet` NEMA vlastiti trigger (otvara se spolja), gejtuj umjesto toga njegovo trigger-dugme (npr. „Nova lokacija") na mjestu poziva; provjeri grep-om `<LokacijaSheet`.

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add components/domain/NoviKlijentButton.tsx components/domain/ObrisiKlijentButton.tsx components/domain/KlijentEditForm.tsx components/domain/LokacijaSheet.tsx components/domain/ObrisiLokacijuButton.tsx
git commit -m "feat(pregled): sakrij klijent/lokacije write akcije za pregled"
```

---

## Task 3: Gejt termini + kontakti + ugovor write-akcija

**Files:**
- Modify: `components/domain/NoviTerminButton.tsx`, `components/domain/TerminSheet.tsx`, `components/domain/KontaktSheet.tsx`, `components/domain/UgovorSheet.tsx`

**Interfaces:**
- Consumes: `useMozeUrediti` (Task 1).

- [ ] **Step 1: Primijeni gate**

U svakom fajlu dodaj hook + `if (!mozeUrediti) return null` na vrhu komponente (isti obrazac kao Task 2).
> Za `*Sheet`: ako sheet ima **vlastiti trigger** (Dialog/Sheet trigger unutar komponente) → `return null` sakriva trigger. Ako se otvara **spolja** (npr. `novi-kontakt-btn` je zaseban element koji renderuje roditelj), gejtuj taj vanjski trigger na mjestu poziva umjesto same Sheet komponente. Grep-om (`<TerminSheet`, `<KontaktSheet`, `<UgovorSheet`, `novi-kontakt-btn`) potvrdi gdje je stvarni trigger, pa gejtuj njega. „Novi termin" je `NoviTerminButton` (trigger) → `return null`.

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add components/domain/NoviTerminButton.tsx components/domain/TerminSheet.tsx components/domain/KontaktSheet.tsx components/domain/UgovorSheet.tsx
git commit -m "feat(pregled): sakrij termini/kontakti/ugovor write akcije za pregled"
```

---

## Task 4: Gejt profil + dokumenti + podsjetnici + AI-snimi

**Files:**
- Modify: `components/domain/DodajProvjeruButton.tsx`, `components/domain/ObrisiProfilButton.tsx`, `components/domain/KlijentDokumentUpload.tsx`, `components/domain/KlijentPodsjetniciForm.tsx`, `components/domain/ChatMessage.tsx`

**Interfaces:**
- Consumes: `useMozeUrediti` (Task 1).

- [ ] **Step 1: Pure-trigger gate (4 fajla)**

U `DodajProvjeruButton.tsx`, `ObrisiProfilButton.tsx`, `KlijentDokumentUpload.tsx`, `KlijentPodsjetniciForm.tsx` — hook + `if (!mozeUrediti) return null` na vrhu (isti obrazac). `KlijentPodsjetniciForm` je cijela write-forma (toggle + combobox) → `return null` (pregled ne upravlja podsjetnicima; ne prikazuje se). `KlijentDokumentUpload` je upload dugme/dropzone → `return null`.

- [ ] **Step 2: MIJEŠANA komponenta — `ChatMessage.tsx` (`ZapisnikProposal`) — gejtuj SAMO save formu**

`ZapisnikProposal` prikazuje AI prijedlog (nalaz/zaključak — READ) i ispod ima `<form action={action}>` sa „Snimi" dugmetom (`data-testid="snimi-zapisnik"`). **NE sakrivati cijeli prijedlog.** Umjesto toga, u `ZapisnikProposal`, uslovno renderuj SAMO save formu:
```tsx
// na vrhu ZapisnikProposal tijela:
const mozeUrediti = useMozeUrediti()
// ... i umotaj postojeći <form action={action} ...> ... </form> u:
{mozeUrediti && (
  <form action={action} className="mt-2">
    {/* ... postojeći hidden inputs + Button snimi-zapisnik + poruke ... */}
  </form>
)}
```
Dodaj `import { useMozeUrediti } from "@/providers/korisnik-provider"` u `ChatMessage.tsx`. Pregled i dalje vidi prijedlog + čita ga, samo nema „Snimi".

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add components/domain/DodajProvjeruButton.tsx components/domain/ObrisiProfilButton.tsx components/domain/KlijentDokumentUpload.tsx components/domain/KlijentPodsjetniciForm.tsx components/domain/ChatMessage.tsx
git commit -m "feat(pregled): sakrij profil/dokumenti/podsjetnici write + AI snimi za pregled"
```

---

## Task 5: E2E — `26-pregled-readonly.spec.ts`

**Files:**
- Modify: `tests/e2e/db.ts` (dodaj `ensureKorisnik(email, lozinka, ime, uloga)` + `deleteKorisnikByEmail` ako ne postoji na ovoj grani)
- Create: `tests/e2e/26-pregled-readonly.spec.ts`

**Interfaces:**
- Consumes: gejt iz Task 2-4 (write dugmad skrivena za pregled); `injectSessionFor`, `insertKlijent`, `assignKlijent`, `deleteKlijentByNaziv`.

- [ ] **Step 1: db helperi**

U `tests/e2e/db.ts`:
```ts
/** Nađi/kreiraj korisnika date uloge sa fiksnom lozinkom; vrati id. */
export async function ensureKorisnik(email: string, lozinka: string, ime: string, uloga: "admin"|"operater"|"pregled"): Promise<string> {
  const { data: list } = await db.auth.admin.listUsers()
  let id = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({ email, password: lozinka, email_confirm: true })
    if (error) throw error
    id = data.user.id
  }
  const { error } = await db.from("korisnici").upsert({ id, ime, email, uloga, aktivan: true }, { onConflict: "id" })
  if (error) throw new Error(`ensureKorisnik upsert: ${error.message}`)
  return id
}

/** Obriši auth korisnika + korisnici red po emailu (čišćenje throwaway naloga). */
export async function deleteKorisnikByEmail(email: string): Promise<void> {
  const { data: list } = await db.auth.admin.listUsers()
  const u = list?.users.find((x) => x.email?.toLowerCase() === email.toLowerCase())
  if (!u) return
  await db.from("korisnici").delete().eq("id", u.id)
  await db.auth.admin.deleteUser(u.id)
}
```
> Ako `deleteKorisnikByEmail` već postoji na grani (npr. nakon merge-a), ne dupliraj — dodaj samo `ensureKorisnik`.

- [ ] **Step 2: Spec**

Kreiraj `tests/e2e/26-pregled-readonly.spec.ts`:
```ts
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import { ensureKorisnik, deleteKorisnikByEmail, insertKlijent, assignKlijent, deleteKlijentByNaziv } from "./db"

// pregled: RLS mu daje pristup samo dodijeljenim firmama; write-akcije MORAJU biti sakrivene (UI),
// a čitanje mora raditi. Throwaway pregled + throwaway firma; brisanje u finally.
test.describe("pregled — read-only UX", () => {
  test("pregled ne vidi write dugmad na kartici klijenta, ali vidi podatke", async ({ page, context }) => {
    const email = `e2e-pregled-${Date.now()}@tehpro.test`
    const naziv = "E2E-TMP PREGLED " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const uid = await ensureKorisnik(email, "PregledLoz1!", "E2E Pregled", "pregled")
      await assignKlijent(uid, kid)
      await injectSessionFor(context, email, "PregledLoz1!")

      await page.goto(`/klijenti/${kid}`)
      // čitanje radi: naziv firme vidljiv
      await expect(page.getByText(naziv)).toBeVisible({ timeout: 30_000 })

      // write-akcije SAKRIVENE (reprezentativni set — uskladi testid-e/ nazive sa stvarnim UI-em):
      await expect(page.getByRole("button", { name: /Uredi klijenta/i })).toHaveCount(0)
      await expect(page.getByTestId("novi-kontakt-btn")).toHaveCount(0)
      // (opciono: dodaj još 1-2 reprezentativna, npr. „Novi termin"/„Dodaj provjeru" ako su na ovom ekranu)
    } finally {
      await deleteKlijentByNaziv(naziv)
      await deleteKorisnikByEmail(email)
    }
  })
})
```
> **Napomena za izvršioca:** uskladi selektore write-dugmadi sa STVARNIM UI-em (tačan naziv „Uredi klijenta" iz i18n, stvarni testid-i). Cilj asercije: bar 2 reprezentativna write-triggera imaju `toHaveCount(0)` za pregled, a read (naziv firme) je vidljiv. Ako neki write-trigger nije na kartici klijenta nego na drugom tabu, navigiraj tamo ili izaberi trigger koji jeste na `/klijenti/{id}`.

- [ ] **Step 3: Pokreni e2e (chromium, workers=1) na DEMO**

```bash
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null
pnpm exec playwright test tests/e2e/26-pregled-readonly.spec.ts --project=chromium --workers=1
```
Expected: 1 passed (+setup). Ako selektor write-dugmeta ne pogađa (naziv/testid) — uskladi test sa stvarnim UI-em (NE mijenjaj gate logiku da bi prošao). Uvijek očisti throwaway (finally).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/db.ts tests/e2e/26-pregled-readonly.spec.ts
git commit -m "test(e2e): pregled ne vidi write akcije, čita podatke"
```

---

## Self-Review (autor plana)

- **Spec coverage:** hook (T1); gejt svih write-površina iz spec-a (T2-T4), sa miješanim `ZapisnikProposal` (samo save) i cijelim `KlijentPodsjetniciForm`; NE-gejtovati lista poštovana; e2e kao pregled (T5). ✔
- **Placeholder scan:** uniformni obrazac + eksplicitni fajlovi; nema TBD. Selektori u T5 imaju „uskladi sa stvarnim UI" napomenu (nije placeholder — traži verifikaciju stvarnih testid-a). ✔
- **Type consistency:** `useMozeUrediti(): boolean` (T1) korišten isto u T2-T4. ✔
- **Rizici:** miješane komponente (T4 ZapisnikProposal eksplicitno); *Sheet trigger lokacija (napomene u T2/T3); e2e selektori (T5 napomena); pregled treba dodjelu da vidi firmu (T5 `assignKlijent`).
