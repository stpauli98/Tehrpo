# Asistent — Unapređenje Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Otvrdni pristup posmatrača, ojačaj sigurnost/robusnost razgovora, popravi kvalitet odgovora (datumi + render) i UI/UX Asistent taba — bez zamjene modela.

**Architecture:** Streaming NDJSON ruta (`app/api/chat/route.ts`) dobija eksplicitni role-guard, rate-limit i server-side rekonstrukciju historije (prestaje vjerovati klijentu). Alat `searchTermini` dobija datumske filtere, a sistem prompt dinamički današnji datum (dodano na call-time da `SISTEM_PROMPT` const ostane byte-identičan). UI renderuje markdown i prikazuje ljudske labele alata.

**Tech Stack:** Next.js 16.2 (App Router), React 19.2, `@anthropic-ai/sdk` 0.105 (model `claude-sonnet-4-6`), Supabase SSR (RLS), zod 4, next-intl, Playwright + Vitest. Nove zavisnosti: `react-markdown`, `remark-gfm`.

## Global Constraints

- **Model se NE mijenja:** `claude-sonnet-4-6` ostaje u `lib/claude/chat.ts` i `lib/zapisnik/generate.ts` (sinhronizovan par). Ne dirati.
- **`SISTEM_PROMPT` const mora ostati byte-identičan** — `lib/claude/prompts.test.ts` to tvrdi i i18n disciplina zahtijeva. Datum se dodaje na call-time, ne u const.
- **Prije uređivanja `lib/claude/*.ts` (Anthropic kod) učitati `claude-api` skill** (pravilo iz CLAUDE.md).
- **Data-klijent po kontekstu:** ruta i akcije koriste SSR klijent (`createServerSupabaseClient`, RLS kao prijavljeni korisnik). Nikad admin/service-role u `app/` putu.
- **i18n paritet:** svaki novi ključ ide u `messages/{sr,en,de}.json` istovremeno; bez ICU `one` kategorije za sr. next-intl tsc provjerava ključeve — nedostajući ključ je tvrda greška.
- **Tailwind:** bez `sm:`/`md:` breakpointa (lint pravilo); desktop-only.
- **Testiranje backend-a kroz Docker** (pravilo korisnika). E2E na **DEMO** bazi, `--workers=1`.
- **Grana/worktree:** radi u `.claude/worktrees/asistent` (grana `feat/asistent-unapredjenja`). Ne raditi u `izolovana-sesija` (tamo je izvoz PR #39).
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Verifikacija RLS-a posmatrača na cloud-u (read-only, bez commita)

**Cilj:** Potvrditi da su RLS politike iz migracije `20260711120000` (`chat_sel`, `chat_ins` sa `not je_pregled()`) žive na **DEMO i PROD**. Ovo je read-only provjera; ne mijenja kod. **Pokrenuti u glavnoj sesiji** (dodiruje PROD kredencijale, ne u sandboxovanom subagentu).

**Files:**
- Create (privremeno, u scratchpad-u — NE commitovati): `verify-chat-rls.ts`

**Interfaces:** nema (ops-provjera).

- [ ] **Step 1: Napiši verifikacijski skript u scratchpad**

Snimi u scratchpad (npr. `<scratchpad>/verify-chat-rls.ts`):

```ts
import { Client } from "pg"

const refs = [
  { name: "PROD", url: process.env.DATABASE_URL },
  { name: "DEMO", url: process.env.DATABASE_URL_DEMO },
]

for (const { name, url } of refs) {
  if (!url) { console.log(`\n=== ${name}: NEMA URL ===`); continue }
  const c = new Client({ connectionString: url })
  // eslint-disable-next-line no-await-in-loop -- ops skript, sekvencijalno je ok
  await c.connect()
  // eslint-disable-next-line no-await-in-loop
  const { rows } = await c.query(
    `select policyname, cmd, qual, with_check
       from pg_policies
      where tablename = 'chat_poruke'
      order by policyname`,
  )
  console.log(`\n=== ${name} chat_poruke politike ===`)
  console.table(rows)
  // eslint-disable-next-line no-await-in-loop
  await c.end()
}
```

- [ ] **Step 2: Pokreni provjeru (oba refa)**

Run (iz repo root-a; DEMO-first precedence nije bitna jer čitamo obje eksplicitno):
```bash
pnpm exec tsx --env-file=.env.local --env-file=.env.development.local <scratchpad>/verify-chat-rls.ts
```
Expected: dva bloka (PROD, DEMO). **Svaki mora imati:**
- `chat_sel` — `cmd=SELECT`, `qual` sadrži `(korisnik_id = auth.uid())`
- `chat_ins` — `cmd=INSERT`, `with_check` sadrži `(korisnik_id = auth.uid()) AND (NOT je_pregled())`

**Ako neki ref umjesto toga pokazuje staru `chat_all` politiku ili nema `chat_ins`:** migracija nije primijenjena na tom refu. **Ne primjenjuj sam** — prijavi korisniku da pokrene (lockstep DEMO↔PROD, ref-guard za DEMO):
```bash
pnpm db:apply-cloud supabase/migrations/20260711120000_chat_poruke_vlasnik_scope.sql
```

- [ ] **Step 3: Očisti scratchpad skript**

```bash
rm <scratchpad>/verify-chat-rls.ts
```

Nema commita u ovom tasku. Zabilježi nalaz (oba refa OK / koji treba apply) za finalni izvještaj.

---

### Task 2: Eksplicitni role-guard na `/api/chat` (401/403) + i18n + E2E posmatrača

**Cilj:** Čist 401 (neprijavljen) / 403 (pregled) umjesto trenutnog 500-iz-RLS. Defense-in-depth povrh redirecta i RLS-a.

**Files:**
- Modify: `app/api/chat/route.ts`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json` (ključevi `asistent.api.neovlasten`, `asistent.api.zabranjeno`)
- Create: `tests/e2e/19-asistent-pregled.spec.ts`

**Interfaces:**
- Consumes: `getTrenutniKorisnik(): Promise<{ id: string; ime: string; uloga: "admin"|"operater"|"pregled" } | null>` iz `@/lib/auth/current-user`.
- Consumes (E2E): `ensureKorisnik(email, lozinka, ime, uloga)`, `deleteKorisnikByEmail(email)` iz `./db`; `injectSessionFor(context, email, lozinka)` iz `./session-helper`.
- Produces: ruta vraća 401/403 prije bilo kakvog upisa.

- [ ] **Step 1: Napiši E2E test (failing)**

Create `tests/e2e/19-asistent-pregled.spec.ts`:

```ts
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import { ensureKorisnik, deleteKorisnikByEmail } from "./db"

const PREGLED_EMAIL = "e2e-pregled@tehpro.test"
const PREGLED_LOZINKA = "E2ePregled2026!"
const PREGLED_IME = "E2E Pregled"

// Svaki test kreira svoj kontekst (bez admin storageState).
test.use({ storageState: { cookies: [], origins: [] } })

test.describe("Asistent — pregled (read-only) nema pristup", () => {
  test.beforeAll(async () => {
    await ensureKorisnik(PREGLED_EMAIL, PREGLED_LOZINKA, PREGLED_IME, "pregled")
  })
  test.afterAll(async () => {
    await deleteKorisnikByEmail(PREGLED_EMAIL).catch(() => {})
  })

  test("pregled GET /asistent → redirect na /pregled", async ({ page, context }) => {
    await injectSessionFor(context, PREGLED_EMAIL, PREGLED_LOZINKA)
    await page.goto("/asistent")
    await expect(page).toHaveURL(/\/pregled/, { timeout: 30_000 })
  })

  test("pregled POST /api/chat → 403", async ({ context }) => {
    await injectSessionFor(context, PREGLED_EMAIL, PREGLED_LOZINKA)
    const res = await context.request.post("/api/chat", {
      data: { konverzacija_id: "00000000-0000-0000-0000-000000000001", userText: "test" },
    })
    expect(res.status()).toBe(403)
  })
})
```

- [ ] **Step 2: Pokreni test — potvrdi da 403 dio pada**

Run:
```bash
pnpm exec playwright test tests/e2e/19-asistent-pregled.spec.ts -g "403" --project=chromium
```
Expected: FAIL — trenutno ruta vrati **500** (RLS blokira insert), ne 403. (Redirect test već prolazi — `page.tsx:24` redirectuje pregled.)

- [ ] **Step 3: Dodaj i18n ključeve (sr/en/de)**

U `messages/sr.json`, u `asistent.api` bloku, dodaj dva ključa (poslije `"bezTeksta"`):
```json
      "bezTeksta": "(bez teksta)",
      "neovlasten": "Niste prijavljeni",
      "zabranjeno": "Nemate pristup asistentu"
```
U `messages/en.json` `asistent.api`:
```json
      "bezTeksta": "(no text)",
      "neovlasten": "Not signed in",
      "zabranjeno": "You do not have access to the assistant"
```
U `messages/de.json` `asistent.api`:
```json
      "bezTeksta": "(kein Text)",
      "neovlasten": "Nicht angemeldet",
      "zabranjeno": "Kein Zugriff auf den Assistenten"
```

- [ ] **Step 4: Dodaj guard u rutu**

U `app/api/chat/route.ts`, dodaj import uz postojeće:
```ts
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
```
Na sam početak `POST` funkcije (prije `bodySchema.parse`):
```ts
export async function POST(req: Request): Promise<Response> {
  const korisnik = await getTrenutniKorisnik()
  if (!korisnik) {
    return new Response(JSON.stringify({ error: t("neovlasten") }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (korisnik.uloga === "pregled") {
    return new Response(JSON.stringify({ error: t("zabranjeno") }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }

  let parsed: z.infer<typeof bodySchema>
  // …ostatak nepromijenjen
```

- [ ] **Step 5: Typecheck + E2E prolaze**

Run:
```bash
pnpm typecheck
pnpm exec playwright test tests/e2e/19-asistent-pregled.spec.ts --project=chromium
```
Expected: `tsc` bez grešaka; oba testa PASS (redirect + 403).

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/route.ts messages/sr.json messages/en.json messages/de.json tests/e2e/19-asistent-pregled.spec.ts
git commit -m "$(printf 'feat(asistent): eksplicitni 401/403 guard na /api/chat za pregled\n\nDefense-in-depth povrh RLS-a i redirecta; posmatrac dobija cist 403.\nE2E: pregled redirect + POST /api/chat -> 403.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Rate-limit + server-side rekonstrukcija historije + i18n

**Cilj:** Spriječiti zloupotrebu Anthropic API-ja (20/min, 400/dan po korisniku) i prestati vjerovati klijentskoj `history` (rekonstrukcija iz baze, scope po vlasniku).

**Files:**
- Create: `lib/claude/rate-limit.ts`, `lib/claude/rate-limit.test.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `components/domain/AsistentChat.tsx`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json` (ključ `asistent.api.previseZahtjeva`)

**Interfaces:**
- Produces: `RATE_LIMIT_PER_MIN: number`, `RATE_LIMIT_PER_DAY: number`, `rateLimitWindows(nowMs: number): { minuteAgo: string; dayAgo: string }`, `prekoracenLimit(perMin: number, perDay: number): boolean`.
- Consumes: `ChatTurn = { role: "user"|"assistant"; text: string }` iz `@/lib/claude/chat` (već postoji).

- [ ] **Step 1: Napiši failing unit test za rate-limit**

Create `lib/claude/rate-limit.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import {
  rateLimitWindows,
  prekoracenLimit,
  RATE_LIMIT_PER_MIN,
  RATE_LIMIT_PER_DAY,
} from "./rate-limit"

describe("rate-limit prozori", () => {
  it("minuteAgo = -60s, dayAgo = -24h od nowMs", () => {
    const now = Date.parse("2026-07-12T12:00:00.000Z")
    const { minuteAgo, dayAgo } = rateLimitWindows(now)
    expect(minuteAgo).toBe("2026-07-12T11:59:00.000Z")
    expect(dayAgo).toBe("2026-07-11T12:00:00.000Z")
  })
})

describe("prekoracenLimit", () => {
  it("ispod oba limita → false", () => {
    expect(prekoracenLimit(RATE_LIMIT_PER_MIN - 1, RATE_LIMIT_PER_DAY - 1)).toBe(false)
  })
  it("na/iznad minutnog → true", () => {
    expect(prekoracenLimit(RATE_LIMIT_PER_MIN, 0)).toBe(true)
  })
  it("na/iznad dnevnog → true", () => {
    expect(prekoracenLimit(0, RATE_LIMIT_PER_DAY)).toBe(true)
  })
})
```

- [ ] **Step 2: Pokreni test — potvrdi FAIL**

Run:
```bash
pnpm vitest run lib/claude/rate-limit.test.ts
```
Expected: FAIL — `Cannot find module './rate-limit'`.

- [ ] **Step 3: Implementiraj `lib/claude/rate-limit.ts`**

Create:
```ts
// Rate-limit za AI chat: sliding-window nad vlastitim user porukama (chat_poruke).
// Bez nove infrastrukture — brojanje ide kroz SSR/RLS klijent u ruti.
export const RATE_LIMIT_PER_MIN = 20
export const RATE_LIMIT_PER_DAY = 400

/** ISO pragovi za brojanje: poruke novije od (now - 60s) i (now - 24h). */
export function rateLimitWindows(nowMs: number): { minuteAgo: string; dayAgo: string } {
  return {
    minuteAgo: new Date(nowMs - 60_000).toISOString(),
    dayAgo: new Date(nowMs - 86_400_000).toISOString(),
  }
}

/** Prekoračen limit ako je broj poruka u minutnom ili dnevnom prozoru dostigao prag. */
export function prekoracenLimit(perMin: number, perDay: number): boolean {
  return perMin >= RATE_LIMIT_PER_MIN || perDay >= RATE_LIMIT_PER_DAY
}
```

- [ ] **Step 4: Pokreni test — PASS**

Run:
```bash
pnpm vitest run lib/claude/rate-limit.test.ts
```
Expected: PASS (4 testa).

- [ ] **Step 5: Dodaj i18n `previseZahtjeva` (sr/en/de)**

`messages/sr.json` `asistent.api` (poslije `"zabranjeno"`):
```json
      "zabranjeno": "Nemate pristup asistentu",
      "previseZahtjeva": "Previše zahtjeva — sačekaj trenutak pa pokušaj ponovo."
```
`messages/en.json`:
```json
      "zabranjeno": "You do not have access to the assistant",
      "previseZahtjeva": "Too many requests — wait a moment and try again."
```
`messages/de.json`:
```json
      "zabranjeno": "Kein Zugriff auf den Assistenten",
      "previseZahtjeva": "Zu viele Anfragen — bitte warte einen Moment und versuche es erneut."
```

- [ ] **Step 6: Izmijeni rutu — schema, rate-limit, server-side historija**

U `app/api/chat/route.ts`:

(a) Dodaj import:
```ts
import { rateLimitWindows, prekoracenLimit } from "@/lib/claude/rate-limit"
```

(b) Skini `history` iz `bodySchema`:
```ts
const bodySchema = z.object({
  konverzacija_id: z.string().uuid(),
  userText: z.string().min(1).max(4000),
})
```

(c) Zamijeni `const { konverzacija_id, userText, history } = parsed` sa:
```ts
  const { konverzacija_id, userText } = parsed
```

(d) Odmah nakon `const supabase = await createServerSupabaseClient()` (a **prije** upisa user poruke) ubaci rate-limit + historiju:
```ts
  // Rate-limit: sliding-window nad vlastitim user porukama (prije upisa nove).
  const { minuteAgo, dayAgo } = rateLimitWindows(Date.now())
  const [minRes, dayRes] = await Promise.all([
    supabase.from("chat_poruke").select("id", { count: "exact", head: true })
      .eq("korisnik_id", korisnik.id).eq("uloga", "user").gte("created_at", minuteAgo),
    supabase.from("chat_poruke").select("id", { count: "exact", head: true })
      .eq("korisnik_id", korisnik.id).eq("uloga", "user").gte("created_at", dayAgo),
  ])
  if (prekoracenLimit(minRes.count ?? 0, dayRes.count ?? 0)) {
    return new Response(JSON.stringify({ error: t("previseZahtjeva") }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    })
  }

  // Historija se rekonstruiše sa servera (ne vjeruje se klijentu): posljednjih 40
  // poruka ovog razgovora u vlasništvu korisnika, obrnuto u ascending za model.
  const { data: priorRows } = await supabase
    .from("chat_poruke")
    .select("uloga, sadrzaj")
    .eq("konverzacija_id", konverzacija_id)
    .eq("korisnik_id", korisnik.id)
    .order("created_at", { ascending: false })
    .limit(40)
  const history: ChatTurn[] = (priorRows ?? [])
    .reverse()
    .map((r) => ({ role: r.uloga === "assistant" ? "assistant" : "user", text: r.sadrzaj }))
```

(e) U poziv `runChat` skini cast (history je već `ChatTurn[]`):
```ts
        const { assistantText, toolsUsed } = await runChat(history, userText, send)
```

- [ ] **Step 7: Izmijeni klijent — prestani slati `history`**

U `components/domain/AsistentChat.tsx`, u funkciji `send`:

Obriši liniju:
```ts
    const history = poruke.map((p) => ({ role: p.role, text: p.text }))
```
Izmijeni `fetch` body (bez `history`):
```ts
        body: JSON.stringify({ konverzacija_id: konverzacijaId, userText }),
```

- [ ] **Step 8: Typecheck + unit + ciljani E2E**

Run:
```bash
pnpm typecheck
pnpm vitest run lib/claude/rate-limit.test.ts
pnpm exec playwright test tests/e2e/09-asistent.spec.ts --project=chromium
```
Expected: `tsc` čist; unit PASS; `09-asistent` (mock, follow-up u istom razgovoru) i dalje PASS — mock ignoriše historiju, a server je rekonstruiše iz baze.

- [ ] **Step 9: Commit**

```bash
git add lib/claude/rate-limit.ts lib/claude/rate-limit.test.ts app/api/chat/route.ts components/domain/AsistentChat.tsx messages/sr.json messages/en.json messages/de.json
git commit -m "$(printf 'feat(asistent): rate-limit (20/min,400/dan) + server-side historija\n\nRuta vise ne vjeruje klijentskoj history (rekonstrukcija iz baze, scope\npo vlasniku) i broji vlastite poruke u prozoru -> 429. Sprjecava injekciju\nlaznih assistant turnova i zloupotrebu Anthropic API-ja.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Datumski filteri u `searchTermini` + današnji datum u prompt

**Cilj:** Upiti tipa „šta dospijeva ovog mjeseca" rade — alat dobija `rok_od`/`rok_do`, a model dobija današnji datum. `SISTEM_PROMPT` const ostaje byte-identičan.

**Files:**
- Modify: `lib/claude/tools.ts`, `lib/claude/tools.test.ts`
- Modify: `lib/claude/prompts.ts`, `lib/claude/prompts.test.ts`
- Modify: `lib/claude/chat.ts`

**Interfaces:**
- Produces: `validIsoDatum(s: string): boolean` (iz `tools.ts`); `datumNapomena(danas: string, locale?: Locale): string` (iz `prompts.ts`).
- `CHAT_TOOLS[0]` (searchTermini) `input_schema.properties` dobija `rok_od`, `rok_do`.

> **Prije izmjena učitaj `claude-api` skill** (Anthropic kod). Model id se NE mijenja.

- [ ] **Step 1: Napiši failing unit testove**

Dodaj u `lib/claude/tools.test.ts` (uz postojeće; proširi import):
```ts
import { toolLabel, validIsoDatum, CHAT_TOOLS } from "./tools"
```
```ts
describe("validIsoDatum", () => {
  it("prihvata YYYY-MM-DD", () => {
    expect(validIsoDatum("2026-07-12")).toBe(true)
  })
  it("odbija druge formate i smeće", () => {
    expect(validIsoDatum("2026/07/12")).toBe(false)
    expect(validIsoDatum("12.07.2026")).toBe(false)
    expect(validIsoDatum("garbage")).toBe(false)
    expect(validIsoDatum("")).toBe(false)
  })
})

describe("searchTermini datumski parametri", () => {
  it("input_schema ima rok_od i rok_do", () => {
    const alat = CHAT_TOOLS.find((t) => t.name === "searchTermini")
    const props = alat?.input_schema.properties as Record<string, unknown>
    expect(props.rok_od).toBeDefined()
    expect(props.rok_do).toBeDefined()
  })
})
```
Dodaj u `lib/claude/prompts.test.ts` (proširi import + novi describe):
```ts
import { SISTEM_PROMPT, datumNapomena } from "./prompts"
```
```ts
describe("datumNapomena (call-time datum, ne dira SISTEM_PROMPT const)", () => {
  it("sr: 'Danas je <datum>.' sa vodećim praznim redovima", () => {
    expect(datumNapomena("2026-07-12", "sr")).toBe("\n\nDanas je 2026-07-12.")
  })
  it("en/de fraze", () => {
    expect(datumNapomena("2026-07-12", "en")).toBe("\n\nToday is 2026-07-12.")
    expect(datumNapomena("2026-07-12", "de")).toBe("\n\nHeute ist 2026-07-12.")
  })
  it("SISTEM_PROMPT const ostaje bez datuma (byte-identičan)", () => {
    expect(SISTEM_PROMPT).not.toContain("Danas je")
  })
})
```

- [ ] **Step 2: Pokreni — potvrdi FAIL**

Run:
```bash
pnpm vitest run lib/claude/tools.test.ts lib/claude/prompts.test.ts
```
Expected: FAIL — `validIsoDatum`/`datumNapomena` ne postoje; `rok_od` undefined.

- [ ] **Step 3: Implementiraj u `lib/claude/tools.ts`**

(a) Dodaj helper (npr. odmah iznad `const MAX = 20`):
```ts
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/
/** Validacija YYYY-MM-DD — sprječava ubacivanje proizvoljne vrijednosti u PostgREST filter. */
export function validIsoDatum(s: string): boolean {
  return ISO_DATUM.test(s)
}
```
(b) U `CHAT_TOOLS`, `searchTermini` `input_schema.properties`, dodaj (uz postojeće `pretraga`/`status`/`limit`):
```ts
        rok_od: { type: "string", description: "Donja granica roka dospijeća, uključivo, format YYYY-MM-DD (opcionalno)" },
        rok_do: { type: "string", description: "Gornja granica roka dospijeća, uključivo, format YYYY-MM-DD (opcionalno)" },
```
(c) U `searchTermini` `description`, dopuni rečenicom:
```
 Podržava i datumski raspon preko rok_od/rok_do (YYYY-MM-DD) nad rokom dospijeća.
```
(d) U `executeTool`, u `if (name === "searchTermini")` grani, poslije linije `if (typeof args.status === "string") q = q.eq("status_izvedeni", args.status)` dodaj:
```ts
    if (typeof args.rok_od === "string" && validIsoDatum(args.rok_od)) q = q.gte("rok_dospijeca", args.rok_od)
    if (typeof args.rok_do === "string" && validIsoDatum(args.rok_do)) q = q.lte("rok_dospijeca", args.rok_do)
```

- [ ] **Step 4: Implementiraj u `lib/claude/prompts.ts`**

Dodaj poslije `JEZIK_INSTRUKCIJA` mape (ostavi `SISTEM_PROMPT` const netaknut):
```ts
// Lokalizovana fraza za današnji datum. Dodaje se u sistem prompt na CALL-TIME (chat.ts),
// NE u SISTEM_PROMPT const — const mora ostati byte-identičan (vidi prompts.test.ts).
const DANAS_FRAZA: Record<Locale, string> = { sr: "Danas je", en: "Today is", de: "Heute ist" }

/** Napomena o današnjem datumu koja se dodaje na kraj sistem prompta u runtime-u. */
export function datumNapomena(danas: string, locale: Locale = APP_LOCALE): string {
  return `\n\n${DANAS_FRAZA[locale]} ${danas}.`
}
```

- [ ] **Step 5: Ubaci datum u prompt na call-time (`lib/claude/chat.ts`)**

Izmijeni import:
```ts
import { SISTEM_PROMPT, datumNapomena } from "./prompts"
```
U `client.messages.stream({...})`, zamijeni `system: SISTEM_PROMPT,` sa:
```ts
      system: SISTEM_PROMPT + datumNapomena(new Date().toISOString().slice(0, 10)),
```
Model ostaje `model: "claude-sonnet-4-6"` — ne dirati.

- [ ] **Step 6: Pokreni — sve zeleno**

Run:
```bash
pnpm vitest run lib/claude/tools.test.ts lib/claude/prompts.test.ts
pnpm typecheck
```
Expected: PASS (uključujući postojeće byte-identične `SISTEM_PROMPT` testove — const netaknut).

- [ ] **Step 7: Commit**

```bash
git add lib/claude/tools.ts lib/claude/tools.test.ts lib/claude/prompts.ts lib/claude/prompts.test.ts lib/claude/chat.ts
git commit -m "$(printf 'feat(asistent): datumski filteri (rok_od/rok_do) + danasnji datum u prompt\n\nsearchTermini dobija validirane YYYY-MM-DD granice nad rok_dospijeca; model\ndobija danasnji datum (call-time, SISTEM_PROMPT const ostaje byte-identican).\nModel nepromijenjen.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Markdown render + ljudske labele alata + aria-live

**Cilj:** Assistant poruke se renderuju kao markdown (bold/natuknice), indikator alata pokazuje ljudske labele, a chat log ima `aria-live`.

**Files:**
- Modify: `package.json` (+ `react-markdown`, `remark-gfm`)
- Modify: `components/domain/ChatMessage.tsx`
- Modify: `components/domain/AsistentChat.tsx`

**Interfaces:**
- Consumes: `ReactMarkdown` (default), `remarkGfm` (default).
- `UiPoruka.tools` semantika: sada drži **ljudske labele** (ne sirove nazive alata).

- [ ] **Step 1: Dodaj zavisnosti**

Run:
```bash
pnpm add react-markdown remark-gfm
```
Expected: `package.json` + `pnpm-lock.yaml` ažurirani; instalacija bez grešaka.

- [ ] **Step 2: Renderuj markdown u `ChatMessage.tsx`**

Dodaj importe na vrh:
```ts
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
```
U `ChatMessage`, zamijeni liniju:
```tsx
        <p className="whitespace-pre-wrap">{poruka.text || (isUser ? "" : "…")}</p>
```
sa:
```tsx
        {isUser ? (
          <p className="whitespace-pre-wrap">{poruka.text}</p>
        ) : poruka.text ? (
          <div className="space-y-2 leading-relaxed [&_a]:underline [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href ?? "#"} target="_blank" rel="noopener noreferrer">{children}</a>
                ),
              }}
            >
              {poruka.text}
            </ReactMarkdown>
          </div>
        ) : (
          <p>…</p>
        )}
```
> Sigurnost: `react-markdown` v9 po defaultu ne parsira raw HTML (nema `rehype-raw`) → nema XSS. User poruke ostaju plain (`whitespace-pre-wrap`).

- [ ] **Step 3: Spremi labelu (ne sirovi naziv) + aria-live u `AsistentChat.tsx`**

(a) U `setPoruke` reduceru, zamijeni:
```ts
            else if (ev.type === "tool") last.tools = [...last.tools, ev.tool]
```
sa:
```ts
            else if (ev.type === "tool") last.tools = [...last.tools, ev.label]
```
(b) Na kontejner poruka dodaj a11y atribute — zamijeni:
```tsx
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-2" data-testid="chat-poruke">
```
sa:
```tsx
      <div ref={scrollRef} role="log" aria-live="polite" aria-busy={busy} className="flex-1 space-y-3 overflow-y-auto p-2" data-testid="chat-poruke">
```

- [ ] **Step 4: Typecheck + lint + E2E asistent (mora ostati zelen)**

Run:
```bash
pnpm typecheck
pnpm lint
pnpm exec playwright test tests/e2e/09-asistent.spec.ts
```
Expected: čisto; `09-asistent` PASS na chromium+webkit — `tool-indikator` je i dalje vidljiv (sad sa labelom „Pretražujem termine…"), `msg-assistant` sadrži „pregled" (markdown render `<p>`), nema console grešaka.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml components/domain/ChatMessage.tsx components/domain/AsistentChat.tsx
git commit -m "$(printf 'feat(asistent): markdown render odgovora + ljudske labele alata + aria-live\n\nAssistant poruke kroz react-markdown (skipHtml default = bez XSS); indikator\nalata prikazuje labele umjesto sirovih naziva; chat log role=log aria-live.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Puni verifikacioni prolaz + PR

**Cilj:** Sve provjere zelene, pa PR.

**Files:** nema izmjena (osim eventualnih sitnih popravki koje iskrsnu).

- [ ] **Step 1: Kompletan lint/typecheck/unit**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm test:unit
```
Expected: sve PASS.

- [ ] **Step 2: Kompletan E2E (DEMO, oba browsera)**

Run:
```bash
pnpm test:e2e
```
Expected: cijeli set zelen (posebno `09-asistent` i `19-asistent-pregled`). Poslije očisti test junk:
```bash
pnpm cleanup:test-data
```

- [ ] **Step 3: Verifikuj uživo (verify skill / ručno)**

Pokreni app (`pnpm dev`), uđi kao operater/admin: pošalji „koji termini kasne ovog mjeseca?" → provjeri (a) datumski filter radi, (b) odgovor je uredno formatiran (bold/natuknice, ne sirove zvjezdice), (c) indikator alata pokazuje „Pretražujem termine…". Uđi kao pregled → nema „Asistent" u meniju; `/asistent` redirect; direktni POST daje 403.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/asistent-unapredjenja
gh pr create --base main --title "Asistent: sigurnost pristupa, rate-limit, datumi, markdown render" --body "$(printf 'Fokusirano unapredjenje Asistent taba (spec: docs/superpowers/specs/2026-07-12-asistent-unapredjenja-design.md).\n\n- WS1: eksplicitni 401/403 guard + verifikacija RLS-a posmatraca (DEMO+PROD)\n- WS2: server-side historija (bez povjerenja klijentu) + rate-limit 20/min,400/dan\n- WS3: datumski filteri (rok_od/rok_do) + danasnji datum u prompt (model nepromijenjen)\n- WS4: markdown render odgovora + ljudske labele alata + aria-live\n\nBez DB migracije (RLS migracija 20260711120000 vec u repou; cloud-apply po potrebi, lockstep).\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)')"
```

> Merge = production deploy na 3 Vercel projekta (lockstep) — **ne** mergovati bez izričite potvrde korisnika. Prijaviti nalaz Task 1 (da li cloud RLS treba apply).

---

## Odgođeno (svjesno van ovog plana)

- **Optimizacija `page.tsx` sidebar upita** (povlači cijelu `chat_poruke` tabelu): očuvanje tačne semantike „prva user poruka = naslov" uz ograničen upit je netrivijalno i nosi rizik regresije sidebar liste. YAGNI za interni desktop alat sa malo korisnika; zaseban task kad količina podataka to opravda.
- stop/kopiraj/regeneriši, brisanje/preimenovanje razgovora, AI-generisani naslovi, nadogradnja modela, keširanje, perzistencija labela alata na reload.

## Self-Review (autor plana)

- **Pokrivenost spec-a:** WS1 → Task 1 (verifikacija) + Task 2 (guard); WS2 → Task 3; WS3 → Task 4; WS4 → Task 5; i18n paritet → Task 2/3; testovi → svaki task + Task 6. ✔
- **Placeholder scan:** nema TBD/TODO; svaki kod-korak ima konkretan kod. ✔
- **Tipovi/nazivi konzistentni:** `rateLimitWindows`/`prekoracenLimit`/`RATE_LIMIT_*`, `validIsoDatum`, `datumNapomena`, `getTrenutniKorisnik().uloga` — isti kroz taskove i testove. `ChatTurn` iz `chat.ts`. ✔
- **Byte-identičan `SISTEM_PROMPT`:** očuvan (datum na call-time u `chat.ts`), postojeći prompts.test.ts prolazi. ✔
- **E2E regresija:** `09-asistent` provjere (tool-indikator vidljivost, „pregled" tekst, proposal, nema-console-grešaka) analizirane i očuvane pod svim izmjenama. ✔
