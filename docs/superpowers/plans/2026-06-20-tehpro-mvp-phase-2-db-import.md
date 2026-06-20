# Tehpro MVP — Faza 2: DB shema + Excel import (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Postaviti kompletnu DB šemu (7 tabela + indeksi + FK + 2 triggera + view) preko Supabase CLI migracija, generisati TypeScript tipove, izgraditi Excel parser i seed import skriptu koja puni dev bazu sa realnim Tehpro podacima iz `2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx`.

**Architecture:** Supabase CLI migrations (SQL files u `supabase/migrations/`), TypeScript types auto-generisani preko `supabase gen types`, Excel parser kao čista biblioteka u `lib/excel/`, seed skripta u `scripts/seed-from-excel.ts` koja koristi admin SDK i upserts. Iz aplikativnog koda (app/, components/, lib/supabase/) ne pristupa se direktno parser-u ili seed-u — to su one-off alati za development.

**Tech Stack:** Supabase CLI 2.x · Supabase JS SDK · `exceljs` 4.x · `zod` 4.x · Playwright (postojeći) · pnpm · tsx (za pokretanje TS skripti)

**Spec:** `docs/superpowers/specs/2026-06-20-tehpro-mvp-design.md` §4-§5
**Prethodna faza:** [phase-1-foundation.md](./2026-06-20-tehpro-mvp-phase-1-foundation.md) — temelji su postavljeni; ova faza dodaje data layer.

---

## Global Constraints

- **Migration tool:** Supabase CLI (`supabase migration new`, `supabase db reset` lokalno). Migracije idu u `supabase/migrations/`, jedan SQL fajl per task.
- **DB driver:** SAMO `@supabase/supabase-js` u app/components/lib runtime kodu. `scripts/` smije koristiti `node-postgres` ili admin SDK — bira se admin SDK jer već imamo helper i ne treba dodatna dep.
- **No-await-in-loop:** ESLint ostaje aktivan; u `scripts/` je override allow (per Task 5 Phase 1). Za bulk seed insert koristi `.insert([...])` array variant, ne loop+insert.
- **Status enum vrijednosti:** `('planirano','zakazano','izvrseno','otkazano')` — bez `'kasni'` (kasni je izvedeni status preko view-a).
- **Datumi:** PostgreSQL `date` tip. Excel datumi parsiraju se kao `YYYY-MM-DD` strings, ne ISO timestamp.
- **Encoding:** Excel sadrži ćir/lat tekst sa dijakritikom (š, đ, č, ć, ž). PostgreSQL je UTF-8 default — verifikuj da text kolone čuvaju dijakritiku.
- **Seed reproducibilnost:** `pnpm seed` mora biti idempotentno — pokretanje 2× ne pravi duple klijente/vrste. Koristi `.upsert()` ili `INSERT … ON CONFLICT`.
- **NIKAKAV Vercel/cloud** — sve lokalno (per [[feedback-tehpro-local-dev]]). Migracije idu protiv `supabase start` lokalne Postgres instance.
- **Git:** sve commit-ove push-uj na `origin/main` nakon svake faze. Faza se zatvara tagom `v0.2.0`.

## Kljucne odluke za Fazu 2

1. **Klijent-vs-lokacija strategija:** Excel ima ime tipa `"WAIKIKI BANJA LUKA - DELTA"` — to je već jedna logička jedinica posla za Tehpro. **U seed-u, čuvamo cijeli string u `klijenti.naziv` bez auto-splitanja**. Tabela `lokacije` ostaje prazna nakon seed-a. Korisnik kasnije može ručno konsolidovati (merge "WAIKIKI BANJA LUKA - DELTA" + "WAIKIKI BANJA LUKA - KORT" u parent "WAIKIKI" sa 2 lokacije). Razlog: pouzdana parsing logika sa diakritikom + raznolikim formatima je fragilna; jednom kad korisnik vidi podatke, brza ručna konsolidacija je sigurnija. Spec to dozvoljava jer `lokacije` FK na `termini` je nullable.
2. **Triggeri:** `tg_termini_compute_rok` + `tg_termini_auto_cycle` u Fazi 2. **`tg_dokumenti_storage_cleanup` ODGOĐEN do Faze 7** (kada Storage stvarno postoji — nema smisla pisati trigger koji briše fajl iz nepostojećeg bucket-a).
3. **TypeScript tipovi:** Generišu se preko `supabase gen types typescript --local > db/types.ts`. Zod schemas (za Server Action input validaciju) NE pišu se sad — odgodi do Faze 3 kad budemo radili CRUD. Sad samo DB types.
4. **`xlsx` vs `exceljs`:** `exceljs` (mtg/exceljs) — bolji TypeScript support, aktivno održavan, nema security advisories iz 2023. `xlsx` (SheetJS community) ima poznate vulnerabilities. Biram **exceljs**.
5. **Excel parsing scope:** Parser obrađuje SVIH 12 sheet-ova (Januar-Decembar). Output je flat lista termina sa stringovima (klijent_naziv, vrsta_naziv) — još ne mapira na ID-jeve. Seed skripta radi mapping.

---

## File Structure (kreirano u ovoj fazi)

```
tehpro-mvp/
├── supabase/
│   └── migrations/
│       ├── 20260620120000_foundation_tables.sql      # klijenti, lokacije, vrste_provjera + indexes
│       ├── 20260620120100_termini.sql                # termini + enum + indexes + view
│       ├── 20260620120200_supporting_tables.sql      # dokumenti, podsjetnici, chat_poruke + indexes
│       └── 20260620120300_triggers.sql               # compute_rok + auto_cycle (NO storage_cleanup yet)
├── db/
│   ├── types.ts                                       # AUTO-GENERATED — ne edituj ručno
│   └── README.md                                      # napomena o regeneraciji types-a
├── lib/
│   └── excel/
│       ├── parser.ts                                 # parseTehproExcel(filePath): ParsedTermin[]
│       ├── parser.types.ts                           # ParsedTermin, ParsedRow tipovi
│       └── parser.test.ts                            # Vitest unit testovi (mali Excel fixture)
├── scripts/
│   ├── seed-from-excel.ts                            # pnpm seed
│   └── README.md                                     # kako pokrenuti
├── tests/
│   ├── e2e/
│   │   └── 02-data.spec.ts                           # E2E: home pokazuje broj klijenata/termina
│   └── fixtures/
│       └── tehpro-mini.xlsx                          # 1 sheet, 2 klijenta, 3 vrste, 5 termina — za unit test
└── (postojeci fajlovi nepromijenjeni)
```

---

## Task Map

| # | Task | Glavni deliverable | Verifikacija |
|---|---|---|---|
| 1 | Foundation tables migracija | klijenti, lokacije, vrste_provjera + 2 indeksa + FK | `supabase db reset` prolazi, tabele postoje |
| 2 | Termini migracija + view | termini, enum, 5 indeksa, `termini_view` | Migration apply OK, INSERT test radi |
| 3 | Supporting tables migracija | dokumenti, podsjetnici, chat_poruke + 4 indeksa + pg_trgm | Migration apply, gin index na klijenti |
| 4 | Triggers migracija | tg_compute_rok + tg_auto_cycle (BEZ storage_cleanup) | Unit SQL test: insert termin → rok računa se; update datum_izvrsenja → novi termin kreiran |
| 5 | TypeScript types | `db/types.ts` generisan, importable iz app/ | `pnpm typecheck` prolazi sa novim tipovima |
| 6 | Excel parser (lib + unit tests) | `lib/excel/parser.ts` + `parser.test.ts` + fixture | `pnpm test:unit` zelen, parser pravilno mapira sve 12 mjeseci |
| 7 | Seed import skripta | `scripts/seed-from-excel.ts`, idempotentna | `pnpm seed` puni dev bazu sa stvarnim podacima; rerun ne pravi duplikate |
| 8 | E2E data test + phase gate | `02-data.spec.ts` + fresh-agent verifikacija | 16+ Playwright tests pass, faza tag v0.2.0 |

**Ukupno: 8 tasks. Procijenjeno trajanje: 1-2 dana.**

---

## Task 1: Foundation tables migracija (klijenti, lokacije, vrste_provjera)

**Files:**
- Create: `supabase/migrations/20260620120000_foundation_tables.sql`

**Interfaces:**
- Consumes: Supabase lokalno (Faza 1)
- Produces: 3 tabele dostupne kasnijim taskovima

- [ ] **Step 1.1: Provjeri da Supabase Docker radi**

```bash
cd "/Users/nmil/Desktop/Ai Forward/tehpro-mvp" && supabase status
```

Ako nije pokrenut: `supabase start`. Trebaš vidjeti API URL na 54321 i DB URL na 54322.

- [ ] **Step 1.2: Kreiraj migration fajl preko CLI**

```bash
supabase migration new foundation_tables
```

Ovo kreira `supabase/migrations/<timestamp>_foundation_tables.sql`. Otvori taj fajl.

- [ ] **Step 1.3: Upiši SQL za 3 tabele**

```sql
-- Foundation tables: klijenti, lokacije, vrste_provjera
-- Spec §4.1 tables 1-3

create extension if not exists pgcrypto; -- gen_random_uuid()

-- 1. KLIJENTI
create table klijenti (
  id          uuid primary key default gen_random_uuid(),
  naziv       text not null,
  napomena    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chk_klijenti_naziv check (length(trim(naziv)) > 0)
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
  created_at      timestamptz not null default now()
);

create index idx_lokacije_klijent on lokacije (klijent_id);

-- 3. VRSTE PROVJERA (catalog)
create table vrste_provjera (
  id                              uuid primary key default gen_random_uuid(),
  naziv                           text not null unique,
  sifra                           text,
  podrazumevani_interval_mjeseci  int,
  zakonski_osnov                  text,
  napomena                        text,
  aktivna                         bool not null default true,
  constraint chk_vrste_interval check (
    podrazumevani_interval_mjeseci is null
    or podrazumevani_interval_mjeseci between 1 and 120
  )
);
```

- [ ] **Step 1.4: Primijeni migraciju lokalno**

```bash
supabase db reset
```

`db reset` briše lokalnu bazu i ponovo primjenjuje sve migracije od početka. Očekivano: vidiš "Resetting local database..." + "Applied migration ... foundation_tables.sql" + "Finished supabase db reset."

Ako primjena fail-uje: čitaj SQL grešku, popravi `.sql` fajl, ponovi.

- [ ] **Step 1.5: Sanity check — tabele postoje**

```bash
supabase db diff --linked false --use-migra 2>/dev/null || echo "(diff CLI varies; alternativa ispod)"
# Alternativa:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*" 2>&1 | grep -E "klijenti|lokacije|vrste_provjera"
```

Očekivano: 3 reda — klijenti, lokacije, vrste_provjera.

- [ ] **Step 1.6: Sanity check — INSERT/SELECT radi sa dijakritiku**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'EOF'
insert into klijenti (naziv) values ('Test š ć č ž đ');
select naziv from klijenti;
delete from klijenti where naziv = 'Test š ć č ž đ';
EOF
```

Očekivano: vidiš tekst sa dijakritikom u SELECT-u (ne `?` ili escape sekvence).

- [ ] **Step 1.7: Verify build/lint još uvijek prolaze**

```bash
pnpm build && pnpm lint && pnpm typecheck
```

Migracija nije TS — ali provjera da nismo slučajno nešto polomili.

- [ ] **Step 1.8: Commit**

```bash
git add supabase/migrations/ && git commit -m "feat(phase-2): foundation tables — klijenti, lokacije, vrste_provjera

- klijenti: uuid PK, naziv with CHECK len>0, timestamps
- lokacije: FK CASCADE on klijent, optional grad/regija/kontakt
- vrste_provjera: catalog, unique naziv, interval CHECK 1-120
- pgcrypto extension za gen_random_uuid()
- idx_lokacije_klijent

Spec §4.1 tables 1-3 + §4.2 lokacije index"
```

---

## Task 2: Termini migracija + view

**Files:**
- Create: `supabase/migrations/<timestamp>_termini.sql`

**Interfaces:**
- Consumes: Task 1 tabele (FK targets)
- Produces: `termini` table + `termini_status` enum + `termini_view` view + 5 indeksa

- [ ] **Step 2.1: Kreiraj migration fajl**

```bash
supabase migration new termini
```

- [ ] **Step 2.2: SQL za termini + enum + indeksi + view**

```sql
-- termini + enum + indexes + termini_view
-- Spec §4.1 table 4, §4.2 indexes 1-5, §4.5 derived status

-- enum (status u tabeli — bez 'kasni', taj je izvedeni)
create type termini_status as enum
  ('planirano','zakazano','izvrseno','otkazano');

-- termini (centralni entitet)
create table termini (
  id                  uuid primary key default gen_random_uuid(),
  klijent_id          uuid not null references klijenti(id) on delete restrict,
  lokacija_id         uuid references lokacije(id) on delete set null,
  vrsta_provjere_id   uuid not null references vrste_provjera(id) on delete restrict,
  interval_mjeseci    int,
  datum_zadnjeg       date,
  rok_dospijeca       date not null,
  datum_zakazan       date,
  datum_izvrsenja     date,
  status              termini_status not null default 'planirano',
  zaduzeni            text,
  napomena            text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_termini_datumi check (
    (datum_izvrsenja is null or datum_izvrsenja <= current_date)
    and (datum_zakazan is null or datum_zakazan >= '2020-01-01')
    and (interval_mjeseci is null or interval_mjeseci between 1 and 120)
  )
);

-- Indeksi (spec §4.2)

-- 1) Dashboard "Kasni rokovi" — partial
create index idx_termini_dashboard on termini (rok_dospijeca, status)
  where status in ('planirano','zakazano');

-- 2) Range scan po datumu
create index idx_termini_rok on termini (rok_dospijeca);

-- 3) Klijent detail
create index idx_termini_klijent on termini (klijent_id, rok_dospijeca);

-- 4) Filter po lokaciji (partial — samo non-null)
create index idx_termini_lokacija on termini (lokacija_id) where lokacija_id is not null;

-- 5) Filter po vrsti
create index idx_termini_vrsta on termini (vrsta_provjere_id);

-- View: izvedeni status (kasni se računa on-the-fly)
create view termini_view as
select
  t.*,
  case
    when t.status = 'izvrseno' then 'izvrseno'
    when t.status = 'otkazano' then 'otkazano'
    when t.rok_dospijeca < current_date then 'kasni'
    else t.status::text
  end as status_izvedeni
from termini t;
```

- [ ] **Step 2.3: Primijeni migraciju**

```bash
supabase db reset
```

Očekivano: obje migracije (Task 1 + Task 2) primijenjene bez greške.

- [ ] **Step 2.4: Sanity check — INSERT termin sa svim FK**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'EOF'
-- Setup test podataka
insert into klijenti (id, naziv) values ('11111111-1111-1111-1111-111111111111', 'Test klijent');
insert into vrste_provjera (id, naziv, podrazumevani_interval_mjeseci)
  values ('22222222-2222-2222-2222-222222222222', 'Test vrsta', 12);

-- Insert termin
insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status)
  values ('11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          '2026-07-01', 'planirano');

-- Provjeri da view radi
select naziv, status_izvedeni from termini_view t
  join klijenti k on k.id = t.klijent_id;

-- Test FK restrict: pokušaj brisati klijenta koji ima termin (mora FAIL)
delete from klijenti where id = '11111111-1111-1111-1111-111111111111';
-- Expected ERROR: violates foreign key constraint

-- Cleanup
delete from termini;
delete from vrste_provjera;
delete from klijenti;
EOF
```

Očekivano:
- INSERT termin uspio
- SELECT vraća row sa `status_izvedeni = 'planirano'`
- DELETE klijenta FAIL-uje (FK restrict)
- Final cleanup prolazi

- [ ] **Step 2.5: Commit**

```bash
git add supabase/migrations/ && git commit -m "feat(phase-2): termini table + enum + indexes + view

- termini_status enum: planirano/zakazano/izvrseno/otkazano (kasni izvedeno)
- termini: PK uuid, FK restrict on klijenti/vrste, FK set null on lokacije
- 5 indexes: dashboard (partial), rok, klijent+rok, lokacija (partial), vrsta
- chk_termini_datumi: izvrsenja<=today, zakazan>=2020, interval 1-120
- termini_view: case-based status_izvedeni (kasni = rok<today AND !izvrseno)

Spec §4.1 table 4, §4.2 indexes 1-5, §4.5 view"
```

---

## Task 3: Supporting tables (dokumenti, podsjetnici, chat_poruke)

**Files:**
- Create: `supabase/migrations/<timestamp>_supporting_tables.sql`

**Interfaces:**
- Consumes: Task 2 termini table (FK target)
- Produces: 3 supporting tables + 4 indeksa + pg_trgm extension + trigram index na klijenti

- [ ] **Step 3.1: Kreiraj migration**

```bash
supabase migration new supporting_tables
```

- [ ] **Step 3.2: SQL**

```sql
-- dokumenti, podsjetnici, chat_poruke + indexes + pg_trgm
-- Spec §4.1 tables 5-7, §4.2 indexes 6-10

-- pg_trgm extension za fuzzy search po nazivu firme
create extension if not exists pg_trgm;

-- 5. DOKUMENTI (storage refs)
create table dokumenti (
  id               uuid primary key default gen_random_uuid(),
  termin_id        uuid not null references termini(id) on delete cascade,
  naziv            text not null,
  storage_path     text not null,
  mime_type        text,
  velicina_bajt    bigint,
  generated_by_ai  bool not null default false,
  uploaded_at      timestamptz not null default now()
);

create index idx_dokumenti_termin on dokumenti (termin_id);

-- 6. PODSJETNICI (audit log)
create table podsjetnici (
  id          uuid primary key default gen_random_uuid(),
  termin_id   uuid not null references termini(id) on delete cascade,
  dana_prije  int not null,
  poslat_na   text[] not null,
  poslat_at   timestamptz not null default now(),
  resend_id   text,
  constraint chk_podsjetnici_dana_prije check (dana_prije between 0 and 365)
);

create index idx_podsjetnici_termin on podsjetnici (termin_id, dana_prije);

-- 7. CHAT_PORUKE (AI istorija)
create type chat_uloga as enum ('user','assistant');

create table chat_poruke (
  id                uuid primary key default gen_random_uuid(),
  konverzacija_id   uuid not null,
  uloga             chat_uloga not null,
  sadrzaj           text not null,
  alat_pozivi       jsonb,
  created_at        timestamptz not null default now()
);

create index idx_chat_konverzacija on chat_poruke (konverzacija_id, created_at);

-- Trigram search po nazivu firme (klijenti tabela iz Task 1)
create index idx_klijenti_naziv_trgm on klijenti using gin (naziv gin_trgm_ops);
```

- [ ] **Step 3.3: Primijeni**

```bash
supabase db reset
```

- [ ] **Step 3.4: Test pg_trgm fuzzy search**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'EOF'
insert into klijenti (naziv) values
  ('WAIKIKI BANJA LUKA'), ('WAIKIKI DOBOJ'), ('NEW YORKER');

-- trigram similarity search (% operator)
select naziv, similarity(naziv, 'WAIK') as sim
from klijenti
where naziv % 'WAIK'
order by sim desc;

-- Cleanup
delete from klijenti where naziv in ('WAIKIKI BANJA LUKA', 'WAIKIKI DOBOJ', 'NEW YORKER');
EOF
```

Očekivano: dva WAIKIKI klijenta vraćena sa similarity > 0; NEW YORKER NIJE u rezultatu.

- [ ] **Step 3.5: Commit**

```bash
git add supabase/migrations/ && git commit -m "feat(phase-2): supporting tables — dokumenti, podsjetnici, chat_poruke

- dokumenti: FK CASCADE on termini, storage_path placeholder za Phase 7
- podsjetnici: FK CASCADE, dana_prije 0-365, poslat_na text[]
- chat_poruke: independent (no FK), konverzacija_id grouping
- chat_uloga enum (user/assistant)
- 4 indexes: dokumenti.termin, podsjetnici (termin+dana_prije),
  chat (konverzacija+created), klijenti trigram (pg_trgm)

Spec §4.1 tables 5-7, §4.2 indexes 6-10
Storage cleanup trigger ODGOĐEN do Phase 7"
```

---

## Task 4: Triggers (compute_rok + auto_cycle)

**Files:**
- Create: `supabase/migrations/<timestamp>_triggers.sql`

**Interfaces:**
- Consumes: Task 2 termini table
- Produces: 2 triggera koji automatski računaju rok i ciklus

- [ ] **Step 4.1: Kreiraj migration**

```bash
supabase migration new triggers
```

- [ ] **Step 4.2: SQL — compute_rok trigger**

```sql
-- Triggers: compute_rok + auto_cycle
-- Spec §4.4 (storage_cleanup ODGOĐEN do Phase 7)

-- TRIGGER 1: compute_rok
-- BEFORE INSERT/UPDATE — ako je datum_zadnjeg postavljen, izračunaj
-- rok_dospijeca = datum_zadnjeg + interval mjeseci.
-- Ako interval_mjeseci nije postavljen, koristi default iz vrste_provjera.
create function tg_termini_compute_rok() returns trigger as $$
declare
  v_interval int;
begin
  if NEW.datum_zadnjeg is not null then
    v_interval := coalesce(
      NEW.interval_mjeseci,
      (select podrazumevani_interval_mjeseci from vrste_provjera where id = NEW.vrsta_provjere_id)
    );
    if v_interval is not null then
      NEW.rok_dospijeca := NEW.datum_zadnjeg + (v_interval || ' months')::interval;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$ language plpgsql;

create trigger tg_termini_compute_rok_biud
  before insert or update on termini
  for each row execute function tg_termini_compute_rok();


-- TRIGGER 2: auto_cycle
-- AFTER UPDATE — okida se na tranziciji datum_izvrsenja NULL → NOT NULL
-- + status = 'izvrseno'. Insertuje sljedeći termin u ciklusu.
-- Idempotentno: ne okida na re-update istog datum_izvrsenja.
create function tg_termini_auto_cycle() returns trigger as $$
begin
  if OLD.datum_izvrsenja is null
     and NEW.datum_izvrsenja is not null
     and NEW.status = 'izvrseno' then
    insert into termini (
      klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
      datum_zadnjeg, rok_dospijeca, status
    )
    values (
      NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
      NEW.datum_izvrsenja,
      NEW.datum_izvrsenja, -- placeholder; tg_compute_rok prepisuje
      'planirano'
    );
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger tg_termini_auto_cycle_au
  after update on termini
  for each row execute function tg_termini_auto_cycle();
```

- [ ] **Step 4.3: Primijeni**

```bash
supabase db reset
```

- [ ] **Step 4.4: Test compute_rok**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'EOF'
-- Setup
insert into klijenti (id, naziv) values ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TestK');
insert into vrste_provjera (id, naziv, podrazumevani_interval_mjeseci)
  values ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TestV', 6);

-- TEST 1: insert sa datum_zadnjeg → rok_dospijeca treba biti +6 mjeseci
insert into termini (klijent_id, vrsta_provjere_id, datum_zadnjeg, rok_dospijeca)
  values ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          '2026-01-15', '2099-01-01');  -- rok_dospijeca placeholder
select datum_zadnjeg, rok_dospijeca from termini
  where klijent_id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- Expected: rok_dospijeca = 2026-07-15 (NOT 2099)

-- TEST 2: insert SAMO sa rok_dospijeca (bez datum_zadnjeg) → ostaje
insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca)
  values ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          '2026-12-31');
-- Expected: 2 reda u termini, drugi sa rok 2026-12-31

select count(*) as broj from termini;
-- Expected: 2

-- Cleanup
delete from termini;
delete from vrste_provjera;
delete from klijenti;
EOF
```

Očekivano: prvi insert ima rok 2026-07-15 (računa trigger), drugi 2026-12-31 (ostao).

- [ ] **Step 4.5: Test auto_cycle**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'EOF'
-- Setup
insert into klijenti (id, naziv) values ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TestK');
insert into vrste_provjera (id, naziv, podrazumevani_interval_mjeseci)
  values ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TestV', 12);

-- Insert termin
insert into termini (id, klijent_id, vrsta_provjere_id, rok_dospijeca, status)
  values ('cccc3333-cccc-cccc-cccc-cccccccccccc',
          'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          '2026-06-15', 'planirano');

-- Update: označi kao izvršeno → auto_cycle treba INSERT-uje novi termin
update termini
  set datum_izvrsenja = '2026-06-15', status = 'izvrseno'
  where id = 'cccc3333-cccc-cccc-cccc-cccccccccccc';

-- Expected: 2 reda — original (izvrseno) + novi planirano sa rok = 2027-06-15
select status, datum_zadnjeg, rok_dospijeca, datum_izvrsenja
  from termini
  order by created_at;

-- TEST 3 (idempotentno): re-update istog datum_izvrsenja NE smije praviti 3. termin
update termini
  set napomena = 'irrelevant change'
  where id = 'cccc3333-cccc-cccc-cccc-cccccccccccc';

select count(*) as broj from termini;
-- Expected: 2 (ne 3)

-- Cleanup
delete from termini;
delete from vrste_provjera;
delete from klijenti;
EOF
```

Očekivano:
- Prvi SELECT vraća 2 reda: jedan izvrseno (rok=2026-06-15, datum_izvr=2026-06-15), drugi planirano (datum_zadnjeg=2026-06-15, rok=2027-06-15)
- Drugi count(*) = 2 (idempotentno)

- [ ] **Step 4.6: Commit**

```bash
git add supabase/migrations/ && git commit -m "feat(phase-2): triggers — compute_rok + auto_cycle

- tg_termini_compute_rok (BEFORE INSERT/UPDATE):
  ako je datum_zadnjeg postavljen, rok = datum_zadnjeg + interval mjeseci
  (interval iz NEW ili default iz vrste_provjera). Updates updated_at.
- tg_termini_auto_cycle (AFTER UPDATE):
  okida na transition OLD.datum_izvrsenja=NULL → NEW.IS NOT NULL i status='izvrseno'
  insertuje novi termin sa datum_zadnjeg=NEW.datum_izvrsenja, status='planirano'.
  Idempotentno (ne okida na re-update istog datuma).

Spec §4.4 (storage_cleanup ODGOĐEN do Phase 7)"
```

---

## Task 5: TypeScript types generation

**Files:**
- Create: `db/types.ts` (AUTO-GENERATED — never edit manually)
- Create: `db/README.md`
- Modify: `lib/supabase/server.ts` + `client.ts` + `admin.ts` (dodaj `<Database>` generic)
- Modify: `package.json` (dodaj `db:types` script)

**Interfaces:**
- Consumes: Tasks 1-4 (DB shema kompletna)
- Produces: `Database` type za `createClient<Database>()` u SDK helperima

- [ ] **Step 5.1: Generiši tipove preko Supabase CLI**

```bash
mkdir -p db
supabase gen types typescript --local > db/types.ts
```

Očekivano: `db/types.ts` (par stotina linija) sa interface-ima za `Database`, `Tables`, etc.

- [ ] **Step 5.2: Kreiraj `db/README.md`**

```markdown
# DB types

`db/types.ts` je **AUTO-GENERATED** preko Supabase CLI. Ne edituj ručno.

Regeneracija nakon bilo koje migracije:

```bash
pnpm db:types
```

Ova komanda pokreće:
```bash
supabase gen types typescript --local > db/types.ts
```

Zatim push-uj izmjene zajedno sa migracijom.
```

- [ ] **Step 5.3: Update `package.json` scripts**

Dodaj u `scripts` blok:

```json
"db:types": "supabase gen types typescript --local > db/types.ts",
"db:reset": "supabase db reset"
```

- [ ] **Step 5.4: Update `lib/supabase/server.ts` — dodaj Database generic**

Pronađi liniju:
```ts
return createServerClient(
```
Zamijeni sa:
```ts
return createServerClient<Database>(
```

I na vrhu fajla dodaj import:
```ts
import type { Database } from "@/db/types"
```

- [ ] **Step 5.5: Isto za `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"

export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
```

- [ ] **Step 5.6: Isto za `lib/supabase/admin.ts`**

```ts
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"

export function createAdminSupabaseClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nije postavljen")
  }
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

- [ ] **Step 5.7: Provjeri build/lint/typecheck**

```bash
pnpm build && pnpm lint && pnpm typecheck
```

Sve mora proći. Sad `createServerSupabaseClient().from('klijenti').select('*')` ima full type safety — `naziv`, `napomena`, `created_at` su known fields.

- [ ] **Step 5.8: Sanity check — type intellisense radi u praksi**

Privremeno u `app/page.tsx` dodaj (samo za test, nemoj commit-ovati):

```tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"

export default async function RootPage() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from("klijenti").select("naziv, napomena").limit(1)
  // hover nad `data[0].naziv` u IDE — treba biti `string | undefined`
  console.log(data?.[0]?.naziv) // type-safe
  return null
}
```

Pokreni `pnpm typecheck` — mora pass. Zatim VRATI `app/page.tsx` na originalni `redirect("/termini")`.

- [ ] **Step 5.9: Commit**

```bash
git add db/ lib/supabase/ package.json && git commit -m "feat(phase-2): TypeScript types iz Supabase + Database generic na SDK helperima

- db/types.ts AUTO-GENERATED preko supabase gen types typescript --local
- db/README.md napomena o regeneraciji
- pnpm db:types script za regen
- pnpm db:reset script za lokalni reset
- lib/supabase/{server,client,admin}.ts: createXClient<Database>() — full type safety

Spec §3.2 db/types.ts"
```

---

## Task 6: Excel parser (lib + unit tests)

**Files:**
- Create: `lib/excel/parser.ts` (parseTehproExcel function)
- Create: `lib/excel/parser.types.ts`
- Create: `lib/excel/parser.test.ts`
- Create: `tests/fixtures/tehpro-mini.xlsx` (mali fixture za testove)
- Modify: `package.json` (dodaj `exceljs`, `vitest` ako nedostaje, `test:unit` script)

**Interfaces:**
- Consumes: ništa (čista biblioteka)
- Produces:
  ```ts
  export type ParsedTermin = {
    klijent_naziv: string       // npr. "WAIKIKI BANJA LUKA - DELTA"
    vrsta_naziv: string         // npr. "Pregled gromobranskih instalacija"
    sheet_naziv: string         // "Januar", "Februar", ... "Decembar"
    datum: string               // "YYYY-MM-DD"
    izvor: "izvrseno" | "planirano"
  }
  export function parseTehproExcel(filePath: string): Promise<ParsedTermin[]>
  ```

- [ ] **Step 6.1: Instaliraj deps**

```bash
pnpm add exceljs
pnpm add -D vitest @vitest/coverage-v8
```

- [ ] **Step 6.2: Kreiraj `lib/excel/parser.types.ts`**

```ts
export type Izvor = "izvrseno" | "planirano"

export type ParsedTermin = {
  klijent_naziv: string
  vrsta_naziv: string
  sheet_naziv: string
  datum: string // ISO "YYYY-MM-DD"
  izvor: Izvor
}

export type ParseResult = {
  termini: ParsedTermin[]
  klijenti: string[]   // jedinstveni nazivi
  vrste: string[]      // jedinstveni nazivi
  skipped: SkippedRow[] // za debugging
}

export type SkippedRow = {
  sheet: string
  row: number
  col: number
  reason: string
}
```

- [ ] **Step 6.3: Kreiraj `lib/excel/parser.ts`**

```ts
import ExcelJS from "exceljs"
import type { ParsedTermin, ParseResult, SkippedRow, Izvor } from "./parser.types"

/**
 * Parsira Tehpro Excel ("2026- obilasci, pregledi i ispitivanja, obuke,
 * dokumentacija.xlsx") u flat listu termina.
 *
 * Struktura sheet-a (svaki mjesec ima isti format):
 * - Row 1: header "FIRME" (ignoriše se)
 * - Row 2: nazivi klijenata u parnim kolonama (B, D, F, ...)
 * - Row 3: alternating "Izvršeno:" / "Planirano:" (B=izvr, C=plan, D=izvr, ...)
 * - Row 4+: vrste pregleda u koloni A, datumi u koloni klijenta
 */
export async function parseTehproExcel(filePath: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)

  const termini: ParsedTermin[] = []
  const klijentiSet = new Set<string>()
  const vrsteSet = new Set<string>()
  const skipped: SkippedRow[] = []

  for (const sheet of wb.worksheets) {
    const sheetNaziv = sheet.name.trim()

    // Row 2 — parovi (klijent name na col 2, 4, 6, ...)
    const row2 = sheet.getRow(2)
    const klijentiByCol: Record<number, string> = {}
    row2.eachCell((cell, colNumber) => {
      if (colNumber === 1) return // skip "FIRME" header
      const val = String(cell.value ?? "").trim()
      if (val && val !== " ") {
        klijentiByCol[colNumber] = val
        klijentiSet.add(val)
      }
    })

    // Row 4+ — vrste u col A, datumi u svakoj klijent-koloni (izvrseno + planirano)
    const lastRow = sheet.actualRowCount
    for (let r = 4; r <= lastRow; r++) {
      const row = sheet.getRow(r)
      const vrstaRaw = row.getCell(1).value
      const vrstaNaziv = normalizeVrsta(String(vrstaRaw ?? "").trim())
      if (!vrstaNaziv) continue
      vrsteSet.add(vrstaNaziv)

      // Za svaki klijent par (col_izvr, col_plan)
      for (const [colStr, klijentNaziv] of Object.entries(klijentiByCol)) {
        const colIzvr = Number(colStr)
        const colPlan = colIzvr + 1

        const datumIzvr = extractDate(row.getCell(colIzvr).value)
        const datumPlan = extractDate(row.getCell(colPlan).value)

        if (datumIzvr) {
          termini.push({
            klijent_naziv: klijentNaziv,
            vrsta_naziv: vrstaNaziv,
            sheet_naziv: sheetNaziv,
            datum: datumIzvr,
            izvor: "izvrseno",
          })
        } else if (rawIsNonEmpty(row.getCell(colIzvr).value) && !datumIzvr) {
          skipped.push({ sheet: sheetNaziv, row: r, col: colIzvr, reason: `Izvrseno cell not parseable: ${String(row.getCell(colIzvr).value)}` })
        }

        if (datumPlan) {
          termini.push({
            klijent_naziv: klijentNaziv,
            vrsta_naziv: vrstaNaziv,
            sheet_naziv: sheetNaziv,
            datum: datumPlan,
            izvor: "planirano",
          })
        } else if (rawIsNonEmpty(row.getCell(colPlan).value) && !datumPlan) {
          skipped.push({ sheet: sheetNaziv, row: r, col: colPlan, reason: `Planirano cell not parseable: ${String(row.getCell(colPlan).value)}` })
        }
      }
    }
  }

  return {
    termini,
    klijenti: Array.from(klijentiSet).sort(),
    vrste: Array.from(vrsteSet).sort(),
    skipped,
  }
}

/**
 * Normalizuje višelinijski naziv vrste pregleda (Excel često ima newline-ove
 * i parentezirane potkategorije). Skida prefixe poput "Mjerenje uslova radne
 * sredine u ljetnjem periodu\n(mikroklima, ...)" u jednu liniju.
 */
function normalizeVrsta(raw: string): string {
  if (!raw) return ""
  // Sve newline-ove → razmak; višestruke razmake → jedan
  return raw.replace(/\s+/g, " ").trim()
}

/**
 * Excel ćelija može biti: Date objekat (ExcelJS auto-parsing), broj
 * (Excel serial date), string "20.01.2026.", string sa whitespace,
 * ili null. Vraća "YYYY-MM-DD" ili null.
 */
function extractDate(raw: ExcelJS.CellValue): string | null {
  if (raw == null) return null
  if (raw instanceof Date) {
    return toIsoDate(raw)
  }
  if (typeof raw === "number") {
    // Excel serial (days since 1900-01-01 sa Lotus bug)
    const date = excelSerialToDate(raw)
    return date ? toIsoDate(date) : null
  }
  if (typeof raw === "string") {
    return parseStringDate(raw.trim())
  }
  // ExcelJS rich text / formula result
  if (typeof raw === "object" && "text" in raw && typeof raw.text === "string") {
    return parseStringDate(raw.text.trim())
  }
  if (typeof raw === "object" && "result" in raw) {
    return extractDate((raw as { result: ExcelJS.CellValue }).result)
  }
  return null
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function excelSerialToDate(serial: number): Date | null {
  if (!isFinite(serial) || serial < 1) return null
  // Excel epoch: 1899-12-30 (uračunava 1900 leap year bug)
  const epoch = Date.UTC(1899, 11, 30)
  return new Date(epoch + serial * 86400_000)
}

function parseStringDate(s: string): string | null {
  if (!s) return null
  // "20.01.2026." ili "20.01.2026" ili "20.1.2026"
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  // Već ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10)
  }
  return null
}

function rawIsNonEmpty(v: ExcelJS.CellValue): boolean {
  if (v == null) return false
  if (typeof v === "string") return v.trim().length > 0
  return true
}
```

- [ ] **Step 6.4: Kreiraj test fixture `tests/fixtures/tehpro-mini.xlsx`**

Napravi mali Excel preko Python-a (jednokratno, fixture commit-uješ):

```bash
mkdir -p tests/fixtures
python3 <<'EOF'
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.title = "TestMjesec"
# Row 1
ws.cell(row=1, column=1, value="FIRME")
# Row 2 — klijenti
ws.cell(row=2, column=2, value="KLIJENT A")
ws.cell(row=2, column=4, value="KLIJENT B")
# Row 3 — labels
ws.cell(row=3, column=2, value="Izvršeno:")
ws.cell(row=3, column=3, value="Planirano:")
ws.cell(row=3, column=4, value="Izvršeno:")
ws.cell(row=3, column=5, value="Planirano:")
# Row 4 — vrsta 1
ws.cell(row=4, column=1, value="Vrsta jedan")
ws.cell(row=4, column=2, value="15.01.2026.")   # KLIJENT A izvr
ws.cell(row=4, column=5, value="20.02.2026.")   # KLIJENT B plan
# Row 5 — vrsta 2 (sa newline)
ws.cell(row=5, column=1, value="Vrsta dva\n(podkategorija)")
ws.cell(row=5, column=3, value="10.03.2026.")   # KLIJENT A plan
# Row 6 — empty vrsta
ws.cell(row=6, column=1, value="")
# Row 7 — vrsta 3, no dates
ws.cell(row=7, column=1, value="Vrsta tri")
wb.save("tests/fixtures/tehpro-mini.xlsx")
print("Saved.")
EOF
```

Očekivano: kreiran fajl `tests/fixtures/tehpro-mini.xlsx` (~5 KB).

- [ ] **Step 6.5: Kreiraj `lib/excel/parser.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { parseTehproExcel } from "./parser"
import path from "node:path"

const FIXTURE = path.join(__dirname, "../../tests/fixtures/tehpro-mini.xlsx")

describe("parseTehproExcel", () => {
  it("parsira fixture sa 2 klijenta i 3 vrste pregleda", async () => {
    const result = await parseTehproExcel(FIXTURE)

    // 2 klijenta detektovana
    expect(result.klijenti).toEqual(["KLIJENT A", "KLIJENT B"])

    // 3 vrste (4. je prazna, 6. nema datuma ali se računa u vrstama)
    expect(result.vrste).toContain("Vrsta jedan")
    expect(result.vrste).toContain("Vrsta dva (podkategorija)")
    expect(result.vrste).toContain("Vrsta tri")
  })

  it("ekstrahuje 3 termina iz fixture-a", async () => {
    const result = await parseTehproExcel(FIXTURE)
    expect(result.termini).toHaveLength(3)
  })

  it("mapira izvrseno vs planirano kolonu pravilno", async () => {
    const result = await parseTehproExcel(FIXTURE)

    const a = result.termini.find(t =>
      t.klijent_naziv === "KLIJENT A" && t.vrsta_naziv === "Vrsta jedan"
    )
    expect(a).toEqual({
      klijent_naziv: "KLIJENT A",
      vrsta_naziv: "Vrsta jedan",
      sheet_naziv: "TestMjesec",
      datum: "2026-01-15",
      izvor: "izvrseno",
    })

    const b = result.termini.find(t =>
      t.klijent_naziv === "KLIJENT B" && t.vrsta_naziv === "Vrsta jedan"
    )
    expect(b?.izvor).toBe("planirano")
    expect(b?.datum).toBe("2026-02-20")
  })

  it("normalizuje multiline vrsta naziv u jednu liniju", async () => {
    const result = await parseTehproExcel(FIXTURE)
    const vrstaDva = result.termini.find(t => t.klijent_naziv === "KLIJENT A" && t.vrsta_naziv.startsWith("Vrsta dva"))
    expect(vrstaDva?.vrsta_naziv).toBe("Vrsta dva (podkategorija)")
    expect(vrstaDva?.izvor).toBe("planirano")
    expect(vrstaDva?.datum).toBe("2026-03-10")
  })

  it("ne emit-uje termin za prazne ćelije", async () => {
    const result = await parseTehproExcel(FIXTURE)
    // Vrsta tri nema datuma u fixture-u → 0 termina
    const tri = result.termini.filter(t => t.vrsta_naziv === "Vrsta tri")
    expect(tri).toHaveLength(0)
  })
})
```

- [ ] **Step 6.6: Update `package.json` scripts**

Dodaj:
```json
"test:unit": "vitest run",
"test:unit:watch": "vitest"
```

- [ ] **Step 6.7: Kreiraj `vitest.config.ts` (root)**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
})
```

- [ ] **Step 6.8: Pokreni unit testove**

```bash
pnpm test:unit
```

Očekivano: 5/5 testova pass.

Ako neki fail-uje: čitaj output, popravi parser, ponovi.

- [ ] **Step 6.9: Pokreni full check**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e
```

Sve mora pass. Playwright nije promijenjen — i dalje 16/16.

- [ ] **Step 6.10: Commit**

```bash
git add lib/excel/ tests/fixtures/ vitest.config.ts package.json pnpm-lock.yaml && git commit -m "feat(phase-2): Excel parser library + unit tests

- lib/excel/parser.ts: parseTehproExcel(filePath) → ParseResult
- exceljs lib (security-clean alternative to xlsx)
- Handles: Date objects, Excel serial numbers, dotted strings,
  rich text, formula results
- Normalizes multiline vrsta nazive
- Skipped rows tracked za debugging
- 5 vitest unit testovi protiv mini fixture-a
- vitest.config.ts + pnpm test:unit script"
```

---

## Task 7: Seed import skripta

**Files:**
- Create: `scripts/seed-from-excel.ts`
- Create: `scripts/README.md`
- Modify: `package.json` (dodaj `seed` script)

**Interfaces:**
- Consumes: Task 6 parser, Task 5 SDK admin helper
- Produces: idempotentna seed funkcija; `pnpm seed` puni dev bazu

- [ ] **Step 7.1: Kreiraj `scripts/seed-from-excel.ts`**

```ts
/**
 * Seed lokalne baze sa Tehpro Excel podacima.
 *
 * Pokretanje:
 *   pnpm seed
 *
 * Idempotentno — pokretanje 2× ne pravi duplikate (.upsert na naziv).
 *
 * Strategija:
 * 1. Parse Excel → ParsedTermin[]
 * 2. Upsert sve jedinstvene klijente (po naziv)
 * 3. Upsert sve jedinstvene vrste_provjera (po naziv)
 * 4. Insert termini — datum_zadnjeg za 'izvrseno' izvor, datum_zakazan za 'planirano'
 */

import path from "node:path"
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { parseTehproExcel } from "../lib/excel/parser"

const EXCEL_PATH = path.join(
  __dirname,
  "..",
  "..",
  "2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx"
)

async function main() {
  console.log("📁 Excel:", EXCEL_PATH)
  console.log("🔄 Parsing...")
  const parsed = await parseTehproExcel(EXCEL_PATH)

  console.log(`   ${parsed.klijenti.length} klijenata`)
  console.log(`   ${parsed.vrste.length} vrsta provjera`)
  console.log(`   ${parsed.termini.length} termina`)
  console.log(`   ${parsed.skipped.length} skipped rows`)

  if (parsed.skipped.length > 0) {
    console.log("⚠️  Skipped rows (first 5):")
    parsed.skipped.slice(0, 5).forEach(s =>
      console.log(`   ${s.sheet} R${s.row} C${s.col}: ${s.reason}`)
    )
  }

  const supabase = createAdminSupabaseClient()

  // 1) Upsert klijenti
  console.log("\n💾 Upserting klijenti...")
  const klijentiRows = parsed.klijenti.map(naziv => ({ naziv }))
  const { data: klijenti, error: kErr } = await supabase
    .from("klijenti")
    .upsert(klijentiRows, { onConflict: "naziv", ignoreDuplicates: false })
    .select("id, naziv")
  if (kErr) throw new Error(`klijenti upsert failed: ${kErr.message}`)
  const klijentiMap = new Map(klijenti?.map(k => [k.naziv, k.id]) ?? [])
  console.log(`   ${klijentiMap.size} klijenata u bazi`)

  // 2) Upsert vrste_provjera
  console.log("\n💾 Upserting vrste_provjera...")
  const vrsteRows = parsed.vrste.map(naziv => ({ naziv }))
  const { data: vrste, error: vErr } = await supabase
    .from("vrste_provjera")
    .upsert(vrsteRows, { onConflict: "naziv", ignoreDuplicates: false })
    .select("id, naziv")
  if (vErr) throw new Error(`vrste upsert failed: ${vErr.message}`)
  const vrsteMap = new Map(vrste?.map(v => [v.naziv, v.id]) ?? [])
  console.log(`   ${vrsteMap.size} vrsta u bazi`)

  // 3) DELETE existing termini for idempotency (klijent+vrsta+datum unique)
  // Pošto nemamo unique constraint na (klijent, vrsta, datum_zadnjeg ili datum_zakazan),
  // ovaj seed RESETUJE termini tabelu pri svakom pokretanju. Klijenti i vrste ostaju.
  console.log("\n🗑️  Brisanje postojećih termina za clean seed...")
  const { error: delErr } = await supabase.from("termini").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  if (delErr) throw new Error(`termini delete failed: ${delErr.message}`)

  // 4) Insert termini (bulk)
  console.log("\n💾 Inserting termini...")
  const terminiRows = parsed.termini.map(t => {
    const klijentId = klijentiMap.get(t.klijent_naziv)
    const vrstaId = vrsteMap.get(t.vrsta_naziv)
    if (!klijentId || !vrstaId) {
      throw new Error(`Missing FK: klijent=${t.klijent_naziv}, vrsta=${t.vrsta_naziv}`)
    }
    const isIzvr = t.izvor === "izvrseno"
    return {
      klijent_id: klijentId,
      vrsta_provjere_id: vrstaId,
      // Za izvrseno: datum je datum_zadnjeg (trigger compute_rok računa rok)
      // Za planirano: datum je rok_dospijeca direktno
      datum_zadnjeg: isIzvr ? t.datum : null,
      datum_izvrsenja: isIzvr ? t.datum : null,
      rok_dospijeca: isIzvr ? t.datum : t.datum, // placeholder za izvrseno; trigger prepiše
      status: (isIzvr ? "izvrseno" : "planirano") as "izvrseno" | "planirano",
    }
  })

  // Bulk insert u batch-ovima od 500 (Supabase REST limit)
  let inserted = 0
  for (let i = 0; i < terminiRows.length; i += 500) {
    const batch = terminiRows.slice(i, i + 500)
    const { error: tErr, count } = await supabase.from("termini").insert(batch, { count: "exact" })
    if (tErr) throw new Error(`termini insert failed at batch ${i}: ${tErr.message}`)
    inserted += count ?? batch.length
  }
  console.log(`   ${inserted} termina insertovano`)

  console.log("\n✅ Seed gotov.")
}

main().catch(err => {
  console.error("❌ Seed failed:", err)
  process.exit(1)
})
```

**Note:** Ovaj fajl ima `for` loop sa `await` (Step 4 batch insert) — u `scripts/` je `no-await-in-loop` rule disabled (Faza 1 Task 5 override).

- [ ] **Step 7.2: Kreiraj `scripts/README.md`**

```markdown
# Scripts

## `pnpm seed`

Puni lokalnu dev bazu sa stvarnim Tehpro podacima iz Excel-a u parent
direktoriju projekta (`../2026- obilasci, pregledi i ispitivanja, obuke,
dokumentacija.xlsx`).

**Preduslovi:**
- `supabase start` (lokalni Docker stack)
- Migracije primijenjene (`pnpm db:reset`)
- `.env.local` postoji sa SUPABASE_SERVICE_ROLE_KEY

**Idempotentno:** klijenti i vrste se upsert-uju po naziv (unique). Termini
se brišu i ponovo insertuju svaki put.

## `pnpm db:reset`

Resetuje lokalnu bazu i ponovo primjenjuje sve migracije. Briše sve podatke.
Nakon ovoga, pokreni `pnpm seed` da napuniš.

## `pnpm db:types`

Generiše `db/types.ts` iz trenutne sheme lokalne baze.
```

- [ ] **Step 7.3: Update `package.json` scripts**

Dodaj:
```json
"seed": "tsx scripts/seed-from-excel.ts"
```

Instaliraj `tsx` ako nije već:
```bash
pnpm add -D tsx
```

- [ ] **Step 7.4: Pokreni seed prvi put**

```bash
pnpm db:reset && pnpm seed
```

Očekivano output (otprilike, brojevi su orijentacioni):
```
📁 Excel: /Users/nmil/Desktop/Ai Forward/2026- obilasci...
🔄 Parsing...
   ~30-50 klijenata
   ~15-20 vrsta provjera
   ~200-500 termina
   0 skipped rows
💾 Upserting klijenti...
   N klijenata u bazi
💾 Upserting vrste_provjera...
   M vrsta u bazi
🗑️  Brisanje postojećih termina za clean seed...
💾 Inserting termini...
   X termina insertovano
✅ Seed gotov.
```

- [ ] **Step 7.5: Pokreni seed drugi put — provjeri idempotentnost**

```bash
pnpm seed
```

Očekivano: ista brojka klijenata i vrsta (upsert ne duplira), termini ista brojka (delete + insert).

- [ ] **Step 7.6: Sanity check baze**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'EOF'
select 'klijenti' as t, count(*) from klijenti
union all select 'vrste_provjera', count(*) from vrste_provjera
union all select 'termini', count(*) from termini
union all select 'termini kasni', count(*) from termini_view where status_izvedeni='kasni';
EOF
```

Očekivano: brojevi se slažu sa output-om seed-a + neki termini su 'kasni' (jer je Excel za 2026, a danas je 2026-06-20+).

- [ ] **Step 7.7: Commit**

```bash
git add scripts/ package.json pnpm-lock.yaml && git commit -m "feat(phase-2): seed import skripta + tsx runner

- scripts/seed-from-excel.ts: parse → upsert klijenti/vrste → insert termini
- Idempotentno: upsert na naziv (unique), termini se brišu+insertuju svaki put
- Batch insert (500 per request) za bulk termini
- pnpm seed script preko tsx
- scripts/README.md sa preduslovima i kako pokrenuti"
```

---

## Task 8: E2E data test + push + phase gate

**Files:**
- Create: `tests/e2e/02-data.spec.ts`
- Possibly: modify `app/(dashboard)/termini/page.tsx` da prikazuje broj termina (za E2E provjeru)

**Interfaces:**
- Consumes: Tasks 1-7 (data sve u bazi)
- Produces: E2E test koji potvrđuje da seed data dospijeva do UI sloja

- [ ] **Step 8.1: Update `app/(dashboard)/termini/page.tsx` da prikazuje broj termina**

```tsx
import { createServerSupabaseClient } from "@/lib/supabase/server"

export default async function TerminiPage() {
  const supabase = await createServerSupabaseClient()
  const { count } = await supabase
    .from("termini")
    .select("*", { count: "exact", head: true })

  return (
    <div>
      <h1 className="text-2xl font-semibold">Termini</h1>
      <p className="mt-2 text-slate-600">
        Sadržaj se popunjava u Fazi 3.
      </p>
      <p className="mt-4 text-sm text-slate-500" data-testid="termini-count">
        Termina u bazi: <span className="font-medium">{count ?? 0}</span>
      </p>
    </div>
  )
}
```

Razlog: ovo nije "stranica" još (to dolazi u Fazi 3), ali nam je potrebno za E2E gate da potvrdi seed→DB→RSC→UI chain radi. Sljedeća faza (3) prepisuje ovo.

- [ ] **Step 8.2: Kreiraj `tests/e2e/02-data.spec.ts`**

```ts
import { test, expect } from "@playwright/test"

test.describe("Faza 2 data layer", () => {
  test("Termini stranica prikazuje broj termina > 0 (seed primijenjen)", async ({ page }) => {
    await page.goto("/termini")
    const countEl = page.getByTestId("termini-count")
    await expect(countEl).toBeVisible()

    const text = await countEl.textContent()
    expect(text).toMatch(/Termina u bazi:\s*\d+/)

    // Ekstrahuj broj i potvrdi > 0
    const match = text?.match(/Termina u bazi:\s*(\d+)/)
    const count = match ? Number(match[1]) : 0
    expect(count).toBeGreaterThan(0)
  })

  test("Bez Supabase grešaka u console na /termini load", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", err => errors.push(err.message))
    page.on("console", msg => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
```

- [ ] **Step 8.3: Pokreni E2E**

```bash
pnpm test:e2e
```

Očekivano: 18/18 testova pass (16 from Faza 1 + 2 nova = 18) × 2 browsera = 36.

Ako test 8.2 fail-uje — broj termina = 0 → seed nije pokrenut. Pokreni `pnpm seed` i ponovi.

- [ ] **Step 8.4: Full check**

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:e2e
```

Sve mora pass.

- [ ] **Step 8.5: Commit**

```bash
git add app/ tests/e2e/ && git commit -m "feat(phase-2): /termini stub prikazuje broj termina + E2E gate

- TerminiPage sad async RSC sa Supabase count('exact', head:true)
- data-testid='termini-count' za stabilan E2E selector
- 02-data.spec.ts: 2 testa (count > 0, no console errors)
- Phase 3 prepisuje ovaj stub sa pravom UI tabelom"
```

- [ ] **Step 8.6: Push na GitHub**

```bash
git push origin main
```

- [ ] **Step 8.7: Phase 2 Gate — dispatch fresh agent**

Dispatch novi `claude` general-purpose agent sa praznim kontekstom i sljedećim promptom:

```
You are an independent verifier for Phase 2 of the Tehpro MVP project.
You have NO context. Validate ONLY Phase 2 deliverables.

Inputs:
- Codebase: /Users/nmil/Desktop/Ai Forward/tehpro-mvp/
- Spec: docs/superpowers/specs/2026-06-20-tehpro-mvp-design.md (sections 4, 5)
- Plan: docs/superpowers/plans/2026-06-20-tehpro-mvp-phase-2-db-import.md

Phase 2 has 8 tasks. Read Plan's "Task Map".

Tasks:
1. Pre-flight: supabase start (ensure Docker stack up); pnpm install
2. Gate 1 (DB migracije): pnpm db:reset — must apply 4 migrations clean.
   Then: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"
   Must show 7 tables: klijenti, lokacije, vrste_provjera, termini, dokumenti, podsjetnici, chat_poruke
   Plus: \dT+ public.* must show 2 enums: termini_status, chat_uloga
   Plus: \dv public.* must show 1 view: termini_view
3. Gate 2 (Triggeri): Run a transaction:
   - INSERT klijent, vrsta, termin sa datum_zadnjeg='2026-01-15', interval=6, rok='2099-01-01'
   - SELECT rok_dospijeca → must be 2026-07-15 (NOT 2099 — trigger overwrote)
   - UPDATE termin SET datum_izvrsenja='2026-01-15', status='izvrseno' → must spawn new termin
   - SELECT count(*) FROM termini → must be 2
   - UPDATE termin SET napomena='change' on same row → count must STILL be 2 (idempotent)
   - Cleanup
4. Gate 3 (Types): pnpm typecheck must pass. db/types.ts must exist.
5. Gate 4 (Unit): pnpm test:unit — vitest must pass (5+ tests).
6. Gate 5 (Seed): pnpm seed — must run clean. Re-run must produce same counts (idempotent).
7. Gate 6 (E2E): pnpm test:e2e — must pass 18+ tests (36+ across browsers).
8. Gate 7 (Manual): pnpm dev, use mcp__playwright__* to open /termini, confirm
   "Termina u bazi: N" where N > 0.
9. Gate 8 (Git): git status clean, git log shows ~8 commits with feat(phase-2): prefix,
   git push origin main (or verify already pushed).

Return STRICT JSON:
{
  "phase": 2,
  "gate_1_migrations": "pass|fail",
  "tables_count": <int>,
  "enums_present": "pass|fail",
  "view_present": "pass|fail",
  "gate_2_triggers": {
    "compute_rok": "pass|fail",
    "auto_cycle": "pass|fail",
    "auto_cycle_idempotent": "pass|fail"
  },
  "gate_3_types": "pass|fail",
  "gate_4_unit_tests": "pass|fail|N/M",
  "gate_5_seed": "pass|fail",
  "gate_5_seed_idempotent": "pass|fail",
  "klijenti_count": <int>,
  "vrste_count": <int>,
  "termini_count": <int>,
  "gate_6_e2e": "pass|fail|N/M",
  "gate_7_manual_termini_count": <int>,
  "gate_8_git_clean": "pass|fail",
  "phase_2_commits": <int>,
  "blockers": [...],
  "non_blockers": [...]
}

Do NOT suggest improvements. Only report.
```

Ako gate prolazi (`blockers: []`), tag `v0.2.0` i push tag.
Ako ima blockers — fiks → re-run gate.

- [ ] **Step 8.8: Tag i push**

```bash
git tag -a v0.2.0 -m "Phase 2 — DB shema + Excel import complete

T1: Foundation tables (klijenti, lokacije, vrste_provjera)
T2: Termini + view + 5 indexes
T3: Supporting tables (dokumenti, podsjetnici, chat_poruke) + pg_trgm
T4: Triggers (compute_rok + auto_cycle; storage_cleanup deferred to Phase 7)
T5: TypeScript types generated; SDK helpers typed
T6: Excel parser + 5 unit tests
T7: Seed import idempotentno (real Tehpro Excel)
T8: E2E data test + phase gate ALL PASS"

git push origin v0.2.0
```

---

## Self-Review

**1. Spec coverage:**

Sekcije spec-a koje Faza 2 pokriva:
- §4.1 Tabele (sve 7): ✓ Tasks 1, 2, 3
- §4.2 Indeksi (svih 10): ✓ Tasks 1, 2, 3
- §4.3 FK pravila: ✓ Tasks 1-3 (RESTRICT, CASCADE, SET NULL)
- §4.4 Triggeri (compute_rok, auto_cycle): ✓ Task 4. **storage_cleanup ODGOĐEN do Phase 7** — eksplicitno dokumentovano u "Ključne odluke" §2.
- §4.5 termini_view (izvedeni status): ✓ Task 2
- §4.6 RLS isključen: implicitno OK (nismo aktivirali RLS — default-no)
- §5 N+1 prevention pravilo: već enforced ESLint-om (Faza 1 Task 5). U seed skripti se koristi bulk insert (ne loop+insert) — princip primijenjen.
- §6 Connection pooling: aplikativni kod koristi `@supabase/supabase-js` SDK; seed skripta koristi admin SDK (HTTP/PostgREST) — bez direktne PG konekcije (osim psql sanity checks koji NISU u runtime kodu). Pooling pravila NE bivaju kršena.
- §9.1 02-data.spec.ts: ✓ Task 8

**Gap:** `lokacije` tabela ostaje prazna nakon seed-a (per Ključna odluka §1). Ovo NIJE bug — to je naša namjerna odluka. UI Faze 4 (Klijenti detail) će tretirati prazan lokacije set ispravno (samo prikaz "Nema lokacija").

**2. Placeholder scan:**

Tražim "TBD", "TODO", "implement later", "fill in details":
- "ODGOĐEN do Phase 7" za storage_cleanup — to je eksplicitno odložen feature sa fazom, ne TODO bez datuma. OK.
- "podsjetnici dolaze u Fazi 6", "AI dolazi u Fazi 8" — nema u plan tekstu. Plan se striktno drži Faze 2.
- Step 8.1 "Sadržaj se popunjava u Fazi 3" — to je tekst u UI stub-u za korisnika, ne TODO u kodu. OK.

Bez TODO/TBD u plan tekstu. OK.

**3. Type consistency:**

- Parser produces `ParsedTermin { klijent_naziv, vrsta_naziv, sheet_naziv, datum, izvor }` (Task 6). Seed konzumira: `t.klijent_naziv`, `t.vrsta_naziv`, `t.datum`, `t.izvor` (Task 7). Field names match.
- `ParsedTermin.izvor: "izvrseno" | "planirano"` (Task 6). Seed mapira `isIzvr = t.izvor === "izvrseno"` (Task 7). Match.
- DB `termini.status` enum `('planirano','zakazano','izvrseno','otkazano')` (Task 2). Seed insertuje `'izvrseno' | 'planirano'` (Task 7). Subset of enum — valid.
- `Database` type iz `db/types.ts` (Task 5) konzumiran od strane `createServerSupabaseClient<Database>()` (Task 5). Match.

Bez signature mismatch-a. OK.

---

## Execution Handoff

Plan complete. Save u `docs/superpowers/plans/2026-06-20-tehpro-mvp-phase-2-db-import.md`.

Po dogovoru sa Faze 1, koristi **Subagent-Driven Development** — fresh subagent po task-u, sa task review nakon svakog, i phase gate na kraju.

Spreman za izvršavanje.
