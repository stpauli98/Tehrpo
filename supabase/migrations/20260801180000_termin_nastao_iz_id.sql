-- N04 — ispravka pogrešno unesenog datuma izvršenja mora stići i do već napravljenog djeteta.
--
-- Kvar (do ove migracije):
--   tg_termini_auto_cycle po zatvaranju termina ubaci sljedeći ciklus sa
--   datum_zadnjeg = datum_izvrsenja roditelja, a tg_termini_compute_rok iz toga izračuna
--   rok_dospijeca. Ako je datum izvršenja unesen pogrešno (tipfeler 07.05. umjesto 05.07.),
--   dijete naslijedi POGREŠAN rok. Kad se roditelj naknadno ispravi, auto-ciklus se
--   NAMJERNO ne okida (grana traži OLD.datum_izvrsenja is null, migracija
--   20260620222606) — pa dijete zauvijek nosi rok izračunat iz pogrešnog datuma.
--   Kroz UI se to ne može popraviti: forma djeteta ne nudi izmjenu roka ni datuma zadnjeg.
--   Zatečeno stanje u trenutku pisanja: DEMO 18 od 38 otvorenih termina su takva djeca,
--   PROD 5 od 16.
--
-- Popravka ima tri dijela:
--   (1) EKSPLICITNA VEZA termini.nastao_iz_id → termini.id. Do sada dijete nije imalo
--       nikakvu referencu na roditelja, pa se moralo pogađati heuristikom
--       (ista trojka klijent/lokacija/vrsta + datum_zadnjeg = stari datum izvršenja).
--       Heuristika NIJE pouzdana sama za sebe: ako za istu trojku postoje dva otvorena
--       termina sa istim datum_zadnjeg (upravo stanje koje je opisano u nalazu o
--       paralelnim ciklusima), ona ne zna koji je čiji. Zato je veza sada zapisana.
--   (2) AFTER UPDATE trigger `korekcija_datuma_izvrsenja` koji hvata granu koju
--       auto_cycle ne pokriva (OLD.datum_izvrsenja is not null) i pomjeri datum_zadnjeg
--       djeteta; rok preračunava postojeći tg_termini_compute_rok.
--   (3) JEDNOKRATAN BACKFILL veze za već postojeća djeca, i to samo tamo gdje je
--       roditelj JEDNOZNAČAN (tačno jedan kandidat). Dvosmisleni slučajevi se svjesno
--       preskaču — bolje bez veze nego sa pogrešnom.
--
-- Zašto se dijete traži i heuristikom (fallback u koraku 2):
--   redovi nastali PRIJE ove migracije koje backfill nije uspio jednoznačno vezati i
--   dalje nemaju nastao_iz_id. Za njih trigger pokušava heuristiku, ali SAMO ako ima
--   TAČNO JEDAN kandidat; kod dva i više ne dira ništa. Kandidat mora biti otvoren,
--   neizvršen, iste trojke i sa datum_zadnjeg jednakim STAROM datumu izvršenja
--   roditelja — dakle red koji je i po podacima nastavak baš tog ciklusa.
--
-- Nema rekurzije: trigger mijenja isključivo redove sa datum_izvrsenja IS NULL, a
-- njegov vlastiti uslov traži OLD.datum_izvrsenja IS NOT NULL. Ugniježđeni UPDATE zato
-- ne može ponovo okinuti ni ovaj trigger ni tg_termini_auto_cycle (kojem treba
-- NEW.datum_izvrsenja IS NOT NULL). Dubina je ograničena i dodatnom tvrdom kapijom
-- pg_trigger_depth().
--
-- Idempotentno / re-run safe.

-- ═══ (0) Preduslov ═════════════════════════════════════════════════════════
-- Ova migracija prepisuje tijelo tg_termini_auto_cycle i u njemu čita NEW.ponavlja_se
-- (kolona stiže iz 20260801100300_termini_ponavlja_se.sql). Migracije se na cloud
-- puštaju RUČNO, jedna po jedna, pa preskok nije nemoguć — a da se dogodio, svaki
-- INSERT u termini bi pucao tek u radu. Zato ovdje pada odmah i glasno.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'termini' and column_name = 'ponavlja_se'
  ) then
    raise exception
      'N04 trazi da je prije nje primijenjena 20260801100300_termini_ponavlja_se (nema kolone termini.ponavlja_se)';
  end if;
end;
$$;

-- ═══ (1) Eksplicitna veza dijete → roditelj ═════════════════════════════════
alter table termini add column if not exists nastao_iz_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'termini_nastao_iz_id_fkey' and conrelid = 'public.termini'::regclass
  ) then
    alter table termini
      add constraint termini_nastao_iz_id_fkey
      foreign key (nastao_iz_id) references termini(id) on delete set null;
  end if;
end;
$$;

create index if not exists idx_termini_nastao_iz on termini (nastao_iz_id)
  where nastao_iz_id is not null;

comment on column termini.nastao_iz_id is
  'Termin iz kojeg je ovaj nastao auto-ciklusom (roditelj). NULL = unesen ručno ili veza nije poznata (stari redovi).';

-- ═══ (2a) auto_cycle upisuje vezu pri stvaranju djeteta ═════════════════════
-- Tijelo je DOSLOVNO prekopirano iz zadnje aktivne verzije
-- (20260801100300_termini_ponavlja_se.sql) — TG_OP prekidač, uslov NEW.ponavlja_se u
-- obje grane, interval-gate i prenos nacin_izvrsenja/ponavlja_se — a dodata je samo
-- kolona nastao_iz_id u INSERT.
-- PAŽNJA za buduće izmjene: svako sljedeće `create or replace function
-- tg_termini_auto_cycle()` MORA zadržati `nastao_iz_id` u listi kolona, inače nova
-- djeca ostaju bez veze i korekcija datuma pada nazad na heuristiku.
create or replace function tg_termini_auto_cycle() returns trigger
language plpgsql as $$
declare
  v_interval int;
begin
  if (
    (TG_OP = 'INSERT'
      and NEW.ponavlja_se
      and NEW.datum_izvrsenja is not null
      and NEW.status = 'izvrseno')
    or
    (TG_OP = 'UPDATE'
      and NEW.ponavlja_se
      and OLD.datum_izvrsenja is null
      and NEW.datum_izvrsenja is not null
      and NEW.status = 'izvrseno'
      and OLD.status is distinct from 'izvrseno')
  ) then
    v_interval := coalesce(
      NEW.interval_mjeseci,
      (select podrazumevani_interval_mjeseci from vrste_provjera where id = NEW.vrsta_provjere_id)
    );
    if v_interval is not null then
      insert into termini (
        klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
        datum_zadnjeg, rok_dospijeca, status, nacin_izvrsenja, ponavlja_se,
        nastao_iz_id
      )
      values (
        NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
        NEW.datum_izvrsenja,
        NEW.datum_izvrsenja, -- placeholder; tg_compute_rok prepisuje
        'planirano',
        NEW.nacin_izvrsenja,
        NEW.ponavlja_se,
        NEW.id
      );
    end if;
  end if;
  return NEW;
end;
$$;

-- ═══ (2b) Korekcija datuma izvršenja se propagira u otvoreno dijete ═════════
create or replace function tg_termini_korekcija_datuma() returns trigger
language plpgsql as $$
declare
  v_pogodjeno int;
  v_dijete    uuid;
  v_kandidata int;
begin
  -- Tvrda kapija protiv ulančavanja. Struktura je već dokazano bez ciklusa (mijenjaju se
  -- samo redovi sa datum_izvrsenja IS NULL), ovo je osigurač za buduće trigere.
  if pg_trigger_depth() > 3 then
    return NEW;
  end if;

  -- Zanima nas ISKLJUČIVO ispravka datuma na već izvršenom terminu. Prvo zatvaranje
  -- (OLD.datum_izvrsenja is null) je posao tg_termini_auto_cycle i ovdje se ne dira.
  if TG_OP <> 'UPDATE'
     or OLD.datum_izvrsenja is null
     or NEW.datum_izvrsenja is null
     or NEW.datum_izvrsenja = OLD.datum_izvrsenja
     or NEW.status is distinct from 'izvrseno' then
    return NEW;
  end if;

  -- Glavni put: dijete je poznato po eksplicitnoj vezi.
  update termini d
  set datum_zadnjeg = NEW.datum_izvrsenja
  where d.nastao_iz_id = NEW.id
    and d.id <> NEW.id                       -- zaštita od samoreference u podacima
    and d.klijent_id = NEW.klijent_id         -- veza ne smije preći granicu firme
    and d.status in ('planirano', 'zakazano')
    and d.datum_izvrsenja is null
    and d.datum_zadnjeg is not distinct from OLD.datum_izvrsenja;
  get diagnostics v_pogodjeno = row_count;

  if v_pogodjeno > 0 then
    return NEW;
  end if;

  -- Fallback za stare redove bez veze: samo ako je kandidat JEDNOZNAČAN.
  -- (array_agg(...))[1] umjesto min(): PG nema min(uuid).
  select count(*), (array_agg(d.id))[1] into v_kandidata, v_dijete
  from termini d
  where d.nastao_iz_id is null
    and d.id <> NEW.id
    and d.klijent_id = NEW.klijent_id
    and d.vrsta_provjere_id = NEW.vrsta_provjere_id
    and d.lokacija_id is not distinct from NEW.lokacija_id
    and d.status in ('planirano', 'zakazano')
    and d.datum_izvrsenja is null
    and d.datum_zadnjeg = OLD.datum_izvrsenja;

  if v_kandidata = 1 then
    update termini
    set datum_zadnjeg = NEW.datum_izvrsenja,
        nastao_iz_id  = NEW.id
    where id = v_dijete;
  elsif v_kandidata > 1 then
    raise notice
      'korekcija datuma: % otvorenih kandidata bez veze za termin % — nijedan nije diran',
      v_kandidata, NEW.id;
  end if;

  return NEW;
end;
$$;

comment on function tg_termini_korekcija_datuma() is
  'N04: ispravka datum_izvrsenja na već izvršenom terminu pomjera datum_zadnjeg otvorenog '
  'djeteta (nastao_iz_id), pa tg_termini_compute_rok preračuna rok_dospijeca.';

drop trigger if exists korekcija_datuma_izvrsenja on termini;
create trigger korekcija_datuma_izvrsenja
  after update on termini
  for each row execute function tg_termini_korekcija_datuma();

-- ═══ (3) Backfill veze za zatečena djeca ════════════════════════════════════
-- Vezuje se SAMO kad je roditelj jednoznačan: ista trojka (klijent, lokacija, vrsta),
-- roditelj izvršen, roditeljev datum_izvrsenja = djetetov datum_zadnjeg, roditelj
-- napravljen prije djeteta. Dvosmislene grupe (2+ kandidata) ostaju NULL.
-- tg_termini_compute_rok se za vrijeme backfilla gasi da upis veze ne bi kao bočni
-- efekat pomjerio rok_dospijeca (isti kvar koji sanira 20260801150500). Audit trigger
-- ostaje uključen — trag o izmjeni je poželjan.
do $$
declare
  v_bilo_ukljuceno boolean := false;
  v_vezano int;
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.termini'::regclass
      and tgname = 'tg_termini_compute_rok_biud'
      and tgenabled <> 'D'
  ) then
    v_bilo_ukljuceno := true;
    execute 'alter table public.termini disable trigger tg_termini_compute_rok_biud';
  end if;

  with kandidati as (
    select d.id as dijete_id,
           p.id as roditelj_id,
           count(*) over (partition by d.id) as broj
    from termini d
    join termini p
      on p.id <> d.id
     and p.klijent_id = d.klijent_id
     and p.vrsta_provjere_id = d.vrsta_provjere_id
     and p.lokacija_id is not distinct from d.lokacija_id
     and p.status = 'izvrseno'
     and p.datum_izvrsenja = d.datum_zadnjeg
     and p.created_at <= d.created_at
    where d.nastao_iz_id is null
      and d.datum_zadnjeg is not null
  )
  update termini t
  set nastao_iz_id = k.roditelj_id
  from kandidati k
  where t.id = k.dijete_id
    and k.broj = 1;
  get diagnostics v_vezano = row_count;

  if v_bilo_ukljuceno then
    execute 'alter table public.termini enable trigger tg_termini_compute_rok_biud';
  end if;

  raise notice 'N04 backfill: povezano % djece sa roditeljem', v_vezano;
end;
$$;
