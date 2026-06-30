# Način izvršenja aktivnosti (TEHPRO izvršava / Samo praćenje)

**Datum:** 2026-06-30
**Status:** odobren dizajn → slijedi plan
**Kontekst:** Zahtjev §4.1 iz `../Povratne informacije i funkcionalni zahtjevi za aplikaciju.docx`: „Za svaku aktivnost potrebno je definisati da li uslugu izvršava TEHPRO ili se vodi samo evidencija i praćenje roka." Iz briefa: centralni plan se prvenstveno tiče aktivnosti koje TEHPRO izvršava; aktivnosti „samo praćenje" se i dalje prate zbog rokova (radnik svejedno obavještava klijenta), ali treba biti jasno označeno o čemu se radi.

## Obim
- Novo polje **`nacin_izvrsenja`** (`izvrsava` | `pracenje`, default `izvrsava`) na profilu usluge (`klijent_provjere`) i na svakoj aktivnosti (`termini`), s propagacijom kroz auto-ciklus.
- Unos pri kreiranju profila provjere (UI + server action).
- Centralni plan: **sve aktivnosti ostaju vidljive** (nema skrivanja), uz vizuelnu **oznaku „Samo praćenje"** i novi **filter „Način"** (Svi / Izvršava / Samo praćenje, default Svi).
- Izvoz (Excel/PDF): nova kolona **„Način"** + poštovanje „Način" filtera.

## Van obima (zaseban posao)
Statusi §10; generisanje izvještaja §7.1; obuke+polaznici §3.2; nulti izvještaj §2.1; Outlook/.ics; mobilna verzija. Podsjetnici se **ne mijenjaju** — i dalje šalju za oba načina.

## Postojeće stanje (potvrđeno)
- `klijent_provjere` (`supabase/migrations/20260623160000_klijent_provjere.sql`): kolone `id, klijent_id, vrsta_provjere_id, lokacija_id, interval_mjeseci, zadnji_datum, aktivan, created_at`. RLS off (app koristi anon).
- `termini` (`supabase/migrations/20260620200651_termini.sql`): centralni entitet; `termini_view` = `select t.*, <status_izvedeni>` (t.* je **pozicijski razvijen** pri kreiranju view-a → dodavanje kolone NE pojavljuje se automatski; view se mora ponovo kreirati).
- `tg_termini_auto_cycle` (`supabase/migrations/20260620201630_triggers.sql`): na izvršenju umeće sljedeći termin kopirajući `klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci`. **Mora dodatno kopirati `nacin_izvrsenja`.**
- `createProfilProvjere` (`app/(dashboard)/klijenti/actions.ts:212`) upisuje `klijent_provjere` + generiše prvi `termin`.
- Plan: `app/api/plan-aktivnosti/{lista,izvoz}/route.ts` dijele `lib/plan-filteri.ts` (`parsePlanFilteri` + `mjesecRange`); `components/domain/TerminiFilters.tsx` (filter UI); `lib/termini-filters.ts` (opcije); `app/(dashboard)/plan-aktivnosti/_views/lista.tsx` (tabela); `lib/plan-izvoz/{xlsx,pdf}.ts` (+ `types.ts` `PlanRed`/`PLAN_KOLONE`).
- `lib/termini.ts`: `STATUS_LABEL`, `toDerivedStatus`, badge mape.

## Rješenje

### 1. Migracija — `supabase/migrations/20260630120000_nacin_izvrsenja.sql`
```sql
-- create type nije idempotentan → guard (cloud single-apply se može ponoviti)
do $$ begin
  create type nacin_izvrsenja_tip as enum ('izvrsava', 'pracenje');
exception when duplicate_object then null;
end $$;

alter table klijent_provjere
  add column if not exists nacin_izvrsenja nacin_izvrsenja_tip not null default 'izvrsava';
alter table termini
  add column if not exists nacin_izvrsenja nacin_izvrsenja_tip not null default 'izvrsava';

-- auto_cycle: kopiraj nacin_izvrsenja na sljedeći termin
create or replace function tg_termini_auto_cycle() returns trigger as $$
begin
  if OLD.datum_izvrsenja is null
     and NEW.datum_izvrsenja is not null
     and NEW.status = 'izvrseno' then
    insert into termini (
      klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
      datum_zadnjeg, rok_dospijeca, status, nacin_izvrsenja
    )
    values (
      NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
      NEW.datum_izvrsenja, NEW.datum_izvrsenja, 'planirano', NEW.nacin_izvrsenja
    );
  end if;
  return NEW;
end;
$$ language plpgsql;

-- termini_view se mora ponovo kreirati (t.* je pozicijski) da izloži novu kolonu.
-- VAŽNO: rekreira se OBOGAĆENA verzija iz 20260620214413_termini_read_model.sql
-- (join nazivi), NE bazna iz 20260620200651 — t.* sada uključuje nacin_izvrsenja.
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
  k.naziv as klijent_naziv,
  l.naziv as lokacija_naziv,
  l.grad  as lokacija_grad,
  v.naziv as vrsta_naziv
from termini t
left join klijenti k       on k.id = t.klijent_id
left join lokacije l       on l.id = t.lokacija_id
left join vrste_provjera v on v.id = t.vrsta_provjere_id;
```
- Enum naziv: `nacin_izvrsenja_tip`; vrijednosti `izvrsava` / `pracenje`. Default `izvrsava` → postojeći podaci se ponašaju kao do sad.
- Re-run sigurno: `add column if not exists`, `create or replace function`, `drop view if exists` + create.
- **Rollout:** primijeniti na CLOUD prije merge-a (`pnpm db:apply-cloud supabase/migrations/20260630120000_nacin_izvrsenja.sql`) — kod čita novu kolonu (pravilo I1). Zatim `pnpm db:types`.

### 2. Server action + UI unosa
- `createProfilProvjere` (`app/(dashboard)/klijenti/actions.ts`): pročitaj `nacin_izvrsenja` iz `formData` (`"izvrsava"` default; validacija: mora biti `izvrsava`|`pracenje`); upiši u `klijent_provjere.insert({...})` i u generisani `termini.insert({...})`.
- `DodajProvjeruButton` (komponenta koja renderuje formu za `createProfilProvjere`): dodaj izbor **„Način izvršenja"** — radio/select s opcijama „TEHPRO izvršava" (`izvrsava`, default) i „Samo praćenje roka" (`pracenje`).

### 3. Filter „Način" (dijeljen lista↔izvoz)
- `lib/plan-filteri.ts` — `PlanFilteri` ima `{status, q, klijentId, lokacijaId, vrstaId, mjesec, godina}`. Dodaj `nacin: string` (default `"svi"`). U `parsePlanFilteri`: `const n = sp.get("nacin"); nacin: n === "izvrsava" || n === "pracenje" ? n : "svi"` (nepoznato → `"svi"`).
- Primjena: u `app/api/plan-aktivnosti/lista/route.ts` i `app/api/plan-aktivnosti/izvoz/route.ts` (oba grade query nad `termini_view` koristeći `parsePlanFilteri`+`mjesecRange`), nakon postojećih `.eq` filtera dodaj: `if (f.nacin !== "svi") query = query.eq("nacin_izvrsenja", f.nacin)`. (Nema zajedničkog `apply` helpera — primjena je inline u obje rute; držati identično.)
- `components/domain/TerminiFilters.tsx`: dodaj select **„Način"** (Svi / Izvršava / Samo praćenje) koji postavlja `nacin` search param (isti obrazac kao postojeći filteri).

### 4. Oznaka u listi
- Tabela je `components/domain/TerminiTable.tsx` (`type TerminRow = Database["public"]["Views"]["termini_view"]["Row"]` → nakon `db:types` automatski nosi `nacin_izvrsenja`). U redu, pored `vrsta_naziv` (kolona „Usluga", `td` na ~liniji 71), prikaži diskretan **badge „Samo praćenje"** kad `r.nacin_izvrsenja === "pracenje"` (npr. mali `secondary`/outline span uz naziv usluge — bez nove kolone, da se ne lomi širina tabele). `lista.tsx` i `getTerminiLista` ne treba mijenjati (red dolazi kao `TerminRow` iz `termini_view`).

### 5. Izvoz — kolona „Način"
- `lib/plan-izvoz/types.ts`: `PlanRed` + `nacin: string` („Izvršava" | „Praćenje"); `PLAN_KOLONE` + `"Način"`.
- `lib/plan-izvoz/xlsx.ts`: dodaj ćeliju + širinu kolone.
- `lib/plan-izvoz/pdf.ts`: dodaj kolonu u `KOLONE` i preraspodijeli širine (zbir ≈ 782 za A4 landscape, margin 30, W=842) tako da nova kolona stane (npr. suziti Klijent/Usluga/Odgovorna).
- `izvoz` ruta mapira `nacin_izvrsenja` reda → labela „Izvršava"/„Praćenje" u `PlanRed`.

### 6. Podsjetnici — bez izmjena
Engine šalje za oba načina (radnik obavještava klijenta i za „praćenje"). Nema promjena u `lib/reminders/`.

## Tok podataka
```
Kreiranje profila → klijent_provjere.nacin_izvrsenja + prvi termin.nacin_izvrsenja
Izvršenje termina → auto_cycle kopira nacin_izvrsenja na sljedeći termin
Plan (lista/izvoz) → termini_view.nacin_izvrsenja → filter „Način" + badge/kolona
```

## Testiranje
- **Unit:** `parsePlanFilteri` (default `nacin="svi"`, validacija nepoznate vrijednosti); `planToXlsx`/`planToPdf` s novom kolonom „Način" (re-parse Excel header sadrži „Način"; PDF i dalje `%PDF-` i ne baca).
- **Integracioni (gated `TEST_DATABASE_URL`):** auto_cycle propagira `nacin_izvrsenja` (umetni termin `pracenje` → izvrši → sljedeći termin je `pracenje`); `termini_view` izlaže `nacin_izvrsenja`.
- **Lint/typecheck/suite** zeleni; `pnpm build` prolazi. `pnpm db:types` regenerisan.
- **Ručno (lokalno):** dodaj profil „Samo praćenje" → plan pokazuje badge; filter „Način=Izvršava" sakriva ga; izvoz Excel/PDF sadrži kolonu „Način".

## Kriterijumi prihvatanja
- [ ] `nacin_izvrsenja` postoji na `klijent_provjere` i `termini` (enum, default `izvrsava`); `termini_view` ga izlaže.
- [ ] Forma za profil provjere nudi „TEHPRO izvršava" / „Samo praćenje"; vrijednost se upisuje u profil i prvi termin.
- [ ] auto_cycle kopira `nacin_izvrsenja` na sljedeći termin u ciklusu.
- [ ] Centralni plan prikazuje sve aktivnosti; „samo praćenje" ima jasnu oznaku.
- [ ] Filter „Način" (Svi/Izvršava/Samo praćenje) radi u listi i poštuje ga izvoz; default Svi.
- [ ] Excel i PDF izvoz imaju kolonu „Način".
- [ ] Podsjetnici nepromijenjeni (rade za oba načina).
- [ ] Migracija primijenjena na cloud prije merge-a; `db:types` regenerisan; lint/typecheck/test/build zeleni.

## Rizici / napomene
- `termini_view` se **mora dropati i ponovo kreirati** (ne `create or replace`) jer `t.*` mijenja redoslijed kolona — `create or replace view` bi pao. Provjeriti da nema zavisnih view-ova (drop bi pao ako ima; trenutno je top read-model).
- Postojeći redovi dobijaju default `izvrsava` → plan ostaje nepromijenjen za zatečene podatke.
- PDF kolona „Način" sužava ostale; držati labele kratke („Izvršava"/„Praćenje").
