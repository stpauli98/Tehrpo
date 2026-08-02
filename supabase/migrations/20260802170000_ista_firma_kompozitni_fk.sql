-- supabase/migrations/20260802170000_ista_firma_kompozitni_fk.sql
--
-- NALAZ C2 — operater može zakačiti lokaciju/ugovor/termin TUĐE firme na svoj zapis.
--
-- Jednokolonski strani ključevi (npr. termini_lokacija_id_fkey) provjeravaju samo da
-- lokacija POSTOJI, ne i da pripada istoj firmi kao red koji je kači. Operater koji ima
-- pravo pisanja nad firmom B mogao je svom terminu podmetnuti `lokacija_id` lokacije
-- firme A: RLS to ne hvata (RLS gleda `klijent_id` reda, a on je ispravno B), pa se
-- tuđi podaci vežu za njegov zapis, a pravom vlasniku (firma A) se zaključa brisanje
-- te lokacije jer je „još referencirana".
--
-- Popravka: svaka tabela koja nosi `klijent_id` I referencu na entitet koji pripada
-- klijentu dobija SLOŽENI strani ključ (<kolona>, klijent_id) → roditelj (id, klijent_id).
-- Baza tada sama odbija svaku vezu preko granice firme. Isti obrazac je već primijenjen
-- na `kontakt_osobe` (fk_kontakt_lokacija_ista_firma, 20260728140000).
--
-- Pokrivene rupe (sve nađene pregledom ŽIVE šeme, ne samo lokacije):
--   termini.lokacija_id          → lokacije
--   termini.nastao_iz_id         → termini   (samoreferenca: ciklus se ne smije „naslijediti" od tuđe firme)
--   klijent_provjere.lokacija_id → lokacije
--   klijent_provjere.ugovor_id   → ugovori
--   dokumenti.termin_id          → termini
--   dokumenti.ugovor_id          → ugovori
--   mejl_log.termin_id           → termini
--
-- ─── Zašto je napisano kao DO petlja, a ne kao ravan niz ALTER-a ───────────────
-- 1) OČUVANJE `ON DELETE` PONAŠANJA. Zamjena ključa mora zadržati tačno onu delete
--    akciju koju taj ključ VEĆ ima u toj bazi. To nije kozmetika: DEMO i PROD imaju
--    `klijent_provjere_lokacija_id_fkey` kao ON DELETE SET NULL, dok ga migracija
--    20260703102000 definiše kao ON DELETE RESTRICT — dakle šeme se razlikuju (drift
--    koji nije predmet ovog nalaza — uzrok je poznat i zapisan u zaglavlju migracije
--    20260801190000: migracije 20260703102000 i 20260703103000 nikad nisu puštene na
--    cloud). Petlja pročita zatečeni `confdeltype` i sagradi novi ključ sa istom
--    akcijom, pa nijedna baza ne mijenja ponašanje pri brisanju.
-- 2) SET NULL MORA IMATI LISTU KOLONA. Na složenom ključu `on delete set null` BEZ
--    liste nulira SVE kolone ključa — dakle i `klijent_id`, koji je NOT NULL. Tačno taj
--    bug je već jednom popravljen (20260730123000), pa se ovdje uvijek generiše
--    `on delete set null (<kolona>)` (PG 15+; DEMO i PROD su na PG 17).
--
-- ─── Zašto se STARI ključ briše, a ne ostavlja pored novog ─────────────────────
-- Dvije veze između istog para tabela učinile bi PostgREST embed dvosmislenim
-- („more than one relationship found"), a `klijent_provjere → lokacije` se embeduje
-- u app/(dashboard)/klijenti/[id]/page.tsx. Novi ključ zato NASLJEĐUJE IME starog:
-- db/types.ts (generisan) i svaki `foreignKeyName` u njemu ostaju tačni, nema
-- preimenovanja koje bi tražilo regeneraciju tipova.
--
-- ─── Zatečeni podaci ───────────────────────────────────────────────────────────
-- Provjereno na DEMO i PROD prije pisanja: 0 redova krši ijedno od ovih pravila
-- (svih 7 provjera vraća 0), pa sanacija podataka nije potrebna i ALTER ne pada.
--
-- Idempotentno / re-run-safe: složeni ključ se prepoznaje po broju kolona (`conkey`),
-- pa ponovno pokretanje migracije ne dira ništa.

-- ─── 1) Roditelji: složeni jedinstveni ključ, cilj novih stranih ključeva ──────
-- `lokacije` ga već ima (uq_lokacije_id_klijent). `id` je primarni ključ, pa je par
-- (id, klijent_id) trivijalno jedinstven — ograničenje ne može pasti na podacima.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'uq_ugovori_id_klijent' and conrelid = 'public.ugovori'::regclass
  ) then
    alter table public.ugovori add constraint uq_ugovori_id_klijent unique (id, klijent_id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'uq_termini_id_klijent' and conrelid = 'public.termini'::regclass
  ) then
    alter table public.termini add constraint uq_termini_id_klijent unique (id, klijent_id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'uq_lokacije_id_klijent' and conrelid = 'public.lokacije'::regclass
  ) then
    alter table public.lokacije add constraint uq_lokacije_id_klijent unique (id, klijent_id);
  end if;
end $$;

-- ─── 2) Jednokolonski FK → složeni FK, uz očuvanu delete akciju ───────────────
do $$
declare
  r            record;
  v_akcija     "char";
  v_klauzula   text;
begin
  for r in
    select *
      from (values
        -- dijete,            kolona,         roditelj,   naziv ključa (zadržava se),           rezervna akcija
        ('termini',          'lokacija_id',  'lokacije', 'termini_lokacija_id_fkey',          'n'::"char"),
        ('termini',          'nastao_iz_id', 'termini',  'termini_nastao_iz_id_fkey',         'n'::"char"),
        ('klijent_provjere', 'lokacija_id',  'lokacije', 'klijent_provjere_lokacija_id_fkey', 'n'::"char"),
        ('klijent_provjere', 'ugovor_id',    'ugovori',  'klijent_provjere_ugovor_id_fkey',   'n'::"char"),
        ('dokumenti',        'termin_id',    'termini',  'dokumenti_termin_id_fkey',          'c'::"char"),
        ('dokumenti',        'ugovor_id',    'ugovori',  'dokumenti_ugovor_id_fkey',          'n'::"char"),
        ('mejl_log',         'termin_id',    'termini',  'mejl_log_termin_id_fkey',           'n'::"char")
      ) as t(dijete, kolona, roditelj, fk, rezervna_akcija)
  loop
    -- Već složen (2 kolone) → migracija je već odrađena na ovoj bazi.
    continue when exists (
      select 1 from pg_constraint
       where conname = r.fk
         and conrelid = ('public.' || r.dijete)::regclass
         and contype = 'f'
         and array_length(conkey, 1) = 2
    );

    -- Zatečena delete akcija se preuzima; ako ključa nema (djelimično odrađen run),
    -- pada se na rezervnu vrijednost koja odgovara zatečenom stanju DEMO/PROD baza.
    select confdeltype into v_akcija
      from pg_constraint
     where conname = r.fk
       and conrelid = ('public.' || r.dijete)::regclass
       and contype = 'f';
    if v_akcija is null then
      v_akcija := r.rezervna_akcija;
    end if;

    v_klauzula := case v_akcija
      when 'c' then ' on delete cascade'
      when 'r' then ' on delete restrict'
      -- lista kolona je OBAVEZNA: bez nje bi se nulirao i klijent_id (NOT NULL)
      when 'n' then format(' on delete set null (%I)', r.kolona)
      when 'd' then format(' on delete set default (%I)', r.kolona)
      else ''            -- 'a' = NO ACTION
    end;

    execute format('alter table public.%I drop constraint if exists %I', r.dijete, r.fk);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I, klijent_id) '
      || 'references public.%I (id, klijent_id)%s',
      r.dijete, r.fk, r.kolona, r.roditelj, v_klauzula
    );

    raise notice 'C2: % (%, klijent_id) → % (id, klijent_id)%', r.dijete, r.kolona, r.roditelj, v_klauzula;
  end loop;
end $$;

-- ─── 3) Indeksi koji prate nove ključeve ──────────────────────────────────────
-- Brisanje roditelja mora naći redove djeteta po OBJE kolone ključa. Tamo gdje ni
-- vodeća kolona nije bila indeksirana (klijent_provjere.lokacija_id, mejl_log.termin_id)
-- to je do sada bio sekvencijalni prolaz; ovdje se to usput popravlja.
create index if not exists idx_klijent_provjere_lokacija
  on public.klijent_provjere (lokacija_id, klijent_id);
create index if not exists idx_mejl_log_termin
  on public.mejl_log (termin_id, klijent_id);

comment on constraint termini_lokacija_id_fkey on public.termini is
  'Složen FK (lokacija_id, klijent_id) → lokacije (id, klijent_id): termin ne može nositi lokaciju druge firme (nalaz C2).';
comment on constraint dokumenti_termin_id_fkey on public.dokumenti is
  'Složen FK (termin_id, klijent_id) → termini (id, klijent_id): dokument ne može biti vezan za termin druge firme (nalaz C2).';

-- Evidenciju u `primijenjene_migracije` upisuje scripts/apply-cloud-migration.ts
-- (računa kontrolnu sumu fajla), pa je migracija ovdje namjerno NE dira.
