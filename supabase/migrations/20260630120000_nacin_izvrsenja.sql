-- §4.1 Način izvršenja: 'izvrsava' (TEHPRO izvršava) | 'pracenje' (samo praćenje roka).
-- Re-run sigurno (review-loop / cloud re-apply): create type nije idempotentan → guard.
do $$ begin
  create type nacin_izvrsenja_tip as enum ('izvrsava', 'pracenje');
exception when duplicate_object then null;
end $$;

alter table klijent_provjere
  add column if not exists nacin_izvrsenja nacin_izvrsenja_tip not null default 'izvrsava';
alter table termini
  add column if not exists nacin_izvrsenja nacin_izvrsenja_tip not null default 'izvrsava';

-- auto_cycle mora kopirati nacin_izvrsenja na sljedeći termin u ciklusu.
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

-- termini_view: t.* je POZICIJSKI razvijen → nova kolona se ne pojavi bez rekreiranja.
-- klijenti_view ovisi o termini_view → mora se rekreirati obje.
-- Rekreira se OBOGAĆENA verzija (join nazivi) iz 20260620214413_termini_read_model.sql.
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
  k.naziv as klijent_naziv,
  l.naziv as lokacija_naziv,
  l.grad  as lokacija_grad,
  v.naziv as vrsta_naziv
from termini t
left join klijenti k       on k.id = t.klijent_id
left join lokacije l       on l.id = t.lokacija_id
left join vrste_provjera v on v.id = t.vrsta_provjere_id;

-- klijenti_view: reproducirana 1:1 iz 20260622140000_klijenti_tip_odnosa.sql
-- (zadnja definicija) — ovisi o termini_view pa se mora rekreirati.
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

-- Re-apply security_invoker (izgubi se DROP-om)
alter view termini_view  set (security_invoker = on);
alter view klijenti_view set (security_invoker = on);
