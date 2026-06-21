# Faza 6 — Email podsjetnici (Resend + cron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistem automatski (dnevno) šalje email podsjetnike za termine kojima ističe rok, sa konfigurabilnim pragovima i primaocima, i bilježi svaki poslat podsjetnik u audit log.

**Architecture:** Anti-join RPC (`get_due_podsjetnici`) vraća termine koji su tačno N dana prije roka i za koje podsjetnik (termin_id, dana_prije) još nije poslat. Čista jezgra (`lib/reminders/runReminders.ts`) sastavlja primaoce, šalje preko Resend-a (sa dry-run prekidačem) i upisuje audit red. Dva ulaza dijele jezgro: HTTP ruta `POST /api/cron/reminders` (zaštićena `CRON_SECRET`) i lokalna skripta `scripts/send-reminders.ts`. Pragovi i per-klijent primaoci se uređuju kroz UI.

**Tech Stack:** Next.js 16.2.9 (App Router, route handlers), React 19, Supabase JS SDK (PostgREST + RPC), `resend` SDK, Zod v4, Tailwind v4 + @base-ui/react, Vitest, Playwright.

## Global Constraints

- **Local-only:** Bez Vercel-a i cloud Supabase-a. Cron je HTTP ruta + lokalna skripta; `vercel.json` cron config se NE pravi u ovoj fazi (odgođeno za Fazu 9 / deploy). Sve čuvati na git-u (push na origin/main nakon faze).
- **Backend test kroz Docker:** lokalni Supabase (`supabase_db_tehpro-mvp`, REST `http://127.0.0.1:54321`). Migracije preko `supabase` CLI / `pnpm db:reset`.
- **Bez dummy podataka:** stvarni Resend SDK; bez mock klasa. "Mock Resend" u testu = **dry-run mod** (bez mreže, bez fake servisa), ne placeholder objekat.
- **Package manager:** `pnpm`. Path alias `@/*`.
- **TS strict:** `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`. Indeksni pristup daje `T | undefined` — guard-uj.
- **ESLint:** `no-await-in-loop` (error; koristi `Promise.all`, ne `await` u petlji) — IZUZETO u `scripts/**`. Zabranjeni Tailwind `sm:`/`md:` prefiksi svuda (desktop-only; koristi `lg:`/`xl:` ili bez breakpointa).
- **Supabase klijenti:** `createServerSupabaseClient()` (async, anon, RLS) u RSC/akcijama; `createAdminSupabaseClient()` (service-role) SAMO u `scripts/` i route handler-ima; nikad u komponentama.
- **Datumi:** `lib/date.ts` — `formatDatum(iso)` za prikaz, `todayIso()` (UTC, usklađeno s DB `current_date`). DB upoređivanja preko `current_date` u SQL-u.
- **Tabele (tačna imena):** `klijenti`, `lokacije`, `termini`, `vrste_provjera` (NE `vrste_provjere`), `podsjetnici`. `termini.vrsta_provjere_id → vrste_provjera`.
- **Server actions pattern:** `'use server'`; `export async function x(_prev: ActionResult, formData: FormData): Promise<ActionResult>`; Zod `safeParse(Object.fromEntries(formData))`; `revalidatePath(...)`; `ActionResult = { ok: true } | { ok: false; errors?; message? }`.
- **Email/cron env varijable su OPCIONE u `lib/env.ts`** (app mora bootovati bez njih); ruta/skripta validiraju prisustvo na mjestu upotrebe.

---

## File Structure

**Nove datoteke:**
- `supabase/migrations/<ts>_podsjetnici_config.sql` — `klijenti.podsjetnik_emails`, `postavke` tabela + seed red, UNIQUE index na `podsjetnici(termin_id, dana_prije)`, RPC `get_due_podsjetnici`.
- `lib/email/resend.ts` — Resend klijent + `sendEmail()` (sa dry-run) + `drySend()`.
- `lib/email/templates.ts` — `reminderSubject()`, `reminderHtml()`, `escapeHtml()`.
- `lib/email/templates.test.ts` — unit testovi za subject/html.
- `lib/reminders/recipients.ts` — `parseEmailList()`, `assembleRecipients()`.
- `lib/reminders/recipients.test.ts` — unit testovi za primaoce.
- `lib/reminders/runReminders.ts` — jezgro (čita postavke → RPC → šalje → audit).
- `app/api/cron/reminders/route.ts` — `POST` handler (Bearer `CRON_SECRET`).
- `scripts/send-reminders.ts` — lokalni pokretač (tsx, admin klijent).
- `app/(dashboard)/postavke/page.tsx` — RSC, čita `postavke`, renderuje `ReminderForm`.
- `app/(dashboard)/postavke/actions.ts` — `updatePostavke` server action.
- `components/domain/ReminderForm.tsx` — uređivanje `dana_prije`.
- `tests/e2e/06-podsjetnici.spec.ts` — E2E (401, dry-run cron, postavke UI, per-klijent emails).

**Izmijenjene datoteke:**
- `lib/env.ts` — dodati `RESEND_API_KEY`, `EMAIL_FROM`, `REMINDER_TO`, `CRON_SECRET` (sve `.optional()`).
- `.env.local.example` + `.env.local` — dodati iste ključeve (primjeri/vrijednosti).
- `package.json` — dependency `resend`; npm script `reminders`.
- `app/(dashboard)/klijenti/actions.ts` — `updateKlijent` prima `podsjetnik_emails`.
- `components/domain/KlijentEditForm.tsx` — polje za `podsjetnik_emails` (comma-separated).
- `app/(dashboard)/klijenti/[id]/page.tsx` — proslijediti `podsjetnik_emails` u `KlijentEditForm` (ako treba) + prikaz primalaca.
- `components/shell/Sidebar.tsx` — nav stavka `Postavke`.
- `db/types.ts` — regenerisano (`pnpm db:types`).

---

## Task 1: DB migracija — config, idempotencija, due RPC

**Files:**
- Create: `supabase/migrations/<ts>_podsjetnici_config.sql`
- Modify (regen): `db/types.ts`

**Interfaces:**
- Produces:
  - kolona `klijenti.podsjetnik_emails text[] not null default '{}'`
  - tabela `postavke(id int pk=1, dana_prije int[] not null default '{30,14,7,1}', updated_at timestamptz)` sa jednim redom (id=1)
  - `unique index uq_podsjetnici_termin_dana on podsjetnici(termin_id, dana_prije)`
  - RPC `get_due_podsjetnici(dana_prije_arr int[]) returns table(termin_id uuid, dana_prije int, klijent_naziv text, vrsta_naziv text, rok_dospijeca date, lokacija_naziv text, lokacija_kontakt_email text, podsjetnik_emails text[])`

- [ ] **Step 1: Kreiraj migraciju**

Generiši ime sa timestamp-om (npr. `supabase migration new podsjetnici_config` ili ručno `YYYYMMDDHHMMSS_podsjetnici_config.sql`). Sadržaj:

```sql
-- Faza 6: konfiguracija podsjetnika, idempotencija, due RPC

-- 1. per-klijent dodatni primaoci podsjetnika
alter table klijenti
  add column podsjetnik_emails text[] not null default '{}';

-- 2. globalne postavke podsjetnika (single-row)
create table postavke (
  id          int primary key default 1,
  dana_prije  int[] not null default '{30,14,7,1}',
  updated_at  timestamptz not null default now(),
  constraint chk_postavke_singleton check (id = 1)
);
insert into postavke (id) values (1) on conflict (id) do nothing;

-- 3. idempotencija: jedan podsjetnik po (termin, prag)
--    drop redundantnog ne-unique indeksa nad istim kolonama (iz supporting_tables migracije)
drop index if exists idx_podsjetnici_termin;
create unique index uq_podsjetnici_termin_dana on podsjetnici (termin_id, dana_prije);

-- 4. due reminders RPC: za svaki prag d, termini sa rok = current_date + d,
--    status aktivan (planirano/zakazano), bez postojeceg podsjetnika za taj prag
create or replace function get_due_podsjetnici(dana_prije_arr int[])
returns table (
  termin_id              uuid,
  dana_prije             int,
  klijent_naziv          text,
  vrsta_naziv            text,
  rok_dospijeca          date,
  lokacija_naziv         text,
  lokacija_kontakt_email text,
  podsjetnik_emails      text[]
)
language sql
stable
as $$
  select
    t.id              as termin_id,
    d.d               as dana_prije,
    k.naziv           as klijent_naziv,
    vp.naziv          as vrsta_naziv,
    t.rok_dospijeca   as rok_dospijeca,
    l.naziv           as lokacija_naziv,
    l.kontakt_email   as lokacija_kontakt_email,
    k.podsjetnik_emails as podsjetnik_emails
  from unnest(dana_prije_arr) as d(d)
  join termini t
    on t.rok_dospijeca = current_date + d.d
   and t.status in ('planirano','zakazano')
  join klijenti k        on k.id = t.klijent_id
  join vrste_provjera vp on vp.id = t.vrsta_provjere_id
  left join lokacije l   on l.id = t.lokacija_id
  where not exists (
    select 1 from podsjetnici p
    where p.termin_id = t.id and p.dana_prije = d.d
  )
  order by t.rok_dospijeca, k.naziv;
$$;
```

- [ ] **Step 2: Primijeni migraciju (reset + seed)**

Run: `pnpm db:reset && pnpm seed`
Expected: bez grešaka; seed izvještava `Termini: 1000`.

- [ ] **Step 3: Provjeri shemu i RPC kroz Docker**

Run:
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "\d postavke"
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select id, dana_prije from postavke;"
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select count(*) from get_due_podsjetnici(array[3650]);"
```
Expected: `postavke` ima 1 red `{30,14,7,1}`; `\d podsjetnici` pokazuje `uq_podsjetnici_termin_dana` UNIQUE; `get_due_podsjetnici(array[3650])` vraća broj (vjerovatno 0 jer nema termina ~10 god u budućnosti) bez greške.

- [ ] **Step 4: Dokaži da RPC vraća redove za realan prag**

Run (nadji prag koji pogađa postojeće termine — termini imaju rok u 2026):
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select dana_prije, count(*) from get_due_podsjetnici((select array_agg(g) from generate_series(0,400) g)) group by dana_prije order by 1 limit 5;"
```
Expected: barem jedan red sa `count > 0` (postoje termini u rasponu narednih 400 dana), kolone se popunjavaju.

- [ ] **Step 5: Regeneriši tipove**

Run: `pnpm db:types`
Expected: `db/types.ts` sada sadrži `postavke` tabelu, `podsjetnik_emails` na `klijenti`, i `get_due_podsjetnici` u `Functions`. Provjeri: `grep -c "get_due_podsjetnici\|postavke\|podsjetnik_emails" db/types.ts` > 0.

**VAŽNO — provjeri nullability povratnih kolona RPC-a** (utiče na Task 3): `supabase gen types` za `returns table(...)` sa `left join` tipično označava SVE kolone kao `T | null`. Pogledaj generisani `get_due_podsjetnici` Returns blok:
```bash
grep -n -A 20 "get_due_podsjetnici" db/types.ts
```
Ako su kolone `string | null` / `number | null` → Task 3 MORA imati null-guard (već je u planu). Zabilježi tačan oblik za implementatora Task 3.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.
```bash
git add supabase/migrations db/types.ts
git commit -m "feat(faza6): podsjetnici config tabela + due RPC + idempotency index"
```

---

## Task 2: Email modul — Resend klijent + template + env

**Files:**
- Modify: `lib/env.ts`
- Modify: `.env.local.example`, `.env.local`
- Modify: `package.json` (dependency `resend`)
- Create: `lib/email/resend.ts`
- Create: `lib/email/templates.ts`
- Test: `lib/email/templates.test.ts`

**Interfaces:**
- Produces:
  - `sendEmail(args: { to: string[]; subject: string; html: string }): Promise<SendResult>` gdje `type SendResult = { id: string; dryRun: boolean }`
  - `drySend: typeof sendEmail` (uvijek dry-run, bez mreže)
  - `reminderSubject(args: { vrsta: string; klijent: string; danaPrije: number }): string`
  - `reminderHtml(args: { klijent: string; vrsta: string; rok: string; danaPrije: number; lokacija?: string | null }): string`
  - `escapeHtml(s: string): string`
  - `env.RESEND_API_KEY | EMAIL_FROM | REMINDER_TO | CRON_SECRET` (svi `string | undefined`)

- [ ] **Step 1: Instaliraj resend**

Run: `pnpm add resend`
Expected: `resend` u `dependencies`.

- [ ] **Step 2: Proširi `lib/env.ts`**

Zamijeni `envSchema` i `parsed` blok:

```ts
import { z } from "zod"

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  REMINDER_TO: z.string().optional(),
  CRON_SECRET: z.string().min(1).optional(),
})

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  REMINDER_TO: process.env.REMINDER_TO,
  CRON_SECRET: process.env.CRON_SECRET,
})

if (!parsed.success) {
  console.error("❌ Invalid env vars:", parsed.error.flatten().fieldErrors)
  throw new Error("Invalid env vars — vidi .env.local.example")
}

export const env = parsed.data
```

- [ ] **Step 3: Dodaj env ključeve u oba .env fajla**

U `.env.local.example` dodaj (primjeri, bez stvarnih tajni):
```
# Email podsjetnici (Faza 6)
RESEND_API_KEY=re_xxx
EMAIL_FROM=Tehpro <onboarding@resend.dev>
REMINDER_TO=tehpro@example.com
CRON_SECRET=promijeni-me
```
U `.env.local` dodaj iste ključeve sa lokalnim vrijednostima — **OBAVEZNO** (ne samo u `.example`; `.env.local` NIJE u gitu pa ga gate ne može uhvatiti, a E2E i ruta zavise od njega):
```
CRON_SECRET=tehpro-dev-cron
EMAIL_FROM=Tehpro <onboarding@resend.dev>
REMINDER_TO=tehpro-dev@example.com
RESEND_API_KEY=
```
- `REMINDER_TO` MORA biti non-empty (npr. `tehpro-dev@example.com`) — inače `assembleRecipients` vraća `[]` za svaki termin, ništa se ne šalje/ne audituje, i E2E idempotency test prolazi prazan (vidi Task 7).
- `RESEND_API_KEY` ostavi prazno za E2E/dev (tada je transport dry-run, bez stvarnog maila). Korisnik ga popunjava za stvarni test (Task 7 Step 5).
- **Provjeri:** `grep -q '^CRON_SECRET=' .env.local && grep -q '^REMINDER_TO=.\+' .env.local || echo "FALI env"`. `.env.local` je u `.gitignore` (jeste) — NIKAD ga ne commit-uj.

- [ ] **Step 4: Kreiraj `lib/email/templates.ts`**

```ts
import { formatDatum } from "@/lib/date"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function danaTekst(d: number): string {
  if (d === 0) return "danas"
  return `za ${d} ${d === 1 ? "dan" : "dana"}`
}

export function reminderSubject(args: {
  vrsta: string
  klijent: string
  danaPrije: number
}): string {
  return `Podsjetnik: ${args.vrsta} — ${args.klijent} (rok ${danaTekst(args.danaPrije)})`
}

export function reminderHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  danaPrije: number
  lokacija?: string | null
}): string {
  const rok = formatDatum(args.rok)
  const lokRed = args.lokacija
    ? `<p style="margin:4px 0"><strong>Lokacija:</strong> ${escapeHtml(args.lokacija)}</p>`
    : ""
  return `<!doctype html>
<html lang="bs"><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h2 style="color:#2563eb;margin:0 0 12px">Podsjetnik o roku</h2>
    <p style="margin:0 0 12px">Termin dospijeva <strong>${danaTekst(args.danaPrije)}</strong> (${rok}).</p>
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px">
      <p style="margin:4px 0"><strong>Klijent:</strong> ${escapeHtml(args.klijent)}</p>
      <p style="margin:4px 0"><strong>Vrsta:</strong> ${escapeHtml(args.vrsta)}</p>
      ${lokRed}
      <p style="margin:4px 0"><strong>Rok dospijeća:</strong> ${rok}</p>
    </div>
    <p style="margin:16px 0 0;color:#64748b;font-size:12px">Tehpro — Sistem za termine i provjere</p>
  </div>
</body></html>`
}
```

- [ ] **Step 5: Napiši failing unit testove `lib/email/templates.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { reminderSubject, reminderHtml, escapeHtml } from "./templates"

describe("escapeHtml", () => {
  it("escape-uje HTML meta znakove", () => {
    expect(escapeHtml('<b>"&\'')).toBe("&lt;b&gt;&quot;&amp;&#39;")
  })
})

describe("reminderSubject", () => {
  it("jednina za 1 dan", () => {
    expect(reminderSubject({ vrsta: "Servis PP aparata", klijent: "AS", danaPrije: 1 }))
      .toBe("Podsjetnik: Servis PP aparata — AS (rok za 1 dan)")
  })
  it("množina za 7 dana", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaPrije: 7 }))
      .toContain("za 7 dana")
  })
  it("danas za 0", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaPrije: 0 }))
      .toContain("rok danas")
  })
})

describe("reminderHtml", () => {
  it("sadrži klijenta, vrstu i formatiran rok; escape-uje vrijednosti", () => {
    const html = reminderHtml({
      klijent: "AS & co",
      vrsta: "Hidranti",
      rok: "2026-09-15",
      danaPrije: 7,
      lokacija: null,
    })
    expect(html).toContain("AS &amp; co")
    expect(html).toContain("Hidranti")
    expect(html).toContain("15.09.2026.")
  })
  it("izostavlja lokaciju kad je null", () => {
    const html = reminderHtml({ klijent: "AS", vrsta: "Hidranti", rok: "2026-09-15", danaPrije: 7, lokacija: null })
    expect(html).not.toContain("Lokacija:")
  })
})
```

- [ ] **Step 6: Pokreni testove (fail) → kreiraj resend.ts**

Run: `pnpm test:unit -- lib/email/templates.test.ts`
Expected (prije Step 4 fajla): FAIL. Pošto je Step 4 već napisao `templates.ts`, ovaj korak treba da PROĐE — ako prolazi, nastavi. (Ako iz nekog razloga ne prolazi, popravi `templates.ts`.)

Kreiraj `lib/email/resend.ts`:

```ts
import { Resend } from "resend"
import { env } from "@/lib/env"

export type SendResult = { id: string; dryRun: boolean }

export type SendArgs = { to: string[]; subject: string; html: string }

const FROM = () => env.EMAIL_FROM ?? "Tehpro <onboarding@resend.dev>"

/** Dry-run: bez mreže; koristi se u testu i kad nema ključa. */
export async function drySend(_args: SendArgs): Promise<SendResult> {
  return { id: "dry-run", dryRun: true }
}

/** Stvarno slanje preko Resend-a; ako nema RESEND_API_KEY → dry-run. */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const key = env.RESEND_API_KEY
  if (!key) return drySend(args)
  const resend = new Resend(key)
  const { data, error } = await resend.emails.send({
    from: FROM(),
    to: args.to,
    subject: args.subject,
    html: args.html,
  })
  if (error) throw new Error(error.message)
  return { id: data?.id ?? "unknown", dryRun: false }
}
```

- [ ] **Step 7: Typecheck + lint + commit**

Run: `pnpm test:unit -- lib/email/templates.test.ts && pnpm typecheck && pnpm lint`
Expected: testovi PASS, typecheck PASS, lint 0 errors.
```bash
git add lib/env.ts lib/email package.json pnpm-lock.yaml .env.local.example
git commit -m "feat(faza6): resend klijent (dry-run gating) + email template + env"
```
(NE dodavati `.env.local`.)

---

## Task 3: Jezgro — primaoci + runReminders

**Files:**
- Create: `lib/reminders/recipients.ts`
- Test: `lib/reminders/recipients.test.ts`
- Create: `lib/reminders/runReminders.ts`

**Interfaces:**
- Consumes: `sendEmail`/`drySend`/`SendArgs`/`SendResult` (Task 2), `reminderSubject`/`reminderHtml` (Task 2), `get_due_podsjetnici` RPC (Task 1), `env.REMINDER_TO` (Task 2).
- Produces:
  - `parseEmailList(raw: string | null | undefined): string[]`
  - `assembleRecipients(args: { base: string[]; klijentEmails: string[]; lokacijaEmail: string | null }): string[]`
  - `runReminders(supabase: SupabaseClient<Database>, deps?: { send?: (a: SendArgs) => Promise<SendResult> }): Promise<ReminderRunResult>`
  - `type ReminderRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }` (vidi kod)

- [ ] **Step 1: Failing test `lib/reminders/recipients.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { parseEmailList, assembleRecipients } from "./recipients"

describe("parseEmailList", () => {
  it("razdvaja po zarezu i trim-uje", () => {
    expect(parseEmailList(" a@x.com , b@y.com ")).toEqual(["a@x.com", "b@y.com"])
  })
  it("prazno/undefined → []", () => {
    expect(parseEmailList("")).toEqual([])
    expect(parseEmailList(undefined)).toEqual([])
  })
})

describe("assembleRecipients", () => {
  it("spaja bazu + klijent + lokaciju, dedupe (case-insensitive), filtrira nevalidne", () => {
    const out = assembleRecipients({
      base: ["tehpro@x.com"],
      klijentEmails: ["TEHPRO@x.com", "sef@k.com", "nevalidno"],
      lokacijaEmail: "lok@l.com",
    })
    expect(out).toEqual(["tehpro@x.com", "sef@k.com", "lok@l.com"])
  })
  it("lokacija null se ignoriše", () => {
    expect(assembleRecipients({ base: ["a@x.com"], klijentEmails: [], lokacijaEmail: null }))
      .toEqual(["a@x.com"])
  })
  it("prazno kad nema validnih", () => {
    expect(assembleRecipients({ base: [], klijentEmails: ["x"], lokacijaEmail: null })).toEqual([])
  })
})
```

- [ ] **Step 2: Pokreni (fail) → implementiraj `lib/reminders/recipients.ts`**

Run: `pnpm test:unit -- lib/reminders/recipients.test.ts` → FAIL (modul ne postoji).

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function assembleRecipients(args: {
  base: string[]
  klijentEmails: string[]
  lokacijaEmail: string | null
}): string[] {
  const all = [
    ...args.base,
    ...args.klijentEmails,
    ...(args.lokacijaEmail ? [args.lokacijaEmail] : []),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of all) {
    const e = raw.trim()
    if (!EMAIL_RE.test(e)) continue
    const key = e.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e.toLowerCase())
  }
  return out
}
```

> Napomena: ovo je `lib/` (ne `scripts/`), pa `no-await-in-loop` vrijedi — ali ova petlja NEMA `await`, čisto sinhrono, dozvoljeno.

- [ ] **Step 3: Testovi prolaze**

Run: `pnpm test:unit -- lib/reminders/recipients.test.ts`
Expected: PASS (4 testa).

- [ ] **Step 4: Implementiraj `lib/reminders/runReminders.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { reminderSubject, reminderHtml } from "@/lib/email/templates"
import { assembleRecipients, parseEmailList } from "@/lib/reminders/recipients"

export type SentItem = { terminId: string; danaPrije: number; to: string[]; resendId: string; dryRun: boolean }
export type SkipItem = { terminId: string; danaPrije: number; razlog: string }
export type ErrItem = { terminId: string; danaPrije: number; message: string }
export type ReminderRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

const DEFAULT_DANA = [30, 14, 7, 1]

export async function runReminders(
  supabase: SupabaseClient<Database>,
  deps: { send?: (a: SendArgs) => Promise<SendResult> } = {},
): Promise<ReminderRunResult> {
  const send = deps.send ?? sendEmail

  const { data: post } = await supabase
    .from("postavke")
    .select("dana_prije")
    .eq("id", 1)
    .maybeSingle()
  const danaPrije = post?.dana_prije && post.dana_prije.length > 0 ? post.dana_prije : DEFAULT_DANA

  const { data: due, error } = await supabase.rpc("get_due_podsjetnici", { dana_prije_arr: danaPrije })
  if (error) throw new Error(error.message)
  const rows = due ?? []

  const base = parseEmailList(env.REMINDER_TO)

  // Sva slanja konkurentno (no-await-in-loop): Promise.all nad async map.
  const outcomes: Outcome[] = await Promise.all(
    rows.map(async (r): Promise<Outcome> => {
      // RPC kolone su (najvjerovatnije) nullable nakon type-gen → suzi prije upotrebe.
      if (
        r.termin_id == null ||
        r.dana_prije == null ||
        r.rok_dospijeca == null ||
        r.klijent_naziv == null ||
        r.vrsta_naziv == null
      ) {
        return { kind: "skip", terminId: r.termin_id ?? "", danaPrije: r.dana_prije ?? -1, razlog: "nepotpun red" }
      }
      const to = assembleRecipients({
        base,
        klijentEmails: r.podsjetnik_emails ?? [],
        lokacijaEmail: r.lokacija_kontakt_email,
      })
      if (to.length === 0) {
        return { kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "nema primalaca" }
      }
      try {
        const res = await send({
          to,
          subject: reminderSubject({ vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, danaPrije: r.dana_prije }),
          html: reminderHtml({
            klijent: r.klijent_naziv,
            vrsta: r.vrsta_naziv,
            rok: r.rok_dospijeca,
            danaPrije: r.dana_prije,
            lokacija: r.lokacija_naziv,
          }),
        })
        // Audit se UPISUJE i za dry-run — spec §9.1 ("mock Resend ... audit log") to traži,
        // i to čini idempotenciju testabilnom. Dry-run se NE koristi u produkciji (tamo je
        // RESEND_API_KEY postavljen i nema force-dry), pa nema rizika blokiranja stvarnih
        // slanja. Lokalno: `pnpm db:reset` prije prelaska sa dry-run na stvarno slanje.
        const { error: insErr } = await supabase.from("podsjetnici").insert({
          termin_id: r.termin_id,
          dana_prije: r.dana_prije,
          poslat_na: to,
          resend_id: res.id,
        })
        if (insErr) {
          if (/duplicate|unique/i.test(insErr.message)) {
            return { kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "vec poslat" }
          }
          // send je uspio ali audit nije → at-least-once (moguć duplikat u sljedećem run-u);
          // prihvatljivo za MVP (bolje dupli podsjetnik nego propušten rok).
          return { kind: "err", terminId: r.termin_id, danaPrije: r.dana_prije, message: insErr.message }
        }
        return { kind: "sent", terminId: r.termin_id, danaPrije: r.dana_prije, to, resendId: res.id, dryRun: res.dryRun }
      } catch (e) {
        return {
          kind: "err",
          terminId: r.termin_id,
          danaPrije: r.dana_prije,
          message: e instanceof Error ? e.message : String(e),
        }
      }
    }),
  )

  const sent: SentItem[] = []
  const skipped: SkipItem[] = []
  const errors: ErrItem[] = []
  for (const o of outcomes) {
    if (o.kind === "sent") sent.push({ terminId: o.terminId, danaPrije: o.danaPrije, to: o.to, resendId: o.resendId, dryRun: o.dryRun })
    else if (o.kind === "skip") skipped.push({ terminId: o.terminId, danaPrije: o.danaPrije, razlog: o.razlog })
    else errors.push({ terminId: o.terminId, danaPrije: o.danaPrije, message: o.message })
  }
  return { sent, skipped, errors }
}
```

> **Napomene:** (1) `Outcome` je discriminated union (`kind`) → partition u `for` petlji se sužava automatski, bez `as`/`any`. (2) Null-guard na vrhu je zbog nullable RPC kolona (potvrdi oblik iz Task 1 Step 5). (3) Audit-on-dry je svjesna odluka (vidi komentar u kodu) — odgovor na critique: spec traži audit i za mock; produkcija ne koristi dry-run.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm test:unit -- lib/reminders/recipients.test.ts && pnpm typecheck`
Expected: PASS.
```bash
git add lib/reminders
git commit -m "feat(faza6): recipients helper + runReminders jezgro"
```

---

## Task 4: Cron ruta + lokalna skripta

**Files:**
- Create: `app/api/cron/reminders/route.ts`
- Create: `scripts/send-reminders.ts`
- Modify: `package.json` (npm script `reminders`)

**Interfaces:**
- Consumes: `runReminders` (Task 3), `createAdminSupabaseClient` (postoji), `drySend` (Task 2), `env.CRON_SECRET` (Task 2).
- Produces: `POST /api/cron/reminders` → JSON `ReminderRunResult` (200) ili `{ error }` (401/500). Telo zahtjeva opciono `{ "dryRun": true }`.

- [ ] **Step 1: Kreiraj route handler**

`app/api/cron/reminders/route.ts`:

```ts
import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { drySend } from "@/lib/email/resend"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: Request) {
  const secret = env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let dryRun = false
  try {
    const body = (await req.json()) as { dryRun?: boolean } | null
    dryRun = body?.dryRun === true
  } catch {
    // prazno telo je OK
  }

  try {
    const supabase = createAdminSupabaseClient()
    const result = await runReminders(supabase, dryRun ? { send: drySend } : {})
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Greška"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Provjeri NextResponse import u Next 16**

Pročitaj `node_modules/next/dist/docs/` (route handlers) AKO `NextResponse`/potpis ne radi (AGENTS.md upozorava na breaking changes). `POST(req: Request)` + `NextResponse.json` je standard; potvrdi build.

- [ ] **Step 3: Kreiraj `scripts/send-reminders.ts`**

```ts
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { drySend } from "@/lib/email/resend"

const DRY = process.argv.includes("--dry")

async function main() {
  const supabase = createAdminSupabaseClient()
  const result = await runReminders(supabase, DRY ? { send: drySend } : {})
  console.log(JSON.stringify(result, null, 2))
  console.log(`\n✅ Poslato: ${result.sent.length} | Preskočeno: ${result.skipped.length} | Greške: ${result.errors.length}`)
}

main().catch((err) => {
  console.error("❌ send-reminders:", err)
  process.exit(1)
})
```

> `@/` alias u tsx skripti radi kao u `scripts/seed-from-excel.ts` (isti tsconfig paths). Ako alias ne radi pod tsx, koristi relativne import-e (`../lib/...`) kao fallback.

- [ ] **Step 4: Dodaj npm script**

U `package.json` `scripts`, dodaj poslije `seed`:
```json
    "reminders": "tsx --env-file=.env.local scripts/send-reminders.ts"
```

- [ ] **Step 5: Build + ručna provjera rute (dry-run)**

Run: `pnpm build` → Expected: ruta `ƒ /api/cron/reminders` u izlazu; bez grešaka.

Pokreni dev server (ako nije) i testiraj auth + dry-run preko Docker-dostupne baze:
```bash
# 401 bez secret-a
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/cron/reminders
# 200 sa secret-om + dry-run (zamijeni <SECRET> vrijednošću iz .env.local CRON_SECRET)
curl -s -X POST http://localhost:3000/api/cron/reminders \
  -H "Authorization: Bearer <SECRET>" -H "Content-Type: application/json" \
  -d '{"dryRun":true}' | head -c 400
```
Expected: prvi vraća `401`; drugi vraća JSON sa `sent/skipped/errors`. Pošto je `REMINDER_TO` postavljen (Task 2 Step 3), `sent` NIJE prazan ako postoje due termini (rok = `current_date + {30,14,7,1}`). Dry-run = bez stvarnih mailova, ali audit SE upisuje. Provjeri:
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select count(*) from podsjetnici;"
```
Expected: `> 0`. Idempotencija — ponovni POST dryRun NE pravi duplikate (count nepromijenjen; ti due redovi su sad isključeni preko `not exists` u RPC-u). Ako je `sent` prazan a `skipped` puno "nema primalaca" → `REMINDER_TO` nije postavljen; popravi `.env.local` i restartuj dev server (`next dev` čita env na startu).

- [ ] **Step 6: Lokalna skripta**

Run: `pnpm reminders -- --dry`
Expected: ispisuje JSON + sažetak; ne baca grešku.

- [ ] **Step 7: Commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.
```bash
git add app/api package.json scripts/send-reminders.ts
git commit -m "feat(faza6): POST /api/cron/reminders (CRON_SECRET) + lokalna skripta"
```

---

## Task 5: Postavke UI — konfigurabilni pragovi

**Files:**
- Create: `app/(dashboard)/postavke/page.tsx`
- Create: `app/(dashboard)/postavke/actions.ts`
- Create: `components/domain/ReminderForm.tsx`
- Modify: `components/shell/Sidebar.tsx`

**Interfaces:**
- Consumes: `createServerSupabaseClient` (postoji), `postavke` tabela (Task 1).
- Produces: `updatePostavke(_prev: ActionResult, formData: FormData): Promise<ActionResult>`; `/postavke` stranica; nav stavka "Postavke".

- [ ] **Step 1: Server action `app/(dashboard)/postavke/actions.ts`**

```ts
'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const schema = z.object({
  // "30, 14, 7, 1" → niz brojeva
  dana_prije: z
    .string()
    .min(1, "Unesite barem jedan prag")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .map((x) => Number(x)),
    )
    .refine((arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 365), {
      message: "Pragovi moraju biti cijeli brojevi 0–365, odvojeni zarezom",
    }),
})

export async function updatePostavke(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  // dedupe + sort opadajuće (30,14,7,1)
  const dana = Array.from(new Set(parsed.data.dana_prije)).sort((a, b) => b - a)
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("postavke")
    .update({ dana_prije: dana, updated_at: new Date().toISOString() })
    .eq("id", 1)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}
```

- [ ] **Step 2: `components/domain/ReminderForm.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updatePostavke, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function ReminderForm({ danaPrije }: { danaPrije: number[] }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(updatePostavke, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <form
      action={(fd) => {
        submitted.current = true
        action(fd)
      }}
      className="max-w-md space-y-3"
      data-testid="reminder-form"
    >
      <label className="block text-sm">
        <span className="text-slate-600">Pragovi (dana prije roka, odvojeni zarezom)</span>
        <Input
          name="dana_prije"
          defaultValue={danaPrije.join(", ")}
          data-testid="reminder-dana-prije"
        />
      </label>

      {state.ok === false && (state.message || state.errors?.dana_prije?.[0]) && (
        <p className="text-sm text-red-600" role="alert">
          {state.message ?? state.errors?.dana_prije?.[0]}
        </p>
      )}
      {state.ok && submitted.current === false && (
        <p className="text-sm text-emerald-600" data-testid="reminder-saved">Sačuvano.</p>
      )}

      <Button type="submit" disabled={pending} data-testid="reminder-submit">
        {pending ? "Spremam…" : "Spremi"}
      </Button>
    </form>
  )
}
```

> Napomena: poruka "Sačuvano." se prikazuje na inicijalnom `state.ok` — prihvatljivo za MVP; ako smeta, ukloni taj blok. Primarna verifikacija je perzistencija + `router.refresh()`.

- [ ] **Step 3: `app/(dashboard)/postavke/page.tsx`**

```tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { ReminderForm } from "@/components/domain/ReminderForm"

export default async function PostavkePage() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from("postavke").select("dana_prije").eq("id", 1).maybeSingle()
  const danaPrije = data?.dana_prije ?? [30, 14, 7, 1]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Postavke</h1>
      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="mb-1 text-base font-medium">Email podsjetnici</h2>
        <p className="mb-4 text-sm text-slate-500">
          Koliko dana prije roka dospijeća se šalje podsjetnik. Sistem dnevno provjerava termine.
        </p>
        <ReminderForm danaPrije={danaPrije} />
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Dodaj nav stavku u `components/shell/Sidebar.tsx`**

Dodaj `Settings` u lucide import i u `NAV_ITEMS` (poslije `Pregled`):
```ts
import {
  ClipboardList,
  Grid3x3,
  Calendar,
  Users,
  Bot,
  FileText,
  Settings,
} from "lucide-react"
```
```ts
  { href: "/pregled",  label: "Pregled",  icon: FileText },
  { href: "/postavke", label: "Postavke", icon: Settings },
] as const
```

- [ ] **Step 5: Build + ručna provjera (Playwright MCP ili dev)**

Run: `pnpm build` → Expected: `ƒ /postavke` ruta, bez grešaka.
Otvori `/postavke` (viewport ≥1280px): polje pokazuje `30, 14, 7, 1`. Promijeni na `45, 7` → Spremi. Provjeri:
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select dana_prije from postavke where id=1;"
```
Expected: `{45,7}`. Zatim vrati na default (`30, 14, 7, 1`) kroz UI ili SQL.

- [ ] **Step 6: Commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.
```bash
git add "app/(dashboard)/postavke" components/domain/ReminderForm.tsx components/shell/Sidebar.tsx
git commit -m "feat(faza6): /postavke + ReminderForm (konfigurabilni pragovi) + nav"
```

---

## Task 6: Per-klijent primaoci podsjetnika

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts` (`updateKlijent`)
- Modify: `components/domain/KlijentEditForm.tsx`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (proslijediti `podsjetnik_emails` + prikaz)

**Interfaces:**
- Consumes: `klijenti.podsjetnik_emails` (Task 1), `parseEmailList` (Task 3).
- Produces: `KlijentEditForm` polje `podsjetnik_emails`; `updateKlijent` upisuje `text[]`.

- [ ] **Step 1: Proširi `updateKlijent` u `app/(dashboard)/klijenti/actions.ts`**

Dodaj import na vrh (poslije postojećih):
```ts
import { parseEmailList } from "@/lib/reminders/recipients"
```
Promijeni `updateKlijentSchema` i `updateKlijent` patch:
```ts
const updateKlijentSchema = z.object({
  id: z.string().uuid(),
  naziv: z.string().min(1, "Naziv je obavezan").max(200).optional(),
  napomena: optionalText(2000),
  podsjetnik_emails: z.string().max(2000).optional(),
})
```
U `updateKlijent`, poslije `if (formData.has("napomena")) ...`:
```ts
  if (formData.has("podsjetnik_emails")) {
    patch.podsjetnik_emails = parseEmailList(f.podsjetnik_emails ?? "")
  }
```
(`KlijentiUpdate` već dozvoljava `podsjetnik_emails: string[]` nakon regen tipova u Task 1.)

- [ ] **Step 2: Dodaj polje u `KlijentEditForm.tsx`**

Proširi prop tip i dodaj input. Promijeni potpis:
```tsx
export function KlijentEditForm({
  klijent,
}: {
  klijent: { id: string; naziv: string; napomena: string | null; podsjetnik_emails: string[] }
}) {
```
Poslije "Napomena" `<label>` bloka, dodaj:
```tsx
          <label className="block text-sm">
            <span className="text-slate-600">Primaoci podsjetnika (email, odvojeni zarezom)</span>
            <Input
              name="podsjetnik_emails"
              defaultValue={klijent.podsjetnik_emails.join(", ")}
              placeholder="npr. sef@firma.com, tehnicar@firma.com"
              data-testid="edit-klijent-primaoci"
            />
          </label>
```

- [ ] **Step 3: Proslijedi `podsjetnik_emails` iz `[id]/page.tsx`**

`app/(dashboard)/klijenti/[id]/page.tsx` čita klijenta iz **`klijenti_view`**, koji NE izlaže `podsjetnik_emails` (potvrđeno critique-om — view ima samo agregate). NE diraj view. Umjesto toga dodaj 4. paralelni fetch u postojeći `Promise.all` (bez N+1):

```ts
const [/* postojeći rezultati */, primaociRes] = await Promise.all([
  // ...postojeći fetch-evi (klijenti_view, termini, lokacije...) ostaju...
  supabase.from("klijenti").select("podsjetnik_emails").eq("id", id).maybeSingle(),
])
```
Pa proslijedi u formu:
```tsx
<KlijentEditForm
  klijent={{
    id: /* postojeće */,
    naziv: /* postojeće */,
    napomena: /* postojeće */,
    podsjetnik_emails: primaociRes.data?.podsjetnik_emails ?? [],
  }}
/>
```
(Implementator: pročitaj tačan oblik postojećeg `Promise.all` i `KlijentEditForm` poziva pa uklopi 4. fetch i 4. prop. `id` je već dostupan iz `params`.)

- [ ] **Step 4: (Opciono) prikaži primaoce na Kontakti/Termini tabu**

Ako je trivijalno, prikaži trenutne primaoce kao tekst na detalju (npr. ispod naziva). Nije obavezno za prolaz; preskoči ako širi obim.

- [ ] **Step 5: Build + ručna provjera**

Run: `pnpm build` → PASS.
Otvori `/klijenti/<id>` → Uredi → unesi `a@x.com, b@y.com` u Primaoci → Spremi. Provjeri:
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select podsjetnik_emails from klijenti where id='<id>';"
```
Expected: `{a@x.com,b@y.com}`.

- [ ] **Step 6: Commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.
```bash
git add "app/(dashboard)/klijenti"
git commit -m "feat(faza6): per-klijent podsjetnik_emails u edit formi + akciji"
```

---

## Task 7: E2E + comprehensive verifikacija + push

**Files:**
- Create: `tests/e2e/06-podsjetnici.spec.ts`

**Interfaces:**
- Consumes: sve prethodno.

- [ ] **Step 1: Napiši `tests/e2e/06-podsjetnici.spec.ts`**

```ts
import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"

// Pročitaj CRON_SECRET iz .env.local apsolutnom putanjom (nezavisno od cwd).
// Dev server (pnpm dev) već koristi istu vrijednost.
function cronSecret(): string {
  const p = path.resolve(process.cwd(), ".env.local")
  const txt = readFileSync(p, "utf8") // baci jasno ako fajl/var fali → znači .env.local nije setovan
  const line = txt.split("\n").find((l) => l.startsWith("CRON_SECRET="))
  const val = line ? line.slice("CRON_SECRET=".length).trim() : ""
  if (!val) throw new Error("CRON_SECRET nije u .env.local — vidi Task 2 Step 3")
  return val
}

test.describe.configure({ mode: "serial" })

test.describe("Faza 6 — Cron endpoint", () => {
  test("bez secret-a → 401", async ({ request }) => {
    const res = await request.post("/api/cron/reminders")
    expect(res.status()).toBe(401)
  })

  test("pogrešan secret → 401", async ({ request }) => {
    const res = await request.post("/api/cron/reminders", {
      headers: { Authorization: "Bearer pogresno", "Content-Type": "application/json" },
      data: { dryRun: true },
    })
    expect(res.status()).toBe(401)
  })

  test("dryRun + ispravan secret → 200; šalje (audit) i idempotentan je", async ({ request }) => {
    const secret = cronSecret()
    const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }

    // Prvi run: REMINDER_TO je postavljen → due termini imaju primaoce → sent > 0, audit upisan.
    const first = await (await request.post("/api/cron/reminders", { headers, data: { dryRun: true } })).json()
    expect(Array.isArray(first.sent)).toBe(true)
    expect(Array.isArray(first.skipped)).toBe(true)
    expect(Array.isArray(first.errors)).toBe(true)
    expect(first.sent.length).toBeGreaterThan(0) // dokazuje da recipient pipeline radi (REMINDER_TO setovan)
    expect(first.errors.length).toBe(0)

    // Drugi run: isti due redovi su sad u podsjetnici → RPC anti-join ih isključuje → 0 novih.
    const second = await (await request.post("/api/cron/reminders", { headers, data: { dryRun: true } })).json()
    expect(second.sent.length).toBe(0)
  })
})

test.describe("Faza 6 — Postavke UI", () => {
  test("uređivanje pragova se perzistira", async ({ page }) => {
    await page.goto("/postavke")
    await expect(page.getByTestId("reminder-form")).toBeVisible()
    const input = page.getByTestId("reminder-dana-prije")
    await input.fill("45, 7")
    await page.getByTestId("reminder-submit").click()
    await expect(page.getByTestId("reminder-dana-prije")).toHaveValue(/45/)
    // vrati default
    await input.fill("30, 14, 7, 1")
    await page.getByTestId("reminder-submit").click()
    await expect(page.getByTestId("reminder-dana-prije")).toHaveValue(/30/)
  })

  test("bez console grešaka na /postavke", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/postavke")
    await expect(page.getByTestId("reminder-form")).toBeVisible()
    expect(errors).toHaveLength(0)
  })
})

test.describe("Faza 6 — Per-klijent primaoci", () => {
  test("uređivanje primalaca klijenta se perzistira", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await expect(page).toHaveURL(/\/klijenti\//)

    await page.getByTestId("uredi-klijent-btn").click()
    await expect(page.getByTestId("klijent-edit-sheet")).toBeVisible()
    await page.getByTestId("edit-klijent-primaoci").fill("qa-primalac@example.com")
    await page.getByTestId("edit-klijent-submit").click()
    // Sačekaj da se sheet ZATVORI prije ponovnog otvaranja (base-ui timing + router.refresh).
    await expect(page.getByTestId("klijent-edit-sheet")).toBeHidden({ timeout: 5000 })

    await page.getByTestId("uredi-klijent-btn").click()
    await expect(page.getByTestId("klijent-edit-sheet")).toBeVisible()
    await expect(page.getByTestId("edit-klijent-primaoci")).toHaveValue(/qa-primalac@example.com/)

    // očisti
    await page.getByTestId("edit-klijent-primaoci").fill("")
    await page.getByTestId("edit-klijent-submit").click()
    await expect(page.getByTestId("klijent-edit-sheet")).toBeHidden({ timeout: 5000 })
  })
})
```

> Napomena: `klijent-card`, `uredi-klijent-btn`, `klijent-edit-sheet`, `edit-klijent-submit` testid-ovi su potvrđeni da postoje (critique). `edit-klijent-primaoci` dodaje Task 6.

> Napomena: `klijent-card` testid mora postojati na `KlijentCard` linku — provjeri; ako je drugačiji selektor, prilagodi (npr. `page.getByRole("link").filter(...)`). Implementator: uskladi selektore sa stvarnim `data-testid`-ovima (vidi `components/domain/KlijentCard.tsx`).

- [ ] **Step 2: Osiguraj test env**

Hard precheck PRIJE E2E (gate ovo ne može uhvatiti kroz git jer `.env.local` nije commitovan):
```bash
grep -q '^CRON_SECRET=.\+' .env.local && grep -q '^REMINDER_TO=.\+' .env.local || { echo "FALI CRON_SECRET/REMINDER_TO u .env.local — vidi Task 2 Step 3"; exit 1; }
```
Dev server (`pnpm dev`, koji Playwright pokreće) automatski učitava `.env.local`. `RESEND_API_KEY` može biti prazan/prisutan — E2E uvijek šalje `dryRun:true` → ruta koristi `drySend` → stvarni mailovi se NE šalju čak i ako je ključ prisutan. **Ako si mijenjao `.env.local` dok je dev server radio, restartuj ga** (next dev čita env na startu) — inače ruta vidi staru/praznu `CRON_SECRET` i vraća 401.

- [ ] **Step 3: Pokreni cijeli E2E paket**

Run: `pnpm db:reset && pnpm seed` (čist state), pa `pnpm test:e2e`
Expected: SVI testovi prolaze (Chromium + WebKit), uključujući 01–06. Zabilježi ukupan broj.

- [ ] **Step 4: Puna verifikacija (gate priprema)**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test:unit`
Expected: typecheck PASS, lint 0 errors, build OK (rute `/api/cron/reminders`, `/postavke`), unit svi PASS.

- [ ] **Step 5: (Opciono, stvarni email test)** Ako korisnik da pravi `RESEND_API_KEY` + verifikovan `EMAIL_FROM` + `REMINDER_TO`:

Run jednom (bez dry-run), npr.:
```bash
curl -s -X POST http://localhost:3000/api/cron/reminders -H "Authorization: Bearer <SECRET>" -H "Content-Type: application/json" -d '{}' | head -c 300
```
Provjeri da email stiže na `REMINDER_TO`. (Ako Resend domen nije verifikovan, koristi `onboarding@resend.dev` FROM i šalji na vlastiti nalog.) Nakon testa, `pnpm db:reset && pnpm seed` da se očisti audit.

- [ ] **Step 6: Commit + push**

```bash
git add tests/e2e/06-podsjetnici.spec.ts
git commit -m "test(faza6): E2E podsjetnici (401, dry-run cron, postavke, per-klijent primaoci)"
git push origin main
```

---

## Phase 6 Gate (fresh agent)

Nakon T7, dispečuj svjež agent bez konteksta da nezavisno validira:
- `pnpm db:reset && pnpm seed`, pa `pnpm build && pnpm lint && pnpm typecheck` (exit 0; lint 0 errors).
- `pnpm test:unit` (svi PASS, uklj. templates + recipients).
- `pnpm test:e2e` (svi PASS, 01–06).
- DB: `\d postavke`, `\d podsjetnici` (UNIQUE `uq_podsjetnici_termin_dana`), `klijenti.podsjetnik_emails` kolona, `get_due_podsjetnici` RPC postoji.
- Env precheck: `grep -q '^CRON_SECRET=.\+' .env.local && grep -q '^REMINDER_TO=.\+' .env.local` (oba postoje).
- Cron: `POST /api/cron/reminders` bez/pogrešnim auth → 401; sa `CRON_SECRET` + `{dryRun:true}` → 200, `sent.length > 0` (REMINDER_TO setovan) + audit upis; ponovni poziv → `sent.length === 0` (idempotencija). Dry-run ne šalje stvarne mailove.
- Manual: `/postavke` mijenja `dana_prije`; `/klijenti/[id]` Uredi snima `podsjetnik_emails`.
- Inventar: sve datoteke iz "File Structure" postoje; nema `vercel.json` (local-only); `.env.local` NIJE u git-u.
- Git: čisto, push-ovano, ~7 commitova od `v0.5.0`.

Na čist gate (0 blokera): tag `v0.6.0` + push, ažuriraj memoriju (`project_tehpro_mvp.md`).

---

## Self-Review (autor)

**Spec coverage (§8 Faza 6 deliverables):**
- "Resend setup" → Task 2 (`lib/email/resend.ts` + `resend` dep + env). ✓
- "email template" → Task 2 (`lib/email/templates.ts` + testovi). ✓
- "Vercel Cron" → Task 4 (HTTP ruta + lokalna skripta; Vercel config odgođen per local-only — dokumentovano u Global Constraints). ✓ (svjesna divergencija)
- "ReminderForm" → Task 5 (`components/domain/ReminderForm.tsx`). ✓
- "audit log" → Task 1 (`podsjetnici` UNIQUE) + Task 3 (upis u runReminders). ✓
- E2E `06-podsjetnici.spec.ts` "Cron endpoint POST vraća poslate emails, audit log; mock Resend" → Task 7 (dry-run = "mock"). ✓
- Korisničke odluke: fiksni primaoci (env `REMINDER_TO`) ✓; per-klijent primaoci (Task 6) ✓; konfigurabilni pragovi (Task 5) ✓; stvarno slanje sa ključem (Task 2 gating + Task 7 Step 5) ✓.

**Placeholder scan:** Sav kod je konkretan; nema TODO/„handle errors“ bez koda. Jedini „implementator odluči“ je Task 6 Step 3 (kako čita `podsjetnik_emails` iz `[id]/page.tsx`) i Task 7 selektor `klijent-card` — oba zahtijevaju čitanje postojećeg fajla jer tačan oblik zavisi od trenutnog koda; data su jasna uputstva i fallback.

**Type consistency:** `SendArgs`/`SendResult` (Task 2) korišteni u Task 3/4; `runReminders(supabase, {send})` potpis isti u ruti i skripti; `ReminderRunResult` polja (`sent/skipped/errors`) ista u ruti i E2E; `get_due_podsjetnici` kolone (`vrsta_naziv`, `lokacija_naziv`, `lokacija_kontakt_email`, `podsjetnik_emails`) korištene tačno tim imenima u `runReminders`. RPC vraća `rok_dospijeca date` → koristi se kao `rok` (ISO string) u `reminderHtml` (Supabase vraća `date` kao `YYYY-MM-DD` string ✓).
