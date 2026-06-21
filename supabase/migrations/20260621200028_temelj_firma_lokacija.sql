-- Temelj: idempotentne lokacije, klijenti_view fanout fix, auto-cycle interval guard

-- 1. Unique index: firma + naziv jedinstveni (idempotent)
create unique index if not exists uq_lokacije_klijent_naziv
  on lokacije (klijent_id, naziv);

-- 2. klijenti_view — ukloniti kartezijev fanout
--    Stara def: LEFT JOIN lokacije + LEFT JOIN termini_view pa GROUP BY => count(DISTINCT l.id) za lokacije
--    ali count(tv.id) za termine — fanout nastaje jer 1 termin x N lokacija = N puta.
--    Novo: dvije odvojene subquery agregacije (lokacije + termini), JOIN na klijenti.
--    Filter uslovi identični sa starom def:
--      broj_aktivnih = planirano | zakazano (BEZ kasni)
--      broj_kasni    = kasni
--      broj_izvrseno = status = 'izvrseno'
--      broj_termina  = count(*) svih
--      broj_lokacija = count(*) lokacija
create or replace view klijenti_view as
select
  k.id,
  k.naziv,
  k.napomena,
  k.created_at,
  k.updated_at,
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

-- 3. auto-cycle guard: preskočiti INSERT ako nema intervala (ni na terminu ni na vrsti_provjere)
--    Jedina izmjena vs stare def: v_interval := coalesce(...); if v_interval is not null then ... end if;
--    INSERT kolone + vrijednosti i trigger binding (tg_termini_auto_cycle_au) ostaju nepromijenjeni.
create or replace function tg_termini_auto_cycle() returns trigger
language plpgsql as $$
declare
  v_interval int;
begin
  if (old.datum_izvrsenja is null
      and new.datum_izvrsenja is not null
      and new.status = 'izvrseno'
      and old.status is distinct from 'izvrseno') then
    v_interval := coalesce(
      new.interval_mjeseci,
      (select podrazumevani_interval_mjeseci from vrste_provjera where id = new.vrsta_provjere_id)
    );
    if v_interval is not null then
      insert into termini (
        klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
        datum_zadnjeg, rok_dospijeca, status
      )
      values (
        new.klijent_id, new.lokacija_id, new.vrsta_provjere_id, new.interval_mjeseci,
        new.datum_izvrsenja,
        new.datum_izvrsenja, -- placeholder; tg_compute_rok prepisuje
        'planirano'
      );
    end if;
  end if;
  return new;
end;
$$;
