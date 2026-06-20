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
