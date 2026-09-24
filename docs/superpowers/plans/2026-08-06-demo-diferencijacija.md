# DEMO diferencijacija — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DEMO deploy (NEXT_PUBLIC_DEMO_MODE=1) dobija narandžastu akcentnu boju, stalnu DEMO traku na svim ekranima i disklejmer modal jednom po prijavi; PROD ostaje piksel-identičan.

**Architecture:** Sve gate-ovano na build-time konstantu `DEMO_MODE` iz `lib/demo.ts`. Boja: `data-demo` atribut na `<html>` + CSS var override u `globals.css` (prefarba svih ~32 upotrebe `bg-brand`/`text-brand`). Traka i modal su nove `components/shell/` klijentske komponente; logika „jednom po prijavi" je čista funkcija nad `sessionStorage` u `lib/demo-disklejmer.ts` (unit-testirana), ključ se briše na mount `/prijava`.

**Tech Stack:** Next.js 16 (App Router, `--webpack`), Tailwind v4 (`@theme` var-based utilities), Base UI Dialog (`components/ui/dialog.tsx`), next-intl (katalozi `messages/{sr,en,de}.json`, key parity čuva tsc), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-demo-diferencijacija-design.md`.
- Sve DEMO izmjene vidljive ISKLJUČIVO kad je `DEMO_MODE === true`; bez flaga ništa se ne renderuje niti stilizuje drugačije.
- Boje: `--color-brand: #ea580c`, `--color-brand-dark: #c2410c`, `--color-brand-light: #ffedd5` (samo pod `html[data-demo]`).
- Svi UI stringovi kroz next-intl; ključevi u SVA TRI kataloga u istoj izmjeni (`sr`/`en`/`de` parity), namespace `shell` (već u `CLIENT_NAMESPACES`).
- Zabranjeni `sm:`/`md:` Tailwind breakpointi (ESLint error); paket menadžer `pnpm`; dev server SAMO `pnpm dev` (`--webpack`).
- Disklejmer se zatvara isključivo dugmetom „Razumijem" (bez X, Escape i klika van modala).
- Komande: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm vitest run <fajl>`.

---

### Task 1: Čista logika „jednom po prijavi" (`lib/demo-disklejmer.ts`)

**Files:**
- Create: `lib/demo-disklejmer.ts`
- Test: `lib/demo-disklejmer.test.ts`

**Interfaces:**
- Consumes: ništa (čist modul, bez importa).
- Produces (Task 4 i 5 ih koriste):
  - `DISKLEJMER_KLJUC: string` = `"demo-disklejmer-potvrdjen"`
  - `bezbjedniSessionStorage(): Storage | null` — `window.sessionStorage` ili `null` (SSR/privatni režim)
  - `trebaPrikazatiDisklejmer(storage: Storage | null): boolean`
  - `potvrdiDisklejmer(storage: Storage | null): void`
  - `ponistiDisklejmer(storage: Storage | null): void`

- [ ] **Step 1: Napiši padajući test**

```ts
// lib/demo-disklejmer.test.ts
import { describe, it, expect } from "vitest"
import {
  DISKLEJMER_KLJUC,
  bezbjedniSessionStorage,
  trebaPrikazatiDisklejmer,
  potvrdiDisklejmer,
  ponistiDisklejmer,
} from "./demo-disklejmer"

// Minimalni in-memory Storage — vitest okruženje je node, nema window/sessionStorage.
function napraviStorage(): Storage {
  const mapa = new Map<string, string>()
  return {
    getItem: (k: string) => (mapa.has(k) ? mapa.get(k)! : null),
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
    clear: () => mapa.clear(),
    key: (i: number) => [...mapa.keys()][i] ?? null,
    get length() {
      return mapa.size
    },
  }
}

describe("demo-disklejmer", () => {
  it("prikazuje se kad ključ ne postoji, ne prikazuje se poslije potvrde", () => {
    const s = napraviStorage()
    expect(trebaPrikazatiDisklejmer(s)).toBe(true)
    potvrdiDisklejmer(s)
    expect(s.getItem(DISKLEJMER_KLJUC)).toBe("1")
    expect(trebaPrikazatiDisklejmer(s)).toBe(false)
  })

  it("poništavanje (nova prijava) vraća prikaz", () => {
    const s = napraviStorage()
    potvrdiDisklejmer(s)
    ponistiDisklejmer(s)
    expect(trebaPrikazatiDisklejmer(s)).toBe(true)
  })

  it("bez storage-a (null) uvijek prikazuje, a upisi ne pucaju", () => {
    expect(trebaPrikazatiDisklejmer(null)).toBe(true)
    expect(() => potvrdiDisklejmer(null)).not.toThrow()
    expect(() => ponistiDisklejmer(null)).not.toThrow()
  })

  it("storage koji baca izuzetak tretira se kao nedostupan", () => {
    const pokvaren = {
      getItem: () => {
        throw new Error("blokiran")
      },
      setItem: () => {
        throw new Error("blokiran")
      },
      removeItem: () => {
        throw new Error("blokiran")
      },
    } as unknown as Storage
    expect(trebaPrikazatiDisklejmer(pokvaren)).toBe(true)
    expect(() => potvrdiDisklejmer(pokvaren)).not.toThrow()
    expect(() => ponistiDisklejmer(pokvaren)).not.toThrow()
  })

  it("bezbjedniSessionStorage vraća null u node okruženju (nema window)", () => {
    expect(bezbjedniSessionStorage()).toBeNull()
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/demo-disklejmer.test.ts`
Expected: FAIL — `Cannot find module './demo-disklejmer'` (ili slično).

- [ ] **Step 3: Minimalna implementacija**

```ts
// lib/demo-disklejmer.ts
// Disklejmer u DEMO režimu se prikazuje jednom po prijavi: ključ u sessionStorage
// znači „potvrđeno", a /prijava ga briše na mount pa svaka nova prijava ponovo
// prikazuje modal. Storage može biti nedostupan (SSR, strogi privatni režim) ili
// bacati na pristup — tada namjerno biramo „prikaži" (bolje previše nego premalo).
export const DISKLEJMER_KLJUC = "demo-disklejmer-potvrdjen"

export function bezbjedniSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function trebaPrikazatiDisklejmer(storage: Storage | null): boolean {
  if (!storage) return true
  try {
    return storage.getItem(DISKLEJMER_KLJUC) === null
  } catch {
    return true
  }
}

export function potvrdiDisklejmer(storage: Storage | null): void {
  try {
    storage?.setItem(DISKLEJMER_KLJUC, "1")
  } catch {
    // namjerno progutano — bez storage-a modal se prikazuje ponovo, što je prihvatljivo
  }
}

export function ponistiDisklejmer(storage: Storage | null): void {
  try {
    storage?.removeItem(DISKLEJMER_KLJUC)
  } catch {
    // namjerno progutano
  }
}
```

- [ ] **Step 4: Testovi zeleni**

Run: `pnpm vitest run lib/demo-disklejmer.test.ts`
Expected: PASS (5 testova).

- [ ] **Step 5: Commit**

```bash
git add lib/demo-disklejmer.ts lib/demo-disklejmer.test.ts
git commit -m "feat(demo): logika disklejmera jednom po prijavi (sessionStorage)"
```

---

### Task 2: i18n ključevi (sr/en/de)

**Files:**
- Modify: `messages/sr.json` (namespace `shell`)
- Modify: `messages/en.json` (namespace `shell`)
- Modify: `messages/de.json` (namespace `shell`)

**Interfaces:**
- Produces: ključevi `shell.demoTraka.tekst` i `shell.demoDisklejmer.{naslov,pasus1,pasus2,pasus3,dugme}` — Taskovi 3 i 4 ih čitaju kroz `useTranslations("shell.demoTraka")` / `useTranslations("shell.demoDisklejmer")`.

- [ ] **Step 1: Dodaj ključeve u sva tri kataloga**

U `messages/sr.json`, unutar postojećeg objekta `"shell"` (poslije `"topBar"`), dodaj:

```json
"demoTraka": {
  "tekst": "DEMO VERZIJA — faza 0 · kostur, ne gotov proizvod"
},
"demoDisklejmer": {
  "naslov": "Dobrodošli u demo okruženje",
  "pasus1": "Ovo je kostur aplikacije — faza 0, generička osnova koju razvijamo od nule. Nije gotov proizvod i ne predstavlja proizvod bilo koje treće strane.",
  "pasus2": "Demo prikazuje samo mali dio mogućnosti. Svako rješenje se izrađuje po mjeri: konačan obim, izgled i funkcionalnosti definišu se u dogovoru sa firmom kojoj se rješenje implementira.",
  "pasus3": "Svi podaci u demo okruženju su testni i ne odnose se na stvarne firme.",
  "dugme": "Razumijem"
},
```

U `messages/en.json`, isto mjesto:

```json
"demoTraka": {
  "tekst": "DEMO VERSION — phase 0 · a skeleton, not a finished product"
},
"demoDisklejmer": {
  "naslov": "Welcome to the demo environment",
  "pasus1": "This is an application skeleton — phase 0, a generic foundation we develop from scratch. It is not a finished product and does not represent any third party's product.",
  "pasus2": "The demo shows only a small part of what is possible. Every solution is built custom: the final scope, look and functionality are defined together with the company it is implemented for.",
  "pasus3": "All data in the demo environment is test data and does not relate to real companies.",
  "dugme": "I understand"
},
```

U `messages/de.json`, isto mjesto:

```json
"demoTraka": {
  "tekst": "DEMO-VERSION — Phase 0 · Gerüst, kein fertiges Produkt"
},
"demoDisklejmer": {
  "naslov": "Willkommen in der Demo-Umgebung",
  "pasus1": "Dies ist ein Anwendungsgerüst — Phase 0, eine generische Grundlage, die wir von Grund auf neu entwickeln. Es ist kein fertiges Produkt und stellt kein Produkt eines Dritten dar.",
  "pasus2": "Die Demo zeigt nur einen kleinen Teil der Möglichkeiten. Jede Lösung wird maßgeschneidert erstellt: endgültiger Umfang, Aussehen und Funktionen werden gemeinsam mit dem Unternehmen festgelegt, für das die Lösung umgesetzt wird.",
  "pasus3": "Alle Daten in der Demo-Umgebung sind Testdaten und beziehen sich nicht auf reale Unternehmen.",
  "dugme": "Verstanden"
},
```

- [ ] **Step 2: Provjeri parity i sintaksu**

Run: `pnpm typecheck`
Expected: PASS (next-intl tipovi se generišu iz kataloga; JSON greška ili raspareni ključevi = tsc error).

- [ ] **Step 3: Commit**

```bash
git add messages/sr.json messages/en.json messages/de.json
git commit -m "i18n(demo): ključevi za DEMO traku i disklejmer (sr/en/de)"
```

---

### Task 3: Narandžasta boja + DEMO traka

**Files:**
- Modify: `app/layout.tsx` (data-demo atribut na `<html>`)
- Modify: `app/globals.css` (override pod `html[data-demo]`)
- Create: `components/shell/DemoTraka.tsx`
- Modify: `app/(dashboard)/layout.tsx` (traka iznad TopBar-a)
- Modify: `app/prijava/page.tsx` (traka fiksirana na vrh)
- Modify: `app/zaboravljena-lozinka/page.tsx` (traka fiksirana na vrh)

**Interfaces:**
- Consumes: `DEMO_MODE` iz `@/lib/demo`; ključ `shell.demoTraka.tekst` iz Task 2.
- Produces: `DemoTraka({ className? }: { className?: string })` — klijentska komponenta, renderuje traku; gate na `DEMO_MODE` radi POZIVALAC (`{DEMO_MODE && <DemoTraka />}`), po uzoru na postojeći DEMO bedž u `TopBar.tsx`.

- [ ] **Step 1: `data-demo` na `<html>`**

U `app/layout.tsx` dodaj import i atribut (React izostavlja atribut kad je vrijednost `undefined` → PROD markup bajt-identičan):

```tsx
import { DEMO_MODE } from "@/lib/demo"
```

```tsx
<html
  lang={APP_LOCALE}
  className={cn("font-sans", inter.variable)}
  data-demo={DEMO_MODE ? "1" : undefined}
  suppressHydrationWarning
>
```

- [ ] **Step 2: CSS override u `app/globals.css`**

Odmah POSLIJE zatvaranja `@theme { ... }` bloka (iza reda 13) dodaj:

```css
/* DEMO režim (lib/demo.ts): narandžasta umjesto plave da se demo na prvi
   pogled razlikuje od produkcijske instance. Tailwind v4 utility klase
   (bg-brand i sl.) kompajliraju u var(--color-brand), pa je ovaj override
   dovoljan za cijeli interfejs. */
html[data-demo] {
  --color-brand: #ea580c;
  --color-brand-dark: #c2410c;
  --color-brand-light: #ffedd5;
}
```

- [ ] **Step 3: Komponenta `DemoTraka`**

```tsx
// components/shell/DemoTraka.tsx
"use client"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

// Renderuje se samo u DEMO režimu — gate je na pozivaocu ({DEMO_MODE && ...}),
// isti obrazac kao DEMO bedž u TopBar.tsx. Namjerno bez dugmeta za zatvaranje.
export function DemoTraka({ className }: { className?: string }) {
  const t = useTranslations("shell.demoTraka")
  return (
    <div
      data-testid="demo-traka"
      className={cn(
        "flex h-8 shrink-0 items-center justify-center bg-brand px-4 text-xs font-semibold tracking-wide text-white",
        className,
      )}
    >
      {t("tekst")}
    </div>
  )
}
```

- [ ] **Step 4: Render u dashboard layoutu**

U `app/(dashboard)/layout.tsx` dodaj importe:

```tsx
import { DemoTraka } from "@/components/shell/DemoTraka"
import { DEMO_MODE } from "@/lib/demo"
```

i ubaci traku kao PRVO dijete flex kolone (h-screen kolona je apsorbuje bez preloma; ništa drugo se ne mijenja):

```tsx
<div className="hidden lg:flex flex-col h-screen">
  {DEMO_MODE && <DemoTraka />}
  <TopBar korisnik={korisnik} />
```

- [ ] **Step 5: Render na auth ekranima**

`app/prijava/page.tsx` — dodaj importe `DemoTraka` i `DEMO_MODE` (uz postojeće), pa omotaj return u fragment sa fiksiranom trakom (postojeći `min-h-screen grid` se NE dira):

```tsx
import { DemoTraka } from "@/components/shell/DemoTraka"
import { DEMO_MODE } from "@/lib/demo"
```

```tsx
  return (
    <>
      {DEMO_MODE && <DemoTraka className="fixed inset-x-0 top-0 z-10" />}
      <div className="min-h-screen grid place-items-center bg-muted">
        {/* ...postojeći sadržaj nepromijenjen... */}
      </div>
    </>
  )
```

`app/zaboravljena-lozinka/page.tsx` — dodaj iste importe (`DemoTraka`, `DEMO_MODE`) pa u komponenti `ZaboravljenaLozinkaForm` (ne oko `Suspense` wrappera) omotaj return u fragment:

```tsx
import { DemoTraka } from "@/components/shell/DemoTraka"
import { DEMO_MODE } from "@/lib/demo"
```

```tsx
  return (
    <>
      {DEMO_MODE && <DemoTraka className="fixed inset-x-0 top-0 z-10" />}
      <div className="min-h-screen grid place-items-center bg-muted">
        {/* ...postojeći sadržaj nepromijenjen... */}
      </div>
    </>
  )
```

- [ ] **Step 6: Provjere**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS oba.

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx app/globals.css components/shell/DemoTraka.tsx "app/(dashboard)/layout.tsx" app/prijava/page.tsx app/zaboravljena-lozinka/page.tsx
git commit -m "feat(demo): narandžasta akcentna boja i DEMO traka na svim ekranima"
```

---

### Task 4: Disklejmer modal poslije prijave

**Files:**
- Create: `components/shell/DemoDisklejmer.tsx`
- Modify: `app/(dashboard)/layout.tsx` (render modala)
- Modify: `app/prijava/page.tsx` (brisanje ključa na mount)

**Interfaces:**
- Consumes: `lib/demo-disklejmer.ts` (Task 1), ključevi `shell.demoDisklejmer.*` (Task 2), `Dialog`/`DialogContent(showCloseButton)`/`DialogHeader`/`DialogTitle`/`DialogFooter` iz `components/ui/dialog.tsx`, `Button` iz `components/ui/button.tsx`.
- Produces: `DemoDisklejmer()` — klijentska komponenta bez propova; gate na `DEMO_MODE` radi pozivalac.

- [ ] **Step 1: Komponenta `DemoDisklejmer`**

```tsx
// components/shell/DemoDisklejmer.tsx
"use client"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  bezbjedniSessionStorage,
  trebaPrikazatiDisklejmer,
  potvrdiDisklejmer,
} from "@/lib/demo-disklejmer"

// Prikazuje se jednom po prijavi (ključ briše /prijava na mount). Zatvaranje
// ISKLJUČIVO dugmetom: bez X-a (showCloseButton={false}), a Escape i klik van
// modala se ignorišu tako što onOpenChange ne prihvata zahtjev za zatvaranje.
export function DemoDisklejmer() {
  const t = useTranslations("shell.demoDisklejmer")
  const [otvoren, setOtvoren] = useState(false)

  // U efektu, ne u render fazi: sessionStorage postoji samo u browseru,
  // a i izbjegava se hydration razlika server/klijent.
  useEffect(() => {
    if (trebaPrikazatiDisklejmer(bezbjedniSessionStorage())) setOtvoren(true)
  }, [])

  const potvrdi = () => {
    potvrdiDisklejmer(bezbjedniSessionStorage())
    setOtvoren(false)
  }

  return (
    <Dialog
      open={otvoren}
      onOpenChange={(sljedece) => {
        if (sljedece) setOtvoren(true)
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="demo-disklejmer"
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t("naslov")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t("pasus1")}</p>
          <p>{t("pasus2")}</p>
          <p>{t("pasus3")}</p>
        </div>
        <DialogFooter>
          <Button onClick={potvrdi} data-testid="demo-disklejmer-potvrdi">
            {t("dugme")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Render u dashboard layoutu**

U `app/(dashboard)/layout.tsx` (importi za `DEMO_MODE` već postoje iz Task 3):

```tsx
import { DemoDisklejmer } from "@/components/shell/DemoDisklejmer"
```

pa odmah uz `<Toaster />`:

```tsx
        {DEMO_MODE && <DemoDisklejmer />}
        <Toaster />
```

- [ ] **Step 3: Brisanje ključa na `/prijava`**

U `app/prijava/page.tsx` dodaj importe:

```tsx
import { useEffect } from "react"
import { bezbjedniSessionStorage, ponistiDisklejmer } from "@/lib/demo-disklejmer"
```

i na početak tijela komponente `PrijavaPage` (poslije postojećih hookova):

```tsx
  // Nova prijava = novi prikaz disklejmera: dolazak na login briše potvrdu,
  // pa modal sačeka korisnika odmah poslije uspješne prijave.
  useEffect(() => {
    if (DEMO_MODE) ponistiDisklejmer(bezbjedniSessionStorage())
  }, [])
```

(`DEMO_MODE` je već importovan u Task 3, Step 5.)

- [ ] **Step 4: Provjere**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: PASS sve tri.

- [ ] **Step 5: Commit**

```bash
git add components/shell/DemoDisklejmer.tsx "app/(dashboard)/layout.tsx" app/prijava/page.tsx
git commit -m "feat(demo): disklejmer modal jednom po prijavi (faza 0, custom rješenje)"
```

---

### Task 5: Verifikacija cijelog toka

**Files:** ništa novo — provjere i eventualne sitne popravke.

**Interfaces:** Consumes sve iz Taskova 1–4.

- [ ] **Step 1: Puna lokalna kapija**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`
Expected: sve PASS. (Build hvata slučajnu server/klijent granicu — npr. `useTranslations` u server komponenti.)

- [ ] **Step 2: Ručna provjera u DEMO režimu**

Run: `NEXT_PUBLIC_DEMO_MODE=1 pnpm dev` pa u browseru na `http://localhost:3000`:

1. `/prijava`: narandžasta traka na vrhu, logo bedž i dugme narandžasti.
2. Prijava (kredencijali iz `.env.development.local`: `E2E_ADMIN_EMAIL` / `E2E_ADMIN_LOZINKA`): modal `demo-disklejmer` preko dashboarda; Escape i klik van modala NE zatvaraju; „Razumijem" zatvara.
3. Navigacija po stranicama: modal se NE vraća; traka stoji iznad TopBar-a; bez duplog scrollbara.
4. Odjava → `/prijava` → prijava: modal se PONOVO prikazuje.
5. Zaustavi server, pokreni obični `pnpm dev` (bez flaga): plava boja, bez trake, bez modala — PROD izgled netaknut.

Expected: svih 5 tačaka prolazi; svako odstupanje se popravlja prije commit-a.

- [ ] **Step 3: Commit eventualnih popravki**

```bash
git add -A && git commit -m "fix(demo): korekcije nakon ručne verifikacije"
```

(Preskoči ako Step 2 nije tražio izmjene.)
