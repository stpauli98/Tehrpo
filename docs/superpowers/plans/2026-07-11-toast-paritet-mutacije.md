# Toast paritet na mutacijama — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantovati da svaka serverska mutacija (koja se već loguje u `audit_log`) korisniku prikaže toast (uspjeh ili greška), kroz jedan dijeljeni obrazac umjesto ad-hoc poziva.

**Architecture:** Čista odlučna funkcija `odlukaToast` (`lib/`, unit-testirana) + dva tanka klijentska omotača (`components/akcija-toast.tsx`): `useAkcijaToast` hook za `useActionState` forme i `toastRezultat` imperativni helper za direktne `await` pozive. Jezgro se gradi prvo na `main`; onda 4 domenska agenta samo usvajaju helper (nula izmjena na dijeljenom fajlu).

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19 `useActionState`, `sonner` toast, `next-intl`, Vitest (node env), pnpm.

## Global Constraints

- Package manager: **pnpm** (ne npm/yarn).
- `dev` mora biti `--webpack` (razmak u putanji ruši Turbopack) — ali ovaj task ne pokreće dev osim vizuelne provjere.
- Domenski jezik: **bosanski/srpski (latinica)** — identifikatori i UI stringovi.
- **Nula hardkodiranih UI stringova** — sve poruke kroz `next-intl` (`useTranslations`).
- `lib/**/*.ts` je **pure logika** (bez React/sonner importa) — samo tu idu unit testovi (`lib/**/*.test.ts`, node env).
- Bez `sm:`/`md:` Tailwind breakpointa (ESLint blokira).
- **NE dirati** `audit_log` / `tg_audit()` / RLS / server-akcijske potpise. Hook je aditivan — postojeći `useEffect` side-efekti (npr. `router.refresh()`) ostaju.
- Path alias: `@/*` = root repo.
- Commit poruke završiti sa: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Jezgro — čista odlučna funkcija `odlukaToast`

**Files:**
- Create: `lib/akcija-toast.ts`
- Test: `lib/akcija-toast.test.ts`

**Interfaces:**
- Produces:
  - `type AkcijaRezultat = { ok: true } | { ok: false; message?: string; errors?: Record<string, string[] | undefined> }`
  - `type ToastOdluka = { tip: "success" | "error"; poruka: string } | null`
  - `function odlukaToast(res: AkcijaRezultat, uspjeh: string, greskaFallback: string): ToastOdluka`

- [ ] **Step 1: Write the failing test**

`lib/akcija-toast.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { odlukaToast } from "./akcija-toast"

describe("odlukaToast", () => {
  it("ok:true → success sa uspjeh porukom", () => {
    expect(odlukaToast({ ok: true }, "Sačuvano", "Greška")).toEqual({
      tip: "success",
      poruka: "Sačuvano",
    })
  })

  it("ok:false + message → error sa tom porukom", () => {
    expect(odlukaToast({ ok: false, message: "Naziv postoji" }, "Sačuvano", "Greška")).toEqual({
      tip: "error",
      poruka: "Naziv postoji",
    })
  })

  it("ok:false samo errors (polja) → null (inline prikaz, bez toasta)", () => {
    expect(
      odlukaToast({ ok: false, errors: { naziv: ["Obavezno"] } }, "Sačuvano", "Greška"),
    ).toBeNull()
  })

  it("ok:false bez message ni errors → error fallback", () => {
    expect(odlukaToast({ ok: false }, "Sačuvano", "Greška")).toEqual({
      tip: "error",
      poruka: "Greška",
    })
  })

  it("ok:false sa message I errors → message pobjeđuje (toast)", () => {
    expect(
      odlukaToast({ ok: false, message: "RLS blokada", errors: { x: ["y"] } }, "Sačuvano", "Greška"),
    ).toEqual({ tip: "error", poruka: "RLS blokada" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/akcija-toast.test.ts`
Expected: FAIL — `Failed to resolve import "./akcija-toast"` / `odlukaToast is not a function`.

- [ ] **Step 3: Write minimal implementation**

`lib/akcija-toast.ts`:
```ts
export type AkcijaRezultat =
  | { ok: true }
  | { ok: false; message?: string; errors?: Record<string, string[] | undefined> }

export type ToastOdluka = { tip: "success" | "error"; poruka: string } | null

/**
 * Odlučuje koji toast (ako ijedan) prikazati za rezultat mutacione akcije.
 * Field-level greške (`errors`) se NE toastaju — prikazuju se inline pod poljima.
 */
export function odlukaToast(
  res: AkcijaRezultat,
  uspjeh: string,
  greskaFallback: string,
): ToastOdluka {
  if (res.ok) return { tip: "success", poruka: uspjeh }
  if (res.message) return { tip: "error", poruka: res.message }
  if (res.errors && Object.keys(res.errors).length > 0) return null
  return { tip: "error", poruka: greskaFallback }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/akcija-toast.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/akcija-toast.ts lib/akcija-toast.test.ts
git commit -m "feat: odlukaToast — čista odlučna funkcija za toast paritet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Klijentski omotači — `useAkcijaToast` + `toastRezultat` + zajednički i18n

**Files:**
- Create: `components/akcija-toast.tsx`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json` (dodati `common.*` ključeve ako fale)

**Interfaces:**
- Consumes: `odlukaToast`, `AkcijaRezultat` iz `@/lib/akcija-toast` (Task 1).
- Produces:
  - `function useAkcijaToast(state: AkcijaRezultat, opcije: { uspjeh: string; greska: string }): void`
  - `function toastRezultat<T extends AkcijaRezultat>(res: T, opcije: { uspjeh: string; greska: string }): T`

> **Zašto bez unit testa ovdje:** vitest `include` je samo `lib/**` + `i18n/**` u **node** env (bez
> DOM-a), a `lib/` mora ostati pure (bez React/sonner importa). Sva odlučna logika je već 100%
> pokrivena u Task 1 (`odlukaToast`); omotači su tanki prolazi koji samo pozovu `toast[tip]`. Ne
> uvodimo jsdom infrastrukturu zbog dvije linije (YAGNI) — omotači se verifikuju typecheck-om +
> vizuelno u sweep taskovima.

- [ ] **Step 1: Write implementation**

`components/akcija-toast.tsx`:
```tsx
"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { odlukaToast, type AkcijaRezultat } from "@/lib/akcija-toast"

/**
 * Hook za `useActionState` forme. Aditivan — okine toast na SVAKI novi rezultat
 * akcije (ne na inicijalni state). Ne dira postojeće success side-efekte forme.
 */
export function useAkcijaToast(
  state: AkcijaRezultat,
  opcije: { uspjeh: string; greska: string },
): void {
  const prethodni = useRef(state)
  useEffect(() => {
    if (state === prethodni.current) return // inicijalni render / nepromijenjen state
    prethodni.current = state
    const odluka = odlukaToast(state, opcije.uspjeh, opcije.greska)
    if (odluka) toast[odluka.tip](odluka.poruka)
  }, [state, opcije.uspjeh, opcije.greska])
}

/** Imperativni helper za direktne `await` pozive akcija. Vraća `res` prolazno. */
export function toastRezultat<T extends AkcijaRezultat>(
  res: T,
  opcije: { uspjeh: string; greska: string },
): T {
  const odluka = odlukaToast(res, opcije.uspjeh, opcije.greska)
  if (odluka) toast[odluka.tip](odluka.poruka)
  return res
}
```

- [ ] **Step 2: Typecheck omotača**

Run: `pnpm typecheck`
Expected: PASS — tipovi `AkcijaRezultat`/`ToastOdluka` iz Task 1 se poklapaju; nema grešaka.

- [ ] **Step 3: Osigurati zajedničke i18n ključeve**

Provjeri postoje li u `messages/sr.json` pod `common`: `sacuvano`, `obrisano`, `greska`. Ako fale, dodaj (paritet u sva 3 fajla):

`messages/sr.json` (`common` objekat):
```json
"sacuvano": "Sačuvano",
"obrisano": "Obrisano",
"greska": "Došlo je do greške"
```
`messages/en.json`:
```json
"sacuvano": "Saved",
"obrisano": "Deleted",
"greska": "Something went wrong"
```
`messages/de.json`:
```json
"sacuvano": "Gespeichert",
"obrisano": "Gelöscht",
"greska": "Ein Fehler ist aufgetreten"
```

Provjeri: `pnpm typecheck` (next-intl tip-provjera ključeva) mora proći.

- [ ] **Step 4: Commit**

```bash
git add components/akcija-toast.tsx messages/sr.json messages/en.json messages/de.json
git commit -m "feat: useAkcijaToast + toastRezultat omotači + common i18n ključevi

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

> **Napomena o Taskovima 3–6:** ovo su paralelni coverage sweep-ovi, svaki u svom git worktree-u
> granatom sa `main` NAKON što su Task 1–2 mergovani u `main`. Svaki agent radi ISKLJUČIVO u svom
> lane-u. Obrazac usvajanja je identičan; razlikuju se samo fajlovi.

### Obrazac usvajanja (važi za sve sweep taskove)

**A) `useActionState` forma** — dodaj hook odmah ispod `useActionState` linije:
```tsx
const [state, action, pending] = useActionState(updateKlijent, initial)
const tc = useTranslations("common")            // ako već ne postoji u komponenti
useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })
```
Import: `import { useAkcijaToast } from "@/components/akcija-toast"`.
Ako komponenta već ima ad-hoc `toast.success/error` na osnovu `state` — ukloni ga (dedup).
Postojeći `useEffect` za `router.refresh()`/`setOpen(false)` OSTAJE netaknut.

**B) Direktni `await` poziv** — omotaj rezultat:
```tsx
import { toastRezultat } from "@/components/akcija-toast"
// prije: const res = await posaljiTest(id); if (!res.ok) toast.error(res.message)
const res = toastRezultat(await posaljiTest(id), { uspjeh: tc("sacuvano"), greska: tc("greska") })
if (res.ok) { /* postojeći success side-efekt */ }
```
Ukloni prethodni ručni `toast.*` za taj poziv (dedup).

**Specifične poruke:** gdje akcija nosi kontekst (npr. „Klijent sačuvan" vs „Obrisano"), koristi
specifičan i18n ključ iz namespace-a te komponente umjesto generičkog `common.sacuvano`; dodaj ključ
u `sr/en/de` ako fali.

**Discovery komanda (pokreni u svom lane-u):** za svaki lane je dat grep opseg u tasku.

**Verifikacija na kraju svakog sweep taska:**
`pnpm typecheck && pnpm lint && pnpm test:unit` — sve zeleno. Vizuelno (`pnpm dev -p <port>`): odradi
1–2 akcije i potvrdi da toast iskoči.

---

## Task 3: Coverage sweep — lane `klijenti`

**Worktree:** `feat/klijenti` · **dev port:** 3001

**Files (mutacione forme/pozivi u lane-u — potvrdi grep-om, pokrij sve nađeno):**
- `components/domain/KlijentEditForm.tsx`, `NoviKlijentButton.tsx`
- `components/domain/KontaktSheet.tsx`, `KontaktiKlijentList.tsx`
- `components/domain/LokacijaSheet.tsx`, `ObrisiLokacijuButton.tsx`
- `components/domain/UgovorSheet.tsx`, `UgovoriTab.tsx`
- `components/domain/DodajProvjeruButton.tsx`, `NovaVrstaButton.tsx`, `VrstaSheet.tsx`, `VrstePregledaTabela.tsx`
- `components/domain/KlijentDokumentUpload.tsx`, `DokumentiSekcija.tsx`, `ObrisiDokumentButton.tsx`
- `components/domain/NoviKorisnikButton.tsx`, `UlogaSelect.tsx`, `KorisnikAkcije.tsx`, `ObrisiProfilButton.tsx`, `MojNalogForm.tsx`, `ObrisiKlijentButton.tsx`

**Discovery:**
```bash
grep -rlE "useActionState|await (update|kreiraj|obrisi|dodaj|posalji|postavi|create|delete)" \
  components/domain app/\(dashboard\)/klijenti app/\(dashboard\)/postavke 2>/dev/null | sort -u
```

- [ ] **Step 1:** Za svaku formu/poziv iz liste primijeni obrazac A ili B (vidi gore). Dedupuj postojeće ad-hoc `toast.*`. Dodaj specifične i18n ključeve gdje kontekst nosi značenje.
- [ ] **Step 2:** `pnpm typecheck` — čisto.
- [ ] **Step 3:** `pnpm lint` — 0 errors.
- [ ] **Step 4:** `pnpm test:unit` — sve zeleno.
- [ ] **Step 5:** Vizuelno `pnpm dev -p 3001`: uredi klijenta → potvrdi „Sačuvano" toast; izazovi grešku (duplo ime) → potvrdi error toast.
- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat: toast paritet — coverage sweep lane klijenti

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Coverage sweep — lane `termini`

**Worktree:** `feat/termini` · **dev port:** 3002

**Files:**
- `components/domain/NoviTerminButton.tsx`, `TerminSheet.tsx`
- Bilo koja mutaciona forma pod `app/(dashboard)/termini`, `plan-aktivnosti`, `prikaz`, `plan`.

**Discovery:**
```bash
grep -rlE "useActionState|await (kreiraj|update|obrisi|zabiljezi|posalji)" \
  components/domain app/\(dashboard\)/termini app/\(dashboard\)/plan-aktivnosti app/\(dashboard\)/prikaz 2>/dev/null | sort -u
```

- [ ] **Step 1:** Primijeni obrazac A/B na sve nađene termini-mutacije. Dedup ad-hoc toast.
- [ ] **Step 2:** `pnpm typecheck` — čisto.
- [ ] **Step 3:** `pnpm lint` — 0 errors.
- [ ] **Step 4:** `pnpm test:unit` — zeleno.
- [ ] **Step 5:** Vizuelno `pnpm dev -p 3002`: kreiraj termin → „Sačuvano" toast.
- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat: toast paritet — coverage sweep lane termini

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Coverage sweep — lane `obilasci`

**Worktree:** `feat/obilasci` · **dev port:** 3003

**Files:**
- Mutacione forme pod `app/(dashboard)/obilasci`, `zapisnici`; zapisnik-generisanje pozivi.

**Discovery:**
```bash
grep -rlE "useActionState|await (generisi|kreiraj|update|obrisi|sacuvaj)" \
  components/domain app/\(dashboard\)/obilasci app/\(dashboard\)/zapisnici 2>/dev/null | sort -u
```

- [ ] **Step 1:** Primijeni obrazac A/B na nađene obilasci/zapisnici mutacije. Ako lane nema mutacionih formi, iskreno to zabilježi u commit poruci (nema izmjena osim potvrde). Dedup ad-hoc toast gdje postoji.
- [ ] **Step 2:** `pnpm typecheck` — čisto.
- [ ] **Step 3:** `pnpm lint` — 0 errors.
- [ ] **Step 4:** `pnpm test:unit` — zeleno.
- [ ] **Step 5:** Vizuelno `pnpm dev -p 3003` (ako ima akcije): potvrdi toast.
- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat: toast paritet — coverage sweep lane obilasci

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Coverage sweep — lane `podsjetnici`

**Worktree:** `feat/podsjetnici` · **dev port:** 3004

**Files:**
- `components/domain/PodsjetniciKontrole.tsx`, `ZakazanoObavijestToggle.tsx`, `SaljiKlijentimaToggle.tsx`, `ReminderForm.tsx`, `VrijemeSlanjaForm.tsx`
- `components/domain/PrimaociCombobox.tsx`, `KlijentPodsjetniciForm.tsx`, `DodjelaKlijenata.tsx`, `DodjelaRadnikaFirmi.tsx` (direktni pozivi)

**Discovery:**
```bash
grep -rlE "useActionState|toast\.(success|error|warning)|await (postavi|posalji|pokreni|azuriraj)" \
  components/domain app/\(dashboard\)/postavke 2>/dev/null | sort -u
```

- [ ] **Step 1:** Primijeni obrazac A (forme) / B (direktni pozivi u `PrimaociCombobox`, `KlijentPodsjetniciForm`, `DodjelaKlijenata`). Dedupuj brojne postojeće ad-hoc `toast.*` na helper. ⚠️ NE dirati logiku slanja podsjetnika ni poslovno pravilo (klijent ne dobija app-notif).
- [ ] **Step 2:** `pnpm typecheck` — čisto.
- [ ] **Step 3:** `pnpm lint` — 0 errors.
- [ ] **Step 4:** `pnpm test:unit` — zeleno.
- [ ] **Step 5:** Vizuelno `pnpm dev -p 3004`: promijeni postavku podsjetnika → „Sačuvano" toast. **NE pokretati ne-dry slanje** (živi Resend na DEMO).
- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat: toast paritet — coverage sweep lane podsjetnici

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Integracija (nakon sva 4 sweep-a)

Merge redoslijedom `podsjetnici → obilasci → klijenti → termini` u `main`, uz
`pnpm typecheck && pnpm lint && pnpm test:unit` provjeru na spojenom `main` (podsjeti se: root
`pnpm lint` ignoriše `.claude/**`). Push = produkcijski deploy na 3 Vercel projekta — tražiti potvrdu.
