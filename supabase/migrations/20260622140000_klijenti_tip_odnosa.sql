-- Tip poslovnog odnosa sa klijentom: ugovor (periodični) ili ponuda (jednokratno).
alter table klijenti
  add column tip_odnosa text
  check (tip_odnosa in ('ugovor', 'ponuda'));

comment on column klijenti.tip_odnosa is 'po ugovoru | po ponudi; null = nije postavljeno';

-- Izložiti tip_odnosa u klijenti_view (KlijentCard čita odavde).
-- Reprodukovana 1:1 iz 20260621200028_temelj_firma_lokacija.sql + dodan k.tip_odnosa.
-- Koristimo DROP + CREATE (ne CREATE OR REPLACE) jer dodavanje kolone mijenja redoslijed.
drop view if exists klijenti_view;
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
