# PP‑1 — Klijent & Ugovor (ID karta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Omogućiti kompletnu „ID kartu klijenta" — osnovni podaci + ugovor + kontakti + ugovorene usluge — centralizovati dokumente (klijent/ugovor/termin) i dati adminu kontrolu nad vrstama usluga.

**Architecture:** Inkrementalno proširenje postojeće Supabase šeme (nove tabele `ugovori`, `kontakt_osobe`; nove kolone na `klijenti`, `vrste_provjera`, `klijent_provjere`, `dokumenti`). Motor rokova (`termini`/`klijent_provjere` generisanje) se NE dira. Server actions (Next.js) + zod validacija + base‑ui Sheet forme. RLS preko postojećih helpera, audit preko `tg_audit()`.

**Tech Stack:** Next.js 16.2.9 (App Router, Server Actions), React 19, Supabase (Postgres + RLS + Storage), zod 4, base‑ui + tailwind, vitest (unit), Playwright (E2E), pnpm.

## Global Constraints

- **Next.js je netipičan:** „This is NOT the Next.js you know" — prije pisanja koda pročitati relevantan vodič u `node_modules/next/dist/docs/` (vidi `AGENTS.md`). Dev se pokreće `pnpm dev` (`next dev -p 3000 --webpack`).
- **Package manager:** `pnpm` (NE npm/yarn).
- **Migracije moraju biti re‑run sigurne:** `if not exists` za tabele/indekse, `drop policy if exists` prije `create policy`, `create or replace` za funkcije/trigere (gdje moguće).
- **Primjena migracija:** prvo lokalni Docker Supabase stack, pa cloud preko `tsx --env-file=.env.local scripts/apply-cloud-migration.ts` (cloud baza NIJE u MCP).
- **Nakon svake schema izmjene:** `pnpm db:types` regeneriše `db/types.ts` (commit zajedno sa migracijom; CI očekuje bez diff‑a).
- **Backend testiranje ide kroz Docker; docker build uvijek sa `.env` fajlom** (korisničko pravilo).
- **NIKAD dummy/placeholder podaci** u kodu (korisničko pravilo).
- **RLS helperi (postoje):** `ima_pristup_klijentu(uuid)`, `je_admin()`, `je_pregled()`. Politike: `<kratko>_sel` (select) i `<kratko>_wr` (all: using + with check). Viewovi koji čitaju RLS tabele moraju imati `security_invoker = on`.
- **Audit:** svaka nova tabela dobija `create trigger audit_<tabela> after insert or update or delete on <tabela> for each row execute function tg_audit();`
- **UUID:** `gen_random_uuid()` (pgcrypto već instaliran). Vremenske: `timestamptz not null default now()`.
- **Forma‑obrazac (base‑ui):** `Sheet`+`SheetTrigger render={...}` + `useActionState` + `submitted` ref + `router.refresh()` na uspjeh; akcije vraćaju `ActionResult` (`{ok:true} | {ok:false, errors?, message?}`); parsiranje `zod.safeParse(Object.fromEntries(formData))`.
- **Storage bucket:** `tehpro-dokumenti` (privatan), helperi u `lib/supabase/storage.ts`.

---

## File Structure

**Migracije (nove):**
- `supabase/migrations/20260627120000_klijenti_idkarta_polja.sql`
- `supabase/migrations/20260627120100_ugovori.sql`
- `supabase/migrations/20260627120200_kontakt_osobe.sql`
- `supabase/migrations/20260627120300_klijent_provjere_ugovor.sql`
- `supabase/migrations/20260627120400_vrste_vodi_dokumentaciju.sql`
- `supabase/migrations/20260627120500_dokumenti_generalizacija.sql`

**Lib (nove pure funkcije + testovi):**
- `lib/ugovori.ts` + `lib/ugovori.test.ts`
- `lib/dokumenti.ts` + `lib/dokumenti.test.ts`

**Server actions (izmjene):**
- `app/(dashboard)/klijenti/actions.ts` — proširiti klijent schemu; dodati `ugovori` + `kontakti` CRUD.
- `app/(dashboard)/postavke/actions.ts` — `updateVrsta`, `postaviVrstaAktivna`.
- `app/(dashboard)/dokumenti/actions.ts` — `uploadKlijentDokumentAction`.
- `lib/supabase/storage.ts` — `dokumentStoragePath` helper (re‑export iz `lib/dokumenti.ts`).

**Komponente (nove/izmjene):**
- `components/domain/KlijentEditForm.tsx` — proširiti ID‑karta poljima + `zaduzeni_tehpro` select.
- `components/domain/UgovorSheet.tsx` (nova) + `components/domain/UgovoriTab.tsx` (nova, prikaz na ID karti).
- `components/domain/KontaktSheet.tsx` (nova) + `components/domain/KontaktiKlijentList.tsx` (nova).
- `components/domain/IdKartaTab.tsx` (nova — sklapa osnovne podatke + ugovor + kontakte + ugovorene usluge).
- `components/domain/VrstaSheet.tsx` (nova — uredi/deaktiviraj vrstu + vodi_dokumentaciju) + izmjena `app/(dashboard)/postavke/page.tsx`.
- `components/domain/KlijentDokumentUpload.tsx` (nova — upload na nivou klijenta + tip) + izmjena `components/domain/KlijentTabs.tsx` (+ tab `id-karta`) i `app/(dashboard)/klijenti/[id]/page.tsx`.

**E2E:**
- `tests/e2e/10-id-karta.spec.ts` (nova).

---

## Task 1: Migracija — ID‑karta polja na `klijenti`

**Files:**
- Create: `supabase/migrations/20260627120000_klijenti_idkarta_polja.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces: kolone `klijenti.adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id (uuid → korisnici)`.

- [ ] **Step 1: Napisati migraciju**

```sql
-- supabase/migrations/20260627120000_klijenti_idkarta_polja.sql
-- PP-1: ID-karta polja na klijentu + odgovorna osoba ispred TEHPRO-a.
-- Sve nullable → ne-rušeća migracija. Re-run safe (add column if not exists).

alter table klijenti add column if not exists adresa            text;
alter table klijenti add column if not exists pib               text;
alter table klijenti add column if not exists maticni_broj      text;
alter table klijenti add column if not exists sifra_djelatnosti text;
alter table klijenti add column if not exists telefon           text;
alter table klijenti add column if not exists email             text;
alter table klijenti add column if not exists zaduzeni_tehpro_id uuid
  references korisnici(id) on delete set null;

create index if not exists idx_klijenti_zaduzeni on klijenti (zaduzeni_tehpro_id);
```

- [ ] **Step 2: Primijeniti lokalno (Docker) i provjeriti**

Run: `pnpm db:reset` (resetuje lokalni stack i primijeni sve migracije)
Expected: bez greške; izlaz sadrži `20260627120000_klijenti_idkarta_polja`.

- [ ] **Step 3: Regenerisati tipove**

Run: `pnpm db:types`
Expected: `db/types.ts` `klijenti.Row` sada sadrži `adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (nema novih grešaka).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120000_klijenti_idkarta_polja.sql db/types.ts
git commit -m "feat(pp1): ID-karta polja na klijenti (adresa/pib/kontakt/zaduzeni_tehpro)"
```

---

## Task 2: Migracija — tabela `ugovori` (+ RLS + audit + jedan aktivan)

**Files:**
- Create: `supabase/migrations/20260627120100_ugovori.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces: tabela `ugovori(id, klijent_id, zavodni_broj, datum_potpisivanja, datum_isteka, vazenje_mjeseci, broj_obilazaka_mjesecno, automatsko_obnavljanje, aktivan, napomena, created_at)`; invarijanta „jedan aktivan po klijentu" (partial unique index).

- [ ] **Step 1: Napisati migraciju**

```sql
-- supabase/migrations/20260627120100_ugovori.sql
-- PP-1: Ugovori (1 klijent → N ugovora, jedan aktivan). RLS preko klijenta + audit.

create table if not exists ugovori (
  id                      uuid primary key default gen_random_uuid(),
  klijent_id              uuid not null references klijenti(id) on delete cascade,
  zavodni_broj            text,
  datum_potpisivanja      date,
  datum_isteka            date,
  vazenje_mjeseci         int,
  broj_obilazaka_mjesecno int,
  automatsko_obnavljanje  bool not null default false,
  aktivan                 bool not null default true,
  napomena                text,
  created_at              timestamptz not null default now(),
  constraint chk_ugovori_vazenje check (vazenje_mjeseci is null or vazenje_mjeseci between 1 and 600),
  constraint chk_ugovori_obilasci check (broj_obilazaka_mjesecno is null or broj_obilazaka_mjesecno between 0 and 31),
  constraint chk_ugovori_datumi check (datum_isteka is null or datum_potpisivanja is null or datum_isteka >= datum_potpisivanja)
);

create index if not exists idx_ugovori_klijent on ugovori (klijent_id);
-- Jedan aktivan ugovor po klijentu:
create unique index if not exists uq_ugovori_aktivan on ugovori (klijent_id) where aktivan;

-- RLS (preko klijenta; pregled = read-only)
alter table ugovori enable row level security;
drop policy if exists ugovori_sel on ugovori;
drop policy if exists ugovori_wr on ugovori;
create policy ugovori_sel on ugovori for select using ( ima_pristup_klijentu(klijent_id) );
create policy ugovori_wr  on ugovori for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- Audit
drop trigger if exists audit_ugovori on ugovori;
create trigger audit_ugovori after insert or update or delete on ugovori
  for each row execute function tg_audit();
```

- [ ] **Step 2: Primijeniti lokalno**

Run: `pnpm db:reset`
Expected: bez greške; `20260627120100_ugovori` u izlazu.

- [ ] **Step 3: Verifikovati partial unique index**

Run:
```bash
psql "$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)" -c \
"insert into klijenti (naziv) values ('TEST_UQ') returning id" -t -A
```
Zatim dva insert‑a sa istim `klijent_id` i `aktivan=true` → drugi mora pasti sa `duplicate key value violates unique constraint "uq_ugovori_aktivan"`. Očisti: `delete from klijenti where naziv='TEST_UQ';`
Expected: drugi insert FAIL (potvrđuje invarijantu).

- [ ] **Step 4: Regen tipovi + typecheck**

Run: `pnpm db:types && pnpm typecheck`
Expected: `db/types.ts` sadrži `ugovori`; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120100_ugovori.sql db/types.ts
git commit -m "feat(pp1): tabela ugovori (jedan aktivan po klijentu) + RLS + audit"
```

---

## Task 3: Migracija — tabela `kontakt_osobe` (+ RLS + audit)

**Files:**
- Create: `supabase/migrations/20260627120200_kontakt_osobe.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces: tabela `kontakt_osobe(id, klijent_id, ime, funkcija, telefon, email, created_at)`.

- [ ] **Step 1: Napisati migraciju**

```sql
-- supabase/migrations/20260627120200_kontakt_osobe.sql
-- PP-1: Kontakt osobe na nivou klijenta (više njih). Lokacijski kontakti ostaju na `lokacije`.

create table if not exists kontakt_osobe (
  id         uuid primary key default gen_random_uuid(),
  klijent_id uuid not null references klijenti(id) on delete cascade,
  ime        text not null,
  funkcija   text,
  telefon    text,
  email      text,
  created_at timestamptz not null default now(),
  constraint chk_kontakt_ime check (length(trim(ime)) > 0)
);

create index if not exists idx_kontakt_osobe_klijent on kontakt_osobe (klijent_id);

alter table kontakt_osobe enable row level security;
drop policy if exists kontakt_sel on kontakt_osobe;
drop policy if exists kontakt_wr on kontakt_osobe;
create policy kontakt_sel on kontakt_osobe for select using ( ima_pristup_klijentu(klijent_id) );
create policy kontakt_wr  on kontakt_osobe for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

drop trigger if exists audit_kontakt_osobe on kontakt_osobe;
create trigger audit_kontakt_osobe after insert or update or delete on kontakt_osobe
  for each row execute function tg_audit();
```

- [ ] **Step 2: Primijeniti lokalno + regen + typecheck**

Run: `pnpm db:reset && pnpm db:types && pnpm typecheck`
Expected: `kontakt_osobe` u `db/types.ts`; typecheck PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260627120200_kontakt_osobe.sql db/types.ts
git commit -m "feat(pp1): tabela kontakt_osobe (klijent-nivo) + RLS + audit"
```

---

## Task 4: Migracija — `klijent_provjere.ugovor_id`

**Files:**
- Create: `supabase/migrations/20260627120300_klijent_provjere_ugovor.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces: kolona `klijent_provjere.ugovor_id (uuid → ugovori, nullable)` — veže „ugovorene usluge" za aktivni ugovor.

- [ ] **Step 1: Napisati migraciju**

```sql
-- supabase/migrations/20260627120300_klijent_provjere_ugovor.sql
-- PP-1: veza profil-provjera → ugovor (ugovorene usluge). Nullable, ne dira motor rokova.

alter table klijent_provjere add column if not exists ugovor_id uuid
  references ugovori(id) on delete set null;

create index if not exists idx_klijent_provjere_ugovor on klijent_provjere (ugovor_id);
```

- [ ] **Step 2: Primijeniti lokalno + regen + typecheck**

Run: `pnpm db:reset && pnpm db:types && pnpm typecheck`
Expected: `klijent_provjere.Row.ugovor_id` postoji; typecheck PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260627120300_klijent_provjere_ugovor.sql db/types.ts
git commit -m "feat(pp1): klijent_provjere.ugovor_id (ugovorene usluge)"
```

---

## Task 5: Migracija — `vrste_provjera.vodi_dokumentaciju`

**Files:**
- Create: `supabase/migrations/20260627120400_vrste_vodi_dokumentaciju.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces: kolona `vrste_provjera.vodi_dokumentaciju (bool not null default true)`.

- [ ] **Step 1: Napisati migraciju**

```sql
-- supabase/migrations/20260627120400_vrste_vodi_dokumentaciju.sql
-- PP-1: da li se za uslugu vodi dokumentacija (gap #5). Audit trigger na vrste već postoji.

alter table vrste_provjera add column if not exists vodi_dokumentaciju bool not null default true;
```

- [ ] **Step 2: Primijeniti lokalno + regen + typecheck**

Run: `pnpm db:reset && pnpm db:types && pnpm typecheck`
Expected: `vrste_provjera.Row.vodi_dokumentaciju` postoji; typecheck PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260627120400_vrste_vodi_dokumentaciju.sql db/types.ts
git commit -m "feat(pp1): vrste_provjera.vodi_dokumentaciju"
```

---

## Task 6: Migracija — generalizacija `dokumenti` (+ backfill + RLS rewrite)

**Files:**
- Create: `supabase/migrations/20260627120500_dokumenti_generalizacija.sql`
- Modify: `db/types.ts` (regen)

**Interfaces:**
- Produces: `dokumenti.klijent_id (not null)`, `dokumenti.ugovor_id (nullable)`, `dokumenti.termin_id (nullable)`, `dokumenti.tip (text, CHECK)`. RLS sada preko `klijent_id`.

- [ ] **Step 1: Napisati migraciju**

```sql
-- supabase/migrations/20260627120500_dokumenti_generalizacija.sql
-- PP-1: dokument se veže za klijenta (uvijek), opciono za ugovor/termin; + tip.
-- Backfill klijent_id iz termina PRIJE set not null; RLS prebačen na klijent_id.

-- 1) Nove kolone
alter table dokumenti add column if not exists klijent_id uuid references klijenti(id) on delete cascade;
alter table dokumenti add column if not exists ugovor_id  uuid references ugovori(id)  on delete set null;
alter table dokumenti add column if not exists tip text not null default 'ostalo';

-- 2) tip CHECK (ime constrainta stabilno; drop pa add radi re-run)
alter table dokumenti drop constraint if exists chk_dokumenti_tip;
alter table dokumenti add constraint chk_dokumenti_tip
  check (tip in ('strucni_nalaz','zapisnik','ugovor','ponuda','fotografija','ostalo'));

-- 3) Backfill klijent_id iz termina za postojeće redove
update dokumenti d
  set klijent_id = t.klijent_id
  from termini t
  where d.klijent_id is null and d.termin_id = t.id;

-- 3b) AI zapisnici → tip 'zapisnik'
update dokumenti set tip = 'zapisnik' where generated_by_ai = true and tip = 'ostalo';

-- 4) klijent_id obavezan, termin_id više nije
alter table dokumenti alter column klijent_id set not null;
alter table dokumenti alter column termin_id drop not null;

create index if not exists idx_dokumenti_klijent on dokumenti (klijent_id);
create index if not exists idx_dokumenti_ugovor  on dokumenti (ugovor_id);

-- 5) RLS: pristup preko klijent_id (ranije preko termin_id)
drop policy if exists dokumenti_sel on dokumenti;
drop policy if exists dokumenti_wr on dokumenti;
create policy dokumenti_sel on dokumenti for select using ( ima_pristup_klijentu(klijent_id) );
create policy dokumenti_wr on dokumenti for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
```

- [ ] **Step 2: Primijeniti lokalno**

Run: `pnpm db:reset`
Expected: bez greške (ako lokalni stack ima dokumente sa termin_id, backfill ih popuni; svjež reset = prazno, prolazi).

- [ ] **Step 3: Verifikovati invarijantu backfilla**

Run:
```bash
psql "$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)" -c \
"select count(*) as bez_klijenta from dokumenti where klijent_id is null;" -t -A
```
Expected: `0` (nijedan dokument bez klijenta).

- [ ] **Step 4: Regen tipovi + typecheck**

Run: `pnpm db:types && pnpm typecheck`
Expected: `dokumenti.Row` ima `klijent_id` (string), `ugovor_id` (string|null), `termin_id` (string|null), `tip` (string). `pnpm typecheck` može prijaviti greške na mjestima koja čitaju `termin_id` kao non-null — to su Task 11/17 (popravljaju se tamo). Ako se jave, zabilježiti i nastaviti; commit ove migracije je samostalan (types regen).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120500_dokumenti_generalizacija.sql db/types.ts
git commit -m "feat(pp1): generalizacija dokumenti (klijent/ugovor + tip, backfill, RLS rewrite)"
```

---

## Task 7: Pure logika — `lib/ugovori.ts` (validacija datuma)

**Files:**
- Create: `lib/ugovori.ts`
- Test: `lib/ugovori.test.ts`

**Interfaces:**
- Produces: `validUgovorDatumi(potpis: string | null, istek: string | null): boolean` — true ako je istek ≥ potpis ili bilo koji null.

- [ ] **Step 1: Napisati failing test**

```typescript
// lib/ugovori.test.ts
import { describe, it, expect } from "vitest"
import { validUgovorDatumi } from "@/lib/ugovori"

describe("validUgovorDatumi", () => {
  it("dozvoljava istek nakon potpisa", () => {
    expect(validUgovorDatumi("2026-01-01", "2027-01-01")).toBe(true)
  })
  it("odbija istek prije potpisa", () => {
    expect(validUgovorDatumi("2027-01-01", "2026-01-01")).toBe(false)
  })
  it("dozvoljava jednake datume", () => {
    expect(validUgovorDatumi("2026-01-01", "2026-01-01")).toBe(true)
  })
  it("dozvoljava null vrijednosti", () => {
    expect(validUgovorDatumi(null, "2026-01-01")).toBe(true)
    expect(validUgovorDatumi("2026-01-01", null)).toBe(true)
    expect(validUgovorDatumi(null, null)).toBe(true)
  })
})
```

- [ ] **Step 2: Pokrenuti test (mora pasti)**

Run: `pnpm vitest run lib/ugovori.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ugovori'`.

- [ ] **Step 3: Implementirati**

```typescript
// lib/ugovori.ts
/** True ako je raspored datuma ugovora valjan: istek ≥ potpis, ili bilo koji nedostaje. */
export function validUgovorDatumi(potpis: string | null, istek: string | null): boolean {
  if (!potpis || !istek) return true
  return istek >= potpis // ISO YYYY-MM-DD → leksikografsko poređenje = hronološko
}
```

- [ ] **Step 4: Pokrenuti test (mora proći)**

Run: `pnpm vitest run lib/ugovori.test.ts`
Expected: PASS (4 testa).

- [ ] **Step 5: Commit**

```bash
git add lib/ugovori.ts lib/ugovori.test.ts
git commit -m "feat(pp1): validUgovorDatumi helper + testovi"
```

---

## Task 8: Pure logika — `lib/dokumenti.ts` (tip + storage path)

**Files:**
- Create: `lib/dokumenti.ts`
- Test: `lib/dokumenti.test.ts`

**Interfaces:**
- Produces:
  - `DOKUMENT_TIPOVI: readonly ["strucni_nalaz","zapisnik","ugovor","ponuda","fotografija","ostalo"]`
  - `type DokumentTip = (typeof DOKUMENT_TIPOVI)[number]`
  - `jeValidanTip(t: string): t is DokumentTip`
  - `dokumentStoragePath(scope: {klijentId: string} | {ugovorId: string} | {terminId: string}, filename: string): string`

- [ ] **Step 1: Napisati failing test**

```typescript
// lib/dokumenti.test.ts
import { describe, it, expect } from "vitest"
import { DOKUMENT_TIPOVI, jeValidanTip, dokumentStoragePath } from "@/lib/dokumenti"

describe("jeValidanTip", () => {
  it("prihvata poznate tipove", () => {
    for (const t of DOKUMENT_TIPOVI) expect(jeValidanTip(t)).toBe(true)
  })
  it("odbija nepoznat tip", () => {
    expect(jeValidanTip("virus")).toBe(false)
  })
})

describe("dokumentStoragePath", () => {
  it("klijent scope → klijenti/<id>/<file>", () => {
    expect(dokumentStoragePath({ klijentId: "k1" }, "ugovor.pdf")).toMatch(/^klijenti\/k1\/[\w.-]+$/)
  })
  it("ugovor scope → ugovori/<id>/<file>", () => {
    expect(dokumentStoragePath({ ugovorId: "u1" }, "anex.pdf")).toMatch(/^ugovori\/u1\/[\w.-]+$/)
  })
  it("termin scope → termini/<id>/<file>", () => {
    expect(dokumentStoragePath({ terminId: "t1" }, "nalaz.pdf")).toMatch(/^termini\/t1\/[\w.-]+$/)
  })
  it("sanitizuje ime fajla", () => {
    const p = dokumentStoragePath({ klijentId: "k1" }, "ime sa /razmakom!.pdf")
    expect(p).not.toContain(" ")
    expect(p).not.toContain("!")
  })
})
```

- [ ] **Step 2: Pokrenuti test (mora pasti)**

Run: `pnpm vitest run lib/dokumenti.test.ts`
Expected: FAIL — modul ne postoji.

- [ ] **Step 3: Implementirati**

```typescript
// lib/dokumenti.ts
export const DOKUMENT_TIPOVI = [
  "strucni_nalaz",
  "zapisnik",
  "ugovor",
  "ponuda",
  "fotografija",
  "ostalo",
] as const
export type DokumentTip = (typeof DOKUMENT_TIPOVI)[number]

export function jeValidanTip(t: string): t is DokumentTip {
  return (DOKUMENT_TIPOVI as readonly string[]).includes(t)
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "dokument"
}

type DokumentScope =
  | { klijentId: string }
  | { ugovorId: string }
  | { terminId: string }

/** Storage putanja po vezi dokumenta. Prefiks bira kontekst (klijent/ugovor/termin). */
export function dokumentStoragePath(scope: DokumentScope, filename: string): string {
  const naziv = safeName(filename)
  const rand = crypto.randomUUID()
  if ("klijentId" in scope) return `klijenti/${scope.klijentId}/${rand}-${naziv}`
  if ("ugovorId" in scope) return `ugovori/${scope.ugovorId}/${rand}-${naziv}`
  return `termini/${scope.terminId}/${rand}-${naziv}`
}
```

- [ ] **Step 4: Pokrenuti test (mora proći)**

Run: `pnpm vitest run lib/dokumenti.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dokumenti.ts lib/dokumenti.test.ts
git commit -m "feat(pp1): DOKUMENT_TIPOVI + dokumentStoragePath helper + testovi"
```

---

## Task 9: Server actions — proširenje `klijenti` (ID‑karta polja)

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts` (`updateKlijentSchema` + `updateKlijent`)

**Interfaces:**
- Consumes: `Database["public"]["Tables"]["klijenti"]["Update"]`.
- Produces: `updateKlijent` prihvata i upisuje `adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id`.

- [ ] **Step 1: Proširiti `updateKlijentSchema`**

U `app/(dashboard)/klijenti/actions.ts`, zamijeniti postojeći `updateKlijentSchema` ovim (dodati nova polja; `optionalText` helper već postoji u fajlu):

```typescript
const UUID_OR_EMPTY = z
  .string()
  .optional()
  .or(z.literal("").transform(() => undefined))
  .refine((v) => v === undefined || /^[0-9a-f-]{36}$/i.test(v), "Neispravan korisnik")

const updateKlijentSchema = z.object({
  id: z.string().uuid(),
  naziv: z.string().min(1, "Naziv je obavezan").max(200).optional(),
  napomena: optionalText(2000),
  podsjetnik_emails: z.string().max(2000).optional(),
  tip_odnosa: z
    .union([z.enum(["ugovor", "ponuda"]), z.literal("none"), z.literal(""), z.null()])
    .transform((v) => (v === "none" || v === "" ? null : v))
    .optional(),
  adresa: optionalText(300),
  pib: optionalText(40),
  maticni_broj: optionalText(40),
  sifra_djelatnosti: optionalText(40),
  telefon: optionalText(60),
  email: optionalText(200),
  zaduzeni_tehpro_id: UUID_OR_EMPTY,
})
```

- [ ] **Step 2: Proširiti `updateKlijent` patch**

U funkciji `updateKlijent`, nakon postojećih `if (formData.has("tip_odnosa")) {...}`, dodati prije `const supabase = ...`:

```typescript
  for (const key of ["adresa", "pib", "maticni_broj", "sifra_djelatnosti", "telefon", "email"] as const) {
    if (formData.has(key)) patch[key] = (f as Record<string, string | undefined>)[key] ?? null
  }
  if (formData.has("zaduzeni_tehpro_id")) {
    patch.zaduzeni_tehpro_id = f.zaduzeni_tehpro_id ?? null
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (patch je `KlijentiUpdate`, sva polja postoje nakon Task 1 regen‑a).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/klijenti/actions.ts"
git commit -m "feat(pp1): updateKlijent prima ID-karta polja"
```

---

## Task 10: Server actions — `ugovori` CRUD (jedan aktivan)

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts` (dodati na kraj)

**Interfaces:**
- Consumes: `validUgovorDatumi` iz `lib/ugovori.ts`.
- Produces: `createUgovor`, `updateUgovor`, `deleteUgovor` (FormData → `ActionResult`). Pri `aktivan=true` deaktivira ostale ugovore klijenta prije upisa.

- [ ] **Step 1: Dodati import na vrh fajla**

```typescript
import { validUgovorDatumi } from "@/lib/ugovori"
```

- [ ] **Step 2: Dodati akcije na kraj `app/(dashboard)/klijenti/actions.ts`**

```typescript
// ─── Ugovori ────────────────────────────────────────────────────────────────

const intOrNull = (min: number, max: number) =>
  z.string().trim().optional()
    .or(z.literal("").transform(() => undefined))
    .transform((s) => (s == null ? null : Number(s)))
    .refine((n) => n === null || (Number.isInteger(n) && n >= min && n <= max), `Broj mora biti ${min}–${max}`)

const dateOrNull = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Neispravan datum").optional()
  .or(z.literal("").transform(() => undefined)).transform((v) => v ?? null)

const ugovorFields = {
  zavodni_broj: optionalText(120),
  datum_potpisivanja: dateOrNull,
  datum_isteka: dateOrNull,
  vazenje_mjeseci: intOrNull(1, 600),
  broj_obilazaka_mjesecno: intOrNull(0, 31),
  automatsko_obnavljanje: z.union([z.literal("on"), z.literal("true"), z.literal("")]).optional()
    .transform((v) => v === "on" || v === "true"),
  aktivan: z.union([z.literal("on"), z.literal("true"), z.literal("")]).optional()
    .transform((v) => v === "on" || v === "true"),
  napomena: optionalText(2000),
}

const createUgovorSchema = z.object({ klijent_id: z.string().uuid(), ...ugovorFields })
const updateUgovorSchema = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid(), ...ugovorFields })

async function deaktivirajOstaleUgovore(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  klijentId: string,
  osimId?: string,
): Promise<void> {
  let q = supabase.from("ugovori").update({ aktivan: false }).eq("klijent_id", klijentId).eq("aktivan", true)
  if (osimId) q = q.neq("id", osimId)
  await q
}

export async function createUgovor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createUgovorSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, aktivan, ...f } = parsed.data
  if (!validUgovorDatumi(f.datum_potpisivanja, f.datum_isteka)) {
    return { ok: false, message: "Datum isteka mora biti nakon datuma potpisivanja." }
  }
  const supabase = await createServerSupabaseClient()
  if (aktivan) await deaktivirajOstaleUgovore(supabase, klijent_id)
  const { error } = await supabase.from("ugovori").insert({ klijent_id, aktivan, ...f })
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function updateUgovor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateUgovorSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, klijent_id, aktivan, ...f } = parsed.data
  if (!validUgovorDatumi(f.datum_potpisivanja, f.datum_isteka)) {
    return { ok: false, message: "Datum isteka mora biti nakon datuma potpisivanja." }
  }
  const supabase = await createServerSupabaseClient()
  if (aktivan) await deaktivirajOstaleUgovore(supabase, klijent_id, id)
  const { error } = await supabase.from("ugovori").update({ aktivan, ...f }).eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function deleteUgovor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "")
  const klijent_id = String(formData.get("klijent_id") ?? "")
  if (!id || !klijent_id) return { ok: false, message: "Nedostaje id." }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("ugovori").delete().eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/klijenti/actions.ts"
git commit -m "feat(pp1): ugovori CRUD akcije (jedan aktivan, validacija datuma)"
```

---

## Task 11: Server actions — `kontakti` CRUD

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts` (dodati na kraj)

**Interfaces:**
- Produces: `createKontakt`, `updateKontakt`, `deleteKontakt` (FormData → `ActionResult`).

- [ ] **Step 1: Dodati akcije na kraj fajla**

```typescript
// ─── Kontakt osobe ────────────────────────────────────────────────────────────

const kontaktFields = {
  ime: z.string().min(1, "Ime je obavezno").max(200),
  funkcija: optionalText(120),
  telefon: optionalText(60),
  email: optionalText(200),
}
const createKontaktSchema = z.object({ klijent_id: z.string().uuid(), ...kontaktFields })
const updateKontaktSchema = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid(), ...kontaktFields })

export async function createKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createKontaktSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("kontakt_osobe").insert({
    klijent_id, ime: f.ime, funkcija: f.funkcija ?? null, telefon: f.telefon ?? null, email: f.email ?? null,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function updateKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateKontaktSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("kontakt_osobe").update({
    ime: f.ime, funkcija: f.funkcija ?? null, telefon: f.telefon ?? null, email: f.email ?? null,
  }).eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function deleteKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "")
  const klijent_id = String(formData.get("klijent_id") ?? "")
  if (!id || !klijent_id) return { ok: false, message: "Nedostaje id." }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("kontakt_osobe").delete().eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add "app/(dashboard)/klijenti/actions.ts"
git commit -m "feat(pp1): kontakt_osobe CRUD akcije"
```

---

## Task 12: Server actions — upravljanje vrstama (uredi/deaktiviraj/vodi_dokumentaciju)

**Files:**
- Modify: `app/(dashboard)/postavke/actions.ts` (dodati na kraj; `zahtijevajAdmina` već postoji)

**Interfaces:**
- Produces: `updateVrsta` (naziv, interval, zakonski_osnov, vodi_dokumentaciju), `postaviVrstaAktivna(id, aktivna)`.

- [ ] **Step 1: Dodati akcije**

```typescript
// ─── Uređivanje / deaktivacija vrste ─────────────────────────────────────────

const updateVrstaSchema = z.object({
  id: z.string().uuid(),
  naziv: z.string().trim().min(1, "Naziv je obavezan").max(200),
  interval: z.string().trim().optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine((s) => s === undefined || (Number.isInteger(Number(s)) && Number(s) >= 1 && Number(s) <= 120),
      { message: "Interval mora biti 1–120 ili prazno" })
    .transform((s) => (s === undefined ? null : Number(s))),
  zakonski_osnov: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  vodi_dokumentaciju: z.union([z.literal("on"), z.literal("true"), z.literal("")]).optional()
    .transform((v) => v === "on" || v === "true"),
})

export async function updateVrsta(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await zahtijevajAdmina()
  const parsed = updateVrstaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, naziv, interval, zakonski_osnov, vodi_dokumentaciju } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("vrste_provjera").update({
    naziv,
    podrazumevani_interval_mjeseci: interval,
    zakonski_osnov: zakonski_osnov ?? null,
    vodi_dokumentaciju,
  }).eq("id", id)
  if (error) {
    const msg = /duplicate|unique/i.test(error.message) ? "Vrsta sa tim nazivom već postoji." : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviVrstaAktivna(vrstaId: string, aktivna: boolean): Promise<ActionResult> {
  await zahtijevajAdmina()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("vrste_provjera").update({ aktivna }).eq("id", vrstaId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add "app/(dashboard)/postavke/actions.ts"
git commit -m "feat(pp1): updateVrsta + postaviVrstaAktivna akcije"
```

---

## Task 13: Server action — upload dokumenta na nivou klijenta/ugovora

**Files:**
- Modify: `app/(dashboard)/dokumenti/actions.ts` (dodati `uploadKlijentDokumentAction`)

**Interfaces:**
- Consumes: `dokumentStoragePath`, `DOKUMENT_TIPOVI`, `jeValidanTip` iz `lib/dokumenti.ts`; `uploadDokument`/`removeDokument`/`ALLOWED_MIME`/`MAX_BYTES` iz storage.
- Produces: `uploadKlijentDokumentAction(_prev, formData)` — polja `klijent_id` (obavezno), `ugovor_id?`, `tip`, `file`.

- [ ] **Step 1: Dodati importe na vrh fajla**

```typescript
import { dokumentStoragePath, jeValidanTip } from "@/lib/dokumenti"
```

- [ ] **Step 2: Dodati akciju na kraj `app/(dashboard)/dokumenti/actions.ts`**

```typescript
const uploadKlijentSchema = z.object({
  klijent_id: z.string().uuid("Klijent je obavezan"),
  ugovor_id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  tip: z.string().refine(jeValidanTip, "Neispravan tip"),
})

export async function uploadKlijentDokumentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = uploadKlijentSchema.safeParse({
    klijent_id: formData.get("klijent_id"),
    ugovor_id: formData.get("ugovor_id") ?? "",
    tip: formData.get("tip") ?? "ostalo",
  })
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, ugovor_id, tip } = parsed.data

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Izaberite fajl." }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return { ok: false, message: "Nedozvoljen tip fajla (docx, pdf, png, jpeg, webp)." }
  }
  if (file.size > MAX_BYTES) return { ok: false, message: "Fajl je veći od 50 MB." }

  const supabase = await createServerSupabaseClient()
  const naziv = safeName(file.name)
  const path = ugovor_id
    ? dokumentStoragePath({ ugovorId: ugovor_id }, naziv)
    : dokumentStoragePath({ klijentId: klijent_id }, naziv)
  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    await uploadDokument(path, bytes, file.type)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Upload nije uspio." }
  }

  const { error } = await supabase.from("dokumenti").insert({
    klijent_id,
    ugovor_id: ugovor_id ?? null,
    termin_id: null,
    naziv,
    storage_path: path,
    mime_type: file.type,
    velicina_bajt: file.size,
    tip,
    generated_by_ai: false,
  })
  if (error) {
    try { await removeDokument(path) } catch (e) { console.error("Rollback fajla nije uspio:", e) }
    return { ok: false, message: error.message }
  }

  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}
```

- [ ] **Step 3: Uskladiti postojeći `uploadDokumentAction` sa novim NOT NULL `klijent_id`**

U postojećoj `uploadDokumentAction`, izmijeniti insert da popuni `klijent_id` (dohvaćen iz termina) i `tip: "strucni_nalaz"`:

```typescript
  const { error } = await supabase.from("dokumenti").insert({
    termin_id,
    klijent_id: termin.klijent_id,
    naziv,
    storage_path: path,
    mime_type: file.type,
    velicina_bajt: file.size,
    tip: "strucni_nalaz",
    generated_by_ai: false,
  })
```

(`termin` već sadrži `klijent_id` — postojeći select je `select("id, klijent_id")`.) Analogno, u `generateZapisnikAction` insert dodati `klijent_id: t.klijent_id` i `tip: "zapisnik"` (objekat `t` već ima `klijent_id`).

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS (greške iz Task 6 oko `termin_id`/`klijent_id` sada riješene).

```bash
git add "app/(dashboard)/dokumenti/actions.ts"
git commit -m "feat(pp1): upload dokumenta na nivou klijenta/ugovora + tip; termin upload puni klijent_id"
```

---

## Task 14: UI — proširenje `KlijentEditForm` (ID‑karta polja + zaduzeni select)

**Files:**
- Modify: `components/domain/KlijentEditForm.tsx`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (proslijediti `korisnici` + nova polja klijenta)

**Interfaces:**
- Consumes: `updateKlijent` (Task 9). Prop `korisnici: {id:string; ime:string}[]`, prošireni `klijent` objekat.

- [ ] **Step 1: Proširiti prop tip i polja u `KlijentEditForm`**

Zamijeniti potpis i tijelo forme (zadržati postojeći Sheet/submit obrazac). Prop `klijent` proširiti na ID‑karta polja i dodati `korisnici`:

```typescript
export function KlijentEditForm({
  klijent,
  korisnici,
}: {
  klijent: {
    id: string; naziv: string; napomena: string | null; podsjetnik_emails: string[]; tip_odnosa?: string | null
    adresa?: string | null; pib?: string | null; maticni_broj?: string | null; sifra_djelatnosti?: string | null
    telefon?: string | null; email?: string | null; zaduzeni_tehpro_id?: string | null
  }
  korisnici: { id: string; ime: string }[]
}) {
```

Unutar `<form>`, nakon polja „Napomena" a prije „Primaoci podsjetnika", dodati blok ID‑karta polja:

```tsx
          {([
            ["adresa", "Adresa"],
            ["telefon", "Telefon"],
            ["email", "Email"],
            ["pib", "PIB"],
            ["maticni_broj", "Matični broj"],
            ["sifra_djelatnosti", "Šifra djelatnosti"],
          ] as const).map(([name, label]) => (
            <label key={name} className="block text-sm">
              <span className="text-slate-600">{label}</span>
              <Input
                name={name}
                defaultValue={(klijent[name] as string | null | undefined) ?? ""}
                data-testid={`edit-klijent-${name}`}
              />
            </label>
          ))}

          <div className="space-y-1">
            <span className="block text-sm text-slate-600">Zadužena osoba (TEHPRO)</span>
            <Select name="zaduzeni_tehpro_id" defaultValue={klijent.zaduzeni_tehpro_id ?? "none"}>
              <SelectTrigger data-testid="edit-klijent-zaduzeni" className="w-full">
                <SelectValue placeholder="— (nije postavljeno)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— (nije postavljeno)</SelectItem>
                {korisnici.map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.ime}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
```

Napomena: `zaduzeni_tehpro_id` šalje `"none"` kada nije postavljeno; `updateKlijent` schema (Task 9) tretira ne‑UUID kao undefined → patch ga postavlja na null kada `formData.has`. Da bi „none" postao null, dodati u `updateKlijent` normalizaciju: ako je `zaduzeni_tehpro_id === "none"`, tretirati kao prazno. **Uskladiti Task 9 `UUID_OR_EMPTY`** da prihvati i `"none"`:

```typescript
const UUID_OR_EMPTY = z
  .string()
  .optional()
  .transform((v) => (v === "none" ? "" : v))
  .or(z.literal("").transform(() => undefined))
  .refine((v) => v === undefined || /^[0-9a-f-]{36}$/i.test(v), "Neispravan korisnik")
```

- [ ] **Step 2: Proslijediti podatke iz stranice**

U `app/(dashboard)/klijenti/[id]/page.tsx`:
- Proširiti `primaociRes` select da uključi nova polja:
```typescript
    supabase.from("klijenti").select("podsjetnik_emails, tip_odnosa, adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id").eq("id", id).maybeSingle(),
```
- Dodati fetch aktivnih korisnika (u postojeći `Promise.all` blok `[profilRes, vrsteRes]` proširiti ili zaseban upit):
```typescript
  const { data: korisniciData } = await supabase.from("korisnici").select("id, ime").eq("aktivan", true).order("ime")
  const korisnici = (korisniciData ?? []).map((k) => ({ id: k.id, ime: k.ime }))
```
- Proslijediti u `KlijentEditForm`:
```tsx
          <KlijentEditForm
            klijent={{
              id: klijent.id,
              naziv: klijent.naziv,
              napomena: klijent.napomena ?? null,
              podsjetnik_emails: primaociRes.data?.podsjetnik_emails ?? [],
              tip_odnosa: primaociRes.data?.tip_odnosa ?? null,
              adresa: primaociRes.data?.adresa ?? null,
              pib: primaociRes.data?.pib ?? null,
              maticni_broj: primaociRes.data?.maticni_broj ?? null,
              sifra_djelatnosti: primaociRes.data?.sifra_djelatnosti ?? null,
              telefon: primaociRes.data?.telefon ?? null,
              email: primaociRes.data?.email ?? null,
              zaduzeni_tehpro_id: primaociRes.data?.zaduzeni_tehpro_id ?? null,
            }}
            korisnici={korisnici}
          />
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "components/domain/KlijentEditForm.tsx" "app/(dashboard)/klijenti/[id]/page.tsx" "app/(dashboard)/klijenti/actions.ts"
git commit -m "feat(pp1): KlijentEditForm — ID-karta polja + zadužena osoba (TEHPRO)"
```

---

## Task 15: UI — `UgovorSheet` + `UgovoriTab`

**Files:**
- Create: `components/domain/UgovorSheet.tsx`
- Create: `components/domain/UgovoriTab.tsx`

**Interfaces:**
- Consumes: `createUgovor`, `updateUgovor`, `deleteUgovor` (Task 10), `Database` tipovi.
- Produces: `<UgovoriTab klijentId ugovori />`, `<UgovorSheet klijentId ugovor? />`.

- [ ] **Step 1: `UgovorSheet.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createUgovor, updateUgovor, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
const initial: ActionResult = { ok: true }

export function UgovorSheet({ klijentId, ugovor }: { klijentId: string; ugovor?: UgovorRow }) {
  const router = useRouter()
  const isEdit = !!ugovor
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(isEdit ? updateUgovor : createUgovor, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      router.refresh()
    }
  }, [state, pending, router])

  const trigger = isEdit
    ? <Button variant="outline" size="sm" data-testid={`uredi-ugovor-${ugovor.id}`}>Uredi</Button>
    : <Button data-testid="novi-ugovor-btn"><Plus className="w-4 h-4" aria-hidden /> Novi ugovor</Button>

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="ugovor-sheet">
        <SheetHeader><SheetTitle>{isEdit ? "Uredi ugovor" : "Novi ugovor"}</SheetTitle></SheetHeader>
        <form
          key={ugovor?.id ?? "new"}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="ugovor-form"
        >
          {isEdit && <input type="hidden" name="id" value={ugovor.id} />}
          <input type="hidden" name="klijent_id" value={klijentId} />

          <label className="block text-sm">
            <span className="text-slate-600">Zavodni broj (broj ugovora)</span>
            <Input name="zavodni_broj" defaultValue={ugovor?.zavodni_broj ?? ""} data-testid="ugovor-zavodni" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">Datum potpisivanja</span>
              <Input type="date" name="datum_potpisivanja" defaultValue={ugovor?.datum_potpisivanja ?? ""} data-testid="ugovor-potpis" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Datum isteka</span>
              <Input type="date" name="datum_isteka" defaultValue={ugovor?.datum_isteka ?? ""} data-testid="ugovor-istek" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Važenje (mjeseci)</span>
              <Input type="number" min={1} max={600} name="vazenje_mjeseci" defaultValue={ugovor?.vazenje_mjeseci ?? ""} data-testid="ugovor-vazenje" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Obilazaka / mjesec</span>
              <Input type="number" min={0} max={31} name="broj_obilazaka_mjesecno" defaultValue={ugovor?.broj_obilazaka_mjesecno ?? ""} data-testid="ugovor-obilasci" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="automatsko_obnavljanje" defaultChecked={ugovor?.automatsko_obnavljanje ?? false} data-testid="ugovor-auto" />
            <span className="text-slate-600">Automatsko obnavljanje</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="aktivan" defaultChecked={ugovor?.aktivan ?? true} data-testid="ugovor-aktivan" />
            <span className="text-slate-600">Aktivan ugovor (deaktivira ostale)</span>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Napomena</span>
            <Input name="napomena" defaultValue={ugovor?.napomena ?? ""} data-testid="ugovor-napomena" />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="ugovor-submit">
            {pending ? "Spremam…" : isEdit ? "Spremi izmjene" : "Kreiraj ugovor"}
          </Button>
        </form>
        <SheetFooter><SheetClose render={<Button variant="outline">Otkaži</Button>} /></SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: `UgovoriTab.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { UgovorSheet } from "@/components/domain/UgovorSheet"
import { deleteUgovor, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { formatDatum } from "@/lib/date"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
const initial: ActionResult = { ok: true }

export function UgovoriTab({ klijentId, ugovori }: { klijentId: string; ugovori: UgovorRow[] }) {
  const router = useRouter()
  const [delState, delAction, delPending] = useActionState(deleteUgovor, initial)
  const prev = useRef(delState)
  useEffect(() => {
    if (delState !== prev.current) { prev.current = delState; if (delState.ok) router.refresh() }
  }, [delState, router])

  return (
    <div className="space-y-3" data-testid="ugovori-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">Ugovori</h3>
        <UgovorSheet klijentId={klijentId} />
      </div>
      {ugovori.length === 0 ? (
        <p className="text-sm text-slate-500">Nema ugovora. Dodajte prvi ugovor.</p>
      ) : (
        <ul className="space-y-2">
          {ugovori.map((u) => (
            <li key={u.id} data-testid="ugovor-red" className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {u.zavodni_broj || "Bez broja"}
                  {u.aktivan && <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">aktivan</span>}
                </span>
                <span className="flex items-center gap-2">
                  <UgovorSheet klijentId={klijentId} ugovor={u} />
                  <form action={delAction}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="klijent_id" value={klijentId} />
                    <Button type="submit" variant="ghost" disabled={delPending} aria-label="Obriši ugovor" data-testid={`obrisi-ugovor-${u.id}`}>
                      <Trash2 className="w-4 h-4 text-red-500" aria-hidden />
                    </Button>
                  </form>
                </span>
              </div>
              <div className="mt-1 text-slate-500">
                {u.datum_potpisivanja ? formatDatum(u.datum_potpisivanja) : "—"} → {u.datum_isteka ? formatDatum(u.datum_isteka) : "—"}
                {u.broj_obilazaka_mjesecno != null && ` · ${u.broj_obilazaka_mjesecno} obilaz./mj.`}
              </div>
            </li>
          ))}
        </ul>
      )}
      {delState.ok === false && delState.message && (
        <p className="text-sm text-red-600" role="alert">{delState.message}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add components/domain/UgovorSheet.tsx components/domain/UgovoriTab.tsx
git commit -m "feat(pp1): UgovorSheet + UgovoriTab komponente"
```

---

## Task 16: UI — `KontaktSheet` + `KontaktiKlijentList`

**Files:**
- Create: `components/domain/KontaktSheet.tsx`
- Create: `components/domain/KontaktiKlijentList.tsx`

**Interfaces:**
- Consumes: `createKontakt`, `updateKontakt`, `deleteKontakt` (Task 11).
- Produces: `<KontaktiKlijentList klijentId kontakti />`, `<KontaktSheet klijentId kontakt? />`.

- [ ] **Step 1: `KontaktSheet.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createKontakt, updateKontakt, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]
const initial: ActionResult = { ok: true }

const FIELDS: readonly [string, string, boolean][] = [
  ["ime", "Ime i prezime *", true],
  ["funkcija", "Funkcija", false],
  ["telefon", "Telefon", false],
  ["email", "Email", false],
]

export function KontaktSheet({ klijentId, kontakt }: { klijentId: string; kontakt?: KontaktRow }) {
  const router = useRouter()
  const isEdit = !!kontakt
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(isEdit ? updateKontakt : createKontakt, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; setOpen(false); router.refresh() }
  }, [state, pending, router])

  const trigger = isEdit
    ? <Button variant="outline" size="sm" data-testid={`uredi-kontakt-${kontakt.id}`}>Uredi</Button>
    : <Button data-testid="novi-kontakt-btn"><Plus className="w-4 h-4" aria-hidden /> Novi kontakt</Button>

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="kontakt-sheet">
        <SheetHeader><SheetTitle>{isEdit ? "Uredi kontakt" : "Novi kontakt"}</SheetTitle></SheetHeader>
        <form
          key={kontakt?.id ?? "new"}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="kontakt-form"
        >
          {isEdit && <input type="hidden" name="id" value={kontakt.id} />}
          <input type="hidden" name="klijent_id" value={klijentId} />
          {FIELDS.map(([name, label, req]) => (
            <label key={name} className="block text-sm">
              <span className="text-slate-600">{label}</span>
              <Input
                name={name}
                required={req}
                defaultValue={isEdit ? (kontakt[name as keyof KontaktRow] as string | null | undefined) ?? "" : ""}
                data-testid={`kontakt-${name}`}
              />
            </label>
          ))}
          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="kontakt-submit">
            {pending ? "Spremam…" : isEdit ? "Spremi izmjene" : "Kreiraj kontakt"}
          </Button>
        </form>
        <SheetFooter><SheetClose render={<Button variant="outline">Otkaži</Button>} /></SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: `KontaktiKlijentList.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KontaktSheet } from "@/components/domain/KontaktSheet"
import { deleteKontakt, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]
const initial: ActionResult = { ok: true }

export function KontaktiKlijentList({ klijentId, kontakti }: { klijentId: string; kontakti: KontaktRow[] }) {
  const router = useRouter()
  const [delState, delAction, delPending] = useActionState(deleteKontakt, initial)
  const prev = useRef(delState)
  useEffect(() => {
    if (delState !== prev.current) { prev.current = delState; if (delState.ok) router.refresh() }
  }, [delState, router])

  return (
    <div className="space-y-3" data-testid="kontakti-klijent-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">Kontakt osobe (firma)</h3>
        <KontaktSheet klijentId={klijentId} />
      </div>
      {kontakti.length === 0 ? (
        <p className="text-sm text-slate-500">Nema kontakata firme.</p>
      ) : (
        <ul className="space-y-2">
          {kontakti.map((k) => (
            <li key={k.id} data-testid="kontakt-red" className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{k.ime}{k.funkcija ? ` · ${k.funkcija}` : ""}</span>
                <span className="flex items-center gap-2">
                  <KontaktSheet klijentId={klijentId} kontakt={k} />
                  <form action={delAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <input type="hidden" name="klijent_id" value={klijentId} />
                    <Button type="submit" variant="ghost" disabled={delPending} aria-label="Obriši kontakt" data-testid={`obrisi-kontakt-${k.id}`}>
                      <Trash2 className="w-4 h-4 text-red-500" aria-hidden />
                    </Button>
                  </form>
                </span>
              </div>
              {(k.telefon || k.email) && (
                <div className="mt-1 text-slate-500">{[k.telefon, k.email].filter(Boolean).join(" · ")}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {delState.ok === false && delState.message && (
        <p className="text-sm text-red-600" role="alert">{delState.message}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add components/domain/KontaktSheet.tsx components/domain/KontaktiKlijentList.tsx
git commit -m "feat(pp1): KontaktSheet + KontaktiKlijentList komponente"
```

---

## Task 17: UI — `KlijentDokumentUpload` (klijent‑nivo upload + tip)

**Files:**
- Create: `components/domain/KlijentDokumentUpload.tsx`

**Interfaces:**
- Consumes: `uploadKlijentDokumentAction` (Task 13), `DOKUMENT_TIPOVI` (Task 8).
- Produces: `<KlijentDokumentUpload klijentId />`.

- [ ] **Step 1: Komponenta**

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { uploadKlijentDokumentAction, type ActionResult } from "@/app/(dashboard)/dokumenti/actions"
import { DOKUMENT_TIPOVI } from "@/lib/dokumenti"

const initial: ActionResult = { ok: true }
const TIP_LABEL: Record<string, string> = {
  strucni_nalaz: "Stručni nalaz", zapisnik: "Zapisnik", ugovor: "Ugovor",
  ponuda: "Ponuda", fotografija: "Fotografija", ostalo: "Ostalo",
}

export function KlijentDokumentUpload({ klijentId }: { klijentId: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(uploadKlijentDokumentAction, initial)
  const fileRef = useRef<HTMLInputElement>(null)
  const prev = useRef(state)
  useEffect(() => {
    if (state !== prev.current) {
      prev.current = state
      if (state.ok) { if (fileRef.current) fileRef.current.value = ""; router.refresh() }
    }
  }, [state, router])

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3" data-testid="klijent-dok-upload">
      <input type="hidden" name="klijent_id" value={klijentId} />
      <label className="block text-sm">
        <span className="text-slate-600">Tip</span>
        <select name="tip" defaultValue="ugovor" className="block rounded-md border border-slate-300 px-2 py-1 text-sm" data-testid="klijent-dok-tip">
          {DOKUMENT_TIPOVI.map((t) => <option key={t} value={t}>{TIP_LABEL[t]}</option>)}
        </select>
      </label>
      <input
        ref={fileRef}
        type="file"
        name="file"
        accept=".docx,.pdf,image/png,image/jpeg,image/webp"
        className="min-w-0 max-w-full text-sm"
        data-testid="klijent-dok-file"
      />
      <Button type="submit" variant="outline" disabled={pending} data-testid="klijent-dok-submit">
        {pending ? "Šaljem…" : "Upload"}
      </Button>
      {state.ok === false && state.message && (
        <p className="w-full text-sm text-red-600" role="alert">{state.message}</p>
      )}
    </form>
  )
}
```

- [ ] **Step 2: Ugraditi u „Dokumenti" tab**

U `app/(dashboard)/klijenti/[id]/page.tsx`, u bloku `{tab === "dokumenti" && (...)}` dodati upload iznad tabele i kolonu „Tip":
- Import: `import { KlijentDokumentUpload } from "@/components/domain/KlijentDokumentUpload"`
- Iznad tabele: `<KlijentDokumentUpload klijentId={id} />`
- U `thead` listu kolona dodati `"Tip"`; u redu dodati ćeliju: `<td className="px-3 py-2 text-slate-500">{d.tip}</td>` (postojeća kolona „Tip" prikazuje AI/Upload — preimenovati tu postojeću u „Izvor", a novu `d.tip` koristiti za tip dokumenta).

- [ ] **Step 3: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add components/domain/KlijentDokumentUpload.tsx "app/(dashboard)/klijenti/[id]/page.tsx"
git commit -m "feat(pp1): upload dokumenta na nivou klijenta + prikaz tipa"
```

---

## Task 18: UI — `IdKartaTab` + registracija taba

**Files:**
- Create: `components/domain/IdKartaTab.tsx`
- Modify: `components/domain/KlijentTabs.tsx` (dodati tab `id-karta`)
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (fetch ugovori/kontakti + render tab)

**Interfaces:**
- Consumes: `UgovoriTab` (Task 15), `KontaktiKlijentList` (Task 16); klijent osnovni podaci, ugovori, kontakti, ugovorene usluge (`profilStavke`).
- Produces: tab `id-karta` na `/klijenti/[id]`.

- [ ] **Step 1: Dodati tab u `KlijentTabs.tsx`**

U `const TABS`, dodati kao prvi element: `{ value: "id-karta", label: "ID karta" },`.

- [ ] **Step 2: `IdKartaTab.tsx`**

```tsx
import { UgovoriTab } from "@/components/domain/UgovoriTab"
import { KontaktiKlijentList } from "@/components/domain/KontaktiKlijentList"
import { formatDatum } from "@/lib/date"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]

export function IdKartaTab({
  klijentId,
  osnovni,
  zaduzeniIme,
  ugovori,
  kontakti,
  usluge,
}: {
  klijentId: string
  osnovni: {
    adresa: string | null; telefon: string | null; email: string | null
    pib: string | null; maticni_broj: string | null; sifra_djelatnosti: string | null
  }
  zaduzeniIme: string | null
  ugovori: UgovorRow[]
  kontakti: KontaktRow[]
  usluge: { vrsta_naziv: string; lokacija_naziv: string | null; sljedeci_rok: string }[]
}) {
  const redovi: [string, string | null][] = [
    ["Adresa", osnovni.adresa],
    ["Telefon", osnovni.telefon],
    ["Email", osnovni.email],
    ["PIB", osnovni.pib],
    ["Matični broj", osnovni.maticni_broj],
    ["Šifra djelatnosti", osnovni.sifra_djelatnosti],
    ["Zadužen (TEHPRO)", zaduzeniIme],
  ]
  return (
    <div className="space-y-6" data-testid="tab-id-karta-content">
      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Osnovni podaci</h3>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {redovi.map(([label, val]) => (
            <div key={label} className="flex justify-between gap-2 text-sm">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-800">{val || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <UgovoriTab klijentId={klijentId} ugovori={ugovori} />
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <KontaktiKlijentList klijentId={klijentId} kontakti={kontakti} />
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Ugovorene usluge</h3>
        {usluge.length === 0 ? (
          <p className="text-sm text-slate-500">Nema definisanih usluga. Dodajte ih kroz tab „Profil".</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {usluge.map((u, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="text-slate-700">{u.vrsta_naziv}{u.lokacija_naziv ? ` · ${u.lokacija_naziv}` : ""}</span>
                <span className="tabular-nums text-slate-500">sljedeći: {formatDatum(u.sljedeci_rok)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Render u stranici**

U `app/(dashboard)/klijenti/[id]/page.tsx`:
- Dodati `"id-karta"` u `VALID_TABS`.
- Dohvatiti ugovore i kontakte (uz postojeće upite):
```typescript
  const { data: ugovoriData } = await supabase.from("ugovori").select("*").eq("klijent_id", id).order("aktivan", { ascending: false }).order("created_at", { ascending: false })
  const ugovori = ugovoriData ?? []
  const { data: kontaktiData } = await supabase.from("kontakt_osobe").select("*").eq("klijent_id", id).order("ime")
  const kontakti = kontaktiData ?? []
  const zaduzeniIme = primaociRes.data?.zaduzeni_tehpro_id
    ? (korisnici.find((k) => k.id === primaociRes.data!.zaduzeni_tehpro_id)?.ime ?? null)
    : null
```
- Dodati render bloka:
```tsx
      {tab === "id-karta" && (
        <IdKartaTab
          klijentId={id}
          osnovni={{
            adresa: primaociRes.data?.adresa ?? null,
            telefon: primaociRes.data?.telefon ?? null,
            email: primaociRes.data?.email ?? null,
            pib: primaociRes.data?.pib ?? null,
            maticni_broj: primaociRes.data?.maticni_broj ?? null,
            sifra_djelatnosti: primaociRes.data?.sifra_djelatnosti ?? null,
          }}
          zaduzeniIme={zaduzeniIme}
          ugovori={ugovori}
          kontakti={kontakti}
          usluge={profilStavke.map((p) => ({ vrsta_naziv: p.vrsta_naziv, lokacija_naziv: p.lokacija_naziv, sljedeci_rok: p.sljedeci_rok }))}
        />
      )}
```
- Import: `import { IdKartaTab } from "@/components/domain/IdKartaTab"`.

- [ ] **Step 4: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add components/domain/IdKartaTab.tsx components/domain/KlijentTabs.tsx "app/(dashboard)/klijenti/[id]/page.tsx"
git commit -m "feat(pp1): ID karta tab (osnovni podaci + ugovori + kontakti + ugovorene usluge)"
```

---

## Task 19: UI — upravljanje vrstama u Postavkama (uredi/deaktiviraj/vodi_dokumentaciju)

**Files:**
- Create: `components/domain/VrstaSheet.tsx`
- Modify: `app/(dashboard)/postavke/page.tsx` (učitati `aktivna`/`vodi_dokumentaciju`, prikaz i SVE vrste, ne samo aktivne)

**Interfaces:**
- Consumes: `updateVrsta`, `postaviVrstaAktivna` (Task 12).
- Produces: `<VrstaSheet vrsta />` (uredi + toggle aktivna + vodi_dokumentaciju).

- [ ] **Step 1: `VrstaSheet.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateVrsta, postaviVrstaAktivna, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function VrstaSheet({
  vrsta,
}: {
  vrsta: { id: string; naziv: string; interval: number | null; zakonski_osnov: string | null; aktivna: boolean; vodi_dokumentaciju: boolean }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(updateVrsta, initial)
  const submitted = useRef(false)
  const [togglePending, startToggle] = useTransition()

  useEffect(() => {
    if (submitted.current && !pending && state.ok) { submitted.current = false; setOpen(false); router.refresh() }
  }, [state, pending, router])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <Button variant="outline" size="sm" data-testid={`uredi-vrstu-${vrsta.id}`}>
          <Pencil className="w-3.5 h-3.5" aria-hidden /> Uredi
        </Button>
      } />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="vrsta-sheet">
        <SheetHeader><SheetTitle>Uredi vrstu pregleda</SheetTitle></SheetHeader>
        <form
          key={vrsta.id}
          action={(fd) => { submitted.current = true; action(fd) }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="vrsta-form"
        >
          <input type="hidden" name="id" value={vrsta.id} />
          <label className="block text-sm">
            <span className="text-slate-600">Naziv *</span>
            <Input name="naziv" required defaultValue={vrsta.naziv} data-testid="vrsta-naziv" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Interval (mjeseci)</span>
            <Input name="interval" type="number" min={1} max={120} defaultValue={vrsta.interval ?? ""} placeholder="prazno = bez auto-zakazivanja" data-testid="vrsta-interval" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Zakonski osnov</span>
            <Input name="zakonski_osnov" defaultValue={vrsta.zakonski_osnov ?? ""} data-testid="vrsta-osnov" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="vodi_dokumentaciju" defaultChecked={vrsta.vodi_dokumentaciju} data-testid="vrsta-vodi-dok" />
            <span className="text-slate-600">Za ovu uslugu se vodi dokumentacija</span>
          </label>
          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}
          <Button type="submit" disabled={pending} data-testid="vrsta-submit">
            {pending ? "Spremam…" : "Spremi izmjene"}
          </Button>
        </form>
        <SheetFooter className="flex-row justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={togglePending}
            data-testid="vrsta-toggle-aktivna"
            className={vrsta.aktivna ? "text-red-600 border-red-200 hover:bg-red-50" : "text-green-700 border-green-200 hover:bg-green-50"}
            onClick={() => startToggle(async () => { await postaviVrstaAktivna(vrsta.id, !vrsta.aktivna); router.refresh() })}
          >
            {vrsta.aktivna ? "Deaktiviraj" : "Aktiviraj"}
          </Button>
          <SheetClose render={<Button variant="outline">Zatvori</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Izmijeniti `postavke/page.tsx`**

- Promijeniti `vrste` upit da uključi sva polja i **sve** vrste (i neaktivne, da se mogu reaktivirati):
```typescript
    supabase
      .from("vrste_provjera")
      .select("id, naziv, podrazumevani_interval_mjeseci, zakonski_osnov, aktivna, vodi_dokumentaciju")
      .order("aktivna", { ascending: false })
      .order("naziv"),
```
- Mapirati u prošireni objekat:
```typescript
  const vrste = (vrsteRes.data ?? []).map((v) => ({
    id: v.id, naziv: v.naziv, interval: v.podrazumevani_interval_mjeseci,
    zakonski_osnov: v.zakonski_osnov, aktivna: v.aktivna, vodi_dokumentaciju: v.vodi_dokumentaciju,
  }))
```
- `IntervaliForm` prima `{id, naziv, interval}` — proslijediti suženu mapu: `vrste.map(({id,naziv,interval}) => ({id,naziv,interval}))`. Pored `IntervaliForm`, dodati listu vrsta sa `VrstaSheet` po redu i indikatorom statusa/vodi_dokumentaciju. Dodati novu sekciju (admin) sa tabelom:
```tsx
      {jeAdminKor && (
        <section className="rounded-xl border border-slate-200 p-4">
          <h2 className="mb-3 text-base font-medium">Upravljanje vrstama</h2>
          <ul className="divide-y divide-slate-100" data-testid="vrste-lista">
            {vrste.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className={v.aktivna ? "" : "text-slate-400 line-through"}>{v.naziv}</span>
                  {!v.vodi_dokumentaciju && <span className="ml-2 text-xs text-slate-400">(bez dokumentacije)</span>}
                  {!v.aktivna && <span className="ml-2 text-xs text-red-500">neaktivna</span>}
                </span>
                <VrstaSheet vrsta={v} />
              </li>
            ))}
          </ul>
        </section>
      )}
```
- Import: `import { VrstaSheet } from "@/components/domain/VrstaSheet"`.

- [ ] **Step 3: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add components/domain/VrstaSheet.tsx "app/(dashboard)/postavke/page.tsx"
git commit -m "feat(pp1): upravljanje vrstama (uredi/deaktiviraj/vodi_dokumentaciju)"
```

---

## Task 20: E2E — kompletan tok ID karte

**Files:**
- Create: `tests/e2e/10-id-karta.spec.ts`

**Interfaces:**
- Consumes: testid‑ove iz Task 14–19. Pretpostavlja postojeći Playwright auth/setup (vidi `tests/e2e/*.spec.ts` i `playwright.config.ts`).

- [ ] **Step 1: Pogledati postojeći E2E obrazac**

Run: `sed -n '1,40p' tests/e2e/*.spec.ts | head -80`
Cilj: preuzeti način prijave/navigacije (storage state, baseURL, helper za login) i ime postojećeg test klijenta. Uskladiti selektore sa stvarnim setupom (ako E2E koristi globalni login, ne duplirati).

- [ ] **Step 2: Napisati E2E test**

```typescript
// tests/e2e/10-id-karta.spec.ts
import { test, expect } from "@playwright/test"

// Pretpostavka: globalni auth setup prijavljuje admina (vidi playwright.config.ts projekte).
test("ID karta: klijent → ugovor → kontakt → dokument", async ({ page }) => {
  const naziv = `E2E ID ${Date.now()}`

  // 1) Kreiraj klijenta
  await page.goto("/klijenti")
  await page.getByTestId("novi-klijent-btn").click()
  await page.getByTestId("klijent-naziv-input").fill(naziv) // uskladiti sa stvarnim testid-om NoviKlijentButton forme
  await page.getByTestId("klijent-submit").click()
  await expect(page.getByText(naziv)).toBeVisible()

  // 2) Otvori klijenta → ID karta tab
  await page.getByText(naziv).click()
  await page.getByTestId("tab-id-karta").click()
  await expect(page.getByTestId("tab-id-karta-content")).toBeVisible()

  // 3) Dodaj ugovor (aktivan)
  await page.getByTestId("novi-ugovor-btn").click()
  await page.getByTestId("ugovor-zavodni").fill("UG-001/2026")
  await page.getByTestId("ugovor-potpis").fill("2026-01-01")
  await page.getByTestId("ugovor-istek").fill("2027-01-01")
  await page.getByTestId("ugovor-obilasci").fill("2")
  await page.getByTestId("ugovor-submit").click()
  await expect(page.getByTestId("ugovor-red")).toContainText("UG-001/2026")
  await expect(page.getByTestId("ugovor-red")).toContainText("aktivan")

  // 4) Dodaj kontakt
  await page.getByTestId("novi-kontakt-btn").click()
  await page.getByTestId("kontakt-ime").fill("Marko Marković")
  await page.getByTestId("kontakt-funkcija").fill("Direktor")
  await page.getByTestId("kontakt-submit").click()
  await expect(page.getByTestId("kontakt-red")).toContainText("Marko Marković")

  // 5) Upload dokumenta tipa "ugovor" na Dokumenti tabu
  await page.getByTestId("tab-dokumenti").click()
  await page.getByTestId("klijent-dok-tip").selectOption("ugovor")
  await page.getByTestId?.("klijent-dok-file") // placeholder-guard; vidi korak 6
  await page.setInputFiles('[data-testid="klijent-dok-file"]', {
    name: "ugovor.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  })
  await page.getByTestId("klijent-dok-submit").click()
  await expect(page.getByText("ugovor.pdf")).toBeVisible()
})
```

- [ ] **Step 3: Uskladiti selektore i pokrenuti (Docker backend)**

Pokrenuti lokalni Supabase Docker stack i dev server, pa:
Run: `pnpm test:e2e tests/e2e/10-id-karta.spec.ts`
Expected: PASS. Ako `novi-klijent-btn`/`klijent-naziv-input`/`klijent-submit` testid‑ovi ne postoje u `NoviKlijentButton.tsx`, otvoriti taj fajl i uskladiti selektore (ne mijenjati ponašanje, samo tačne testid‑ove). Ukloniti `getByTestId?` placeholder liniju iz koraka 2.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/10-id-karta.spec.ts
git commit -m "test(pp1): E2E tok ID karte (klijent/ugovor/kontakt/dokument)"
```

---

## Task 21: Završni gate + cloud migracija

**Files:** (bez novih)

- [ ] **Step 1: Pun unit + tip + lint**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint`
Expected: sve PASS.

- [ ] **Step 2: Provjeriti da `db:types` nema diff**

Run: `pnpm db:types && git diff --exit-code db/types.ts`
Expected: bez izlaza (exit 0) — tipovi usklađeni sa migracijama.

- [ ] **Step 3: Pun E2E (Docker)**

Run: `pnpm test:e2e`
Expected: sve PASS (uključ. postojeće setove + novi 10‑id‑karta).

- [ ] **Step 4: Primijeniti migracije na cloud**

Run: `tsx --env-file=.env.local scripts/apply-cloud-migration.ts`
Expected: 6 PP‑1 migracija primijenjeno na cloud bez greške. (Cloud nije u MCP — ovo je jedini put primjene na produkciju.) Provjeriti `dokumenti` backfill na cloudu istim upitom iz Task 6 Step 3.

- [ ] **Step 5: Finalni commit (ako ima nezakomitovanih artefakata)**

```bash
git status --short
# ako je sve već commitovano: nema akcije
```

---

## Self-Review (autor plana)

**Spec coverage:**
- Gap #1 (ID karta/ugovor): Task 1 (polja), 2 (ugovori), 9–10 (akcije), 14–15, 18 (UI). ✅
- Gap #3 (dokumenti za ugovore/ponude): Task 6 (generalizacija), 8 (helperi), 13 (upload), 17 (UI). ✅
- Gap #5 (vodi_dokumentaciju + admin upravljanje vrstama): Task 5 (kolona), 12 (akcije), 19 (UI). ✅
- Kontakti (klijent‑nivo): Task 3, 11, 16, 18. ✅
- RLS/audit nove tabele: Task 2, 3 (folдano). ✅
- Backfill `dokumenti.klijent_id`: Task 6. ✅
- Testiranje (Docker/TDD): unit Task 7–8; E2E Task 20; gate Task 21. ✅

**Placeholder scan:** Jedina svjesna „uskladi selektore" tačka je Task 20 Step 3 (E2E zavisi od stvarnog auth setupa koji nije u kontekstu) — eksplicitno označeno kao korak, ne kao nedovršen kod. Linija `getByTestId?` u Task 20 je namjerno označena za uklanjanje u Step 3.

**Type consistency:** `ActionResult` jedinstven; `dokumentStoragePath`/`DOKUMENT_TIPOVI`/`jeValidanTip` (lib/dokumenti) dosljedno korišteni u Task 13/17; `validUgovorDatumi` (lib/ugovori) u Task 10; nazivi akcija (`createUgovor`/`updateUgovor`/`deleteUgovor`, `createKontakt`/…, `updateVrsta`/`postaviVrstaAktivna`, `uploadKlijentDokumentAction`) dosljedni između akcija i komponenti.

**Napomena o riziku:** `klijenti_view`/`termini_view` ne mijenjamo u PP‑1; ID karta čita direktno iz tabela. Ako kasnije lista klijenata treba „ima aktivan ugovor", to je zaseban dodatak (van PP‑1).
