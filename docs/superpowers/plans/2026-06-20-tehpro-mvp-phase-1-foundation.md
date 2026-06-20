# Tehpro MVP — Faza 1: Temelji (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold Next.js 15 + TypeScript + Tailwind v4 + shadcn/ui projekat sa Supabase konekcijama, desktop-only gate-om, ESLint pravilima, Playwright setup-om, i prvim Vercel preview deploy-om. Faza ne uključuje domain logiku — samo temelje koji omogućavaju ostale faze.

**Architecture:** Server Components-first (React Server Components default), Server Actions za mutacije, `@supabase/supabase-js` SDK kao jedini DB driver. Sve mutacije kroz Server Actions. Three SDK helperi: `server.ts` (cookies-aware), `client.ts` (browser), `admin.ts` (service role, za scripts/cron).

**Tech Stack:** Next.js 15.x · React 19 · TypeScript 5.x · Tailwind v4 · shadcn/ui · `@supabase/supabase-js` 2.x · `@supabase/ssr` · Lucide React · Inter font · Playwright 1.x · pnpm · Vercel.

**Spec:** `docs/superpowers/specs/2026-06-20-tehpro-mvp-design.md`

---

## Per-faza strategija

Svaka faza ima svoj plan dokument: `YYYY-MM-DD-tehpro-mvp-phase-N-<naziv>.md`. Plan za sljedeću fazu se piše tek nakon što prethodna faza prođe sva 4 gate-a (build + lint + Playwright + fresh-agent). Ovo dozvoljava da učenja iz prethodne faze (DB šeme, UI paterni, AI ponašanje) informišu plan za sljedeću.

---

## Global Constraints

- **Node:** >= 20.x (Vercel default)
- **Package manager:** **pnpm** (ne npm/yarn). Lock fajl `pnpm-lock.yaml` u repo-u.
- **TypeScript:** strict mode, `noUncheckedIndexedAccess: true`
- **DB driver:** SAMO `@supabase/supabase-js` u runtime kodu. Direktan `pg`/`postgres`/Drizzle = zabranjen u app/ i lib/ folderima. Dozvoljen samo u `scripts/`.
- **Tailwind breakpoints:** SAMO `lg:`, `xl:`, `2xl:`. Korištenje `sm:`/`md:` = ESLint error.
- **Brand color:** `#2563eb` (blue-600). NE mijenjaj bez user approval-a.
- **Brand status colors:** `planirano: #3b82f6, zakazano: #06b6d4, izvrseno: #16a34a, kasni: #dc2626, otkazano: #64748b`.
- **Font:** Inter (preko `next/font`).
- **Region:** Vercel `fra1` (Frankfurt).
- **Repo:** https://github.com/stpauli98/Tehrpo (origin `main` = production branch).
- **Lokalna putanja:** `/Users/nmil/Desktop/Ai Forward/tehpro-mvp/`
- **N+1 prevention:** ESLint pravilo `no-await-in-loop` enable-ovan. Loop koji izvršava Supabase query po elementu = code review blocker.
- **Connection pooling:** Aplikativni kod koristi SDK (HTTP/PostgREST), bez direktne PG konekcije. Scripts koje idu direkt na PG koriste Supavisor transaction pooler (port 6543).

---

## File Structure (kreirano u ovoj fazi)

```
tehpro-mvp/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx                  # sidebar + topbar + desktop-only gate
│   │   ├── page.tsx                    # redirect → /termini placeholder
│   │   └── termini/page.tsx            # prazna stub page (Faza 3 puni)
│   ├── layout.tsx                      # root html, Inter font, providers
│   ├── globals.css                     # @import "tailwindcss" + @theme
│   └── not-found.tsx                   # 404
├── components/
│   ├── ui/                             # shadcn primitives (Button, Card, Sheet, ...)
│   └── shell/
│       ├── Sidebar.tsx                 # navigacija 6 tab-ova
│       ├── TopBar.tsx                  # logo + status
│       └── DesktopOnlyGate.tsx         # mobile blocker
├── lib/
│   ├── supabase/
│   │   ├── server.ts                   # createServerClient (cookies)
│   │   ├── client.ts                   # createBrowserClient
│   │   └── admin.ts                    # createClient sa service role
│   ├── env.ts                          # validated env vars (zod)
│   └── utils.ts                        # cn() helper za Tailwind
├── tests/
│   └── e2e/
│       ├── 01-smoke.spec.ts            # smoke + desktop gate
│       ├── fixtures.ts                 # Playwright fixtures
│       └── playwright.config.ts
├── public/                             # static assets
├── .env.local.example                  # template env vars
├── .env.local                          # gitignored
├── .gitignore
├── .eslintrc.json                      # rules
├── components.json                     # shadcn config
├── next.config.ts
├── package.json
├── pnpm-lock.yaml
├── postcss.config.mjs
├── tsconfig.json
├── playwright.config.ts
├── vercel.json                         # region + funkcije config
└── README.md                           # quick-start
```

---

## Task Map

| # | Task | Glavni deliverable | Verifikacija |
|---|---|---|---|
| 1 | Project scaffold | Next.js 15 + TS + pnpm + git | `pnpm dev` startuje na :3000 |
| 2 | Tailwind v4 + tokens + Inter font | Brand tokens validni, Inter učitan | Build prolazi, vizualno provjereno |
| 3 | shadcn/ui setup + base primitives | Button, Card, Sheet, Sonner instalirani | Import + render bez greške |
| 4 | Supabase project + SDK helpers | 3 SDK helpera, env varijable validirane | Test query iz server.ts radi |
| 5 | ESLint pravila (desktop-only, N+1) | `sm:`/`md:` fail-uje, `no-await-in-loop` enable | Test koji koristi `sm:` fail-uje lint |
| 6 | Dashboard layout + desktop-only gate | Sidebar + TopBar + gate komponenta | Resize browser na 1023px → gate vidljiv |
| 7 | Playwright setup + 01-smoke.spec.ts | Smoke test prolazi na Chromium + WebKit | `pnpm test:e2e` pass |
| 8 | Vercel link + preview deploy | Live preview URL | Curl vraća 200 na preview URL-u |

**Total: 8 tasks. Procijenjeno trajanje: 1 dan rad.**

---

## Task 1: Project scaffold (Next.js 15 + TypeScript + pnpm)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `README.md`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `next-env.d.ts`

**Interfaces:**
- Consumes: prazan repo sa `docs/` i `.git/`
- Produces: pokretač Next.js aplikacije na portu 3000

- [ ] **Step 1.1: Provjera radne lokacije i postojećih fajlova**

```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && ls -la
```

Expected output: vidiš `.git/` i `docs/`. Ako vidiš još neke fajlove, STOP i izvjesti.

- [ ] **Step 1.2: Provjera pnpm verzije**

```bash
pnpm --version
```

Expected: ≥ 9.x. Ako manje ili `command not found`, instaliraj: `corepack enable && corepack prepare pnpm@latest --activate`.

- [ ] **Step 1.3: Scaffold Next.js u trenutni direktorij**

```bash
pnpm create next-app@latest . \
  --typescript \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --no-tailwind \
  --no-turbopack \
  --use-pnpm
```

Notes:
- `--no-tailwind` jer instaliramo Tailwind v4 ručno u Task 2 (create-next-app može i dalje da default-uje na v3)
- `--no-src-dir` (sve direktno u `app/`, `components/`, `lib/`)
- `--no-turbopack` jer Playwright + Turbopack ima edge cases; vraćamo se na Webpack
- Ako te pita "remove existing files" — odgovori NE; scaffolder mora poštovati postojeći `.git/` i `docs/`

Expected: kreira `app/`, `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `README.md`, `next-env.d.ts`, instalira pnpm dependencies.

- [ ] **Step 1.4: Update `tsconfig.json` sa strict mode + noUncheckedIndexedAccess**

Edit `tsconfig.json`, dodaj/zamijeni u `compilerOptions`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

- [ ] **Step 1.5: Update `.gitignore` da uključuje sve potrebno**

Provjeri da `.gitignore` sadrži (dodaj ako fali):

```
.env
.env.local
.env.*.local
.next/
node_modules/
test-results/
playwright-report/
playwright/.cache/
*.tsbuildinfo
.vercel
```

- [ ] **Step 1.6: Update `package.json` scripts**

Zamijeni `scripts` blok sa:

```json
"scripts": {
  "dev": "next dev -p 3000",
  "build": "next build",
  "start": "next start -p 3000",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```

- [ ] **Step 1.7: Pokreni dev server i provjeri**

```bash
pnpm dev
```

Expected: `▲ Next.js 15.x.x  - Local: http://localhost:3000`. Otvori `http://localhost:3000` — vidiš default Next.js welcome page. Stop server (Ctrl+C).

- [ ] **Step 1.8: Commit**

```bash
git add . && git commit -m "feat(phase-1): scaffold Next.js 15 + TypeScript + pnpm

- create-next-app sa --no-tailwind (instaliramo v4 ručno u sljedećem task-u)
- strict TS config + noUncheckedIndexedAccess
- pnpm scripts za dev/build/lint/typecheck/test:e2e"
```

---

## Task 2: Tailwind v4 + brand tokens + Inter font

**Files:**
- Modify: `package.json` (deps), `app/layout.tsx`, `app/globals.css`
- Create: `postcss.config.mjs`

**Interfaces:**
- Consumes: scaffold iz Task 1
- Produces: globalne Tailwind klase + brand tokens dostupni svim komponentama, `font-sans` koristi Inter

- [ ] **Step 2.1: Instaliraj Tailwind v4**

```bash
pnpm add -D tailwindcss@latest @tailwindcss/postcss@latest postcss@latest
```

Verify in package.json that tailwindcss version is `^4.x.x`. Ako je vraćen v3, force-uj v4:

```bash
pnpm add -D tailwindcss@^4 @tailwindcss/postcss@^4
```

- [ ] **Step 2.2: Kreiraj `postcss.config.mjs`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

- [ ] **Step 2.3: Zamijeni `app/globals.css` Tailwind v4 + brand tokens**

```css
@import "tailwindcss";

@theme {
  --color-brand-DEFAULT: #2563eb;
  --color-brand-dark: #1e40af;
  --color-brand-light: #dbeafe;

  --color-status-planirano: #3b82f6;
  --color-status-zakazano: #06b6d4;
  --color-status-izvrseno: #16a34a;
  --color-status-kasni: #dc2626;
  --color-status-otkazano: #64748b;

  --font-family-sans: "Inter", system-ui, sans-serif;
}

@layer base {
  html, body {
    height: 100%;
  }
  body {
    font-family: var(--font-family-sans);
    color: #020617;
    background: #ffffff;
  }
}
```

- [ ] **Step 2.4: Update `app/layout.tsx` sa Inter font**

Zamijeni cijeli fajl sa:

```tsx
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Tehpro — Sistem za termine i provjere",
  description: "Praćenje periodičnih pregleda, ispitivanja i provjera za Tehpro tim.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="sr" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2.5: Update `app/page.tsx` da testira brand tokens vizualno**

```tsx
export default function Home() {
  return (
    <main className="min-h-screen p-12">
      <h1 className="text-3xl font-semibold text-brand">Tehpro</h1>
      <p className="mt-2 text-slate-600">
        Sistem za termine i provjere — temelji postavljeni.
      </p>
      <div className="mt-6 flex gap-2">
        <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-status-planirano">Planirano</span>
        <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-status-zakazano">Zakazano</span>
        <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-status-izvrseno">Izvršeno</span>
        <span className="px-3 py-1 rounded-full text-xs font-medium text-white bg-status-kasni">Kasni</span>
      </div>
    </main>
  )
}
```

- [ ] **Step 2.6: Pokreni dev i vizualno provjeri**

```bash
pnpm dev
```

Otvori http://localhost:3000 — vidi:
1. Naslov "Tehpro" u brand plavoj boji (#2563eb)
2. Font Inter (ne system default)
3. 4 status badge-a sa različitim bojama

Stop server.

- [ ] **Step 2.7: Verify build**

```bash
pnpm build
```

Expected: bez greške, generiše `.next/` build.

- [ ] **Step 2.8: Commit**

```bash
git add . && git commit -m "feat(phase-1): Tailwind v4 + brand tokens + Inter font

- @theme sa brand-{DEFAULT,dark,light} i status-* tokenima
- Inter font preko next/font, latin + latin-ext za bosanske/srpske karaktere
- demo page sa svim 4 status badge-a"
```

---

## Task 3: shadcn/ui setup + base primitives

**Files:**
- Create: `components.json`, `lib/utils.ts`
- Create: `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/sheet.tsx`, `components/ui/dialog.tsx`, `components/ui/input.tsx`, `components/ui/select.tsx`, `components/ui/dropdown-menu.tsx`, `components/ui/sonner.tsx`, `components/ui/tabs.tsx`, `components/ui/badge.tsx`

**Interfaces:**
- Consumes: Tailwind v4 iz Task 2
- Produces: shadcn primitives koje koriste sve domain komponente kasnijih faza

- [ ] **Step 3.1: Instaliraj shadcn CLI**

```bash
pnpm add -D shadcn@latest
```

- [ ] **Step 3.2: Init shadcn — kreiraj `components.json`**

```bash
pnpm dlx shadcn@latest init -y \
  --base-color slate \
  --css-variables
```

Expected: kreira `components.json`, update-uje `lib/utils.ts` sa `cn()` helper-om, dodaje `tailwind-merge` i `clsx` u dependencies.

Otvori `components.json` i provjeri:
- `"style": "default"` (ili `"new-york"`, oba OK)
- `"baseColor": "slate"`
- `"cssVariables": true`
- `"aliases.components": "@/components"`
- `"aliases.utils": "@/lib/utils"`

- [ ] **Step 3.3: Instaliraj base primitives**

```bash
pnpm dlx shadcn@latest add button card sheet dialog input select dropdown-menu sonner tabs badge
```

Expected: kreira `components/ui/{button,card,sheet,dialog,input,select,dropdown-menu,sonner,tabs,badge}.tsx`, instalira `@radix-ui/*`, `class-variance-authority`, `lucide-react`, `sonner`.

- [ ] **Step 3.4: Update `app/page.tsx` da koristi shadcn Button + Card**

```tsx
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default function Home() {
  return (
    <main className="min-h-screen p-12">
      <h1 className="text-3xl font-semibold text-brand">Tehpro</h1>
      <p className="mt-2 text-slate-600">
        Sistem za termine i provjere — temelji postavljeni.
      </p>

      <Card className="mt-6 max-w-md">
        <CardHeader>
          <CardTitle>shadcn/ui radi</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
        </CardContent>
      </Card>
    </main>
  )
}
```

- [ ] **Step 3.5: Pokreni dev i vizualno provjeri**

```bash
pnpm dev
```

Otvori http://localhost:3000 — vidi:
1. Card sa "shadcn/ui radi" naslovom
2. 3 dugmeta (primary/secondary/outline) sa različitim stilovima
3. Bez konsolnih grešaka u browser DevTools

Stop server.

- [ ] **Step 3.6: Verify build + lint**

```bash
pnpm build && pnpm lint && pnpm typecheck
```

Expected: sve tri komande prolaze bez greške.

- [ ] **Step 3.7: Commit**

```bash
git add . && git commit -m "feat(phase-1): shadcn/ui + base primitives

- shadcn init sa slate base + CSS vars + lib/utils.ts cn() helper
- primitives: button, card, sheet, dialog, input, select,
  dropdown-menu, sonner, tabs, badge
- demo page provjerava Button i Card render"
```

---

## Task 4: Supabase project + SDK helpers + env validation

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/admin.ts`
- Create: `lib/env.ts`
- Create: `.env.local.example`
- Modify: `package.json` (deps)
- Manually: kreirati Supabase projekat preko https://supabase.com/dashboard

**Interfaces:**
- Consumes: ništa
- Produces:
  - `createServerSupabaseClient(): SupabaseClient` — za RSC i Server Actions
  - `createBrowserSupabaseClient(): SupabaseClient` — za client components
  - `createAdminSupabaseClient(): SupabaseClient` — service role, samo za scripts/cron
  - `env: { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY }` — validirane env vars

- [ ] **Step 4.1: Kreiraj novi Supabase projekat (manualno)**

1. Idi na https://supabase.com/dashboard
2. New Project — naziv: `tehpro-mvp`, region: `Frankfurt (eu-central-1)`, DB password: generiši i SAČUVAJ
3. Sačekaj ~2 min da se projekat provizionira
4. Settings → API → kopiraj:
   - Project URL (npr. `https://abcd1234.supabase.co`)
   - `anon` `public` key
   - `service_role` `secret` key (NE smije nikad ići u client kod)

- [ ] **Step 4.2: Instaliraj Supabase SDK + zod**

```bash
pnpm add @supabase/supabase-js @supabase/ssr zod
```

- [ ] **Step 4.3: Kreiraj `.env.local.example`**

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Migrations / scripts only — Supavisor transaction pooler (port 6543)
DATABASE_URL=
```

- [ ] **Step 4.4: Kreiraj `.env.local` (gitignored) i popuni**

Kopiraj `.env.local.example` u `.env.local` i popuni stvarne vrijednosti iz Supabase dashboard-a.

Provjera: `cat .env.local` mora pokazati tvoje stvarne vrijednosti. `git status` NE smije pokazivati `.env.local` (mora biti u .gitignore).

- [ ] **Step 4.5: Kreiraj `lib/env.ts` sa zod validation**

```ts
import { z } from "zod"

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
})

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
})

if (!parsed.success) {
  console.error("❌ Invalid env vars:", parsed.error.flatten().fieldErrors)
  throw new Error("Invalid env vars — vidi .env.local.example")
}

export const env = parsed.data
```

- [ ] **Step 4.6: Kreiraj `lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { env } from "@/lib/env"

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component poziva — set se ignoriše (auth dolazi kasnije)
          }
        },
      },
    }
  )
}
```

- [ ] **Step 4.7: Kreiraj `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr"
import { env } from "@/lib/env"

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
```

- [ ] **Step 4.8: Kreiraj `lib/supabase/admin.ts`**

```ts
import { createClient } from "@supabase/supabase-js"
import { env } from "@/lib/env"

/**
 * Service role klijent — bypass-uje RLS.
 * SAMO za scripts/, cron handler-e. NIKAD u app/ ili components/.
 */
export function createAdminSupabaseClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nije postavljen")
  }
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

- [ ] **Step 4.9: Test konekcije — update `app/page.tsx` privremeno**

Dodaj test query u `app/page.tsx` koji proba da listira tabele iz `pg_catalog`:

```tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default async function Home() {
  const supabase = await createServerSupabaseClient()
  // jednostavan ping — Supabase auth check (radi i bez tabela)
  const { error } = await supabase.auth.getSession()
  const connected = !error

  return (
    <main className="min-h-screen p-12">
      <h1 className="text-3xl font-semibold text-brand">Tehpro</h1>
      <p className="mt-2 text-slate-600">
        Sistem za termine i provjere — temelji postavljeni.
      </p>

      <Card className="mt-6 max-w-md">
        <CardHeader>
          <CardTitle>
            Supabase: {connected ? "✓ konektovan" : "✗ greška"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {connected ? (
            <p className="text-sm text-slate-600">Server klijent radi.</p>
          ) : (
            <p className="text-sm text-status-kasni">Provjeri .env.local</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 max-w-md">
        <CardHeader>
          <CardTitle>shadcn/ui radi</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
        </CardContent>
      </Card>
    </main>
  )
}
```

- [ ] **Step 4.10: Pokreni dev i provjeri**

```bash
pnpm dev
```

Otvori http://localhost:3000 — vidi:
- "Supabase: ✓ konektovan"
- Bez greške u terminal-u Next.js dev server-a
- Bez greške u browser DevTools console

Ako vidiš "✗ greška": provjeri `.env.local` — URL i anon key moraju biti tačni.

Stop server.

- [ ] **Step 4.11: Verify build + lint + typecheck**

```bash
pnpm build && pnpm lint && pnpm typecheck
```

Expected: sve prolazi.

- [ ] **Step 4.12: Commit**

```bash
git add . && git commit -m "feat(phase-1): Supabase SDK + env validation

- lib/env.ts: zod validation env vars-a
- lib/supabase/server.ts: createServerSupabaseClient (cookies-aware)
- lib/supabase/client.ts: createBrowserSupabaseClient
- lib/supabase/admin.ts: createAdminSupabaseClient (service role)
- .env.local.example template
- demo home prikazuje status konekcije"
```

---

## Task 5: ESLint pravila — desktop-only + N+1 prevention

**Files:**
- Modify: `.eslintrc.json` (ili `eslint.config.mjs` ako Next.js 15 koristi flat config)

**Interfaces:**
- Consumes: scaffold iz Task 1 (Next.js već dodaje `eslint-config-next`)
- Produces: lint pravila koja blokiraju `sm:`/`md:` Tailwind klase i sequential await-in-loop patterne

- [ ] **Step 5.1: Provjeri koji ESLint config format Next.js 15 generiše**

```bash
ls -la | grep -i eslint
```

Možeš vidjeti `eslint.config.mjs` (flat config, Next.js 15+) ILI `.eslintrc.json` (legacy). Slijedeći koraci se prilagođavaju.

- [ ] **Step 5.2A: Ako postoji `eslint.config.mjs` (flat config)**

Zamijeni sadržaj sa:

```js
import { dirname } from "path"
import { fileURLToPath } from "url"
import { FlatCompat } from "@eslint/eslintrc"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "no-await-in-loop": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(?<![a-zA-Z])(sm|md):/]",
          message: "Tehpro je desktop-only. Koristi lg:/xl:/2xl: ili bez breakpoint-a.",
        },
        {
          selector: "TemplateElement[value.raw=/(?<![a-zA-Z])(sm|md):/]",
          message: "Tehpro je desktop-only. Koristi lg:/xl:/2xl: ili bez breakpoint-a.",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*"],
    rules: {
      "no-await-in-loop": "off",
    },
  },
]

export default eslintConfig
```

- [ ] **Step 5.2B: Ako postoji `.eslintrc.json` (legacy)**

Zamijeni sadržaj sa:

```json
{
  "extends": ["next/core-web-vitals", "next/typescript"],
  "rules": {
    "no-await-in-loop": "error",
    "no-restricted-syntax": [
      "error",
      {
        "selector": "Literal[value=/(?<![a-zA-Z])(sm|md):/]",
        "message": "Tehpro je desktop-only. Koristi lg:/xl:/2xl: ili bez breakpoint-a."
      },
      {
        "selector": "TemplateElement[value.raw=/(?<![a-zA-Z])(sm|md):/]",
        "message": "Tehpro je desktop-only. Koristi lg:/xl:/2xl: ili bez breakpoint-a."
      }
    ]
  },
  "overrides": [
    {
      "files": ["scripts/**/*"],
      "rules": { "no-await-in-loop": "off" }
    }
  ]
}
```

- [ ] **Step 5.3: Test pravilo — `sm:` mora fail-ovati**

Privremeno dodaj u `app/page.tsx` (u bilo koji div):

```tsx
<div className="sm:hidden">test</div>
```

Pokreni:

```bash
pnpm lint
```

Expected: ESLint error `"Tehpro je desktop-only. Koristi lg:/xl:/2xl: ili bez breakpoint-a."` na liniji sa `sm:hidden`.

Ako lint **ne fail-uje**: regex je netačan ili pravilo nije aktivirano — vrati se na Step 5.2 i provjeri.

- [ ] **Step 5.4: Ukloni test klasu**

Ukloni `<div className="sm:hidden">test</div>` iz `app/page.tsx`. Pokreni:

```bash
pnpm lint
```

Expected: pass.

- [ ] **Step 5.5: Test pravilo — `await in loop` mora fail-ovati**

Privremeno kreiraj `lib/test-lint.ts`:

```ts
import { createServerSupabaseClient } from "./supabase/server"

export async function badPattern(ids: string[]) {
  const supabase = await createServerSupabaseClient()
  const results = []
  for (const id of ids) {
    const { data } = await supabase.from("test").select("*").eq("id", id).single()
    results.push(data)
  }
  return results
}
```

Pokreni:

```bash
pnpm lint
```

Expected: error `no-await-in-loop`.

Obriši `lib/test-lint.ts`:

```bash
rm lib/test-lint.ts
```

Pokreni `pnpm lint` ponovo — sad mora pass.

- [ ] **Step 5.6: Commit**

```bash
git add . && git commit -m "feat(phase-1): ESLint pravila — desktop-only + N+1

- no-restricted-syntax blokira 'sm:'/'md:' Tailwind klase
- no-await-in-loop blokira sequential await pattern
- override za scripts/ (bulk operacije dozvoljene tamo)"
```

---

## Task 6: Dashboard layout + Sidebar + TopBar + DesktopOnlyGate

**Files:**
- Create: `app/(dashboard)/layout.tsx`, `app/(dashboard)/page.tsx`, `app/(dashboard)/termini/page.tsx`
- Create: `components/shell/Sidebar.tsx`, `components/shell/TopBar.tsx`, `components/shell/DesktopOnlyGate.tsx`
- Modify: `app/page.tsx` (redirect na /termini)
- Delete: stari `app/page.tsx` sadržaj (zamijenjen redirect-om)

**Interfaces:**
- Consumes: shadcn primitives (Task 3), brand tokens (Task 2)
- Produces:
  - `<DesktopOnlyGate />` — sakriva sadržaj ispod `lg:` breakpoint-a
  - `<Sidebar />` — fixed lijevi nav sa 6 stavki (Termini · Prikaz · Plan · Klijenti · Asistent · Pregled)
  - `<TopBar />` — sticky top header sa logo-om
  - `(dashboard)/layout.tsx` — wraps sve dashboard stranice

- [ ] **Step 6.1: Kreiraj `components/shell/DesktopOnlyGate.tsx`**

```tsx
import { Monitor } from "lucide-react"

export function DesktopOnlyGate() {
  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-white flex items-center justify-center p-8">
      <div className="max-w-sm text-center space-y-4">
        <Monitor className="w-16 h-16 mx-auto text-brand" aria-hidden />
        <h1 className="text-xl font-semibold">Tehpro je optimizovan za desktop</h1>
        <p className="text-slate-600 text-sm">
          Za rad sa sistemom otvorite aplikaciju na laptopu ili desktop
          računaru (ekran minimalno 1024px širine).
        </p>
        <p className="text-xs text-slate-400">
          Mobilna verzija nije u obimu ovog projekta.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 6.2: Kreiraj `components/shell/Sidebar.tsx`**

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ClipboardList,
  Grid3x3,
  Calendar,
  Users,
  Bot,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/termini",  label: "Termini",  icon: ClipboardList },
  { href: "/prikaz",   label: "Prikaz",   icon: Grid3x3 },
  { href: "/plan",     label: "Plan",     icon: Calendar },
  { href: "/klijenti", label: "Klijenti", icon: Users },
  { href: "/asistent", label: "Asistent", icon: Bot },
  { href: "/pregled",  label: "Pregled",  icon: FileText },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Glavna navigacija"
      className="w-56 shrink-0 border-r border-slate-200 bg-slate-50 p-3 flex flex-col gap-1"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
              active
                ? "bg-brand text-white"
                : "text-slate-700 hover:bg-slate-100"
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="w-4 h-4" aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 6.3: Kreiraj `components/shell/TopBar.tsx`**

```tsx
export function TopBar() {
  return (
    <header className="h-14 shrink-0 border-b border-slate-200 px-6 flex items-center justify-between bg-white">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded bg-brand text-white text-xs font-bold grid place-items-center">
          T
        </div>
        <span className="font-semibold">Tehpro</span>
        <span className="text-xs text-slate-400">Sistem za termine i provjere</span>
      </div>
      <div className="text-xs text-slate-400">v0.1 · MVP</div>
    </header>
  )
}
```

- [ ] **Step 6.4: Kreiraj `app/(dashboard)/layout.tsx`**

```tsx
import { Sidebar } from "@/components/shell/Sidebar"
import { TopBar } from "@/components/shell/TopBar"
import { DesktopOnlyGate } from "@/components/shell/DesktopOnlyGate"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <DesktopOnlyGate />
      <div className="hidden lg:flex flex-col h-screen">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 6.5: Kreiraj `app/(dashboard)/page.tsx` (redirect na /termini)**

```tsx
import { redirect } from "next/navigation"

export default function DashboardIndex() {
  redirect("/termini")
}
```

- [ ] **Step 6.6: Kreiraj `app/(dashboard)/termini/page.tsx` (stub)**

```tsx
export default function TerminiPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Termini</h1>
      <p className="mt-2 text-slate-600">Sadržaj se popunjava u Fazi 3.</p>
    </div>
  )
}
```

- [ ] **Step 6.7: Zamijeni `app/page.tsx` (root) sa redirect-om**

```tsx
import { redirect } from "next/navigation"

export default function RootPage() {
  redirect("/termini")
}
```

- [ ] **Step 6.8: Pokreni dev i vizualno provjeri desktop view**

```bash
pnpm dev
```

Otvori http://localhost:3000 u browseru maksimalne širine (>1024px):
- Auto-redirect na /termini
- TopBar gore sa "Tehpro" logo-om
- Sidebar lijevo sa 6 stavki, "Termini" highlighted (brand color)
- Main content "Termini" naslov + placeholder text
- Bez DesktopOnlyGate-a

- [ ] **Step 6.9: Resize browser na 1023px — gate mora biti vidljiv**

Smanji browser prozor ispod 1024px širine. Vidi:
- Gate ekran preko cijelog prozora
- Monitor ikona + "Tehpro je optimizovan za desktop" + objašnjenje
- Aplikacija sakrivena

Resize nazad iznad 1024px — aplikacija se vraća.

Stop server.

- [ ] **Step 6.10: Verify build + lint + typecheck**

```bash
pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 6.11: Commit**

```bash
git add . && git commit -m "feat(phase-1): dashboard shell + desktop-only gate

- (dashboard) route group sa layout (TopBar + Sidebar + main)
- Sidebar: 6 nav stavki sa Lucide ikonama, active state
- TopBar: brand logo + verzija
- DesktopOnlyGate: lg:hidden full-screen ispod 1024px
- root redirect na /termini, dashboard redirect na /termini
- termini/page.tsx stub (Faza 3 puni)"
```

---

## Task 7: Playwright setup + 01-smoke.spec.ts

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/01-smoke.spec.ts`, `tests/e2e/fixtures.ts`
- Modify: `package.json` (deps)
- Modify: `.gitignore` (već treba `playwright-report/`, `test-results/`)

**Interfaces:**
- Consumes: dashboard shell iz Task 6
- Produces:
  - Playwright config sa Chromium + WebKit browsers
  - `pnpm test:e2e` skripta
  - smoke spec koji testira: home redirect, sidebar items, desktop gate visibility

- [ ] **Step 7.1: Instaliraj Playwright**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium webkit
```

Expected: instalira browsere u `~/Library/Caches/ms-playwright/`.

- [ ] **Step 7.2: Kreiraj `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

- [ ] **Step 7.3: Kreiraj `tests/e2e/01-smoke.spec.ts`**

```ts
import { test, expect } from "@playwright/test"

test.describe("Faza 1 smoke", () => {
  test("root redirects to /termini", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL("/termini")
  })

  test("TopBar prikazuje Tehpro brand", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByRole("banner")).toContainText("Tehpro")
    await expect(page.getByRole("banner")).toContainText("Sistem za termine i provjere")
  })

  test("Sidebar prikazuje svih 6 nav stavki", async ({ page }) => {
    await page.goto("/termini")
    const nav = page.getByRole("navigation", { name: "Glavna navigacija" })
    await expect(nav.getByRole("link", { name: "Termini" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Prikaz" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Plan" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Klijenti" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Asistent" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Pregled" })).toBeVisible()
  })

  test("Aktivna stavka u Sidebar-u ima aria-current=page", async ({ page }) => {
    await page.goto("/termini")
    const active = page.getByRole("link", { name: "Termini" })
    await expect(active).toHaveAttribute("aria-current", "page")
  })

  test("Termini stub page render-uje naslov", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByRole("heading", { name: "Termini" })).toBeVisible()
  })

  test("Desktop-only gate VIDLJIV na 1023px", async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 800 })
    await page.goto("/termini")
    await expect(page.getByText("Tehpro je optimizovan za desktop")).toBeVisible()
    await expect(page.getByText("ekran minimalno 1024px širine")).toBeVisible()
    // Glavna aplikacija sakrivena
    await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeHidden()
  })

  test("Desktop-only gate SAKRIVEN na 1024px", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto("/termini")
    await expect(page.getByText("Tehpro je optimizovan za desktop")).toBeHidden()
    // Aplikacija vidljiva
    await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeVisible()
  })

  test("Bez console grešaka na load", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
```

- [ ] **Step 7.4: Pokreni Playwright**

```bash
pnpm test:e2e
```

Expected: svi testovi prolaze na Chromium I WebKit (8 testova × 2 browsera = 16 pass).

Ako neki test fail-uje: pokreni `pnpm test:e2e:ui` da vidiš headed mode i diagnoseuj.

- [ ] **Step 7.5: Verify build + lint + typecheck još jednom**

```bash
pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 7.6: Commit**

```bash
git add . && git commit -m "test(phase-1): Playwright setup + 01-smoke.spec

- playwright.config.ts sa Chromium + WebKit @ 1440x900
- webServer pokreće pnpm dev
- 01-smoke.spec.ts: 8 testova
  * root redirect, TopBar, Sidebar items, active state,
    Termini stub, desktop gate visibility @ 1023/1024px,
    no console errors"
```

---

## Task 8: Vercel link + prvi preview deploy

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Consumes: sve gornje
- Produces: live preview URL na Vercel-u, sa env vars konfigurisanim

- [ ] **Step 8.1: Provjeri Vercel CLI auth**

```bash
vercel whoami
```

Expected: `nextpixel9`. Ako pogrešan nalog: `vercel logout && vercel login` (otvara browser).

- [ ] **Step 8.2: Switch na stpauli98s-projects team**

```bash
vercel teams switch stpauli98s-projects
```

Expected: `> Success! Switched to stpauli98s-projects`.

- [ ] **Step 8.3: Link projekat (kreira ili pripaja postojeći Vercel projekat)**

Iz `tehpro-mvp/` foldera:

```bash
vercel link --yes --project tehpro-mvp
```

Ako projekat ne postoji, Vercel će ga kreirati. Ako pita "What's your project's name?" — odgovori `tehpro-mvp`.

Expected: kreira `.vercel/project.json` (gitignored).

- [ ] **Step 8.4: Push env vars u Vercel**

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
# zalijepi vrijednost iz .env.local kad pita
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_URL development

vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY development

vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY preview
```

Provjera: `vercel env ls` mora pokazati sve 3 varijable za relevantna environments.

- [ ] **Step 8.5: Kreiraj `vercel.json`**

```json
{
  "regions": ["fra1"],
  "framework": "nextjs"
}
```

- [ ] **Step 8.6: Push trenutni branch na GitHub**

```bash
git add vercel.json && git commit -m "chore(phase-1): vercel.json — fra1 region" && git push
```

- [ ] **Step 8.7: Trigger preview deploy**

```bash
vercel deploy 2>&1 | tee /tmp/vercel-deploy.log | tail -30
```

Expected: Build prolazi, output preview URL tipa `https://tehpro-mvp-xxxxxx.vercel.app`.

Sačuvaj URL — koristi se u Step 8.8.

- [ ] **Step 8.8: Verify preview URL radi**

```bash
PREVIEW_URL=$(cat /tmp/vercel-deploy.log | grep -oE 'https://tehpro-mvp-[a-z0-9-]+\.vercel\.app' | head -1)
echo "Preview URL: $PREVIEW_URL"
curl -sI "$PREVIEW_URL/termini" | head -5
```

Expected:
- `HTTP/2 200`
- `server: Vercel`

Otvori preview URL u browseru ručno (>1024px width) — vidi dashboard kao i lokalno.

- [ ] **Step 8.9: Commit (ako su `.vercel/` ili nešto novo)**

```bash
git status
```

Ako pokazuje izmjene koje treba commit-ovati (osim `.vercel/` koji je gitignored), commit-uj:

```bash
git add . && git commit -m "chore(phase-1): preview deploy ready"
```

---

## Faza 1 — Gate kriterijumi

Prije nego što pređemo na Fazu 2, svih 4 mora prolazi:

**Gate 1: Build**
```bash
pnpm build
```
Expected: clean build, bez warning-a/error-a.

**Gate 2: Lint + typecheck**
```bash
pnpm lint && pnpm typecheck
```
Expected: oba prolaze bez output-a.

**Gate 3: E2E Playwright**
```bash
pnpm test:e2e
```
Expected: svi testovi pass na Chromium I WebKit (16 ukupno).

**Gate 4: Fresh-agent verifikacija**

Dispatch novi `claude` (general-purpose) agent sa praznim kontekstom. Prompt:

```
You are an independent verifier for Phase 1 of the Tehpro MVP project.
You have NO context of what was built. Validate ONLY the Phase 1
deliverables.

Inputs:
- Spec: /Users/nmil/Desktop/Ai Forward/tehpro-mvp/docs/superpowers/specs/2026-06-20-tehpro-mvp-design.md
- Plan: /Users/nmil/Desktop/Ai Forward/tehpro-mvp/docs/superpowers/plans/2026-06-20-tehpro-mvp-phase-1-foundation.md
- Codebase: /Users/nmil/Desktop/Ai Forward/tehpro-mvp/ (current branch HEAD)
- Read the Plan's "Task Map" section for the list of deliverables.

Tasks:
1. cd into the repo. Run: pnpm install && pnpm build && pnpm lint && pnpm typecheck
2. Run: pnpm test:e2e (must pass on Chromium + WebKit)
3. Start dev server (pnpm dev in background) and use mcp__playwright__*
   tools to manually exercise:
   a. Open http://localhost:3000 — should redirect to /termini
   b. Verify TopBar shows "Tehpro" + "Sistem za termine i provjere"
   c. Verify Sidebar has 6 nav items: Termini, Prikaz, Plan, Klijenti, Asistent, Pregled
   d. Click each Sidebar item — should navigate (some may 404, that's OK for Phase 1; only Termini stub exists)
   e. Resize browser to 1023px — desktop-only gate must appear
   f. Resize back to 1440px — app returns
   g. Open browser DevTools console — must have ZERO errors on load
4. Read package.json — verify deps include: next@15, react@19, typescript,
   tailwindcss@4, @supabase/supabase-js, @supabase/ssr, zod, @playwright/test,
   lucide-react, sonner.
5. Read app/(dashboard)/layout.tsx — verify DesktopOnlyGate is rendered.
6. Read .eslintrc or eslint.config.mjs — verify no-restricted-syntax and
   no-await-in-loop rules are configured.
7. Verify Vercel preview URL is live (https://tehpro-mvp-*.vercel.app/termini
   should return HTTP 200).

Output strict JSON:
{
  "phase": 1,
  "build": "pass|fail",
  "lint": "pass|fail",
  "typecheck": "pass|fail",
  "e2e_chromium": "pass|fail",
  "e2e_webkit": "pass|fail",
  "manual_flows": [
    {"name": "root redirect", "status": "pass|fail", "notes": "..."},
    {"name": "TopBar branding", "status": "pass|fail", "notes": "..."},
    {"name": "Sidebar 6 items", "status": "pass|fail", "notes": "..."},
    {"name": "desktop gate 1023px", "status": "pass|fail", "notes": "..."},
    {"name": "app visible 1440px", "status": "pass|fail", "notes": "..."},
    {"name": "no console errors", "status": "pass|fail", "notes": "..."}
  ],
  "deps_check": "pass|fail",
  "eslint_rules_check": "pass|fail",
  "preview_url_live": "pass|fail",
  "blockers": ["..."],
  "non_blockers": ["..."]
}

Do NOT suggest improvements. Only report what works and what doesn't.
```

Ako ima blocker-a → fiks → re-run fresh-agent. Ako nema → tag `v0.1.0`, pokreni `writing-plans` skill za Fazu 2.

---

## Self-Review

**1. Spec coverage:**

Sekcije spec-a koje Faza 1 pokriva:
- §3.1 Stack: ✓ Task 1, 2, 3, 4, 7
- §3.2 Folder layout: ✓ djelimično — `app/`, `components/`, `lib/`, `tests/` kreirani; `db/`, `scripts/` će Faza 2
- §4 DB shema: NIJE u Fazi 1 (intentionally — Faza 2)
- §5 N+1 prevention: ✓ Task 5 (ESLint pravilo)
- §6 Connection pooling: ✓ Task 4 (SDK helperi prema spec-u)
- §7 Ekrani: djelimično — shell + 1 stub (`/termini`); ostale stranice (`/prikaz`, `/plan`, `/klijenti`, `/asistent`, `/pregled`) su 404 do svojih faza
- §7.3 Brand tokens: ✓ Task 2
- §7.4 Desktop-only gate: ✓ Task 6 + Task 5 (ESLint enforcement)
- §7.5 shadcn primitives: ✓ Task 3
- §9.1 Playwright spec mapping (Faza 1 = 01-smoke.spec.ts): ✓ Task 7
- §9.2 Fresh-agent verifikacija: ✓ Gate 4

**Gap:** Nijedna stranica osim `/termini` ne postoji u Fazi 1. To je intentional (svaka stranica dolazi u svojoj fazi). Sidebar linkovi će 404-ovati za neimplementirane stranice u Fazi 1 — to je očekivano ponašanje za ovaj korak; user će vidjeti puno funkcionisanje navigacije tek u kasnijim fazama.

**2. Placeholder scan:**

Pretraga kroz plan za "TBD", "TODO", "implement later":
- Step 6.6 spominje "Sadržaj se popunjava u Fazi 3" — to je u stub page tekstu, ne u planu kao TODO. OK.
- Step 4.1 "kreiraj novi Supabase projekat manualno" — to je manualni korak koji se NE može automatizovati; engineer mora ovo uraditi rukom. To NIJE placeholder za kasnije, već akcija u trenutku.

Bez TODO/TBD u plan tekstu. OK.

**3. Type consistency:**

Provjera signature-a između tasks-a:
- Task 4 produces: `createServerSupabaseClient()`, `createBrowserSupabaseClient()`, `createAdminSupabaseClient()`. Step 4.9 (privremeni test query) i Task 6 (privremeno se nije koristio supabase) — nema neusklađenosti.
- Task 5 produces ESLint pravila — koja Task 6, 7, 8 implicitno prolaze.
- `cn()` iz `@/lib/utils` se koristi u Sidebar.tsx (Task 6); kreiran u Task 3 (shadcn init). Sekvenca tačna.
- `<DesktopOnlyGate />` iz `@/components/shell/DesktopOnlyGate` (Task 6 Step 6.1) i import u Task 6 Step 6.4. OK.

Bez signature mismatch-a. OK.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-tehpro-mvp-phase-1-foundation.md`.

Dva execution opcije:

**1. Subagent-Driven (preporučeno — usklađeno sa tvojim zahtjevom "fresh agent verify svaki task")**
- Dispatch-ujem fresh `claude` subagent po task-u (T1, T2, ..., T8)
- Između task-ova, ja verifikujem rezultat (čitam diff, runam testove)
- Drugi fresh agent verifikuje Phase Gate na kraju
- Najbolje za nezavisnu provjeru, dva sloja validacije
- Skill: `superpowers:subagent-driven-development`

**2. Inline Execution**
- Ja izvršavam task-ove redom u ovoj sesiji
- Batch checkpoint-i nakon par task-ova za tvoj pregled
- Brže ali bez nezavisnog fresh-agent gate-a po task-u
- Skill: `superpowers:executing-plans`

Koji pristup?
