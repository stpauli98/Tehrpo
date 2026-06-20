# Tehpro — Sistem za termine i provjere
## MVP Design Spec

**Datum:** 2026-06-20
**Verzija:** 1.0
**Status:** Approved (brainstorming complete)
**Sljedeći korak:** `writing-plans` skill → implementacijski plan po fazama

---

## 1. Cilj i opseg

Tehpro pruža usluge zaštite na radu i sl. Veliki dio posla su periodični pregledi, ispitivanja i provjere koje se kod klijenata moraju ponavljati u zakonski propisanim intervalima. Ručno praćenje "kome i kada ističe rok" je rizično — sistem to automatizuje.

**MVP cilj:** Single-tenant aplikacija za Tehpro tim, na jednom mjestu prati sve obavezne provjere po klijentu, automatski računa sljedeći rok i šalje email podsjetnike. Uključuje AI asistenta za upite i generisanje zapisnika.

**Korisnici:** Tehpro tim. Auth nije u Fazi 1 — otvoreni sistem; dodaje se kasnije kad budemo znali tačne korisnike i njihova prava.

**Izvor:** Mockup [`Tehpro - Mockup.html`](../../../Tehpro%20-%20Mockup.html) (deployed na [tehpro-demo.nextpixel.dev](https://tehpro-demo.nextpixel.dev)) i discovery dokument [`Tehpro - Mapiranje potreba.md`](../../../Tehpro%20-%20Mapiranje%20potreba.md).

---

## 2. Odluke donesene u brainstorming-u

| # | Pitanje | Odluka |
|---|---|---|
| 1 | Scope projekta | **MVP sa pravim backend-om** |
| 2 | Auth model | **Bez auth-a u Fazi 1**; dodajemo kasnije |
| 3 | AI Asistent | **Pravi Claude API + ograničeni tool-set** |
| 4 | Email podsjetnici | **Pravi email — Resend + Vercel Cron** |
| 5 | Dokumenti | **Generisanje (AI .docx) + upload + Supabase Storage** |
| 6 | Početni podaci | **Import iz Tehpro Excel-a** (`2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx`) |
| 7 | Deploy strategija | **Zamijeni postojeći `tehpro-demo.nextpixel.dev`** kad MVP bude spreman |
| 8 | Stack pristup | **Approach A — Lean Supabase-direct** (RSC + Server Actions, bez ORM-a) |
| 9 | Mobile | **Desktop-only — gate ispod 1024px**; bez mobile optimizacije |

---

## 3. Arhitektura

### 3.1 Stack

```
Next.js 15 (App Router) + TypeScript
Tailwind v4 + shadcn/ui + Lucide React + Inter font
Supabase (Postgres + Storage) — JS client, bez ORM-a
Server Actions (mutacije) + RSC (reads)
Resend (email) + Vercel Cron (scheduler)
@anthropic-ai/sdk za AI Asistent (model: claude-sonnet-4-6)
docx (generisanje zapisnika) + mammoth (preview)
xlsx (jednokratni Excel import)
Playwright (E2E, Chromium + WebKit)
Vercel (hosting, region: fra1)
```

### 3.2 Folder layout

```
tehpro-mvp/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx                  # sidebar shell + desktop-only gate
│   │   ├── page.tsx                    # redirect → /termini
│   │   ├── termini/
│   │   │   ├── page.tsx                # list + filteri + stats
│   │   │   ├── [id]/page.tsx           # detail (sheet)
│   │   │   └── new/page.tsx            # form za novi termin
│   │   ├── prikaz/page.tsx             # matrix view (klijenti × vrste × mjeseci)
│   │   ├── plan/page.tsx               # mjesečni kalendar
│   │   ├── klijenti/
│   │   │   ├── page.tsx                # grid + search
│   │   │   └── [id]/page.tsx           # detail (tabs: Termini, Lokacije, Dokumenti)
│   │   ├── asistent/page.tsx           # chat UI (streaming)
│   │   └── pregled/page.tsx            # generisani dokumenti
│   ├── api/
│   │   ├── cron/reminders/route.ts     # Vercel Cron handler (dnevno)
│   │   └── chat/route.ts               # Claude streaming endpoint
│   └── layout.tsx                      # root (fonts, providers)
├── components/
│   ├── ui/                             # shadcn primitives
│   └── domain/                         # TerminCard, StatusBadge, MatrixGrid, ...
├── lib/
│   ├── supabase/{server,client,admin}.ts
│   ├── claude/{tools,prompts}.ts
│   ├── email/{resend,templates}.ts
│   └── date.ts                         # DD.MM.YYYY helpers
├── db/
│   ├── migrations/                     # Supabase CLI SQL files
│   ├── types.ts                        # generated tipovi
│   └── schemas.ts                      # zod schemas
├── scripts/
│   └── excel-import.ts                 # jednokratno punjenje seed-a
├── tests/e2e/                          # Playwright spec po fazi
└── docs/superpowers/
    ├── specs/                          # ovaj fajl
    └── plans/                          # writing-plans output
```

---

## 4. DB shema

### 4.1 Tabele

```sql
-- 1. KLIJENTI
create table klijenti (
  id          uuid primary key default gen_random_uuid(),
  naziv       text not null,
  napomena    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  constraint chk_naziv check (length(trim(naziv)) > 0)
);

-- 2. LOKACIJE (1 klijent → N lokacija)
create table lokacije (
  id              uuid primary key default gen_random_uuid(),
  klijent_id      uuid not null references klijenti(id) on delete cascade,
  naziv           text not null,
  grad            text,
  regija          text,
  adresa          text,
  kontakt_osoba   text,
  kontakt_email   text,
  kontakt_telefon text,
  created_at      timestamptz default now()
);

-- 3. VRSTE PROVJERA (catalog)
create table vrste_provjera (
  id                              uuid primary key default gen_random_uuid(),
  naziv                           text not null unique,
  sifra                           text,
  podrazumevani_interval_mjeseci  int,
  zakonski_osnov                  text,
  napomena                        text,
  aktivna                         bool default true
);

-- 4. TERMINI (centralni entitet)
create type termini_status as enum
  ('planirano','zakazano','izvrseno','otkazano');

create table termini (
  id                  uuid primary key default gen_random_uuid(),
  klijent_id          uuid not null references klijenti(id) on delete restrict,
  lokacija_id         uuid references lokacije(id) on delete set null,
  vrsta_provjere_id   uuid not null references vrste_provjera(id) on delete restrict,
  interval_mjeseci    int,                                  -- override (null = koristi default vrste)
  datum_zadnjeg       date,                                  -- zadnji obavljen
  rok_dospijeca       date not null,                         -- računa trigger
  datum_zakazan       date,
  datum_izvrsenja     date,
  status              termini_status not null default 'planirano',
  zaduzeni            text,                                  -- ime izvršioca (string, FK kasnije)
  napomena            text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  constraint chk_datumi check (
    (datum_izvrsenja is null or datum_izvrsenja <= current_date)
    and (datum_zakazan is null or datum_zakazan >= '2020-01-01')
    and (interval_mjeseci is null or interval_mjeseci between 1 and 120)
  )
);

-- 5. DOKUMENTI (storage refs)
create table dokumenti (
  id               uuid primary key default gen_random_uuid(),
  termin_id        uuid not null references termini(id) on delete cascade,
  naziv            text not null,
  storage_path     text not null,           -- "termini/{id}/zapisnik.docx"
  mime_type        text,
  velicina_bajt    bigint,
  generated_by_ai  bool default false,
  uploaded_at      timestamptz default now()
);

-- 6. PODSJETNICI (audit log)
create table podsjetnici (
  id          uuid primary key default gen_random_uuid(),
  termin_id   uuid not null references termini(id) on delete cascade,
  dana_prije  int not null,
  poslat_na   text[] not null,
  poslat_at   timestamptz default now(),
  resend_id   text,
  constraint chk_dana_prije check (dana_prije between 0 and 365)
);

-- 7. CHAT_PORUKE (AI istorija)
create type chat_uloga as enum ('user','assistant');

create table chat_poruke (
  id                uuid primary key default gen_random_uuid(),
  konverzacija_id   uuid not null,
  uloga             chat_uloga not null,
  sadrzaj           text not null,
  alat_pozivi       jsonb,                  -- tool calls
  created_at        timestamptz default now()
);
```

### 4.2 Indeksi

```sql
-- Dashboard "Kasni rokovi" — najčešći upit (partial)
create index idx_termini_dashboard on termini (rok_dospijeca, status)
  where status in ('planirano','zakazano');

-- Range scan po datumu (ovog mjeseca)
create index idx_termini_rok on termini (rok_dospijeca);

-- Klijent detail
create index idx_termini_klijent on termini (klijent_id, rok_dospijeca);

-- Filter po lokaciji
create index idx_termini_lokacija on termini (lokacija_id) where lokacija_id is not null;

-- Filter po vrsti (Prikaz matrix)
create index idx_termini_vrsta on termini (vrsta_provjere_id);

-- Cron job lookup
create index idx_podsjetnici_termin on podsjetnici (termin_id, dana_prije);

-- Dokumenti per termin
create index idx_dokumenti_termin on dokumenti (termin_id);

-- Chat istorija po konverzaciji
create index idx_chat_konverzacija on chat_poruke (konverzacija_id, created_at);

-- Lokacije po klijentu
create index idx_lokacije_klijent on lokacije (klijent_id);

-- Trigram search po nazivu firme
create extension if not exists pg_trgm;
create index idx_klijenti_naziv_trgm on klijenti using gin (naziv gin_trgm_ops);
```

### 4.3 FK pravila (referencijalni integritet)

| Veza | ON DELETE | Razlog |
|---|---|---|
| `lokacije.klijent_id` → `klijenti` | **CASCADE** | Brisanjem klijenta brišu se i lokacije |
| `termini.klijent_id` → `klijenti` | **RESTRICT** | Štitiš istoriju — ne dozvoli brisanje klijenta ako ima termine |
| `termini.lokacija_id` → `lokacije` | **SET NULL** | Termini ostaju ako se lokacija obriše |
| `termini.vrsta_provjere_id` → `vrste_provjera` | **RESTRICT** | Deaktiviraj (`aktivna=false`) umjesto brisanja |
| `dokumenti.termin_id` → `termini` | **CASCADE** | Storage cleanup trigger briše i fajlove |
| `podsjetnici.termin_id` → `termini` | **CASCADE** | Audit prati termin |
| `chat_poruke` | nema FK | Razgovori su nezavisni |

### 4.4 Triggeri

- **`tg_termini_compute_rok`** — BEFORE INSERT/UPDATE: računa `rok_dospijeca = COALESCE(datum_zadnjeg, NEW.rok_dospijeca) + interval '... months'`
- **`tg_termini_auto_cycle`** — AFTER UPDATE: okida se kada `OLD.datum_izvrsenja IS NULL AND NEW.datum_izvrsenja IS NOT NULL AND NEW.status='izvrseno'` (jednokratna tranzicija). Insertuje novi termin sa istim `klijent_id`, `lokacija_id`, `vrsta_provjere_id`, `interval_mjeseci`; `datum_zadnjeg = NEW.datum_izvrsenja`; `status='planirano'`. Original termin ostaje u istoriji. Trigger NE okida na re-update istog `datum_izvrsenja` (idempotentno).
- **`tg_dokumenti_storage_cleanup`** — AFTER DELETE: briše fajl iz Supabase Storage bucket-a `tehpro-dokumenti/{storage_path}`. Bez ovoga, CASCADE ostavlja orphaned fajlove.

### 4.5 Izvedeni statusi (view)

`kasni` se NE čuva u tabeli — računa se on-the-fly:

```sql
create view termini_view as
select t.*,
  case
    when t.status = 'izvrseno' then 'izvrseno'
    when t.status = 'otkazano' then 'otkazano'
    when t.rok_dospijeca < current_date then 'kasni'
    else t.status::text
  end as status_izvedeni
from termini t;
```

### 4.6 RLS

Isključen u Fazi 1 (nema auth). Migracija za uključivanje pripremljena ali komentarisana — aktivira se zajedno sa auth-om u budućoj fazi.

---

## 5. Query principle — N+1 prevention

**Query-by-page rule:** Svaki Next.js route u dashboard-u smije imati **najviše 2 DB round-trips** za inicijalni render (header counts + main data). Više = redesign, ne više query-ja.

| Ekran | Pristup |
|---|---|
| Klijenti list | Jedan `select` sa subquery count-ovima ili `LEFT JOIN LATERAL` |
| Termini list | Jedan `select` sa Supabase nested relations: `.select('*, klijent:klijenti(naziv), lokacija:lokacije(naziv,grad), vrsta:vrste_provjera(naziv)')` |
| Prikaz matrix | Jedan grouping query: `select klijent_id, vrsta_provjere_id, date_trunc('month', rok_dospijeca), count(*) ... group by 1,2,3`; pivot u memoriji |
| Cron podsjetnika | Jedan `select` sa LEFT JOIN na `podsjetnici` za "već poslat" provjeru |
| AI tool calls | Svaki tool vraća batch (array), nikad jedan po jedan |

**Code review pravilo:** Loop koji izvršava query po elementu = blocker. ESLint config zabranjuje `await` unutar `.map()` / `for` loop-a koji poziva Supabase metod.

---

## 6. Connection pooling

| Scenario | Driver | Pooler |
|---|---|---|
| Server Actions / RSC | `@supabase/supabase-js` (HTTP/PostgREST) | Ne treba — pool je interno na Supabase strani |
| Vercel Cron handler | `@supabase/supabase-js` | Isto |
| Excel import (lokalno, jednokratno) | `node-postgres` direkt | **Supavisor transaction mode** (port 6543) |
| Supabase CLI migracije | `psql` / supabase CLI | Direct (port 5432) — lokalno/CI |

### Pravila

1. **Application code MUST koristi `@supabase/supabase-js` SDK ONLY.** Direktan `pg` / `postgres` / Drizzle u runtime kodu je zabranjen.
2. **Scripts mimo SDK-a koriste Supavisor transaction pooler string:** `postgres://postgres.[ref]:[pwd]@aws-0-[region].pooler.supabase.com:6543/postgres`
3. **Vercel env varijable:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (samo za migracije, pooler string)
4. **SDK singleton helperi:** `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/supabase/client.ts`. Ne pravi novu instancu u svakoj funkciji.

---

## 7. Ekrani

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar:  [Tehpro logo]              "Mockup · demo podaci" │
├──────────┬──────────────────────────────────────────────────┤
│ Sidebar  │                                                  │
│  📋 Term │           Main Content (RSC)                     │
│  ▦ Prik  │                                                  │
│  📅 Plan │                                                  │
│  👥 Klij │                                                  │
│  🤖 Asist│                                                  │
│  📄 Preg │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

- Sidebar uvijek expand-ovan (desktop-only)
- TopBar sticky

### 7.2 Specifikacije po ekranima

#### A. `/termini`
- **Stats row:** 4 kartice (`Ukupno`, `Ovog mjeseca`, `Kasni`, `Izvršeni ovog mjeseca`)
- **Filteri:** search (po klijentu/lokaciji), klijent dropdown, vrsta dropdown, status pills, range mjeseci
- **Tabela:** Datum roka · Klijent · Lokacija · Vrsta · Status · Zaduženi · Akcije
- **CTA:** `+ Novi termin`

#### B. `/termini/[id]` (sheet)
- Header: klijent + lokacija + vrsta + status badge
- Forma: `datum_zakazan`, `datum_izvrsenja`, `zaduzeni`, `napomena`
- `Označi kao izvršeno` button → dialog za upload zapisnika
- Sekcija "Dokumenti" + `Generiši zapisnik (AI)`
- Sekcija "Istorija" (prethodni ciklusi)

#### C. `/prikaz` (matrix)
- Kolone: vrste provjera; Redovi: klijenti × lokacije
- Ćelija: `✓ DD.MM.YYYY` za izvršene, datum za planirane, "Kasni!" red za prekoračene; prazna ćelija = nema termina
- Klik ćeliju sa terminom → otvara `TerminSheet`. Klik praznu ćeliju → otvara `TerminSheet` u "novi" mode-u sa pre-popunjenim `klijent_id`, `lokacija_id`, `vrsta_provjere_id` iz pozicije ćelije
- Toggle: po mjesecu / po godini
- Bar chart "opterećenje po mjesecima" (Recharts) iznad

#### D. `/plan` (kalendar)
- Mjesečni grid 7 kolona × 5-6 redova (broj sedmica varira po mjesecu); dani prethodnog/sljedećeg mjeseca prikazani sivo
- Svaka ćelija dana: max 3 vidljiva termina + "još N" link ako ima više
- Sidebar desno: termini za izabrani dan (kompletna lista)
- Navigation: prev/next mjesec, "Danas" button, change godina dropdown

#### E. `/klijenti`
- Search input
- Cards grid: naziv, broj lokacija, broj aktivnih termina, broj kasnih (red badge)

#### F. `/klijenti/[id]`
- Tabovi: `Termini` · `Lokacije` · `Dokumenti` · `Kontakti`

#### G. `/asistent` (chat)
- Sidebar lijevo: lista razgovora, `+ Novi`
- Centar: poruke, streaming, tool call indikatori
- Suggested pills: 3 pitanja iz mockup-a
- Input: "Napiši pitanje..."

#### H. `/pregled`
- Lista AI-generisanih zapisnika
- Preview pane (mammoth.js)
- Akcije: Download · Re-generate · Briši

### 7.3 Brand tokens

```ts
// tailwind.config.ts
colors: {
  brand:  { DEFAULT: '#2563eb', dark: '#1e40af', light: '#dbeafe' },
  status: {
    planirano: '#3b82f6', zakazano: '#06b6d4', izvrseno: '#16a34a',
    kasni: '#dc2626', otkazano: '#64748b',
  },
},
fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
```

### 7.4 Desktop-only gate

Cijela aplikacija sakrivena ispod 1024px (`lg:` breakpoint). Gate component prikazuje:
- Monitor ikona
- "Tehpro je optimizovan za desktop"
- "Za rad sa sistemom otvorite aplikaciju na laptopu ili desktop računaru (ekran minimalno 1024px širine)"

ESLint pravilo: `sm:` i `md:` Tailwind prefiksi su zabranjeni.

```ts
// .eslintrc — fail build na sm:/md: korištenje
{ "rules": { "no-restricted-syntax": ["error",
  { "selector": "Literal[value=/\\b(sm|md):/]",
    "message": "Tehpro je desktop-only. Koristi lg:/xl: ili bez breakpoint-a." }
]}}
```

### 7.5 Komponente

**shadcn primitives (instalirane u Fazi 1):** Button, Input, Select, Dialog, Sheet, Dropdown, Tabs, Table, Badge, Card, Calendar, Popover, Command, Form (+ react-hook-form + zod), Sonner (toast).

**Domain komponente (gradimo postupno):**

| Komponenta | Faza |
|---|---|
| `StatusBadge`, `StatCard`, `TerminiTable`, `TerminiFilters`, `TerminSheet` | 3 |
| `KlijentCard` | 4 |
| `MatrixGrid`, `MonthCalendar` | 5 |
| `ReminderForm` | 6 |
| `DokumentUpload`, `DocxPreview` | 7 |
| `ChatMessage`, `ChatInput`, `SuggestedPills` | 8 |

---

## 8. Faze

| # | Faza | Procjena | Glavni deliverable |
|---|---|---|---|
| 1 | **Temelji** | 1d | Next.js scaffold, Tailwind tokens, shadcn install, Supabase setup, prazna DB shema, Playwright smoke, desktop-only gate |
| 2 | **DB + Excel import** | 1-2d | Migracije, indeksi, FK, parsing skripta, seed u dev bazi, integration test |
| 3 | **Termini CRUD** | 2-3d | List + filteri + create/edit/detail; status workflow + auto-cycle trigger |
| 4 | **Klijenti CRUD + Lokacije** | 1-2d | List, trigram search, detail, lokacije tabovi |
| 5 | **Prikaz matrix + Mjesečni plan** | 2-3d | Matrix grid, kalendar, "opterećenje po mjesecima" chart |
| 6 | **Email podsjetnici + Cron** | 1-2d | Resend setup, email template, Vercel Cron, ReminderForm, audit log |
| 7 | **Dokumenti (upload + AI generisanje)** | 2-3d | Storage, upload UI, `docx` generisanje, /pregled, mammoth.js preview |
| 8 | **AI Asistent** | 2-3d | Claude SDK + streaming, 3-4 tools (`searchTermini`, `listFirme`, `generateZapisnik`, `suggestGrouping`), chat UI, konverzacija history |
| 9 | **Production deploy** | 0.5d | Zamjena static `tehpro-demo.nextpixel.dev` Next.js verzijom; smoke test na live URL-u |

**Ukupno:** ~13-21 radnih dana (8.5 faza × prosjek 1.5-2.5 dana).

### 8.1 Šta NIJE u Fazi 1 (eksplicitno YAGNI)

- Auth / korisničke uloge
- Mobile responsive
- Fakturisanje / naplata
- Portal za klijente (samostalni pristup)
- Mobilna aplikacija
- Integracija sa računovodstvenim sistemom
- Soft delete
- Versioning dokumenata
- Bulk export (osim AI .docx generisanja)

---

## 9. Verifikacija (per-faza gate)

Faza je `done` tek kada **sva 4 prolaze**:

```
✅ 1. Build:        pnpm build
✅ 2. Lint + TS:    pnpm lint && pnpm tsc --noEmit
✅ 3. E2E:          pnpm test:e2e (Chromium + WebKit)
✅ 4. Fresh-agent:  Independent verifikacija od strane novog agenta
                    bez konteksta
```

### 9.1 Playwright spec mapping

| Faza | Spec fajl | Pokriva |
|---|---|---|
| 1 | `tests/e2e/01-smoke.spec.ts` | Home loadovan, desktop gate radi (1023px → gate, 1024px → app), sidebar visible |
| 2 | `tests/e2e/02-data.spec.ts` | Seed import dao N klijenata, M termina; query view radi |
| 3 | `tests/e2e/03-termini.spec.ts` | Create termin, mark izvršeno, auto-cycle novi termin, status badge boje |
| 4 | `tests/e2e/04-klijenti.spec.ts` | Search "WAIK" vraća WAIKIKI, detail prikazuje lokacije |
| 5 | `tests/e2e/05-matrix-plan.spec.ts` | Matrix ćelije, klik otvara termin, kalendar mjesec navigacija |
| 6 | `tests/e2e/06-podsjetnici.spec.ts` | Cron endpoint POST vraća poslate emails, audit log; mock Resend |
| 7 | `tests/e2e/07-dokumenti.spec.ts` | Upload, preview, generiši AI zapisnik (mock Claude), download |
| 8 | `tests/e2e/08-asistent.spec.ts` | Streaming, tool call execute-uje query, follow-up question |
| 9 | `tests/e2e/09-production.spec.ts` | Smoke test na production URL-u: home loads, sidebar visible, jedan termin lista, desktop gate radi |

**Vizualna regresija** od Faze 3 nadalje: `await page.screenshot({fullPage:true})` za ključne ekrane; stored u `tests/e2e/__screenshots__/`.

### 9.2 Fresh-agent verifikacija

Nakon što sva 3 lokalna gate-a prolaze, dispatch-uje se novi `claude` agent sa praznim kontekstom:

**Input agentu:**
- Spec dokument (link)
- Lista deliverable-a za TU fazu (samo)
- Repo branch

**Tasks:**
1. `pnpm install && pnpm build && pnpm lint && pnpm tsc --noEmit`
2. `pnpm test:e2e` (Chromium + WebKit)
3. Manualno izvršiti svaki user flow iz Phase scope-a kroz `mcp__playwright__*` headed mode
4. Provjeriti: console errors, network failures, broken images, accessibility warnings, repeated POST patterns (N+1 indikator)

**Output:**
```json
{
  "phase": N,
  "build": "pass|fail",
  "lint": "pass|fail",
  "e2e": "pass|fail",
  "manual_flows": [{name, status, screenshot, notes}],
  "blockers": [...],
  "non_blockers": [...]
}
```

Ako blocker → fiks → re-run fresh-agent. Ako nema blocker-a → merge u `main`, tag `v0.N.0`, prelazak na sljedeću fazu.

### 9.3 Branch strategija

- `main` = production (Vercel preview auto-deploy, manual promote na `tehpro-demo.nextpixel.dev`)
- `phase-N-<naziv>` = feature branch per faza
- Squash merge u `main` tek nakon gate
- Tag `v0.N.0` nakon svake merge-ovane faze

---

## 10. Reference

- Mockup: [Tehpro - Mockup.html](../../../Tehpro%20-%20Mockup.html)
- Discovery: [Tehpro - Mapiranje potreba.md](../../../Tehpro%20-%20Mapiranje%20potreba.md)
- Excel seed: [2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx](../../../2026-%20obilasci,%20pregledi%20i%20ispitivanja,%20obuke,%20dokumentacija.xlsx)
- Static demo deploy: https://tehpro-demo.nextpixel.dev
- Target production: https://tehpro-demo.nextpixel.dev (zamjena u Fazi 8)
