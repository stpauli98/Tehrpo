-- Post-due grana se seli u get_post_due_termine() + post_due_obavijesti.
-- Ovdje ostaje ISKLJUČIVO pre-due grana, prekopirana doslovno iz 20260629120000.
-- Povratni tip je nepromijenjen → create or replace je dovoljan (bez drop).
create or replace function get_due_podsjetnici(dana_prije_arr int[])
returns table (
  termin_id      uuid,
  dana_prije     int,
  dana_do_roka   int,
  klijent_id     uuid,
  klijent_naziv  text,
  vrsta_naziv    text,
  rok_dospijeca  date,
  lokacija_naziv text
)
language sql
stable
as $$
  -- PRE-DUE: najmanji JOŠ-neposlat prag čiji je prozor ušao, po terminu.
  -- distinct on traži order by t.id prvo, pa se rezultat omotava radi vanjskog sortiranja.
  select * from (
    select distinct on (t.id)
      t.id                             as termin_id,
      d.d                              as dana_prije,
      (t.rok_dospijeca - current_date) as dana_do_roka,
      k.id                             as klijent_id,
      k.naziv                          as klijent_naziv,
      vp.naziv                         as vrsta_naziv,
      t.rok_dospijeca,
      l.naziv                          as lokacija_naziv
    from termini t
    join klijenti k        on k.id = t.klijent_id
    join vrste_provjera vp on vp.id = t.vrsta_provjere_id
    left join lokacije l   on l.id = t.lokacija_id
    cross join unnest(dana_prije_arr) as d(d)
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca >= current_date
      and d.d >= (t.rok_dospijeca - current_date)
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id and p.dana_prije >= 0 and p.dana_prije <= d.d
      )
    order by t.id, d.d asc
  ) s
  order by s.rok_dospijeca, s.klijent_naziv;
$$;
