-- Vlasništvo zapisa (2026-07-30): ko je unio red.
-- Potrebno za potvrđenu dozvolu "operater briše SVOJE unose" vs "TUĐE unose" (20260730151000).
-- Nullable je namjerno: service-role putevi (cron, seed, import) nemaju auth.uid(), a stari
-- redovi bez audit traga ostaju null → tretiraju se kao "nije moje" (restriktivnije).
-- Re-run safe.

alter table klijenti  add column if not exists kreirao_id uuid references korisnici(id) on delete set null;
alter table lokacije  add column if not exists kreirao_id uuid references korisnici(id) on delete set null;
alter table ugovori   add column if not exists kreirao_id uuid references korisnici(id) on delete set null;
alter table termini   add column if not exists kreirao_id uuid references korisnici(id) on delete set null;
alter table dokumenti add column if not exists kreirao_id uuid references korisnici(id) on delete set null;

create index if not exists idx_klijenti_kreirao  on klijenti  (kreirao_id);
create index if not exists idx_lokacije_kreirao  on lokacije  (kreirao_id);
create index if not exists idx_ugovori_kreirao   on ugovori   (kreirao_id);
create index if not exists idx_termini_kreirao   on termini   (kreirao_id);
create index if not exists idx_dokumenti_kreirao on dokumenti (kreirao_id);

-- security definer: čita korisnici (RLS self-select) da FK ne padne za nepostojeći profil.
create or replace function tg_postavi_kreirao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.kreirao_id is null and auth.uid() is not null
     and exists (select 1 from korisnici k where k.id = auth.uid()) then
    NEW.kreirao_id := auth.uid();
  end if;
  return NEW;
end; $$;

drop trigger if exists postavi_kreirao on klijenti;
create trigger postavi_kreirao before insert on klijenti
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on lokacije;
create trigger postavi_kreirao before insert on lokacije
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on ugovori;
create trigger postavi_kreirao before insert on ugovori
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on termini;
create trigger postavi_kreirao before insert on termini
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on dokumenti;
create trigger postavi_kreirao before insert on dokumenti
  for each row execute function tg_postavi_kreirao();

-- ── Backfill iz audit_log ────────────────────────────────────────────────────
-- tg_audit() upisuje (korisnik_id, akcija=TG_OP, entitet=TG_TABLE_NAME, entitet_id=id::text).
-- Uzimamo NAJSTARIJI INSERT red po entitetu = stvarni autor. Bez izmišljanja podataka:
-- redovi bez audit traga (predaudit, seed, import) ostaju null.
update klijenti t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'klijenti' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;

update lokacije t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'lokacije' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;

update ugovori t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'ugovori' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;

update termini t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'termini' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;

update dokumenti t set kreirao_id = a.korisnik_id
from (select distinct on (entitet_id) entitet_id, korisnik_id from audit_log
      where entitet = 'dokumenti' and akcija = 'INSERT' and korisnik_id is not null
      order by entitet_id, vrijeme asc) a
where a.entitet_id = t.id::text and t.kreirao_id is null;
