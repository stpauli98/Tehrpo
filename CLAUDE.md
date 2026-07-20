# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## ⚠️ Read first

- **Next.js 16 — not the one you know.** APIs, conventions, and file structure differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code. Notable rename already in use: `middleware` → **`proxy`** (`proxy.ts`, exports a `proxy()` function + `config.matcher`).
- **`--webpack` is mandatory for `next dev`.** Turbopack panics with `Next.js package not found` because the project path contains a space (`Ai Forward`). The `dev` script and the Playwright `webServer` both force `next dev --webpack`. Do not switch back to Turbopack unless the project is moved to a space-free path.
- **Package manager is `pnpm`** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Use `pnpm`, not `npm`/`yarn`.
- **Domain language is Bosnian/Serbian (latinica).** Table names, columns, routes, identifiers, and UI strings are all in the domain language (`klijenti`, `termini`, `obilasci`, `podsjetnici`…). This is intentional — match it.
- **The cloud DB has two environments — always know which one you're touching.** PROD = ref `fqtqkehjidkzeasiegnq` via `DATABASE_URL` in `.env.local`; DEMO = ref `mtwwotmwrasozmcgqwhc` via `DATABASE_URL_DEMO` in `.env.development.local`. Local dev and E2E run against **DEMO**; real client data lives in **PROD**. Anything reading env must prefer `.env.development.local` (DEMO) over `.env.local` (PROD) — the DEMO-first precedence in `tests/e2e/db.ts` and `tests/e2e/session-helper.ts` exists because getting it backwards writes tests into PROD while the app reads DEMO. Ref-guard before any PROD write. `.env.local` is **not** shell-`source`-able (parse error) — read values with `grep` or `tsx --env-file`.
- **Merge to `main` = production deploy.** Vercel git-integration auto-deploys `main` to **three** Production projects at once (there is no deploy GitHub Action; as of 2026-07-20 the repo has **no** GitHub Actions workflows at all — scheduling lives in `vercel.json`). Vercel project names are **inverted from role**: `tehpro-demo.nextpixel.dev` (Vercel project `tehpro-demo`) is PROD → `fqtqkehjidkzeasiegnq`; `de.nextpixel.dev` + `demo.nextpixel.dev` are DEMO → `mtwwotmwrasozmcgqwhc`. Branch push = Preview deploy. Don't push `main` casually.

## Commands

```bash
pnpm dev              # next dev -p 3000 --webpack  (NEVER plain `next dev`)
pnpm build            # next build
pnpm lint             # eslint .
pnpm typecheck        # tsc --noEmit

pnpm test:unit        # vitest run         (lib/**/*.test.ts, node env, pure logic)
pnpm test:unit:watch  # vitest
pnpm test:e2e         # playwright test --workers=1  (boots its own dev server)
pnpm test:e2e:ui      # playwright --ui

# run a single test
pnpm vitest run lib/date.test.ts
pnpm exec playwright test tests/e2e/18-auth-rls.spec.ts
pnpm exec playwright test -g "kreira klijenta"
```

Database & data scripts (all `tsx --env-file=.env.local`; DB scripts use the **service-role** admin client):

```bash
pnpm db:types         # regenerate db/types.ts from the LOCAL DB — AUTO-GENERATED, never hand-edit
pnpm db:reset         # supabase db reset (reapply all migrations to local stack)
pnpm seed             # wipe + repopulate LOCAL DB from ../2026- obilasci...xlsx (needs `supabase start` first)
pnpm seed:admin <email> <pw> "<ime>"   # create Supabase Auth user + admin korisnici row (idempotent)
pnpm db:apply-cloud --demo <migration.sql>              # apply ONE migration to cloud DEMO
POTVRDI_PROD=da pnpm db:apply-cloud --prod <migration.sql>  # ... to cloud PROD (target is never implicit)
pnpm reminders [-- --dry]              # run the reminder engine locally (same code as the cron route)
pnpm preview:import   # dry-read the Excel workbook, no DB writes
```

## Architecture

### What this is
TEHPRO is a Banja Luka workplace-safety (ZNR) and fire-protection (ZOP) consultancy. The app replaces manual Excel deadline-tracking. The authoritative spec is `../TEHPRO - Brief za agenta.md` (data model in §4, business rules in §5, confirmed decisions in §12). Core flow:

> **klijenti** (clients) have **lokacije** (locations) and one active **ugovor** (contract). Periodic services (**vrste_provjera** / brief's *Usluga*) generate **termini** (the deadline engine / brief's *Aktivnost*) whose `rok_dospijeca` auto-recomputes when a completed inspection is recorded; status `kasni` (overdue) is derived automatically. Contracted monthly site visits (**obilasci**) produce notes/minutes (**zapisnici/bilješke**) stored as **dokumenti**. **podsjetnici** (reminders) fire 60/30/15/7-day + post-due email/app alerts to the assigned worker/admin — **never to the client**. Access is role-based (`admin` / `operater` / `pregled`) with RLS-by-assignment + an audit log.

**Vocabulary gotcha:** the brief uses `Aktivnost`/`Usluga`/`IzvrsenaAktivnost`; the MVP kept the older `termini`/`vrste_provjera` schema and extends it additively. The mapping is in `claudedocs/2026-06-26-gap-plan-mvp-vs-brief.md` §1.

### Data layer — three Supabase clients (`lib/supabase/`)
Pick by execution context; this is the most important rule in the codebase:

| Client | Factory | Key | Use in |
|---|---|---|---|
| Browser | `client.ts` `createBrowserSupabaseClient()` | anon (RLS as logged-in user) | client components |
| SSR server | `server.ts` `createServerSupabaseClient()` | anon + cookie bridge | **default** for Server Components / Route Handlers / Server Actions |
| Admin | `admin.ts` `createAdminSupabaseClient()` | service-role (**bypasses RLS**) | `scripts/`, cron handlers, `lib/supabase/storage.ts`, `lib/cache.ts` only |

**Never use the admin/service-role client in the `app/` or `components/` request path.** All env is read through `lib/env.ts` (zod-validated, throws on boot).

### Auth, RLS & audit
- `proxy.ts` is the gate: validates `getUser()`, redirects unauth → `/prijava`. `PUBLIC` allowlist includes `/api/cron` (Bearer `CRON_SECRET`, no cookie). Deactivation check is **fail-open** — signs out only when `korisnici.aktivan === false`; a missing/erroring profile row never revokes the session.
- `korisnici` table PKs on `auth.users(id)` with `uloga` (`admin|operater|pregled`) + `aktivan`. Use `lib/auth/current-user.ts` `getTrenutniKorisnik()` (React-`cache`d) and `lib/auth/roles.ts` (`jeAdmin`, `mozeUrediti`) — don't re-query.
- RLS policies key on `SECURITY DEFINER` helpers `ima_pristup_klijentu()` / `je_admin()` / `je_pregled()`; client-scoped tables join through `klijent_id`. `pregled` role is read-only everywhere. Every mutation hits a generic `tg_audit()` trigger → `audit_log` (admin-read only).
- **`pregled` read-only UX is a client layer *on top of* RLS** (RLS already blocks the writes server-side; this just hides dead buttons). `providers/korisnik-provider.tsx` exposes `useUloga()` and `useMozeUrediti()` (= `mozeUrediti(uloga)`, admin||operater). Gate write controls with `{mozeUrediti && …}`, or `if (!mozeUrediti) return null` **placed after all hook calls** (Rules of Hooks). Hide the write control only — never the read view. When a component mixes read + write (inputs + submit), disable/hide only the write parts.
- **RLS gotchas:** SQL **views must set `security_invoker=on`** or they bypass RLS. A cloud-only event trigger auto-enables RLS on every new public table, so **a new table with no policy silently returns 0 rows**.

### Migrations & read models
- `supabase/migrations/*.sql` is the source of truth. `db/types.ts` is auto-generated — run `pnpm db:types` after any migration, never hand-edit.
- **The cloud DB is NOT reachable through the Supabase MCP.** Apply migrations to cloud one file at a time with `pnpm db:apply-cloud --demo <file>` / `POTVRDI_PROD=da pnpm db:apply-cloud --prod <file>` (raw `pg` over the pooler). **The target is never implicit:** without `--demo`/`--prod` the script refuses to run, and it verifies the connection string actually carries the matching project ref before executing (`lib/supabase/refs.ts`). Until 2026-07-20 it silently defaulted to PROD.
- Read-model convention: pages read from flat enriched **views** (`klijenti_view`, `termini_view` — joined names + computed `status_izvedeni`) and **stable RPCs** (`get_termini_stats`, `get_opterecenje`) so a screen aggregates in one round-trip rather than N queries.

### App Router conventions (`app/`)
All authenticated UI lives under the `app/(dashboard)/` route group. `app/(dashboard)/layout.tsx` is an async server shell (fetches the user, wraps in TanStack Query provider + `TopBar`/`Sidebar`). The app is **desktop-only** (`DesktopOnlyGate`, `hidden lg:flex`). There are three data-fetching patterns — know which to use:

1. **Server Action** (`actions.ts`, `'use server'`) — all mutations. Rigid shape: Zod `safeParse(Object.fromEntries(formData))` → `(_prev, formData)` signature → discriminated `ActionResult` (`{ok:true} | {ok:false, errors?|message?}`) → mutate via SSR client → `revalidatePath(...)`. `klijenti/actions.ts` is the reference (maps PG error codes like `23505` to friendly messages; some invariants live in DB triggers, not app code).
2. **Server Component fetch** — read-heavy pages fetch directly with parallel `Promise.all` over the views. `klijenti/[id]/page.tsx` is the reference (fan-out, conditional fetch by `tab` searchParam).
3. **API route + react-query** — only the interactive `plan-aktivnosti` screen. `_views/{lista,kalendar,matrica}.tsx` are client components using `useQuery` against typed fetchers in `lib/queries/plan-aktivnosti.ts` → `app/api/plan-aktivnosti/*/route.ts`. **The route's filter logic deliberately mirrors the server-component query — keep both in sync when editing.**

### Domain logic & integrations (`lib/`)
Pure domain logic is in `lib/*.ts`, stateless and unit-tested via co-located `*.test.ts` (`date`, `termini` status/badge maps, `calendar`, `matrix`, `hitno`, `dedup`, `obilasci`, `plan-view`…). Dates are TZ-safe ISO strings compared lexicographically.

External integrations live in `lib/{excel,zapisnik,claude,reminders,email}/` and **all follow a dry-run/mock-first pattern** so the app runs offline and tests never touch the network:
- **AI chat** (`lib/claude/`) — agentic tool-use loop (`runChat`, up to `MAX_KORACI=5`), tools query the views, emits a `proposal` event; the model never saves (user confirms in UI). `chatDryRun()` returns canned events from `mock.ts` when `CHAT_DRY_RUN=1` or `ANTHROPIC_API_KEY` is missing. Entry: `app/api/chat/route.ts` (streams NDJSON).
- **AI zapisnik** (`lib/zapisnik/`) — generate text (LLM/mock) → `buildZapisnikDocx` (`docx` lib → Buffer) → upload to storage. `ZAPISNIK_DRY_RUN=1` (or no key) → deterministic content; also degrades to deterministic content if the model returns non-JSON.
- **Email reminders** (`lib/reminders/` + `lib/email/`) — `runReminders` calls RPC `get_due_podsjetnici`, dedups recipients, sends via Resend (`drySend()` when `RESEND_API_KEY` unset), writes an idempotent audit row. Entry: `app/api/cron/reminders/route.ts`.
- **Excel import** (`lib/excel/parser.ts`, `exceljs`) — heavy normalization (known-firm whitelist, location canonicalization, multi-format dates, dedupe). Drives `pnpm seed`.

**Anthropic model id `claude-sonnet-4-6` is hardcoded in two places** — `lib/claude/chat.ts` and `lib/zapisnik/generate.ts`. Change both together. **Load the `claude-api` skill before editing any Anthropic/Claude code.**

### i18n & branding — same code, many firms/locales (never hard-code either)
One codebase serves multiple firms and languages; brand and locale are **build-time env flags**, not literals in code.
- **Locale** (`lib/locale.ts` → `i18n/request.ts`, next-intl): `NEXT_PUBLIC_APP_LOCALE` ∈ `sr|en|de` (default `sr`), fixed per deployment (needs rebuild). Catalogs live in `messages/{sr,en,de}.json`.
- **Brand** (`lib/brand.ts`): `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_APP_TAGLINE` (default `"Tehpro"`). Consume `APP_NAME` / `APP_TAGLINE` / `APP_INITIAL` — never a literal firm name. `brand.ts`/`locale.ts` are imported at module level in both client and server code, so they must not pull the whole message catalog (bundle discipline).
- **next-intl type-checks translator namespaces/keys against the literal JSON union** — referencing a key/namespace that doesn't exist yet is a hard `tsc` error. Add the key to all of `messages/*.json` in the *same* change that uses it, keep `sr`/`en`/`de` at key parity, and do **not** use the ICU `one` plural category for `sr`.

### Tests & deployment
- **Unit:** Vitest, node env, `lib/**/*.test.ts` only, pure logic.
- **E2E:** Playwright, `--workers=1`, chromium + webkit at 1440×900. It boots its own dev server (`--webpack`, with `ZAPISNIK_DRY_RUN=1` + `CHAT_DRY_RUN=1`). `auth.setup.ts` logs in via Supabase REST and hand-encodes the `@supabase/ssr` cookie into `storageState` to avoid hundreds of real logins. **E2E runs against the cloud DEMO Supabase (not a local stack)** — mutations hit the live DEMO DB (`--workers=1`, since specs share global singleton `postavke` id=1), so `pnpm cleanup:test-data` purges test junk afterward. **A `globalSetup` guard refuses to run the suite unless the resolved target is the DEMO ref** (`tests/e2e/global-setup.ts`) — in a git worktree missing `.env.development.local`, `next dev` silently falls back to `.env.local` (PROD), which is how a full E2E run once wrote to production.
- **Deploy:** Vercel, region `dub1` (`vercel.json`). The reminder cron is wired **only** through `vercel.json` (`/api/cron/reminders`, `0 * * * *` — hourly), one schedule per Vercel project. The route itself decides whether to act: `podsjetnici_aktivni`, `vrijeme_slanja_sat`, and the daily `zadnje_slanje_datum` marker (pre-due only). **Hourly is deliberate** — the hour gate needs several attempts per day, and post-due recovery of a stale claim (15 min) is meaningless with one run. A `.github/workflows/reminders.yml` used to exist as a second scheduler but **never worked**: its four secrets were never set, so `curl` got an empty URL and `|| true` made every run report success. It was removed on 2026-07-20 rather than left to lie.

### Conventions enforced by lint
- **No `sm:` / `md:` Tailwind breakpoints** (`no-restricted-syntax` in `eslint.config.mjs`) — desktop-only; use `lg:`/`xl:`/`2xl:` or no breakpoint.
- **`no-await-in-loop: error`** everywhere except `scripts/` (bulk ops batch with `Promise.all`).
- UI is shadcn (`base-nova` style, `components/ui/`) + Base UI + `lucide` icons; domain components in `components/domain/`, shell in `components/shell/`.
