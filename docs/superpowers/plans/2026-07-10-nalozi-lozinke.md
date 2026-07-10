# Nalozi i lozinke — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** „Promijeni lozinku" za svakog prijavljenog korisnika + admin „Pošalji reset" po korisniku.

**Architecture:** Pure helper za validaciju (unit); dvije imperativne server akcije (`promijeniLozinku`, `posaljiResetKorisniku`) u postavke/actions.ts koje koriste Supabase auth (`signInWithPassword` re-auth, `updateUser`, `resetPasswordForEmail`); „Moj nalog" sekcija u Postavkama vidljiva svim ulogama; „Pošalji reset" stavka u `KorisnikAkcije` (admin-only tab). i18n sr/en/de; e2e na cloud DEMO sa throwaway nalogom.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Supabase auth, next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-10-nalozi-lozinke-design.md`

## Global Constraints

- **Grana:** `feat/nalozi-lozinke` (od `main`). Zaseban PR. Bez migracija/cloud koraka.
- **Package manager:** `pnpm`; `next dev`/e2e sa `--webpack`; e2e `--workers=1`.
- **SSR Supabase klijent** (`createServerSupabaseClient`) u akcijama; nikad admin klijent u request putanji.
- **`ActionResult`** = `{ ok: true } | { ok: false, message?: string }` (import iz `@/app/(dashboard)/klijenti/actions`).
- next-intl: novi ključevi u sva 3 jezika (sr/en/de), paritet; `one` ICU zabranjen za sr.
- Tailwind: bez `sm:`/`md:` breakpointa.
- **Svaki commit** završava: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Pure helper `validirajNovuLozinku` (TDD)

**Files:**
- Create: `lib/auth/lozinka.ts`
- Test: `lib/auth/lozinka.test.ts`

**Interfaces:**
- Produces: `validirajNovuLozinku(nova: string, potvrda: string): { ok: true } | { ok: false; razlog: "min" | "nePoklapaju" }`

- [ ] **Step 1: Napiši test**

Kreiraj `lib/auth/lozinka.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { validirajNovuLozinku } from "./lozinka"

describe("validirajNovuLozinku", () => {
  it("ok kad je >=8 i poklapa se", () => {
    expect(validirajNovuLozinku("tajna123", "tajna123")).toEqual({ ok: true })
  })
  it("min kad je kraća od 8", () => {
    expect(validirajNovuLozinku("kratko7", "kratko7")).toEqual({ ok: false, razlog: "min" })
  })
  it("nePoklapaju kad se ne slažu (i kad je dužina ok)", () => {
    expect(validirajNovuLozinku("tajna123", "tajna124")).toEqual({ ok: false, razlog: "nePoklapaju" })
  })
})
```

- [ ] **Step 2: Pokreni — pada**

Run: `pnpm vitest run lib/auth/lozinka.test.ts`
Expected: FAIL (modul ne postoji).

- [ ] **Step 3: Implementiraj**

Kreiraj `lib/auth/lozinka.ts`:
```ts
export type LozinkaValidacija = { ok: true } | { ok: false; razlog: "min" | "nePoklapaju" }

/** Validacija nove lozinke: min 8 znakova, i mora se poklapati s potvrdom. */
export function validirajNovuLozinku(nova: string, potvrda: string): LozinkaValidacija {
  if (nova.length < 8) return { ok: false, razlog: "min" }
  if (nova !== potvrda) return { ok: false, razlog: "nePoklapaju" }
  return { ok: true }
}
```

- [ ] **Step 4: Pokreni — prolazi**

Run: `pnpm vitest run lib/auth/lozinka.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add lib/auth/lozinka.ts lib/auth/lozinka.test.ts
git commit -m "feat(auth): validirajNovuLozinku helper (min 8 + poklapanje)"
```

---

## Task 2: Server akcije `promijeniLozinku` + `posaljiResetKorisniku`

**Files:**
- Modify: `app/(dashboard)/postavke/actions.ts`

**Interfaces:**
- Consumes: `validirajNovuLozinku` (Task 1); postojeći `zahtijevajAdmina()`, `ActionResult`, `t` (translator) i `createServerSupabaseClient` iz istog/susjednog modula.
- Produces:
  - `promijeniLozinku(trenutna: string, nova: string, potvrda: string): Promise<ActionResult>`
  - `posaljiResetKorisniku(email: string): Promise<ActionResult>`

- [ ] **Step 1: Dodaj importe (ako fale)**

U `app/(dashboard)/postavke/actions.ts` osiguraj importe: `import { headers } from "next/headers"` i `import { validirajNovuLozinku } from "@/lib/auth/lozinka"`. (`createServerSupabaseClient`, `zahtijevajAdmina`, `ActionResult`, `t` već postoje u fajlu — koristi ih; NE dupliraj.)

- [ ] **Step 2: Dodaj `promijeniLozinku`**

Umetni (npr. blizu ostalih korisnik-akcija):
```ts
/** Prijavljeni korisnik mijenja svoju lozinku (traži trenutnu radi re-autentifikacije). */
export async function promijeniLozinku(trenutna: string, nova: string, potvrda: string): Promise<ActionResult> {
  const v = validirajNovuLozinku(nova, potvrda)
  if (!v.ok) {
    return { ok: false, message: v.razlog === "min" ? t("mojNalog.greske.minDuzina") : t("mojNalog.greske.nePoklapaju") }
  }
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, message: t("mojNalog.greske.opsta") }
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: trenutna })
  if (authErr) return { ok: false, message: t("mojNalog.greske.trenutnaPogresna") }
  const { error } = await supabase.auth.updateUser({ password: nova })
  if (error) return { ok: false, message: t("mojNalog.greske.opsta") }
  return { ok: true }
}
```
> **Napomena za izvršioca:** provjeri kako je `t` postavljen u ovom fajlu (npr. `createTranslator` sa namespace-om `"postavke"`). Ako je namespace `"postavke"`, ključevi su `mojNalog.greske.*` kao gore. Ako je translator bez namespace-a ili drugačiji, prilagodi prefiks da pokazuje na `postavke.mojNalog.greske.*`. Ključeve dodaje Task 3.

- [ ] **Step 3: Dodaj `posaljiResetKorisniku`**

```ts
/** Admin okine reset-email za korisnika (ne postavlja/ne vidi lozinku). */
export async function posaljiResetKorisniku(email: string): Promise<ActionResult> {
  await zahtijevajAdmina()
  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirm` })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: EXIT 0 (ako `t("mojNalog...")` ključevi još ne postoje, next-intl to ne obara u typecheck-u; dodaju se u Task 3 prije e2e/build-a).

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/postavke/actions.ts"
git commit -m "feat(postavke): akcije promijeniLozinku (re-auth) + posaljiResetKorisniku (admin)"
```

---

## Task 3: A1 UI — „Moj nalog" sekcija (svi prijavljeni) + i18n

**Files:**
- Create: `components/domain/MojNalogForm.tsx`, `components/domain/MojNalogSekcija.tsx`
- Modify: `app/(dashboard)/postavke/page.tsx`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `promijeniLozinku` (Task 2).

- [ ] **Step 1: i18n ključevi (sr)**

U `messages/sr.json`, unutar objekta `"postavke"`, dodaj (uz postojeće ključeve; pazi na zarez):
```json
    "mojNalog": {
      "naslov": "Moj nalog",
      "opis": "Promijeni svoju lozinku.",
      "trenutna": "Trenutna lozinka",
      "nova": "Nova lozinka (min 8)",
      "potvrda": "Potvrdi novu lozinku",
      "dugme": "Promijeni lozinku",
      "uToku": "Mijenjam…",
      "uspjeh": "Lozinka je promijenjena.",
      "greske": {
        "minDuzina": "Nova lozinka mora imati bar 8 znakova.",
        "nePoklapaju": "Lozinke se ne poklapaju.",
        "trenutnaPogresna": "Trenutna lozinka nije tačna.",
        "opsta": "Nije moguće promijeniti lozinku."
      }
    },
```

- [ ] **Step 2: Isti ključevi u en.json i de.json**

`messages/en.json` → `postavke.mojNalog`:
```json
    "mojNalog": {
      "naslov": "My account",
      "opis": "Change your password.",
      "trenutna": "Current password",
      "nova": "New password (min 8)",
      "potvrda": "Confirm new password",
      "dugme": "Change password",
      "uToku": "Changing…",
      "uspjeh": "Password changed.",
      "greske": {
        "minDuzina": "New password must be at least 8 characters.",
        "nePoklapaju": "Passwords do not match.",
        "trenutnaPogresna": "Current password is incorrect.",
        "opsta": "Could not change the password."
      }
    },
```
`messages/de.json` → `postavke.mojNalog`:
```json
    "mojNalog": {
      "naslov": "Mein Konto",
      "opis": "Ändere dein Passwort.",
      "trenutna": "Aktuelles Passwort",
      "nova": "Neues Passwort (min. 8)",
      "potvrda": "Neues Passwort bestätigen",
      "dugme": "Passwort ändern",
      "uToku": "Wird geändert…",
      "uspjeh": "Passwort geändert.",
      "greske": {
        "minDuzina": "Das neue Passwort muss mindestens 8 Zeichen haben.",
        "nePoklapaju": "Passwörter stimmen nicht überein.",
        "trenutnaPogresna": "Aktuelles Passwort ist falsch.",
        "opsta": "Passwort konnte nicht geändert werden."
      }
    },
```

- [ ] **Step 3: Provjeri JSON**

Run: `node -e "['sr','en','de'].forEach(l=>{if(!require('./messages/'+l+'.json').postavke.mojNalog.dugme)throw new Error(l)});console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: `MojNalogForm.tsx` (client)**

Kreiraj `components/domain/MojNalogForm.tsx`:
```tsx
"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { promijeniLozinku } from "@/app/(dashboard)/postavke/actions"

export function MojNalogForm() {
  const t = useTranslations("postavke.mojNalog")
  const [pending, start] = useTransition()
  const [trenutna, setTrenutna] = useState("")
  const [nova, setNova] = useState("")
  const [potvrda, setPotvrda] = useState("")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await promijeniLozinku(trenutna, nova, potvrda)
      if (r.ok) {
        toast.success(t("uspjeh"))
        setTrenutna(""); setNova(""); setPotvrda("")
      } else {
        toast.error(r.message ?? t("greske.opsta"))
      }
    })
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-3" data-testid="moj-nalog-form">
      <label className="block space-y-1">
        <span className="text-sm text-slate-600">{t("trenutna")}</span>
        <Input type="password" autoComplete="current-password" required value={trenutna}
          onChange={(e) => setTrenutna(e.target.value)} data-testid="loz-trenutna" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-slate-600">{t("nova")}</span>
        <Input type="password" autoComplete="new-password" required value={nova}
          onChange={(e) => setNova(e.target.value)} data-testid="loz-nova" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-slate-600">{t("potvrda")}</span>
        <Input type="password" autoComplete="new-password" required value={potvrda}
          onChange={(e) => setPotvrda(e.target.value)} data-testid="loz-potvrda" />
      </label>
      <Button type="submit" disabled={pending} data-testid="loz-submit">
        {pending ? t("uToku") : t("dugme")}
      </Button>
    </form>
  )
}
```

- [ ] **Step 5: `MojNalogSekcija.tsx` (server)**

Kreiraj `components/domain/MojNalogSekcija.tsx`:
```tsx
import { getTranslations } from "next-intl/server"
import { CollapsibleSection } from "./CollapsibleSection"
import { MojNalogForm } from "./MojNalogForm"

export async function MojNalogSekcija() {
  const t = await getTranslations("postavke.mojNalog")
  return (
    <CollapsibleSection title={t("naslov")} description={t("opis")}>
      <MojNalogForm />
    </CollapsibleSection>
  )
}
```

- [ ] **Step 6: Ukey u Postavke stranicu (svi, prije admin-sekcija)**

U `app/(dashboard)/postavke/page.tsx`: dodaj import `import { MojNalogSekcija } from "@/components/domain/MojNalogSekcija"` i renderuj ga ODMAH nakon `<h1>…</h1>`, **izvan** `jeAdminKor` uslova:
```tsx
      <h1 className="text-2xl font-semibold">{t("naslov")}</h1>

      <MojNalogSekcija />

      {jeAdminKor && (
```

- [ ] **Step 7: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: EXIT 0.

- [ ] **Step 8: Commit**

```bash
git add components/domain/MojNalogForm.tsx components/domain/MojNalogSekcija.tsx "app/(dashboard)/postavke/page.tsx" messages/sr.json messages/en.json messages/de.json
git commit -m "feat(postavke): Moj nalog — promjena lozinke (sve uloge)"
```

---

## Task 4: A2 UI — „Pošalji reset" u `KorisnikAkcije` + i18n

**Files:**
- Modify: `components/domain/KorisnikAkcije.tsx`, `components/domain/KorisniciTabela.tsx`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `posaljiResetKorisniku` (Task 2).

- [ ] **Step 1: i18n ključevi (sva 3 jezika) u `postavke.korisnikAkcije`**

Dodaj u `postavke.korisnikAkcije` (uz postojeće `testEmail` itd.):
- sr: `"posaljiReset": "Pošalji reset lozinke"`, `"resetPoslat": "Reset link poslat na {email}"`, `"resetGreska": "Slanje reseta nije uspjelo."`
- en: `"posaljiReset": "Send password reset"`, `"resetPoslat": "Reset link sent to {email}"`, `"resetGreska": "Failed to send reset."`
- de: `"posaljiReset": "Passwort-Reset senden"`, `"resetPoslat": "Reset-Link an {email} gesendet"`, `"resetGreska": "Reset konnte nicht gesendet werden."`

- [ ] **Step 2: `KorisnikAkcije` — dodaj `email` prop + „Pošalji reset" stavku**

U `components/domain/KorisnikAkcije.tsx`:
(a) dodaj `KeyRound` u lucide import: `import { MoreHorizontal, Send, UserX, UserCheck, KeyRound } from "lucide-react"`.
(b) dodaj `posaljiResetKorisniku` u import iz actions: `import { posaljiTestniEmail, postaviAktivan, posaljiResetKorisniku } from "@/app/(dashboard)/postavke/actions"`.
(c) proširi props: dodaj `email: string`:
```tsx
export function KorisnikAkcije({ korisnikId, email, aktivan, jeJa }: { korisnikId: string; email: string; aktivan: boolean; jeJa: boolean }) {
```
(d) dodaj handler (uz `testEmail`/`toggleAktivan`):
```tsx
  function posaljiReset() {
    start(async () => {
      const r = await posaljiResetKorisniku(email)
      if (r.ok) toast.success(t("resetPoslat", { email }))
      else toast.error(r.message ?? t("resetGreska"))
    })
  }
```
(e) dodaj stavku u `DropdownMenuContent` (poslije `test-email` stavke):
```tsx
        <DropdownMenuItem onClick={posaljiReset} data-testid={`posalji-reset-${korisnikId}`}>
          <KeyRound /> {t("posaljiReset")}
        </DropdownMenuItem>
```

- [ ] **Step 3: `KorisniciTabela` — proslijedi `email`**

U `components/domain/KorisniciTabela.tsx`, na mjestu gdje se renderuje `<KorisnikAkcije korisnikId={k.id} aktivan={k.aktivan} jeJa={jeJa} />`, dodaj `email={k.email}`:
```tsx
                    <KorisnikAkcije korisnikId={k.id} email={k.email} aktivan={k.aktivan} jeJa={jeJa} />
```

- [ ] **Step 4: JSON + typecheck + lint + build**

Run: `node -e "['sr','en','de'].forEach(l=>{if(!require('./messages/'+l+'.json').postavke.korisnikAkcije.posaljiReset)throw new Error(l)});console.log('ok')"`
Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: `ok` pa EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add components/domain/KorisnikAkcije.tsx components/domain/KorisniciTabela.tsx messages/sr.json messages/en.json messages/de.json
git commit -m "feat(postavke): admin Posalji reset lozinke po korisniku"
```

---

## Task 5: E2E — `25-nalozi-lozinke.spec.ts` (+ db helper)

**Files:**
- Modify: `tests/e2e/db.ts` (dodaj `deleteKorisnikByEmail`)
- Create: `tests/e2e/25-nalozi-lozinke.spec.ts`

**Interfaces:**
- Consumes: `data-testid` kuke iz Task 3/4 (`moj-nalog-form`, `loz-trenutna/nova/potvrda/submit`, `posalji-reset-<id>`, `akcije-<id>`); `injectSessionFor`, `ensureOperater`, `korisnici-pretraga`.

- [ ] **Step 1: db helper `deleteKorisnikByEmail`**

U `tests/e2e/db.ts` dodaj:
```ts
/** Obriši auth korisnika + korisnici red po emailu (čišćenje throwaway naloga). */
export async function deleteKorisnikByEmail(email: string): Promise<void> {
  const { data: list } = await db.auth.admin.listUsers()
  const u = list?.users.find((x) => x.email?.toLowerCase() === email.toLowerCase())
  if (!u) return
  await db.from("korisnici").delete().eq("id", u.id)
  await db.auth.admin.deleteUser(u.id)
}
```

- [ ] **Step 2: Spec**

Kreiraj `tests/e2e/25-nalozi-lozinke.spec.ts`:
```ts
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import { ensureOperater, deleteKorisnikByEmail } from "./db"

// A1: prijavljen korisnik mijenja svoju lozinku (traži trenutnu). A2: admin "Pošalji reset".
// Throwaway operater sa JEDINSTVENIM emailom + brisanje u finally — da izmijenjena lozinka
// ne ostane i ne razbije auth drugih testova (NE koristiti fiksni test-nalog).
test.describe("Nalozi i lozinke", () => {
  test("A1: promjena lozinke — pogrešna trenutna → greška; tačna → uspjeh", async ({ page, context }) => {
    const email = `e2e-loz-${Date.now()}@example.com`
    const staraLoz = "StaraLoz1!"
    await ensureOperater(email, staraLoz, "E2E Lozinka Op")
    try {
      await injectSessionFor(context, email, staraLoz)
      await page.goto("/postavke")
      await expect(page.getByTestId("moj-nalog-form")).toBeVisible({ timeout: 30_000 })

      // pogrešna trenutna → greška (toast)
      await page.getByTestId("loz-trenutna").fill("PogresnaLoz9!")
      await page.getByTestId("loz-nova").fill("NovaLoz123!")
      await page.getByTestId("loz-potvrda").fill("NovaLoz123!")
      await page.getByTestId("loz-submit").click()
      await expect(page.getByText("Trenutna lozinka nije tačna.")).toBeVisible({ timeout: 15_000 })

      // tačna trenutna → uspjeh
      await page.getByTestId("loz-trenutna").fill(staraLoz)
      await page.getByTestId("loz-nova").fill("NovaLoz123!")
      await page.getByTestId("loz-potvrda").fill("NovaLoz123!")
      await page.getByTestId("loz-submit").click()
      await expect(page.getByText("Lozinka je promijenjena.")).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteKorisnikByEmail(email)
    }
  })

  test("A2: admin Pošalji reset za korisnika → success toast", async ({ page }) => {
    const email = `e2e-reset-${Date.now()}@example.com`
    await ensureOperater(email, "StaraLoz1!", "E2E Reset Op")
    try {
      // admin (default storageState) → Postavke → Korisnici
      await page.goto("/postavke")
      await page.getByRole("button", { name: "Korisnici" }).click()
      await page.getByTestId("korisnici-pretraga").fill("E2E Reset Op")
      // otvori akcije reda pa klikni Pošalji reset
      const red = page.locator('[data-testid^="akcije-"]').first()
      await red.click()
      await page.locator('[data-testid^="posalji-reset-"]').first().click()
      await expect(page.getByText(new RegExp(`Reset link poslat na ${email}`))).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteKorisnikByEmail(email)
    }
  })
})
```
> **Napomena za izvršioca:** provjeri stvarni testid/naziv za otvaranje „Korisnici" collapsible i pretragu (`korisnici-pretraga` je viđen u 23-specu). Ako je otvaranje sekcije drugačije (npr. `getByRole("button", { name: "Korisnici" })` ne pogađa), uskladi sa `KorisniciTab`/`CollapsibleSection`. Ako `korisnici-pretraga` filtrira po imenu, „E2E Reset Op" mora dati taj jedan red.

- [ ] **Step 3: Pokreni e2e (chromium, workers=1) na DEMO**

```bash
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null
pnpm exec playwright test tests/e2e/25-nalozi-lozinke.spec.ts --project=chromium --workers=1
```
Expected: 2 passed (+ setup). Ako A2 selektor ne pogađa red — uskladi po napomeni, ne mijenjaj asercije toasta.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/db.ts tests/e2e/25-nalozi-lozinke.spec.ts
git commit -m "test(e2e): promjena lozinke + admin posalji reset"
```

---

## Self-Review (autor plana)

- **Spec coverage:** A1 helper (T1) + akcija (T2) + UI/i18n (T3); A2 akcija (T2) + UI/i18n (T4); e2e (T5). ✔
- **Placeholder scan:** pun kod svuda; nema TBD. ✔
- **Type consistency:** `promijeniLozinku(trenutna,nova,potvrda)` i `posaljiResetKorisniku(email)` isti u T2 (def) i T3/T4 (poziv); `validirajNovuLozinku` razlozi `"min"|"nePoklapaju"` isti u T1 i T2; `email` prop u KorisnikAkcije (T4). ✔
- **Rizici:** `t` namespace u postavke/actions.ts (napomena u T2); e2e selektor „Korisnici"/pretraga (napomena u T5); throwaway nalog + brisanje u finally.
