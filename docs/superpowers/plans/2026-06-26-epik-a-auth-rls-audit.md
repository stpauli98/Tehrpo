# EPIK A — Auth, uloge, RLS, audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uvesti prijavu (Supabase Auth), uloge admin/operater/pregled, pristup po dodjeli (RLS) i automatski audit log u postojeći `tehpro-mvp`.

**Architecture:** RLS je jedini izvor istine za vidljivost (helper `ima_pristup_klijentu` + `auth.uid()`); middleware radi samo authentication gate; audit se piše generičkim DB trigerom. Redoslijed je dependency-safe: sve ne-rušeće promjene (tabele, helperi, audit, login, middleware, test harness) idu prije, a **uključivanje RLS-a je posljednji zadatak** — tako app i postojећih 16 testova rade tokom cijelog razvoja.

**Tech Stack:** Next.js 16.2.9 (App Router) · `@supabase/ssr` + `@supabase/supabase-js` · Postgres 17 (cloud) · Vitest · Playwright · Zod · shadcn/ui · sonner.

## Global Constraints

- **Okruženje:** in-place na cloud Supabase projektu (`fqtqkehjidkzeasiegnq`). Svi podaci su **mock i zamjenjivi** — smije se brisati/ponovo seedovati. (Svjesno odstupanje od globalnog „Docker za backend" pravila — korisnikov eksplicitan izbor za ovaj epik.)
- **Migracije se primjenjuju** sa: `pnpm db:apply-cloud supabase/migrations/<fajl>.sql` (koristi `DATABASE_URL` iz `.env.local`).
- **Tipovi:** nakon svake migracije regeneriši `db/types.ts` sa `pnpm exec supabase gen types typescript --db-url "$DATABASE_URL" > db/types.ts` (NE `--local` — nema lokalne baze).
- **Next.js 16.2.9 ima breaking promjene** — prije pisanja `middleware.ts` PROČITAJ `node_modules/next/dist/docs/` (vidi AGENTS.md).
- **Desktop-only:** zabranjeni `sm:`/`md:` Tailwind prefiksi (ESLint fail). Koristi `lg:`/`xl:` ili bez prefiksa.
- **App kod koristi ISKLJUČIVO `@supabase/supabase-js` SDK** (preko `lib/supabase/*` helpera). Direktan `pg` samo u `scripts/`.
- **Bez `await` u `.map()`/`for` petlji koje zovu Supabase** (N+1 blocker) — koristi `Promise.all`.
- **Domenski jezik:** srpski (latinica, snake_case identifikatori kao u postojećem kodu).
- **Server Action konvencija:** potpis `(_prev: ActionResult, formData: FormData)`, povrat `ActionResult = {ok:true,...} | {ok:false, errors?, message?}`.
- **Service role klijent** (`createAdminSupabaseClient`) samo u `scripts/` i Server Actions koje admin pokreće (kreiranje korisnika); nikad za čitanje liste klijenata.

---

## File Structure

**Migracije (`supabase/migrations/`):**
- `20260626210000_auth_korisnici.sql` — enum, `korisnici`, `korisnik_klijent`, `audit_log`, helperi (`je_admin`, `je_pregled`, `ima_pristup_klijentu`).
- `20260626210500_audit_trigger.sql` — `tg_audit()` + kačenje na tabele.
- `20260626211000_rls_enable.sql` — **(zadnja, breaking)** enable RLS + politike + `security_invoker` viewovi + storage politika.

**Skripte:**
- `scripts/seed-admin.ts` — kreira admin auth nalog + `korisnici` red.

**App:**
- `lib/auth/roles.ts` — čiste funkcije za UI gating (unit-tested).
- `lib/auth/current-user.ts` — `getTrenutniKorisnik()` (server).
- `lib/supabase/server.ts` — aktivirati `setAll` (modify).
- `app/prijava/page.tsx` + `app/prijava/actions.ts` — login.
- `app/zaboravljena-lozinka/page.tsx` + `actions.ts` — reset zahtjev.
- `app/auth/nova-lozinka/page.tsx` + `actions.ts` — postavljanje nove lozinke.
- `middleware.ts` — auth gate.
- `components/shell/TopBar.tsx` — korisnik + odjava (modify).
- `app/(dashboard)/postavke/page.tsx` + `actions.ts` — tab „Korisnici" + admin gate (modify).
- `components/domain/KorisniciTab.tsx`, `NoviKorisnikButton.tsx`, `DodjelaKlijenata.tsx` — UI.

**Testovi:**
- `lib/auth/roles.test.ts` — unit.
- `tests/e2e/auth.setup.ts` — Playwright setup projekt (login kao admin → `storageState`).
- `tests/e2e/db.ts` — dodati `ensureKorisnik`, `assignKlijent`, `clearKorisnik` helpere (modify).
- `tests/e2e/17-auth-rls.spec.ts` — izolacija po ulozi.
- `playwright.config.ts` — setup projekt + `storageState` (modify).

---

## Task 1: DB migracija — korisnici, korisnik_klijent, audit_log, helperi

**Files:**
- Create: `supabase/migrations/20260626210000_auth_korisnici.sql`
- Modify: `db/types.ts` (regenerisan)
- Test: `tests/e2e/db.ts` (privremena provjera u Step 2 preko service-role klijenta)

**Interfaces:**
- Produces (SQL): tabele `korisnici(id,ime,email,uloga,aktivan,created_at)`, `korisnik_klijent(korisnik_id,klijent_id)`, `audit_log(...)`; funkcije `je_admin() bool`, `je_pregled() bool`, `ima_pristup_klijentu(uuid) bool`; enum `korisnik_uloga`.

- [ ] **Step 1: Napiši migraciju**

```sql
-- supabase/migrations/20260626210000_auth_korisnici.sql
-- EPIK A: profil korisnika, N:N dodjela klijenata, audit log, RLS helperi.
-- NE uključuje RLS (vidi 20260626211000_rls_enable.sql) — ovo je ne-rušeća migracija.

create type korisnik_uloga as enum ('admin','operater','pregled');

create table korisnici (
  id          uuid primary key references auth.users(id) on delete cascade,
  ime         text not null,
  email       text not null unique,
  uloga       korisnik_uloga not null default 'pregled',
  aktivan     bool not null default true,
  created_at  timestamptz not null default now(),
  constraint chk_korisnici_ime check (length(trim(ime)) > 0)
);

create table korisnik_klijent (
  korisnik_id  uuid not null references korisnici(id) on delete cascade,
  klijent_id   uuid not null references klijenti(id)  on delete cascade,
  primary key (korisnik_id, klijent_id)
);
create index idx_kk_korisnik on korisnik_klijent (korisnik_id);
create index idx_kk_klijent  on korisnik_klijent (klijent_id);

create table audit_log (
  id          bigint generated always as identity primary key,
  korisnik_id uuid references korisnici(id) on delete set null,
  akcija      text not null,
  entitet     text not null,
  entitet_id  text,
  staro       jsonb,
  novo        jsonb,
  vrijeme     timestamptz not null default now()
);
create index idx_audit_entitet on audit_log (entitet, entitet_id);
create index idx_audit_vrijeme on audit_log (vrijeme desc);

-- Helperi: SECURITY DEFINER da mogu čitati korisnici/korisnik_klijent i kad RLS bude uključen.
create or replace function je_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from korisnici k
    where k.id = auth.uid() and k.uloga = 'admin' and k.aktivan);
$$;

create or replace function je_pregled() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from korisnici k
    where k.id = auth.uid() and k.uloga = 'pregled' and k.aktivan);
$$;

create or replace function ima_pristup_klijentu(p_klijent_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select je_admin() or exists (
    select 1 from korisnik_klijent kk
    join korisnici k on k.id = kk.korisnik_id
    where kk.korisnik_id = auth.uid()
      and kk.klijent_id = p_klijent_id
      and k.aktivan);
$$;
```

- [ ] **Step 2: Primijeni i verifikuj (migracija je sama sebi test)**

Run:
```bash
pnpm db:apply-cloud supabase/migrations/20260626210000_auth_korisnici.sql
```
Expected: `✅ Primijenjeno: supabase/migrations/20260626210000_auth_korisnici.sql`

Provjeri da tabele/funkcije postoje (service-role zaobilazi RLS):
```bash
pnpm exec tsx --env-file=.env.local -e "import('./tests/e2e/db.ts').then(async ({db})=>{const a=await db.from('korisnici').select('id').limit(1);const b=await db.from('korisnik_klijent').select('korisnik_id').limit(1);const c=await db.from('audit_log').select('id').limit(1);console.log('korisnici',a.error?.message??'OK');console.log('korisnik_klijent',b.error?.message??'OK');console.log('audit_log',c.error?.message??'OK')})"
```
Expected: tri reda `OK` (bez error poruka).

- [ ] **Step 3: Regeneriši tipove**

Run:
```bash
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)
pnpm exec supabase gen types typescript --db-url "$DATABASE_URL" > db/types.ts
```
Expected: `db/types.ts` sadrži `korisnici`, `korisnik_klijent`, `audit_log`. Provjeri: `grep -c "korisnik_klijent" db/types.ts` → ≥1.

- [ ] **Step 4: Build + typecheck**

Run: `pnpm tsc --noEmit`
Expected: bez grešaka.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260626210000_auth_korisnici.sql db/types.ts
git commit -m "feat(auth): korisnici, korisnik_klijent, audit_log tabele + RLS helperi"
```

---

## Task 2: Audit trigger

**Files:**
- Create: `supabase/migrations/20260626210500_audit_trigger.sql`
- Test: ad-hoc preko service-role klijenta (Step 3)

**Interfaces:**
- Consumes: `audit_log` tabela (Task 1).
- Produces (SQL): funkcija `tg_audit()`; trigeri `audit_<tabela>` na `klijenti, lokacije, termini, vrste_provjera, korisnici, korisnik_klijent, klijent_provjere`.

- [ ] **Step 1: Napiši migraciju**

```sql
-- supabase/migrations/20260626210500_audit_trigger.sql
-- Generički audit: bilježi INSERT/UPDATE/DELETE sa staro→novo (JSONB).
-- Akter = auth.uid() (null za service-role/cron = sistemska izmjena).

create or replace function tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(NEW.id::text, OLD.id::text);
  insert into audit_log (korisnik_id, akcija, entitet, entitet_id, staro, novo)
  values (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_id,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end
  );
  return coalesce(NEW, OLD);
end; $$;

create trigger audit_klijenti        after insert or update or delete on klijenti        for each row execute function tg_audit();
create trigger audit_lokacije        after insert or update or delete on lokacije        for each row execute function tg_audit();
create trigger audit_termini         after insert or update or delete on termini         for each row execute function tg_audit();
create trigger audit_vrste_provjera  after insert or update or delete on vrste_provjera  for each row execute function tg_audit();
create trigger audit_korisnici       after insert or update or delete on korisnici       for each row execute function tg_audit();
create trigger audit_korisnik_klijent after insert or update or delete on korisnik_klijent for each row execute function tg_audit();
create trigger audit_klijent_provjere after insert or update or delete on klijent_provjere for each row execute function tg_audit();
```

- [ ] **Step 2: Primijeni**

Run: `pnpm db:apply-cloud supabase/migrations/20260626210500_audit_trigger.sql`
Expected: `✅ Primijenjeno: ...`

- [ ] **Step 3: Verifikuj da trigger piše audit red**

Run:
```bash
pnpm exec tsx --env-file=.env.local -e "import('./tests/e2e/db.ts').then(async ({db,firstKlijentId})=>{const id=await firstKlijentId();await db.from('klijenti').update({napomena:'audit-test '+Date.now()}).eq('id',id);const {data}=await db.from('audit_log').select('akcija,entitet,staro,novo').eq('entitet','klijenti').eq('entitet_id',id).order('vrijeme',{ascending:false}).limit(1);console.log(JSON.stringify(data?.[0]??'NEMA',null,0))})"
```
Expected: JSON sa `"akcija":"UPDATE","entitet":"klijenti"` i `staro`/`novo` objektima. (Akter je null jer je service-role — očekivano.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626210500_audit_trigger.sql
git commit -m "feat(audit): generički audit trigger (staro→novo) na ključnim tabelama"
```

---

## Task 3: Seed admin skripta

**Files:**
- Create: `scripts/seed-admin.ts`
- Modify: `package.json` (script `seed:admin`)

**Interfaces:**
- Consumes: `createAdminSupabaseClient` (`lib/supabase/admin.ts`), `korisnici` tabela.
- Produces: admin auth nalog + `korisnici` red sa `uloga='admin'`.

- [ ] **Step 1: Napiši skriptu**

```ts
// scripts/seed-admin.ts
// Kreira (ili ažurira) admin nalog. Idempotentno: ako email postoji, samo osigura korisnici red.
// Pokretanje: pnpm seed:admin <email> <lozinka> "<ime>"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

async function main() {
  const [email, lozinka, ime] = process.argv.slice(2)
  if (!email || !lozinka || !ime) throw new Error('Upotreba: pnpm seed:admin <email> <lozinka> "<ime>"')
  const admin = createAdminSupabaseClient()

  // 1. Nađi ili kreiraj auth korisnika
  const { data: list } = await admin.auth.admin.listUsers()
  let userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: lozinka, email_confirm: true,
    })
    if (error) throw error
    userId = data.user.id
    console.log("✅ Kreiran auth nalog:", email)
  } else {
    console.log("ℹ️  Auth nalog već postoji:", email)
  }

  // 2. Upsert profila sa ulogom admin
  const { error: upErr } = await admin.from("korisnici").upsert(
    { id: userId, ime, email, uloga: "admin", aktivan: true },
    { onConflict: "id" },
  )
  if (upErr) throw upErr
  console.log("✅ Admin profil spreman:", ime, `<${email}>`)
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
```

- [ ] **Step 2: Dodaj npm script**

U `package.json`, u `"scripts"`, dodaj liniju:
```json
"seed:admin": "tsx --env-file=.env.local scripts/seed-admin.ts",
```

- [ ] **Step 3: Pokreni seed**

Run: `pnpm seed:admin nmil322@icloud.com Tehpro2026! "Nikola Milošević"`
Expected: `✅ Admin profil spreman: Nikola Milošević <nmil322@icloud.com>`

- [ ] **Step 4: Verifikuj**

Run:
```bash
pnpm exec tsx --env-file=.env.local -e "import('./tests/e2e/db.ts').then(async ({db})=>{const {data}=await db.from('korisnici').select('ime,uloga,aktivan').eq('uloga','admin');console.log(JSON.stringify(data))})"
```
Expected: niz sa bar jednim `{"ime":"Nikola Milošević","uloga":"admin","aktivan":true}`.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-admin.ts package.json
git commit -m "feat(auth): seed-admin skripta (idempotentno kreira admin nalog)"
```

---

## Task 4: Auth helperi (roles + current-user)

**Files:**
- Create: `lib/auth/roles.ts`
- Create: `lib/auth/current-user.ts`
- Test: `lib/auth/roles.test.ts`

**Interfaces:**
- Produces:
  - `type Uloga = 'admin' | 'operater' | 'pregled'`
  - `mozeUrediti(uloga: Uloga): boolean` — true za admin/operater
  - `jeAdmin(uloga: Uloga): boolean`
  - `type TrenutniKorisnik = { id: string; ime: string; uloga: Uloga }`
  - `getTrenutniKorisnik(): Promise<TrenutniKorisnik | null>` (server)

- [ ] **Step 1: Napiši failing test**

```ts
// lib/auth/roles.test.ts
import { describe, it, expect } from "vitest"
import { mozeUrediti, jeAdmin } from "./roles"

describe("roles", () => {
  it("mozeUrediti: admin i operater true, pregled false", () => {
    expect(mozeUrediti("admin")).toBe(true)
    expect(mozeUrediti("operater")).toBe(true)
    expect(mozeUrediti("pregled")).toBe(false)
  })
  it("jeAdmin: samo admin", () => {
    expect(jeAdmin("admin")).toBe(true)
    expect(jeAdmin("operater")).toBe(false)
    expect(jeAdmin("pregled")).toBe(false)
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/auth/roles.test.ts`
Expected: FAIL — `Cannot find module './roles'`.

- [ ] **Step 3: Napiši roles.ts**

```ts
// lib/auth/roles.ts
export type Uloga = "admin" | "operater" | "pregled"

export function mozeUrediti(uloga: Uloga): boolean {
  return uloga === "admin" || uloga === "operater"
}

export function jeAdmin(uloga: Uloga): boolean {
  return uloga === "admin"
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/auth/roles.test.ts`
Expected: PASS (2 testa).

- [ ] **Step 5: Napiši current-user.ts**

```ts
// lib/auth/current-user.ts
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { Uloga } from "@/lib/auth/roles"

export type TrenutniKorisnik = { id: string; ime: string; uloga: Uloga }

/** Vraća profil prijavljenog korisnika ili null. Jedan DB round-trip. */
export async function getTrenutniKorisnik(): Promise<TrenutniKorisnik | null> {
  const supabase = await createServerSupabaseClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data } = await supabase
    .from("korisnici")
    .select("id, ime, uloga")
    .eq("id", auth.user.id)
    .maybeSingle()
  if (!data) return null
  return { id: data.id, ime: data.ime, uloga: data.uloga as Uloga }
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm tsc --noEmit`
Expected: bez grešaka.
```bash
git add lib/auth/roles.ts lib/auth/roles.test.ts lib/auth/current-user.ts
git commit -m "feat(auth): roles helperi (unit-tested) + getTrenutniKorisnik"
```

---

## Task 5: Login (cookie setAll + Server Action + /prijava)

**Files:**
- Modify: `lib/supabase/server.ts` (aktiviraj `setAll`)
- Create: `app/prijava/page.tsx`
- Create: `app/prijava/actions.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient`.
- Produces: ruta `/prijava`; Server Action `prijaviSe(_prev, formData)` → redirect `/pregled` ili `ActionResult` greška.

- [ ] **Step 1: Aktiviraj setAll u server.ts**

U `lib/supabase/server.ts`, zamijeni `catch { ... }` blok tako da pokušaj set-a ne guta tiho u Route Handler/Server Action kontekstu — ostavi try/catch ali ukloni zastarjeli komentar:

```ts
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // U RSC render kontekstu set baca — middleware osvježava sesiju, pa je ovo bezbjedno ignorisati.
          }
        },
```

- [ ] **Step 2: Napiši login Server Action**

```ts
// app/prijava/actions.ts
"use server"
import { z } from "zod"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult = { ok: false; message?: string } | { ok: true }

const schema = z.object({
  email: z.string().email("Neispravan email"),
  lozinka: z.string().min(1, "Unesite lozinku"),
})

export async function prijaviSe(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, message: "Unesite email i lozinku." }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.lozinka,
  })
  if (error) return { ok: false, message: "Pogrešan email ili lozinka." }
  redirect("/pregled")
}
```

- [ ] **Step 3: Napiši /prijava stranicu (client forma)**

```tsx
// app/prijava/page.tsx
"use client"
import { useActionState } from "react"
import { prijaviSe, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: true }

export default function PrijavaPage() {
  const [state, action, pending] = useActionState(prijaviSe, initial)
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form action={action} className="w-80 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-brand text-white text-xs font-bold grid place-items-center">T</div>
          <span className="font-semibold">Tehpro</span>
        </div>
        <h1 className="text-lg font-medium">Prijava</h1>
        <Input name="email" type="email" placeholder="Email" autoComplete="username" required />
        <Input name="lozinka" type="password" placeholder="Lozinka" autoComplete="current-password" required />
        {state.ok === false && state.message && (
          <p className="text-sm text-status-kasni" role="alert">{state.message}</p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Prijava…" : "Prijavi se"}
        </Button>
        <a href="/zaboravljena-lozinka" className="block text-center text-xs text-slate-500 hover:underline">
          Zaboravljena lozinka?
        </a>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Ručna provjera login-a (RLS još nije uključen)**

Run: `pnpm dev` pa otvori `http://localhost:3000/prijava`, prijavi se admin nalogom iz Task 3.
Expected: redirect na `/pregled`, dashboard se prikazuje.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: bez grešaka.
```bash
git add lib/supabase/server.ts app/prijava
git commit -m "feat(auth): /prijava ekran + login Server Action + aktiviran cookie setAll"
```

---

## Task 6: Middleware (auth gate)

**Files:**
- Create: `middleware.ts`

**Interfaces:**
- Consumes: `@supabase/ssr` `createServerClient`, `korisnici.aktivan`.
- Produces: redirect na `/prijava` za neprijavljene/deaktivirane na svim rutama osim javnih.

- [ ] **Step 1: Pročitaj Next.js 16 middleware dokumentaciju**

Run: `ls node_modules/next/dist/docs/ && grep -rl -i "middleware" node_modules/next/dist/docs/ | head`
Pročitaj relevantan fajl prije pisanja koda (API se može razlikovati od treninga).

- [ ] **Step 2: Napiši middleware**

```ts
// middleware.ts
import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { env } from "@/lib/env"

const PUBLIC = ["/prijava", "/zaboravljena-lozinka", "/auth"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/prijava", request.url))
  }

  if (user && !isPublic) {
    const { data: profil } = await supabase
      .from("korisnici").select("aktivan").eq("id", user.id).maybeSingle()
    if (!profil?.aktivan) {
      await supabase.auth.signOut()
      const url = new URL("/prijava", request.url)
      url.searchParams.set("greska", "deaktiviran")
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
}
```

- [ ] **Step 3: Ručna provjera**

Run: u privatnom prozoru otvori `http://localhost:3000/termini` (bez prijave).
Expected: redirect na `/prijava`. Nakon prijave: `/termini` dostupan.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: build prolazi.
```bash
git add middleware.ts
git commit -m "feat(auth): middleware auth gate + provjera aktivan"
```

---

## Task 7: Reset lozinke

**Files:**
- Create: `app/zaboravljena-lozinka/page.tsx`, `app/zaboravljena-lozinka/actions.ts`
- Create: `app/auth/nova-lozinka/page.tsx`, `app/auth/nova-lozinka/actions.ts`

**Interfaces:**
- Produces: rute `/zaboravljena-lozinka`, `/auth/nova-lozinka`; akcije `posaljiReset`, `postaviLozinku`.

- [ ] **Step 1: posaljiReset action**

```ts
// app/zaboravljena-lozinka/actions.ts
"use server"
import { z } from "zod"
import { headers } from "next/headers"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult = { ok: boolean; message?: string }

export async function posaljiReset(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = z.string().email().safeParse(formData.get("email"))
  if (!email.success) return { ok: false, message: "Neispravan email." }
  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createServerSupabaseClient()
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/nova-lozinka`,
  })
  // Uvijek isti odgovor (ne otkrivaj postoji li email).
  return { ok: true, message: "Ako nalog postoji, poslali smo link za reset." }
}
```

- [ ] **Step 2: /zaboravljena-lozinka stranica**

```tsx
// app/zaboravljena-lozinka/page.tsx
"use client"
import { useActionState } from "react"
import { posaljiReset, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: false }

export default function ZaboravljenaLozinkaPage() {
  const [state, action, pending] = useActionState(posaljiReset, initial)
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form action={action} className="w-80 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <h1 className="text-lg font-medium">Reset lozinke</h1>
        <Input name="email" type="email" placeholder="Email" required />
        {state.message && <p className="text-sm text-slate-600" role="status">{state.message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Slanje…" : "Pošalji link"}
        </Button>
        <a href="/prijava" className="block text-center text-xs text-slate-500 hover:underline">Nazad na prijavu</a>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: postaviLozinku action**

```ts
// app/auth/nova-lozinka/actions.ts
"use server"
import { z } from "zod"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult = { ok: false; message: string } | { ok: true }

export async function postaviLozinku(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.string().min(8, "Lozinka mora imati bar 8 znakova").safeParse(formData.get("lozinka"))
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) return { ok: false, message: "Link je istekao ili je nevažeći. Zatražite novi." }
  redirect("/pregled")
}
```

- [ ] **Step 4: /auth/nova-lozinka stranica**

```tsx
// app/auth/nova-lozinka/page.tsx
"use client"
import { useActionState } from "react"
import { postaviLozinku, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: true }

export default function NovaLozinkaPage() {
  const [state, action, pending] = useActionState(postaviLozinku, initial)
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form action={action} className="w-80 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <h1 className="text-lg font-medium">Nova lozinka</h1>
        <Input name="lozinka" type="password" placeholder="Nova lozinka (min 8)" autoComplete="new-password" required />
        {state.ok === false && <p className="text-sm text-status-kasni" role="alert">{state.message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Snimanje…" : "Postavi lozinku"}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: Typecheck + build + commit**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: prolazi.
```bash
git add app/zaboravljena-lozinka app/auth/nova-lozinka
git commit -m "feat(auth): reset lozinke (zahtjev + postavljanje nove)"
```

---

## Task 8: TopBar (korisnik + odjava) + dashboard prazno stanje

**Files:**
- Modify: `components/shell/TopBar.tsx`
- Create: `app/(dashboard)/odjava/actions.ts`
- Modify: `app/(dashboard)/layout.tsx` (proslijedi korisnika TopBar-u)

**Interfaces:**
- Consumes: `getTrenutniKorisnik` (Task 4).
- Produces: TopBar prikazuje ime+uloga + dugme „Odjava"; action `odjaviSe()`.

- [ ] **Step 1: odjava action**

```ts
// app/(dashboard)/odjava/actions.ts
"use server"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function odjaviSe() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect("/prijava")
}
```

- [ ] **Step 2: TopBar prima korisnika**

```tsx
// components/shell/TopBar.tsx
import { odjaviSe } from "@/app/(dashboard)/odjava/actions"
import type { TrenutniKorisnik } from "@/lib/auth/current-user"

export function TopBar({ korisnik }: { korisnik: TrenutniKorisnik | null }) {
  return (
    <header className="h-14 shrink-0 border-b border-slate-200 px-6 flex items-center justify-between bg-white">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded bg-brand text-white text-xs font-bold grid place-items-center">T</div>
        <span className="font-semibold">Tehpro</span>
        <span className="text-xs text-slate-400">Sistem za termine i provjere</span>
      </div>
      <div className="flex items-center gap-4">
        {korisnik && (
          <span className="text-xs text-slate-600">
            {korisnik.ime} · <span className="text-slate-400">{korisnik.uloga}</span>
          </span>
        )}
        <form action={odjaviSe}>
          <button type="submit" className="text-xs text-slate-500 hover:text-slate-900 hover:underline">
            Odjava
          </button>
        </form>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Layout prosljeđuje korisnika**

U `app/(dashboard)/layout.tsx`: pretvori u `async`, dohvati korisnika i proslijedi:
```tsx
import { Sidebar } from "@/components/shell/Sidebar"
import { TopBar } from "@/components/shell/TopBar"
import { DesktopOnlyGate } from "@/components/shell/DesktopOnlyGate"
import { Toaster } from "@/components/ui/sonner"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const korisnik = await getTrenutniKorisnik()
  return (
    <>
      <DesktopOnlyGate />
      <div className="hidden lg:flex flex-col h-screen">
        <TopBar korisnik={korisnik} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
      <Toaster />
    </>
  )
}
```

- [ ] **Step 4: Ažuriraj smoke test za TopBar (sad ima i Odjava)**

U `tests/e2e/01-smoke.spec.ts`, test „TopBar prikazuje Tehpro brand" ostaje validan (banner i dalje sadrži „Tehpro"). Bez izmjene potrebne; pokreni kasnije u Task 10.

- [ ] **Step 5: Typecheck + build + commit**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: prolazi.
```bash
git add components/shell/TopBar.tsx "app/(dashboard)/layout.tsx" "app/(dashboard)/odjava/actions.ts"
git commit -m "feat(auth): TopBar korisnik + odjava"
```

---

## Task 9: Postavke → tab Korisnici (admin) + akcije

**Files:**
- Modify: `app/(dashboard)/postavke/page.tsx` (admin gate + tab Korisnici)
- Modify: `app/(dashboard)/postavke/actions.ts` (dodati akcije)
- Create: `components/domain/KorisniciTab.tsx`
- Create: `components/domain/NoviKorisnikButton.tsx`
- Create: `components/domain/DodjelaKlijenata.tsx`

**Interfaces:**
- Consumes: `getTrenutniKorisnik`, `createAdminSupabaseClient`, `createServerSupabaseClient`.
- Produces (Server Actions): `kreirajKorisnika`, `postaviUlogu`, `postaviAktivan`, `postaviDodjele`.

- [ ] **Step 1: Dodaj akcije u postavke/actions.ts**

Dodaj na kraj `app/(dashboard)/postavke/actions.ts` (zadrži postojeći `ActionResult` tip):
```ts
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"

async function zahtijevajAdmina(): Promise<void> {
  const k = await getTrenutniKorisnik()
  if (!k || k.uloga !== "admin") throw new Error("Samo administrator.")
}

const noviKorisnikSchema = z.object({
  ime: z.string().trim().min(1, "Ime je obavezno").max(120),
  email: z.string().email("Neispravan email"),
  lozinka: z.string().min(8, "Lozinka min 8 znakova"),
  uloga: z.enum(["admin", "operater", "pregled"]),
})

export async function kreirajKorisnika(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await zahtijevajAdmina()
  const parsed = noviKorisnikSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email, password: parsed.data.lozinka, email_confirm: true,
  })
  if (error || !data.user) {
    return { ok: false, message: /already|registered|exists/i.test(error?.message ?? "")
      ? "Korisnik sa tim emailom već postoji." : (error?.message ?? "Greška.") }
  }
  const { error: pErr } = await admin.from("korisnici").insert({
    id: data.user.id, ime: parsed.data.ime, email: parsed.data.email, uloga: parsed.data.uloga, aktivan: true,
  })
  if (pErr) return { ok: false, message: pErr.message }
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviUlogu(korisnikId: string, uloga: "admin"|"operater"|"pregled"): Promise<ActionResult> {
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from("korisnici").update({ uloga }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviAktivan(korisnikId: string, aktivan: boolean): Promise<ActionResult> {
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from("korisnici").update({ aktivan }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

/** Postavi tačan skup dodijeljenih klijenata za korisnika (zamijeni postojeće). */
export async function postaviDodjele(korisnikId: string, klijentIds: string[]): Promise<ActionResult> {
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  const { error: delErr } = await admin.from("korisnik_klijent").delete().eq("korisnik_id", korisnikId)
  if (delErr) return { ok: false, message: delErr.message }
  if (klijentIds.length > 0) {
    const rows = klijentIds.map((klijent_id) => ({ korisnik_id: korisnikId, klijent_id }))
    const { error: insErr } = await admin.from("korisnik_klijent").insert(rows)
    if (insErr) return { ok: false, message: insErr.message }
  }
  revalidatePath("/postavke")
  return { ok: true }
}
```

- [ ] **Step 2: KorisniciTab komponenta (server-rendered lista + klijent akcije)**

```tsx
// components/domain/KorisniciTab.tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { NoviKorisnikButton } from "./NoviKorisnikButton"
import { DodjelaKlijenata } from "./DodjelaKlijenata"

export async function KorisniciTab() {
  const supabase = await createServerSupabaseClient()
  const [korisniciRes, klijentiRes, dodjeleRes] = await Promise.all([
    supabase.from("korisnici").select("id, ime, email, uloga, aktivan").order("ime"),
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
  ])
  const korisnici = korisniciRes.data ?? []
  const klijenti = klijentiRes.data ?? []
  const dodjele = dodjeleRes.data ?? []

  return (
    <section className="rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-medium">Korisnici</h2>
        <NoviKorisnikButton />
      </div>
      <ul className="divide-y divide-slate-100">
        {korisnici.map((k) => (
          <li key={k.id} className="py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{k.ime} {!k.aktivan && <span className="text-xs text-slate-400">(deaktiviran)</span>}</div>
              <div className="text-xs text-slate-500">{k.email} · {k.uloga}</div>
            </div>
            {k.uloga !== "admin" && (
              <DodjelaKlijenata
                korisnikId={k.id}
                klijenti={klijenti}
                izabrani={dodjele.filter((d) => d.korisnik_id === k.id).map((d) => d.klijent_id)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 3: NoviKorisnikButton (dialog forma)**

```tsx
// components/domain/NoviKorisnikButton.tsx
"use client"
import { useActionState, useState } from "react"
import { kreirajKorisnika, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: true }

export function NoviKorisnikButton() {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(kreirajKorisnika, initial)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">+ Novi korisnik</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novi korisnik</DialogTitle></DialogHeader>
        <form action={action} className="space-y-3">
          <Input name="ime" placeholder="Ime i prezime" required />
          <Input name="email" type="email" placeholder="Email" required />
          <Input name="lozinka" type="password" placeholder="Početna lozinka (min 8)" required />
          <select name="uloga" defaultValue="operater" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
            <option value="operater">Operater</option>
            <option value="pregled">Pregled</option>
            <option value="admin">Administrator</option>
          </select>
          {state.ok === false && state.message && <p className="text-sm text-status-kasni" role="alert">{state.message}</p>}
          <Button type="submit" disabled={pending} className="w-full">{pending ? "Kreiranje…" : "Kreiraj"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: DodjelaKlijenata (multi-select checkbox lista)**

```tsx
// components/domain/DodjelaKlijenata.tsx
"use client"
import { useState, useTransition } from "react"
import { postaviDodjele } from "@/app/(dashboard)/postavke/actions"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function DodjelaKlijenata({
  korisnikId, klijenti, izabrani,
}: { korisnikId: string; klijenti: { id: string; naziv: string }[]; izabrani: string[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(izabrani))
  const [pending, start] = useTransition()
  function toggle(id: string) {
    setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function sacuvaj() {
    start(async () => {
      const r = await postaviDodjele(korisnikId, [...sel])
      toast[r.ok ? "success" : "error"](r.ok ? "Dodjele snimljene." : (r.message ?? "Greška."))
    })
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-brand">Dodijeljeni klijenti ({sel.size})</summary>
      <div className="mt-2 max-h-48 overflow-auto rounded border border-slate-100 p-2 space-y-1">
        {klijenti.map((k) => (
          <label key={k.id} className="flex items-center gap-2">
            <input type="checkbox" checked={sel.has(k.id)} onChange={() => toggle(k.id)} />
            {k.naziv}
          </label>
        ))}
      </div>
      <Button size="sm" className="mt-2" onClick={sacuvaj} disabled={pending}>
        {pending ? "Snimanje…" : "Sačuvaj dodjele"}
      </Button>
    </details>
  )
}
```

- [ ] **Step 5: Admin gate + tab u postavke/page.tsx**

Na vrh `app/(dashboard)/postavke/page.tsx` dodaj import i gate; dodaj `KorisniciTab` ispod postojećih sekcija:
```tsx
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { KorisniciTab } from "@/components/domain/KorisniciTab"
// ...
export default async function PostavkePage() {
  const korisnik = await getTrenutniKorisnik()
  const jeAdminKor = korisnik?.uloga === "admin"
  // ... postojeći supabase fetch ostaje ...
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Postavke</h1>
      {/* postojeće sekcije Email podsjetnici + Vrste pregleda ostaju */}
      {jeAdminKor && <KorisniciTab />}
    </div>
  )
}
```

- [ ] **Step 6: Typecheck + build + ručna provjera**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: prolazi. Ručno: kao admin otvori `/postavke` → vidiš „Korisnici"; kreiraj operatera; dodijeli mu klijenta.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/postavke" components/domain/KorisniciTab.tsx components/domain/NoviKorisnikButton.tsx components/domain/DodjelaKlijenata.tsx
git commit -m "feat(auth): Postavke→Korisnici (kreiranje, uloga, aktivan, dodjela klijenata)"
```

---

## Task 10: E2E auth infrastruktura + migracija postojećih specova

**Files:**
- Create: `tests/e2e/auth.setup.ts`
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/db.ts` (helperi za korisnike)
- Modify: postojećih 16 specova — nasljeđuju admin `storageState` (preko config-a, bez izmjene svakog fajla)

**Interfaces:**
- Consumes: admin nalog (Task 3), login ekran (Task 5).
- Produces: `storageState` za chromium/webkit; `db.ts` helperi `ensureOperater`, `assignKlijent`, `clearKorisnik`.

- [ ] **Step 1: Dodaj helpere u db.ts**

Dodaj na kraj `tests/e2e/db.ts`:
```ts
/** Nađi/kreiraj operatera sa fiksnom lozinkom; vrati id. */
export async function ensureOperater(email: string, lozinka: string, ime: string): Promise<string> {
  const { data: list } = await db.auth.admin.listUsers()
  let id = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({ email, password: lozinka, email_confirm: true })
    if (error) throw error
    id = data.user.id
  }
  await db.from("korisnici").upsert({ id, ime, email, uloga: "operater", aktivan: true }, { onConflict: "id" })
  return id
}
export async function assignKlijent(korisnikId: string, klijentId: string): Promise<void> {
  await db.from("korisnik_klijent").upsert({ korisnik_id: korisnikId, klijent_id: klijentId })
}
export async function clearDodjele(korisnikId: string): Promise<void> {
  await db.from("korisnik_klijent").delete().eq("korisnik_id", korisnikId)
}
```

- [ ] **Step 2: auth.setup.ts (login kao admin → storageState)**

```ts
// tests/e2e/auth.setup.ts
import { test as setup, expect } from "@playwright/test"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "nmil322@icloud.com"
const ADMIN_LOZINKA = process.env.E2E_ADMIN_LOZINKA ?? "Tehpro2026!"

setup("authenticate admin", async ({ page }) => {
  await page.goto("/prijava")
  await page.getByPlaceholder("Email").fill(ADMIN_EMAIL)
  await page.getByPlaceholder("Lozinka").fill(ADMIN_LOZINKA)
  await page.getByRole("button", { name: "Prijavi se" }).click()
  await expect(page).toHaveURL("/pregled")
  await page.context().storageState({ path: "tests/e2e/.auth/admin.json" })
})
```

- [ ] **Step 3: playwright.config.ts — setup projekt + storageState**

Zamijeni `projects` blok:
```ts
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "tests/e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, storageState: "tests/e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
  ],
```
Dodaj `tests/e2e/.auth/` u `.gitignore`.

- [ ] **Step 4: Popravi smoke testove koji zavise od neautentifikovanog stanja**

U `tests/e2e/01-smoke.spec.ts`, testovi „Desktop-only gate" rade `page.goto("/termini")` na 1023px — sa storageState su prijavljeni, pa rade. Ali test „root redirects to /pregled" i dalje važi (prijavljen → `/pregled`). Bez izmjena potrebnih; ako neki test ide na javnu rutu, izuzmi storageState po potrebi.

- [ ] **Step 5: Pokreni cijeli E2E set**

Run: `pnpm test:e2e`
Expected: setup prolazi, svih 16 postojećih specova zeleno (sad prijavljeni kao admin koji vidi sve — isto ponašanje kao prije RLS-a).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/auth.setup.ts tests/e2e/db.ts playwright.config.ts .gitignore tests/e2e/01-smoke.spec.ts
git commit -m "test(auth): Playwright storageState (admin) + db helperi za korisnike"
```

---

## Task 11: Uključi RLS (BREAKING — zadnji) + 17-auth-rls spec

**Files:**
- Create: `supabase/migrations/20260626211000_rls_enable.sql`
- Create: `tests/e2e/17-auth-rls.spec.ts`

**Interfaces:**
- Consumes: helperi `ima_pristup_klijentu`/`je_admin`/`je_pregled` (Task 1); login, middleware, storageState (Task 5,6,10).
- Produces: RLS aktivan na svim tabelama; izolacija po dodjeli.

- [ ] **Step 1: Napiši 17-auth-rls.spec.ts (failing prije RLS-a)**

```ts
// tests/e2e/17-auth-rls.spec.ts
import { test, expect } from "@playwright/test"
import { db, ensureOperater, assignKlijent, clearDodjele, insertKlijent, deleteKlijentByNaziv } from "./db"

const OP_EMAIL = "e2e-operater@tehpro.test"
const OP_LOZINKA = "Operater2026!"
const KLIJENT_VIDLJIV = "E2E Vidljiv DOO"
const KLIJENT_SKRIVEN = "E2E Skriven DOO"

test.describe("EPIK A — RLS izolacija", () => {
  let opId = ""
  let vidljivId = ""
  test.beforeAll(async () => {
    opId = await ensureOperater(OP_EMAIL, OP_LOZINKA, "E2E Operater")
    vidljivId = await insertKlijent(KLIJENT_VIDLJIV)
    await insertKlijent(KLIJENT_SKRIVEN)
    await clearDodjele(opId)
    await assignKlijent(opId, vidljivId)
  })
  test.afterAll(async () => {
    await clearDodjele(opId)
    await deleteKlijentByNaziv(KLIJENT_VIDLJIV)
    await deleteKlijentByNaziv(KLIJENT_SKRIVEN)
  })

  test("operater vidi samo dodijeljenog klijenta", async ({ browser }) => {
    const ctx = await browser.newContext() // bez admin storageState
    const page = await ctx.newPage()
    await page.goto("/prijava")
    await page.getByPlaceholder("Email").fill(OP_EMAIL)
    await page.getByPlaceholder("Lozinka").fill(OP_LOZINKA)
    await page.getByRole("button", { name: "Prijavi se" }).click()
    await expect(page).toHaveURL("/pregled")
    await page.goto("/klijenti")
    await expect(page.getByText(KLIJENT_VIDLJIV)).toBeVisible()
    await expect(page.getByText(KLIJENT_SKRIVEN)).toHaveCount(0)
    await ctx.close()
  })

  test("neprijavljen → redirect na /prijava", async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto("/termini")
    await expect(page).toHaveURL(/\/prijava/)
    await ctx.close()
  })

  test("operater nema tab Korisnici", async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto("/prijava")
    await page.getByPlaceholder("Email").fill(OP_EMAIL)
    await page.getByPlaceholder("Lozinka").fill(OP_LOZINKA)
    await page.getByRole("button", { name: "Prijavi se" }).click()
    await page.goto("/postavke")
    await expect(page.getByRole("heading", { name: "Korisnici" })).toHaveCount(0)
    await ctx.close()
  })
})
```

- [ ] **Step 2: Pokreni — mora pasti (RLS još off, operater vidi i skrivenog)**

Run: `pnpm test:e2e tests/e2e/17-auth-rls.spec.ts --project=chromium`
Expected: FAIL na „operater vidi samo dodijeljenog" (vidi i KLIJENT_SKRIVEN jer RLS nije uključen).

- [ ] **Step 3: Napiši RLS migraciju**

```sql
-- supabase/migrations/20260626211000_rls_enable.sql
-- BREAKING: uključuje RLS. Primijeniti tek kad login+middleware+storageState rade.

-- A) Viewovi → security_invoker (inače zaobilaze RLS)
alter view termini_view  set (security_invoker = on);
alter view klijenti_view set (security_invoker = on);

-- B) Tabele vezane za klijenta
alter table klijenti        enable row level security;
alter table lokacije        enable row level security;
alter table termini         enable row level security;
alter table dokumenti       enable row level security;
alter table obilasci        enable row level security;
alter table klijent_provjere enable row level security;
alter table podsjetnici     enable row level security;

-- klijenti
create policy klijenti_sel on klijenti for select using ( ima_pristup_klijentu(id) );
create policy klijenti_ins on klijenti for insert with check ( auth.uid() is not null and not je_pregled() );
create policy klijenti_upd on klijenti for update using ( ima_pristup_klijentu(id) and not je_pregled() )
                                       with check ( ima_pristup_klijentu(id) and not je_pregled() );
create policy klijenti_del on klijenti for delete using ( ima_pristup_klijentu(id) and not je_pregled() );

-- Auto-dodjela kreatora: kad operater (ne-admin) kreira klijenta, dodaj mu korisnik_klijent
-- red da ga odmah vidi (admin ionako vidi sve, pa njemu ne treba red).
create or replace function tg_klijent_auto_dodjela() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not je_admin() then
    insert into korisnik_klijent (korisnik_id, klijent_id)
    values (auth.uid(), NEW.id)
    on conflict do nothing;
  end if;
  return NEW;
end; $$;
create trigger klijent_auto_dodjela after insert on klijenti
  for each row execute function tg_klijent_auto_dodjela();

-- lokacije (preko klijent_id)
create policy lokacije_sel on lokacije for select using ( ima_pristup_klijentu(klijent_id) );
create policy lokacije_wr  on lokacije for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- termini (preko klijent_id)
create policy termini_sel on termini for select using ( ima_pristup_klijentu(klijent_id) );
create policy termini_wr  on termini for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- klijent_provjere (preko klijent_id)
create policy kp_sel on klijent_provjere for select using ( ima_pristup_klijentu(klijent_id) );
create policy kp_wr  on klijent_provjere for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- obilasci (preko klijent_id — provjeri kolonu; ima klijent_id)
create policy obilasci_sel on obilasci for select using ( ima_pristup_klijentu(klijent_id) );
create policy obilasci_wr  on obilasci for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- dokumenti (preko termin_id → termini.klijent_id)
create policy dokumenti_sel on dokumenti for select using (
  exists (select 1 from termini t where t.id = dokumenti.termin_id and ima_pristup_klijentu(t.klijent_id)) );
create policy dokumenti_wr on dokumenti for all using (
  exists (select 1 from termini t where t.id = dokumenti.termin_id and ima_pristup_klijentu(t.klijent_id)) and not je_pregled()
) with check (
  exists (select 1 from termini t where t.id = dokumenti.termin_id and ima_pristup_klijentu(t.klijent_id)) and not je_pregled() );

-- podsjetnici (preko termin_id → termini.klijent_id); upis radi cron (service role, bypass)
create policy podsjetnici_sel on podsjetnici for select using (
  exists (select 1 from termini t where t.id = podsjetnici.termin_id and ima_pristup_klijentu(t.klijent_id)) );

-- C) Katalog / postavke
alter table vrste_provjera enable row level security;
alter table postavke       enable row level security;
create policy vrste_sel on vrste_provjera for select using ( auth.uid() is not null );
create policy vrste_wr  on vrste_provjera for all using ( je_admin() ) with check ( je_admin() );
create policy postavke_sel on postavke for select using ( auth.uid() is not null );
create policy postavke_wr  on postavke for all using ( je_admin() ) with check ( je_admin() );

-- D) Korisnici / dodjela
alter table korisnici        enable row level security;
alter table korisnik_klijent enable row level security;
create policy korisnici_sel  on korisnici for select using ( id = auth.uid() or je_admin() );
create policy korisnici_wr   on korisnici for all    using ( je_admin() ) with check ( je_admin() );
create policy kk_sel on korisnik_klijent for select using ( korisnik_id = auth.uid() or je_admin() );
create policy kk_wr  on korisnik_klijent for all    using ( je_admin() ) with check ( je_admin() );

-- E) Audit log: čita samo admin (upis ide kroz SECURITY DEFINER trigger)
alter table audit_log enable row level security;
create policy audit_sel on audit_log for select using ( je_admin() );

-- F) chat_poruke: samo prijavljeni (tehnički dug: per-korisnik vlasništvo)
alter table chat_poruke enable row level security;
create policy chat_all on chat_poruke for all using ( auth.uid() is not null ) with check ( auth.uid() is not null );

-- G) Storage: pristup objektima samo prijavljenima (minimum; per-klijent = tehnički dug)
create policy storage_dok_sel on storage.objects for select
  using ( bucket_id = 'tehpro-dokumenti' and auth.uid() is not null );
create policy storage_dok_wr on storage.objects for all
  using ( bucket_id = 'tehpro-dokumenti' and auth.uid() is not null )
  with check ( bucket_id = 'tehpro-dokumenti' and auth.uid() is not null );
```

> **Napomena za implementatora:** prije primjene provjeri tačne nazive kolona `obilasci` (treba `klijent_id`) i `dokumenti` (treba `termin_id`) u `db/types.ts`. Ako `obilasci` nema `klijent_id` nego samo `lokacija_id`, prilagodi politiku na `exists` preko `lokacije`/`termini`.

- [ ] **Step 4: Verifikuj kolone prije primjene**

Run: `grep -A2 '"obilasci"' db/types.ts | head; grep -A2 '"dokumenti"' db/types.ts | head`
Expected: potvrdi `klijent_id` na `obilasci` i `termin_id` na `dokumenti`; ako se razlikuje, ispravi migraciju.

- [ ] **Step 5: Primijeni RLS**

Run: `pnpm db:apply-cloud supabase/migrations/20260626211000_rls_enable.sql`
Expected: `✅ Primijenjeno: ...`

- [ ] **Step 6: Pokreni RLS spec — mora proći**

Run: `pnpm test:e2e tests/e2e/17-auth-rls.spec.ts --project=chromium`
Expected: PASS (operater vidi samo dodijeljenog; neprijavljen redirect; nema tab Korisnici).

- [ ] **Step 7: Pokreni CIJELI E2E set (regresija)**

Run: `pnpm test:e2e`
Expected: svi specovi zeleno. Admin storageState vidi sve (RLS dozvoljava adminu sve), pa postojeći testovi rade.
> Ako neki spec padne jer čita preko `termini_view`/`klijenti_view` a koristi neautentifikovan kontekst — provjeri da test ide kroz admin storageState.

- [ ] **Step 8: Verifikuj audit aktera (prijavljeni korisnik)**

Ručno: kao admin izmijeni termin u UI-ju → u bazi:
```bash
pnpm exec tsx --env-file=.env.local -e "import('./tests/e2e/db.ts').then(async ({db})=>{const {data}=await db.from('audit_log').select('korisnik_id,akcija,entitet').not('korisnik_id','is',null).order('vrijeme',{ascending:false}).limit(1);console.log(JSON.stringify(data))})"
```
Expected: red sa popunjenim `korisnik_id` (akter iz JWT-a).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260626211000_rls_enable.sql tests/e2e/17-auth-rls.spec.ts
git commit -m "feat(auth): uključi RLS po dodjeli + storage/chat politike + 17-auth-rls E2E"
```

---

## Završna verifikacija (gate)

- [ ] `pnpm build` — prolazi
- [ ] `pnpm lint && pnpm tsc --noEmit` — bez grešaka
- [ ] `pnpm test:unit` — uklj. `lib/auth/roles.test.ts`
- [ ] `pnpm test:e2e` — svih 17 specova (chromium + webkit) zeleno
- [ ] Ručno: operater ne vidi tuđeg klijenta ni direktnim URL-om `/klijenti/<skriveni-id>` (prazno/404)
- [ ] Ručno: `pregled` korisnik nema dugmad za izmjenu i direktan write je odbijen

---

## Self-review (popunjeno)

**Spec coverage:** §3 model → Task 1; §4 RLS politike (A–H) → Task 11 (A–G; chat=F, storage=G); §5 auth flow → Task 5,6,7,9 (audit trigger=Task 2); §6 UI → Task 8,9; §7 edge → middleware aktivan (Task 6), prazne liste (RLS), service-role audit (Task 2); §8 testiranje → Task 4 (unit), Task 10 (harness), Task 11 (17-auth-rls + regresija). Seed admin (§ odluka 3) → Task 3.

**Otvorena stavka za implementatora:** „prazno stanje bez dodjela" poruka na dashboardu (§7) — RLS vraća prazne liste automatski; eksplicitna poruka „Nemate dodijeljenih klijenata" je opciono UI poboljšanje, dodati u Task 8 ako se želi (nije blocker za gate).

**Placeholder scan:** nema TBD/TODO; svi koraci imaju konkretan kod ili komandu. Nazivi kolona za `obilasci`/`dokumenti` se verifikuju u Task 11 Step 4 prije primjene (svjesna provjera, ne placeholder).

**Type consistency:** `ActionResult` (postojeći u postavke/actions.ts) ponovo korišten u Task 9; login/reset koriste vlastiti uži `ActionResult` (odvojeni moduli — nema sudara). `getTrenutniKorisnik`/`TrenutniKorisnik` (Task 4) korišteni u Task 8,9. Helper imena (`je_admin`, `je_pregled`, `ima_pristup_klijentu`) dosljedna kroz Task 1 i 11.
