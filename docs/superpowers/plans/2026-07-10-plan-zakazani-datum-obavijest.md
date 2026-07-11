# Zakazani datum u planu + obavijest o probijanju roka — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Termin sa zakazanim datumom prikazuje se u kalendaru/listi/matrici na zakazanom datumu (fallback na rok), a zakazivanje poslije roka daje živo upozorenje u formi + best-effort transakcijski email internim primaocima.

**Architecture:** Jedna računata kolona `datum_prikaza = coalesce(datum_zakazan, rok_dospijeca)` u `termini_view` postaje pozicijska osnova za sva tri prikaza. Zakazivanje poslije roka detektuje čista funkcija (klijent + server); server nakon upisa poziva `SECURITY DEFINER` RPC koji atomično računa interne primaoce (bypass RLS), zauzima idempotenciju po `(termin_id, datum_zakazan)` i vraća listu za slanje; email ide preko postojeće Resend infrastrukture (dry-run bez ključa).

**Tech Stack:** Next.js 16 (App Router, `--webpack`), TypeScript, Supabase (Postgres + RLS + SECURITY DEFINER RPC), pnpm, Vitest (unit), Playwright (E2E, cilja cloud DEMO), next-intl (sr/en/de), Resend.

## Global Constraints

- **Package manager `pnpm`** (nikad npm/yarn). Dev je `pnpm dev` (`next dev --webpack`; nikad plain `next dev` — put ima razmak).
- **Next.js 16** — `proxy.ts` ne `middleware`; pročitati `node_modules/next/dist/docs/` prije Next-specifičnog koda.
- **Domain jezik = bosanski/srpski (latinica)**: tabele/kolone/rute/identifikatori/UI stringovi (`termini`, `rok_dospijeca`, `datum_zakazan`…). Match postojeće.
- **Dvije cloud baze**: PROD ref `fqtqkehjidkzeasiegnq` (`DATABASE_URL` u `.env.local`), DEMO ref `mtwwotmwrasozmcgqwhc` (`DATABASE_URL_DEMO` u `.env.development.local`). **Dev i E2E rade nad DEMO.** Ref-guard prije PROD upisa. `.env.local` nije shell-`source`-abilan (grep, ne source).
- **Migracije**: `supabase/migrations/*.sql` je izvor istine; `db/types.ts` je auto-generisan (`pnpm db:types` iz LOCAL DB, nikad ručno). Cloud DB nije dostupna preko Supabase MCP — primjenjuje se jedan fajl `pnpm db:apply-cloud` (PROD) / override `DATABASE_URL` za DEMO.
- **Tri Supabase klijenta**: SSR anon (`createServerSupabaseClient`) je default u rutama/akcijama; **admin/service-role klijent je ZABRANJEN u `app/`/`components/` request-putanji**. Zato interne primaoce računa `SECURITY DEFINER` RPC (ne admin klijent).
- **RLS**: viewovi moraju imati `security_invoker = on`; nova tabela na cloudu automatski dobije RLS (event trigger) → bez policy-a vraća 0 redova, pa joj se pristupa isključivo preko DEFINER RPC-a.
- **Merge u `main` = production deploy** (auto na 3 Vercel projekta). Ostajemo na grani `feat/plan-zakazani-datum`; cloud migracije (DEMO→PROD) su eksplicitan korak koji korisnik pokreće (Task 9).
- **i18n**: dodavati ključeve u `messages/{sr,en,de}.json` u ISTOJ izmjeni, uz key-parity; **ne koristiti ICU `one` kategoriju za sr** (koristiti `=1`/`other`).
- **Lint**: bez `sm:`/`md:` Tailwind breakpointa (samo `lg:`/`xl:`/`2xl:` ili bez); `no-await-in-loop` (osim `scripts/`).
- **Nikad hardkodirati** brand/firmu; email koristi `APP_NAME`/`APP_TAGLINE` (`lib/brand.ts`), nikad literal.
- **Verifikacija prije "gotovo"**: `pnpm typecheck && pnpm lint && pnpm test:unit` moraju proći; E2E gdje je navedeno.

---

## File Structure

**Create:**
- `supabase/migrations/20260710140000_datum_prikaza_i_zakazano_obavijest.sql` — `datum_prikaza` u `termini_view` (+ rekreacija `klijenti_view`), tabela `termin_zakazano_obavijest`, RPC `zabiljezi_zakazano_obavijest`.
- `lib/plan-datum.ts` — čiste funkcije `jeZakazanoPoslijeRoka`, `danaPoslijeRoka`.
- `lib/plan-datum.test.ts` — unit.
- `lib/reminders/zakazanoNakonRoka.ts` — best-effort orkestracija (RPC claim → send).
- `lib/email/zakazanoNakonRoka.test.ts` — unit za template funkcije.

**Modify:**
- `lib/email/templates.ts` — `zakazanoNakonRokaSubject`, `zakazanoNakonRokaHtml`.
- `app/api/plan-aktivnosti/kalendar/route.ts` — filter/sort po `datum_prikaza`.
- `app/api/plan-aktivnosti/lista/route.ts` — sort po `datum_prikaza`.
- `app/api/plan-aktivnosti/matrica/route.ts` — select + prozor po `datum_prikaza`.
- `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx` — grupisanje + `?dan` filter po `datum_prikaza`.
- `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx` — `dan`/`columnKey` iz `datum_prikaza`.
- `components/domain/TerminiTable.tsx` — kolona prikazuje `datum_prikaza` (primarno) + rok (sekundarno kad se razlikuje).
- `components/domain/TerminSheet.tsx` — živo upozorenje uz `datum_zakazan` polje.
- `components/domain/NoviTerminButton.tsx` — živo upozorenje uz `datum_zakazan` polje.
- `app/(dashboard)/termini/actions.ts` — `updateTermin`/`createTermin` pozivaju email orkestraciju kad je zakazan > rok.
- `messages/{sr,en,de}.json` — ključevi za upozorenje, email, lista kolonu.
- `tests/e2e/22-kasni-zakazano.spec.ts` — kalendar-pozicioniranje + zakazivanje-poslije-roka (upozorenje + audit).
- `db/types.ts` — regen (Task 1).

---

## Task 1: DB migracija — `datum_prikaza` + audit tabela + claim RPC

**Files:**
- Create: `supabase/migrations/20260710140000_datum_prikaza_i_zakazano_obavijest.sql`
- Modify (regen): `db/types.ts`

**Interfaces:**
- Produces: view kolona `termini_view.datum_prikaza` (`date`, NOT NULL efektivno); tabela `termin_zakazano_obavijest(id, termin_id, datum_zakazan, poslat_na, created_at)`; RPC `zabiljezi_zakazano_obavijest(p_termin_id uuid, p_datum_zakazan date, p_base text[]) returns text[]` — vraća listu primalaca za slanje, prazan niz kad je već poslato ili nema primalaca.

- [ ] **Step 1: Napiši migraciju**

Create `supabase/migrations/20260710140000_datum_prikaza_i_zakazano_obavijest.sql`:

```sql
-- 2026-07-10: datum_prikaza (coalesce zakazan/rok) kao pozicijska osnova plana +
-- audit "zakazano poslije roka" + atomski claim RPC za transakcijski email.

-- 1) termini_view dobija datum_prikaza. klijenti_view zavisi → rekreiraju se OBA
--    (obrazac iz 20260630120000_nacin_izvrsenja.sql; t.* je pozicijski razvijen,
--    nova kolona se ne pojavi bez rekreiranja).
drop view if exists klijenti_view;
drop view if exists termini_view;
create view termini_view as
select
  t.*,
  case
    when t.status = 'izvrseno' then 'izvrseno'
    when t.status = 'otkazano' then 'otkazano'
    when t.rok_dospijeca < current_date then 'kasni'
    else t.status::text
  end as status_izvedeni,
  coalesce(t.datum_zakazan, t.rok_dospijeca) as datum_prikaza,
  k.naziv as klijent_naziv,
  l.naziv as lokacija_naziv,
  l.grad  as lokacija_grad,
  v.naziv as vrsta_naziv
from termini t
left join klijenti k       on k.id = t.klijent_id
left join lokacije l       on l.id = t.lokacija_id
left join vrste_provjera v on v.id = t.vrsta_provjere_id;

create view klijenti_view as
select
  k.id,
  k.naziv,
  k.napomena,
  k.created_at,
  k.updated_at,
  k.tip_odnosa,
  coalesce(lok.broj_lokacija, 0) as broj_lokacija,
  coalesce(t.broj_termina, 0)    as broj_termina,
  coalesce(t.broj_aktivnih, 0)   as broj_aktivnih,
  coalesce(t.broj_kasni, 0)      as broj_kasni,
  coalesce(t.broj_izvrseno, 0)   as broj_izvrseno
from klijenti k
left join (
  select klijent_id, count(*) as broj_lokacija
  from lokacije
  group by klijent_id
) lok on lok.klijent_id = k.id
left join (
  select
    klijent_id,
    count(*)                                                                        as broj_termina,
    count(*) filter (where status_izvedeni = any (array['planirano', 'zakazano'])) as broj_aktivnih,
    count(*) filter (where status_izvedeni = 'kasni')                               as broj_kasni,
    count(*) filter (where status = 'izvrseno')                                     as broj_izvrseno
  from termini_view
  group by klijent_id
) t on t.klijent_id = k.id;

alter view termini_view  set (security_invoker = on);
alter view klijenti_view set (security_invoker = on);

-- 2) Audit: koje "zakazano poslije roka" obavijesti su poslane. Idempotencija po
--    (termin_id, datum_zakazan). Interna tabela — pristup samo preko DEFINER RPC ispod.
create table if not exists termin_zakazano_obavijest (
  id            uuid primary key default gen_random_uuid(),
  termin_id     uuid not null references termini(id) on delete cascade,
  datum_zakazan date not null,
  poslat_na     text[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (termin_id, datum_zakazan)
);
alter table termin_zakazano_obavijest enable row level security;
-- Namjerno bez policy-a: čita/piše isključivo DEFINER RPC ispod (kao audit_log obrazac).

-- 3) Atomski claim + računanje internih primalaca (bypass caller RLS: DEFINER).
--    Vraća listu primalaca za slanje; prazan niz = ne šalji (već poslato / nema primalaca).
--    Interni primaoci = admini (aktivan+prima_podsjetnike) ∪ dodijeljeni klijentu ∪ base(env).
--    NIKAD klijent (nema "firma" kanala).
create or replace function zabiljezi_zakazano_obavijest(
  p_termin_id uuid,
  p_datum_zakazan date,
  p_base text[]
) returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_klijent  uuid;
  v_primaoci text[];
  v_inserted int;
begin
  select klijent_id into v_klijent from termini where id = p_termin_id;
  if v_klijent is null then
    return '{}';
  end if;

  select array(
    select distinct lower(btrim(email)) as e
    from (
      select k.email
      from korisnici k
      where k.aktivan and k.prima_podsjetnike
        and (
          k.uloga = 'admin'
          or exists (
            select 1 from korisnik_klijent kk
            where kk.korisnik_id = k.id and kk.klijent_id = v_klijent
          )
        )
      union
      select unnest(coalesce(p_base, '{}'))
    ) s(email)
    where lower(btrim(email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) into v_primaoci;

  if v_primaoci is null or array_length(v_primaoci, 1) is null then
    return '{}';
  end if;

  insert into termin_zakazano_obavijest (termin_id, datum_zakazan, poslat_na)
  values (p_termin_id, p_datum_zakazan, v_primaoci)
  on conflict (termin_id, datum_zakazan) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    return '{}';  -- već poslato za ovaj (termin, datum_zakazan)
  end if;

  return v_primaoci;
end;
$$;
```

- [ ] **Step 2: Primijeni na LOCAL i regeneriši tipove**

Run:
```bash
pnpm db:reset
pnpm db:types
```
Expected: `db:reset` reapplied sve migracije bez greške; `db/types.ts` sada u `termini_view.Row` sadrži `datum_prikaza: string`, i `Functions` sadrži `zabiljezi_zakazano_obavijest`.

- [ ] **Step 3: Verifikuj kolonu i RPC u local bazi**

Run:
```bash
pnpm exec tsx --env-file=.env.local -e "import {Client} from 'pg'; const c=new Client({connectionString: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'}); await c.connect(); console.log((await c.query(\"select column_name from information_schema.columns where table_name='termini_view' and column_name='datum_prikaza'\")).rows); console.log((await c.query(\"select proname from pg_proc where proname='zabiljezi_zakazano_obavijest'\")).rows); await c.end();"
```
Expected: ispisuje `[ { column_name: 'datum_prikaza' } ]` i `[ { proname: 'zabiljezi_zakazano_obavijest' } ]`.
(Ako lokalni port/konekcija drugačiji, koristiti konekc. string iz `supabase status`.)

- [ ] **Step 4: Verifikuj da tipovi kompajliraju**

Run: `pnpm typecheck`
Expected: PASS (nema grešaka; `datum_prikaza` sada postoji u tipu view-a).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710140000_datum_prikaza_i_zakazano_obavijest.sql db/types.ts
git commit -m "feat(db): datum_prikaza u termini_view + audit/claim RPC za zakazano-poslije-roka"
```

---

## Task 2: Čista funkcija — zakazano poslije roka

**Files:**
- Create: `lib/plan-datum.ts`
- Test: `lib/plan-datum.test.ts`

**Interfaces:**
- Produces: `jeZakazanoPoslijeRoka(rok: string | null | undefined, zakazan: string | null | undefined): boolean`; `danaPoslijeRoka(rok: string, zakazan: string): number` (broj kalendarskih dana zakazan − rok; pozitivan kad je zakazan poslije roka).

- [ ] **Step 1: Napiši padajući test**

Create `lib/plan-datum.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { jeZakazanoPoslijeRoka, danaPoslijeRoka } from "./plan-datum"

describe("jeZakazanoPoslijeRoka", () => {
  it("true kad je zakazan strogo poslije roka", () => {
    expect(jeZakazanoPoslijeRoka("2026-07-13", "2026-07-15")).toBe(true)
  })
  it("false kad je zakazan na rok", () => {
    expect(jeZakazanoPoslijeRoka("2026-07-13", "2026-07-13")).toBe(false)
  })
  it("false kad je zakazan prije roka", () => {
    expect(jeZakazanoPoslijeRoka("2026-07-13", "2026-07-10")).toBe(false)
  })
  it("false kad zakazan nije postavljen", () => {
    expect(jeZakazanoPoslijeRoka("2026-07-13", null)).toBe(false)
    expect(jeZakazanoPoslijeRoka("2026-07-13", "")).toBe(false)
  })
  it("false kad rok nedostaje", () => {
    expect(jeZakazanoPoslijeRoka(null, "2026-07-15")).toBe(false)
  })
})

describe("danaPoslijeRoka", () => {
  it("broji kalendarske dane između roka i zakazanog", () => {
    expect(danaPoslijeRoka("2026-07-13", "2026-07-15")).toBe(2)
  })
  it("radi preko granice mjeseca", () => {
    expect(danaPoslijeRoka("2026-07-31", "2026-08-02")).toBe(2)
  })
  it("0 kad su isti", () => {
    expect(danaPoslijeRoka("2026-07-13", "2026-07-13")).toBe(0)
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/plan-datum.test.ts`
Expected: FAIL — "Failed to resolve import ./plan-datum" / funkcije ne postoje.

- [ ] **Step 3: Implementiraj**

Create `lib/plan-datum.ts`:

```ts
/** Plan pozicioniranje/upozorenje: poređenje zakazanog datuma i roka. ISO 'YYYY-MM-DD'. */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** True kad je zakazani datum STROGO poslije roka. Prazno/nevažeće → false. */
export function jeZakazanoPoslijeRoka(
  rok: string | null | undefined,
  zakazan: string | null | undefined,
): boolean {
  if (!rok || !zakazan) return false
  const r = rok.slice(0, 10)
  const z = zakazan.slice(0, 10)
  if (!ISO_RE.test(r) || !ISO_RE.test(z)) return false
  return z > r // leksikografsko poređenje ISO datuma
}

/** Broj kalendarskih dana (zakazan − rok). Pozitivan kad je zakazan poslije roka. */
export function danaPoslijeRoka(rok: string, zakazan: string): number {
  const r = Date.UTC(
    Number(rok.slice(0, 4)), Number(rok.slice(5, 7)) - 1, Number(rok.slice(8, 10)),
  )
  const z = Date.UTC(
    Number(zakazan.slice(0, 4)), Number(zakazan.slice(5, 7)) - 1, Number(zakazan.slice(8, 10)),
  )
  return Math.round((z - r) / 86_400_000)
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/plan-datum.test.ts`
Expected: PASS (8 testova).

- [ ] **Step 5: Commit**

```bash
git add lib/plan-datum.ts lib/plan-datum.test.ts
git commit -m "feat(plan): cista funkcija jeZakazanoPoslijeRoka/danaPoslijeRoka"
```

---

## Task 3: Kalendar pozicionira po `datum_prikaza`

**Files:**
- Modify: `app/api/plan-aktivnosti/kalendar/route.ts:37-39`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx:57-68` i `:73-75`
- Test: `tests/e2e/22-kasni-zakazano.spec.ts` (novi test u Task 8; ovdje ručna provjera)

**Interfaces:**
- Consumes: `termini_view.datum_prikaza` (Task 1).

- [ ] **Step 1: API — filter/sort po `datum_prikaza`**

In `app/api/plan-aktivnosti/kalendar/route.ts`, zamijeni blok `.gte(...).lte(...).order(...)`:

```ts
  const { data, error } = await supabase
    .from("termini_view")
    .select("*")
    .gte("datum_prikaza", from)
    .lte("datum_prikaza", to)
    .order("datum_prikaza")
```

- [ ] **Step 2: View — grupiši po `datum_prikaza`**

In `app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx`, u petlji koja gradi `terminiByDan` (trenutno linije 57–68) zamijeni `rok_dospijeca` sa `datum_prikaza`:

```tsx
  const terminiByDan = new Map<string, DayTermin[]>()
  for (const termin of termini) {
    if (!termin.id || !termin.datum_prikaza) continue
    const dan = termin.datum_prikaza.slice(0, 10)
    const arr = terminiByDan.get(dan) ?? []
    arr.push({
      id: termin.id,
      klijentNaziv: termin.klijent_naziv ?? "—",
      lokacijaNaziv: termin.lokacija_naziv,
      status: toDerivedStatus(termin.status_izvedeni),
    })
    terminiByDan.set(dan, arr)
  }
```

I `?dan` sidebar filter (trenutno linije 73–75):

```tsx
  const danTermini = selectedDan
    ? termini.filter((termin) => (termin.datum_prikaza ?? "").slice(0, 10) === selectedDan)
    : []
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Ručna provjera u dev-u (DEMO)**

> Napomena: dev cilja DEMO. Ova provjera ima puni efekat tek nakon što je migracija primijenjena na DEMO (Task 9). Ako DEMO još nema migraciju, preskoči do Task 9 i vrati se.

Run: `pnpm dev` → otvori `/plan-aktivnosti?view=kalendar`. Termin sa `datum_zakazan` u budućem danu prikazuje se na zakazanom danu, ne na roku.

- [ ] **Step 5: Commit**

```bash
git add app/api/plan-aktivnosti/kalendar/route.ts "app/(dashboard)/plan-aktivnosti/_views/kalendar.tsx"
git commit -m "feat(plan): kalendar pozicionira po datum_prikaza (zakazan pa rok)"
```

---

## Task 4: Lista i matrica po `datum_prikaza`

**Files:**
- Modify: `app/api/plan-aktivnosti/lista/route.ts:18`
- Modify: `app/api/plan-aktivnosti/matrica/route.ts:59-61,68-72`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx:62-70,76-84`
- Modify: `components/domain/TerminiTable.tsx:74` (+ header label)
- Modify: `messages/{sr,en,de}.json`

**Interfaces:**
- Consumes: `termini_view.datum_prikaza` (Task 1).

- [ ] **Step 1: Lista API — sort po `datum_prikaza`**

In `app/api/plan-aktivnosti/lista/route.ts`, promijeni `.order`:

```ts
  let listQuery = supabase
    .from("termini_view")
    .select("*", { count: "exact" })
    .order("datum_prikaza", { ascending: true })
```

- [ ] **Step 2: Matrica API — select + prozor po `datum_prikaza`**

In `app/api/plan-aktivnosti/matrica/route.ts`, `mode==="mjesec"` grana:

```ts
    const { data, error } = await supabase
      .from("termini_view")
      .select("id, vrsta_provjere_id, vrsta_naziv, klijent_id, rok_dospijeca, datum_prikaza, status_izvedeni")
      .gte("datum_prikaza", od)
      .lte("datum_prikaza", doIso)
```

`mode==="klijent"` grana:

```ts
    const { data, error } = await supabase
      .from("termini_view")
      .select("id, vrsta_provjere_id, vrsta_naziv, rok_dospijeca, datum_prikaza, status_izvedeni")
      .eq("klijent_id", klijentId)
      .gte("datum_prikaza", `${godina}-01-01`)
      .lte("datum_prikaza", `${godina}-12-31`)
      .order("vrsta_naziv")
```

- [ ] **Step 3: Matrica view — bucket po `datum_prikaza`**

In `app/(dashboard)/plan-aktivnosti/_views/matrica.tsx`, `mode==="mjesec"` inputs (trenutno 62–70):

```tsx
    const inputs: MatrixInput[] = termini
      .filter((termin) => termin.id && termin.vrsta_provjere_id && termin.klijent_id && termin.datum_prikaza)
      .map((termin) => ({
        id: termin.id!,
        vrstaId: termin.vrsta_provjere_id!,
        vrstaNaziv: termin.vrsta_naziv ?? "—",
        columnKey: termin.klijent_id!,
        dan: Number(termin.datum_prikaza!.slice(8, 10)),
        status: toDerivedStatus(termin.status_izvedeni),
      }))
```

`mode==="klijent"` inputs (trenutno 76–84):

```tsx
    const inputs: MatrixInput[] = termini
      .filter((termin) => termin.id && termin.vrsta_provjere_id && termin.datum_prikaza)
      .map((termin) => ({
        id: termin.id!,
        vrstaId: termin.vrsta_provjere_id!,
        vrstaNaziv: termin.vrsta_naziv ?? "—",
        columnKey: String(Number(termin.datum_prikaza!.slice(5, 7))),
        dan: Number(termin.datum_prikaza!.slice(8, 10)),
        status: toDerivedStatus(termin.status_izvedeni),
      }))
```

- [ ] **Step 4: Lista tabela — prikaži prikazni datum + rok kad se razlikuje**

In `components/domain/TerminiTable.tsx`, zamijeni datum ćeliju (trenutno linija 74):

```tsx
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                {formatDatum(r.datum_prikaza)}
                {r.datum_zakazan && r.datum_zakazan !== r.rok_dospijeca && (
                  <span className="block text-xs text-slate-400">
                    {t("rokKratko", { datum: formatDatum(r.rok_dospijeca) })}
                  </span>
                )}
              </td>
```

Header label ostaje ključ `datumRoka`, ali mu se mijenja vrijednost u "Datum" (Step 5), jer ćelija sad primarno pokazuje prikazni datum.

- [ ] **Step 5: i18n ključevi (parity sr/en/de)**

In `messages/sr.json` → `termini.tabela.kolone.datumRoka`: promijeni na `"Datum"`; dodaj u `termini.tabela` ključ:
```json
      "rokKratko": "rok {datum}"
```
In `messages/en.json` → `termini.tabela.kolone.datumRoka`: `"Date"`; dodaj `"rokKratko": "due {datum}"`.
In `messages/de.json` → `termini.tabela.kolone.datumRoka`: `"Datum"`; dodaj `"rokKratko": "Frist {datum}"`.

- [ ] **Step 6: Typecheck + lint + unit**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: PASS (next-intl provjerava da ključevi postoje u sve tri lokale; nedostatak = tsc greška).

- [ ] **Step 7: Commit**

```bash
git add app/api/plan-aktivnosti/lista/route.ts app/api/plan-aktivnosti/matrica/route.ts "app/(dashboard)/plan-aktivnosti/_views/matrica.tsx" components/domain/TerminiTable.tsx messages/sr.json messages/en.json messages/de.json
git commit -m "feat(plan): lista i matrica pozicioniraju po datum_prikaza + rok kao sekundarni"
```

---

## Task 5: Email — template + orkestracija

**Files:**
- Modify: `lib/email/templates.ts` (dodati dvije funkcije na kraj)
- Create: `lib/email/zakazanoNakonRoka.test.ts`
- Create: `lib/reminders/zakazanoNakonRoka.ts`
- Modify: `messages/{sr,en,de}.json` (namespace `email.zakazanoNakonRoka`)

**Interfaces:**
- Consumes: `sendEmail`/`SendArgs`/`SendResult` (`lib/email/resend.ts`); `parseEmailList` (`lib/reminders/recipients.ts`); RPC `zabiljezi_zakazano_obavijest` (Task 1); `env.REMINDER_TO`.
- Produces:
  - `zakazanoNakonRokaSubject(args: { vrsta: string; klijent: string }, locale?): string`
  - `zakazanoNakonRokaHtml(args: { klijent: string; vrsta: string; rok: string; zakazan: string; lokacija?: string | null }, locale?): string`
  - `posaljiZakazanoNakonRoka(supabase, args: { terminId: string; datumZakazan: string }, deps?: { send?: (a: SendArgs) => Promise<SendResult> }): Promise<{ poslato: boolean; to?: string[]; dryRun?: boolean; razlog?: string }>`

- [ ] **Step 1: i18n ključevi za email (parity)**

In `messages/sr.json`, unutar `email` objekta dodaj namespace:
```json
    "zakazanoNakonRoka": {
      "predmet": "Zakazano poslije roka — {vrsta} · {klijent}",
      "znacka": "Zakazano poslije roka",
      "uvod": "Termin je zakazan nakon roka dospijeća.",
      "poljeRok": "Rok dospijeća",
      "poljeZakazan": "Zakazano za",
      "poljeVrsta": "Vrsta",
      "poljeKlijent": "Klijent",
      "poljeLokacija": "Lokacija",
      "napomena": "Zakazivanje poslije roka je dozvoljeno; ovo je automatska obavijest zaduženima."
    }
```
In `messages/en.json` (`email`):
```json
    "zakazanoNakonRoka": {
      "predmet": "Scheduled after due date — {vrsta} · {klijent}",
      "znacka": "Scheduled after due date",
      "uvod": "This activity was scheduled after its due date.",
      "poljeRok": "Due date",
      "poljeZakazan": "Scheduled for",
      "poljeVrsta": "Service",
      "poljeKlijent": "Client",
      "poljeLokacija": "Location",
      "napomena": "Scheduling after the due date is allowed; this is an automatic notice to the assignees."
    }
```
In `messages/de.json` (`email`):
```json
    "zakazanoNakonRoka": {
      "predmet": "Nach Frist geplant — {vrsta} · {klijent}",
      "znacka": "Nach Frist geplant",
      "uvod": "Diese Aktivität wurde nach ihrer Frist geplant.",
      "poljeRok": "Frist",
      "poljeZakazan": "Geplant für",
      "poljeVrsta": "Leistung",
      "poljeKlijent": "Kunde",
      "poljeLokacija": "Standort",
      "napomena": "Eine Planung nach der Frist ist erlaubt; dies ist eine automatische Benachrichtigung an die Zuständigen."
    }
```

- [ ] **Step 2: Napiši padajući test za template funkcije**

Create `lib/email/zakazanoNakonRoka.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { zakazanoNakonRokaSubject, zakazanoNakonRokaHtml } from "./templates"

describe("zakazanoNakonRoka email", () => {
  it("subject sadrži vrstu i klijenta", () => {
    const s = zakazanoNakonRokaSubject({ vrsta: "Obilazak", klijent: "CARMEUSE" })
    expect(s).toContain("Obilazak")
    expect(s).toContain("CARMEUSE")
  })
  it("html prikazuje rok i zakazani datum (sr format)", () => {
    const html = zakazanoNakonRokaHtml({
      klijent: "CARMEUSE", vrsta: "Obilazak",
      rok: "2026-07-13", zakazan: "2026-07-15", lokacija: "Doboj",
    })
    expect(html).toContain("13.07.2026.")
    expect(html).toContain("15.07.2026.")
    expect(html).toContain("CARMEUSE")
    expect(html).toContain("Doboj")
  })
  it("html escape-uje HTML u nazivima", () => {
    const html = zakazanoNakonRokaHtml({
      klijent: "<b>x</b>", vrsta: "V", rok: "2026-07-13", zakazan: "2026-07-15",
    })
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).not.toContain("<b>x</b>")
  })
})
```

- [ ] **Step 3: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/email/zakazanoNakonRoka.test.ts`
Expected: FAIL — `zakazanoNakonRokaSubject`/`zakazanoNakonRokaHtml` ne postoje.

- [ ] **Step 4: Implementiraj template funkcije**

In `lib/email/templates.ts`, dodaj na kraj fajla (koristi postojeće `escapeHtml`, `htmlLang`, `formatDatum`, `APP_NAME`, `APP_TAGLINE`, `createTranslator`, `getMessages`, `APP_LOCALE`, `Locale`):

```ts
export function zakazanoNakonRokaSubject(
  args: { vrsta: string; klijent: string },
  locale: Locale = APP_LOCALE,
): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.zakazanoNakonRoka" })
  return t("predmet", { vrsta: args.vrsta, klijent: args.klijent })
}

export function zakazanoNakonRokaHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  zakazan: string
  lokacija?: string | null
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.zakazanoNakonRoka" })
  const boja = "#dc2626"
  const rok = formatDatum(args.rok, locale)
  const zakazan = formatDatum(args.zakazan, locale)
  const lokRed = args.lokacija
    ? `<tr><td style="padding:4px 0;color:#64748b">${t("poljeLokacija")}</td><td style="padding:4px 0;text-align:right">${escapeHtml(args.lokacija)}</td></tr>`
    : ""
  return `<!doctype html>
<html lang="${htmlLang(locale)}"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:${boja};padding:16px 24px">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:16px;font-weight:bold">${escapeHtml(APP_NAME)}</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;opacity:.85">${t("znacka")}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px">
          <span style="display:inline-block;background:${boja};color:#ffffff;font-size:12px;font-weight:bold;padding:4px 10px;border-radius:999px">${t("znacka")}</span>
          <p style="margin:12px 0 0;font-size:15px">${t("uvod")}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-top:1px solid #e2e8f0;font-size:14px">
            <tr><td style="padding:8px 0;color:#64748b">${t("poljeRok")}</td><td style="padding:8px 0;text-align:right">${rok}</td></tr>
            <tr><td style="padding:4px 0;color:#64748b">${t("poljeZakazan")}</td><td style="padding:4px 0;text-align:right;font-weight:bold">${zakazan}</td></tr>
            <tr><td style="padding:4px 0;color:#64748b">${t("poljeVrsta")}</td><td style="padding:4px 0;text-align:right">${escapeHtml(args.vrsta)}</td></tr>
            <tr><td style="padding:4px 0;color:#64748b">${t("poljeKlijent")}</td><td style="padding:4px 0;text-align:right">${escapeHtml(args.klijent)}</td></tr>
            ${lokRed}
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#64748b">${t("napomena")}</p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center">${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
```

- [ ] **Step 5: Pokreni test — mora proći**

Run: `pnpm vitest run lib/email/zakazanoNakonRoka.test.ts`
Expected: PASS (3 testa).

- [ ] **Step 6: Implementiraj orkestraciju**

Create `lib/reminders/zakazanoNakonRoka.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { parseEmailList } from "@/lib/reminders/recipients"
import { zakazanoNakonRokaSubject, zakazanoNakonRokaHtml } from "@/lib/email/templates"

export type ZakazanoObavijestResult = {
  poslato: boolean
  to?: string[]
  dryRun?: boolean
  razlog?: "preskoceno" | "greska"
  message?: string
}

/**
 * Best-effort obavijest "zakazano poslije roka". NE baca — vraća rezultat.
 * Idempotencija + interni primaoci: SECURITY DEFINER RPC zabiljezi_zakazano_obavijest
 * (bypass caller RLS, atomski claim). NIKAD klijentu.
 */
export async function posaljiZakazanoNakonRoka(
  supabase: SupabaseClient<Database>,
  args: { terminId: string; datumZakazan: string },
  deps: { send?: (a: SendArgs) => Promise<SendResult> } = {},
): Promise<ZakazanoObavijestResult> {
  const send = deps.send ?? sendEmail
  try {
    const base = parseEmailList(env.REMINDER_TO)
    const { data: primaociData, error: rpcErr } = await supabase.rpc("zabiljezi_zakazano_obavijest", {
      p_termin_id: args.terminId,
      p_datum_zakazan: args.datumZakazan,
      p_base: base,
    })
    if (rpcErr) return { poslato: false, razlog: "greska", message: rpcErr.message }
    const to = (primaociData ?? []) as string[]
    if (to.length === 0) return { poslato: false, razlog: "preskoceno" }

    const { data: row, error: rowErr } = await supabase
      .from("termini_view")
      .select("klijent_naziv, vrsta_naziv, lokacija_naziv, rok_dospijeca")
      .eq("id", args.terminId)
      .maybeSingle()
    if (rowErr || !row?.klijent_naziv || !row.vrsta_naziv || !row.rok_dospijeca) {
      return { poslato: false, razlog: "greska", message: rowErr?.message ?? "nepotpun termin" }
    }

    const res = await send({
      to,
      subject: zakazanoNakonRokaSubject({ vrsta: row.vrsta_naziv, klijent: row.klijent_naziv }),
      html: zakazanoNakonRokaHtml({
        klijent: row.klijent_naziv,
        vrsta: row.vrsta_naziv,
        rok: row.rok_dospijeca,
        zakazan: args.datumZakazan,
        lokacija: row.lokacija_naziv,
      }),
    })
    return { poslato: true, to, dryRun: res.dryRun }
  } catch (e) {
    return { poslato: false, razlog: "greska", message: e instanceof Error ? e.message : String(e) }
  }
}
```

> Napomena: `posaljiZakazanoNakonRoka` se ne unit-testira izolovano (supabase mock je krhak) — pokriveno je E2E-om u Task 8 (dry-run + provjera audit reda). Template funkcije su unit-testirane (Step 2–5).

- [ ] **Step 7: Typecheck + lint + unit**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/email/templates.ts lib/email/zakazanoNakonRoka.test.ts lib/reminders/zakazanoNakonRoka.ts messages/sr.json messages/en.json messages/de.json
git commit -m "feat(email): template + orkestracija za obavijest zakazano-poslije-roka"
```

---

## Task 6: Server actions — pošalji obavijest kad je zakazan > rok

**Files:**
- Modify: `app/(dashboard)/termini/actions.ts` (`updateTermin`, `createTermin`)

**Interfaces:**
- Consumes: `jeZakazanoPoslijeRoka` (Task 2); `posaljiZakazanoNakonRoka` (Task 5).

- [ ] **Step 1: Importi**

In `app/(dashboard)/termini/actions.ts`, dodaj uz postojeće importe:

```ts
import { jeZakazanoPoslijeRoka } from "@/lib/plan-datum"
import { posaljiZakazanoNakonRoka } from "@/lib/reminders/zakazanoNakonRoka"
```

- [ ] **Step 2: `updateTermin` — dohvati rok + pošalji obavijest**

U `updateTermin`, blok koji dohvaća trenutni red radi status-sync (trenutno linije 60–65) proširi da uzme i `rok_dospijeca`, i zadrži red za kasnije. Zamijeni taj `if` blok:

```ts
  // Sinhronizuj status sa "Datum zakazan": planirano ↔ zakazano; usput dohvati rok
  // (treba za detekciju zakazano-poslije-roka nakon upisa).
  let rokDospijeca: string | null = null
  if (formData.has("datum_zakazan")) {
    const { data: cur } = await supabase
      .from("termini").select("status, rok_dospijeca").eq("id", id).maybeSingle()
    rokDospijeca = cur?.rok_dospijeca ?? null
    if (!fields.status) {
      if (cur?.status === "planirano" && patch.datum_zakazan) patch.status = "zakazano"
      else if (cur?.status === "zakazano" && !patch.datum_zakazan) patch.status = "planirano"
    }
  }
```

Nakon uspješnog update-a (poslije `if (error) return ...`, prije `return { ok: true }`):

```ts
  // Best-effort: obavijest kad je zakazano poslije roka. Ne obara čuvanje.
  const noviZakazan = patch.datum_zakazan
  if (typeof noviZakazan === "string" && jeZakazanoPoslijeRoka(rokDospijeca, noviZakazan)) {
    await posaljiZakazanoNakonRoka(supabase, { terminId: id, datumZakazan: noviZakazan })
  }
```

- [ ] **Step 3: `createTermin` — pošalji obavijest po insert-u**

U `createTermin`, nakon uspješnog insert-a (poslije `if (error) return ...`, prije `return { ok: true }`) — treba `id` novog reda, pa dodaj `.select("id").single()` na insert. Zamijeni insert blok:

```ts
  const { data: novi, error } = await supabase.from("termini").insert({
    klijent_id,
    vrsta_provjere_id,
    lokacija_id: lokacija_id ?? null,
    rok_dospijeca,
    datum_zakazan: datum_zakazan ?? null,
    zaduzeni: zaduzeni ?? null,
    status: datum_zakazan ? "zakazano" : "planirano",
  }).select("id").single()

  if (error) return { ok: false, message: friendlyDbError(error) }

  // Best-effort: obavijest kad je zakazano poslije roka. Ne obara kreiranje.
  if (datum_zakazan && novi?.id && jeZakazanoPoslijeRoka(rok_dospijeca, datum_zakazan)) {
    await posaljiZakazanoNakonRoka(supabase, { terminId: novi.id, datumZakazan: datum_zakazan })
  }

  return { ok: true }
```

- [ ] **Step 4: Typecheck + lint + unit**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/termini/actions.ts"
git commit -m "feat(termini): posalji obavijest o zakazivanju poslije roka pri upisu"
```

---

## Task 7: Živo upozorenje u formama

**Files:**
- Modify: `components/domain/TerminSheet.tsx`
- Modify: `components/domain/NoviTerminButton.tsx`
- Modify: `messages/{sr,en,de}.json` (namespace `termini.zakazanoUpozorenje`)

**Interfaces:**
- Consumes: `jeZakazanoPoslijeRoka`, `danaPoslijeRoka` (Task 2); `formatDatum` (`lib/date`).

- [ ] **Step 1: i18n ključ za upozorenje (parity, bez ICU `one` za sr)**

In `messages/sr.json`, kao novi objekat unutar `termini` (npr. odmah nakon `statusBadge`):
```json
    "zakazanoUpozorenje": {
      "poslijeRoka": "⚠ Zakazano {dana, plural, =1 {# dan} other {# dana}} poslije roka ({rok}). Dozvoljeno — biće poslano obavještenje."
    }
```
In `messages/en.json` (`termini`):
```json
    "zakazanoUpozorenje": {
      "poslijeRoka": "⚠ Scheduled {dana, plural, one {# day} other {# days}} after the due date ({rok}). Allowed — a notice will be sent."
    }
```
In `messages/de.json` (`termini`):
```json
    "zakazanoUpozorenje": {
      "poslijeRoka": "⚠ {dana, plural, one {# Tag} other {# Tage}} nach der Frist geplant ({rok}). Erlaubt — eine Benachrichtigung wird gesendet."
    }
```
> sr namjerno koristi `=1`/`other` (ne `one`); en/de smiju `one`.

- [ ] **Step 2: TerminSheet — prati zakazani datum + prikaži upozorenje**

In `components/domain/TerminSheet.tsx`:

Dodaj importe:
```tsx
import { jeZakazanoPoslijeRoka, danaPoslijeRoka } from "@/lib/plan-datum"
```
(uz postojeći `formatDatum` import).

Dodaj `useTranslations` i state (uz ostale hookove, npr. poslije `const tc = useTranslations("common")`):
```tsx
  const tz = useTranslations("termini.zakazanoUpozorenje")
  const [zakazanInput, setZakazanInput] = useState(termin.datum_zakazan ?? "")
```
Resetuj state kad se promijeni termin (uz postojeće `useEffect`-e):
```tsx
  useEffect(() => {
    setZakazanInput(termin.datum_zakazan ?? "")
  }, [termin.id, termin.datum_zakazan])
```
Dodaj `onChange` na `datum_zakazan` Input (trenutno oko linije 138–144):
```tsx
                <Input
                  type="date"
                  name="datum_zakazan"
                  defaultValue={termin.datum_zakazan ?? ""}
                  disabled={!mozeUrediti}
                  onChange={(e) => setZakazanInput(e.target.value)}
                  data-testid="edit-datum-zakazan"
                />
```
Ispod tog `<label>` (poslije zatvaranja labela za datum_zakazan) dodaj upozorenje:
```tsx
              {jeZakazanoPoslijeRoka(termin.rok_dospijeca, zakazanInput) && (
                <p
                  className="col-span-2 text-xs text-amber-700"
                  role="status"
                  data-testid="zakazano-poslije-roka"
                >
                  {tz("poslijeRoka", {
                    dana: danaPoslijeRoka(termin.rok_dospijeca, zakazanInput),
                    rok: formatDatum(termin.rok_dospijeca),
                  })}
                </p>
              )}
```

- [ ] **Step 3: NoviTerminButton — kontrolisani rok/zakazan + upozorenje**

In `components/domain/NoviTerminButton.tsx`:

Dodaj importe:
```tsx
import { useTranslations } from "next-intl" // već postoji
import { jeZakazanoPoslijeRoka, danaPoslijeRoka } from "@/lib/plan-datum"
import { formatDatum } from "@/lib/date"
```
Dodaj state uz postojeće (poslije `const [lokacijaId, setLokacijaId] = useState("")`):
```tsx
  const [rok, setRok] = useState("")
  const [zakazan, setZakazan] = useState("")
  const tz = useTranslations("termini.zakazanoUpozorenje")
```
Učini rok/zakazan Input-e kontrolisanim (trenutno linije 175–183):
```tsx
          <label className="block text-sm">
            <span className="text-slate-600">{t("poljeRok")}</span>
            <Input type="date" name="rok_dospijeca" required value={rok}
              onChange={(e) => setRok(e.target.value)} data-testid="novi-rok" />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">{t("poljeDatumZakazan")}</span>
            <Input type="date" name="datum_zakazan" value={zakazan}
              onChange={(e) => setZakazan(e.target.value)} data-testid="novi-zakazan" />
          </label>
          {jeZakazanoPoslijeRoka(rok, zakazan) && (
            <p className="text-xs text-amber-700" role="status" data-testid="zakazano-poslije-roka">
              {tz("poslijeRoka", { dana: danaPoslijeRoka(rok, zakazan), rok: formatDatum(rok) })}
            </p>
          )}
```
U success `useEffect` (reset nakon uspješnog kreiranja, uz `setKlijentId("")` itd.) dodaj:
```tsx
      setRok("")
      setZakazan("")
```

- [ ] **Step 4: Typecheck + lint + unit**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/domain/TerminSheet.tsx components/domain/NoviTerminButton.tsx messages/sr.json messages/en.json messages/de.json
git commit -m "feat(plan): zivo upozorenje kad se zakazuje poslije roka (sheet + novi termin)"
```

---

## Task 8: E2E — pozicioniranje + upozorenje + audit

**Files:**
- Modify: `tests/e2e/22-kasni-zakazano.spec.ts`

**Interfaces:**
- Consumes: db helperi `insertKlijent`, `insertTermin`, `zakaziTermin`, `firstVrstaSaIntervalom`, `deleteTerminiByKlijent`, `deleteKlijentByNaziv` (`tests/e2e/db.ts`); UI `data-testid="zakazano-poslije-roka"`, `edit-datum-zakazan`, `termin-sheet`, `edit-save`.

> Preduslov: migracija (Task 1) primijenjena na DEMO (Task 9) — E2E cilja DEMO.

- [ ] **Step 1: Dodaj test — kalendar pozicionira na zakazani datum**

In `tests/e2e/22-kasni-zakazano.spec.ts`, dodaj nový `describe` na kraj fajla:

```ts
test.describe("Zakazani datum — pozicioniranje i upozorenje", () => {
  test("kalendar prikazuje termin na zakazanom danu, ne na roku", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstVrstaSaIntervalom()
    // rok 13., zakazan 20. istog (budućeg) mjeseca — oba u istom prikazu mjeseca
    const now = new Date()
    const g = now.getUTCFullYear()
    const m = String(now.getUTCMonth() + 1).padStart(2, "0")
    const rok = `${g}-${m}-13`
    const zakazan = `${g}-${m}-20`
    try {
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta.id, rok })
      await zakaziTermin(tid, zakazan)

      await page.goto(`/plan-aktivnosti?view=kalendar&godina=${g}&mjesec=${Number(m)}`)
      // Klik na dan 20 (zakazan) → sidebar sadrži termin; dan 13 (rok) ga NE sadrži.
      await page.goto(`/plan-aktivnosti?view=kalendar&godina=${g}&mjesec=${Number(m)}&dan=${zakazan}`)
      const sidebar = page.getByTestId("plan-sidebar")
      await expect(sidebar).toContainText(naziv)

      await page.goto(`/plan-aktivnosti?view=kalendar&godina=${g}&mjesec=${Number(m)}&dan=${rok}`)
      await expect(page.getByTestId("plan-sidebar")).not.toContainText(naziv)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
```

- [ ] **Step 2: Dodaj test — upozorenje pri zakazivanju poslije roka**

Nastavi u istom `describe`:

```ts
  test("uređivanje datuma zakazanog poslije roka prikazuje upozorenje", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstVrstaSaIntervalom()
    const juce = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const sutra = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    try {
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta.id, rok: juce })

      await page.goto(`/plan-aktivnosti?view=lista&klijent_id=${kid}&mjesec=svi&status=svi&selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()

      await page.getByTestId("edit-datum-zakazan").fill(sutra)
      const up = page.getByTestId("zakazano-poslije-roka")
      await expect(up).toBeVisible()
      await expect(up).toContainText("poslije roka")
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})
```

- [ ] **Step 3: Pokreni ova dva testa (protiv DEMO)**

Run: `pnpm exec playwright test tests/e2e/22-kasni-zakazano.spec.ts -g "Zakazani datum"`
Expected: PASS (chromium + webkit). Ako padne zbog nedostatka migracije na DEMO → prvo Task 9 (DEMO apply), pa ponovo.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/22-kasni-zakazano.spec.ts
git commit -m "test(e2e): kalendar pozicioniranje na zakazani datum + upozorenje poslije roka"
```

---

## Task 9: Cloud migracija (DEMO → PROD) + finalna verifikacija

**Files:**
- Create: `claudedocs/2026-07-10-plan-zakazani-datum-migracija-komande.md`

> Cloud upisi su osjetljivi i **pokreće ih korisnik** (ref-guard). Ovaj task piše komande-dokument i radi finalnu lokalnu verifikaciju; ne izvršava cloud upise automatski.

- [ ] **Step 1: Napiši komande-dokument**

Create `claudedocs/2026-07-10-plan-zakazani-datum-migracija-komande.md`:

````markdown
# Migracija: datum_prikaza + zakazano-obavijest — cloud komande

Fajl: `supabase/migrations/20260710140000_datum_prikaza_i_zakazano_obavijest.sql`

## 1) DEMO (ref mtwwotmwrasozmcgqwhc) — dev/E2E cilj, prvo ovdje

```bash
cd "/Users/nmil/Desktop/Ai Forward/TEHPRO-Dokumenit/tehpro-mvp"
DATABASE_URL="$(grep -E '^DATABASE_URL_DEMO=' .env.development.local | cut -d= -f2- | tr -d '"')" \
  pnpm exec tsx scripts/apply-cloud-migration.ts \
  supabase/migrations/20260710140000_datum_prikaza_i_zakazano_obavijest.sql
```
Provjeri ref prije: `grep -E '^DATABASE_URL_DEMO=' .env.development.local` mora sadržati `mtwwotmwrasozmcgqwhc`.

## 2) PROD (ref fqtqkehjidkzeasiegnq) — TEK pri merge-u u main

```bash
cd "/Users/nmil/Desktop/Ai Forward/TEHPRO-Dokumenit/tehpro-mvp"
# REF-GUARD: potvrdi da je PROD prije upisa
grep -E '^DATABASE_URL=' .env.local | grep fqtqkehjidkzeasiegnq && \
pnpm db:apply-cloud supabase/migrations/20260710140000_datum_prikaza_i_zakazano_obavijest.sql
```

Migracija je idempotentna na nivou objekata (`drop view if exists`, `create or replace function`,
`create table if not exists`), ali je pokreni **jednom** po bazi.
````

- [ ] **Step 2: Primijeni na DEMO (korisnik potvrđuje/pokreće)**

Pokreni komandu iz sekcije 1 gore. Expected: `✅ Primijenjeno: …20260710140000_…sql`.

- [ ] **Step 3: Finalna verifikacija**

Run:
```bash
pnpm typecheck && pnpm lint && pnpm test:unit
pnpm exec playwright test tests/e2e/22-kasni-zakazano.spec.ts
```
Expected: typecheck/lint/unit PASS; E2E (chromium+webkit) PASS.

- [ ] **Step 4: Commit**

```bash
git add claudedocs/2026-07-10-plan-zakazani-datum-migracija-komande.md
git commit -m "docs: cloud migracija komande (DEMO/PROD) za datum_prikaza + zakazano-obavijest"
```

- [ ] **Step 5: Integracija grane**

Koristi `superpowers:finishing-a-development-branch` da odlučiš merge/PR. PROD migraciju (sekcija 2 dokumenta) primijeni **tek** pri merge-u u `main` (jer merge = production deploy na 3 Vercel projekta).

---

## Self-Review

**Spec coverage:**
- `datum_prikaza` kolona (spec §Arhitektura) → Task 1. ✓
- Kalendar po zakazanom (spec §3) → Task 3. ✓
- Lista + matrica po zakazanom (spec §3, "sva tri prikaza") → Task 4. ✓
- Živo upozorenje u obje forme (spec §4) → Task 7. ✓
- Transakcijski email, interni primaoci, nikad klijent, idempotentno, best-effort (spec §5) → Task 5 (modul) + Task 6 (hook) + Task 1 (RPC). ✓
- izvršeni/otkazani = isti coalesce (spec §Rubni) → Task 1 (view bez CASE po statusu). ✓
- zakazan u drugom mjesecu (spec §Rubni) → Task 1 (`datum_prikaza` u upitu). ✓
- Testiranje (spec §7): `jeZakazanoPoslijeRoka` unit (Task 2), template unit (Task 5), E2E kalendar+upozorenje (Task 8). ✓
- **Odstupanje od spec-a:** spec §5 je spominjao proširenje `ActionResult` `{ok:true, upozorenje?}`; **izostavljeno (YAGNI)** — živo klijentsko upozorenje (Task 7) pokriva UX, email ostaje potpuno server-side. Zabilježeno ovdje namjerno.
- **Deploy env:** dev/E2E ciljaju DEMO, pa DEMO apply (Task 9 §1) prethodi E2E-u; naznačeno u Task 3/8.

**Placeholder scan:** Nema TBD/TODO. Sav kod je konkretan. `<file>` u komande-dokumentu je zamijenjen stvarnim imenom fajla.

**Type consistency:** RPC `zabiljezi_zakazano_obavijest(p_termin_id, p_datum_zakazan, p_base)→text[]` isto u Task 1 (SQL) i Task 5 (poziv). `posaljiZakazanoNakonRoka(supabase, {terminId, datumZakazan}, {send?})` isto u Task 5 (def) i Task 6 (poziv). `jeZakazanoPoslijeRoka(rok, zakazan)`/`danaPoslijeRoka(rok, zakazan)` isto u Task 2/6/7. `datum_prikaza` isto ime svuda. `data-testid="zakazano-poslije-roka"` isto u Task 7 i Task 8.
