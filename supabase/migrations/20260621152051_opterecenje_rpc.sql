-- Opterećenje po mjesecima: broj termina po mjesecu za godinu, razbijeno po izvedenom statusu.
create or replace function get_opterecenje(godina int)
returns table (
  mjesec    int,
  ukupno    bigint,
  izvrseno  bigint,
  kasni     bigint,
  u_planu   bigint
)
language sql
stable
as $$
  select
    extract(month from rok_dospijeca)::int                              as mjesec,
    count(*)                                                            as ukupno,
    count(*) filter (where status_izvedeni = 'izvrseno')               as izvrseno,
    count(*) filter (where status_izvedeni = 'kasni')                  as kasni,
    count(*) filter (where status_izvedeni in ('planirano','zakazano')) as u_planu
  from termini_view
  where extract(year from rok_dospijeca) = godina
  group by 1
  order by 1;
$$;
