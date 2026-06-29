-- Krug 1: catch-up + post-due podsjetnici, rokovi 60/30/15/7
-- Mijenja get_due_podsjetnici (prozor umjesto tačne jednakosti + post-due grana),
-- olabavljuje chk_podsjetnici_dana_prije (dozvoljava negativni post-due marker),
-- i postavlja default pragova na {60,30,15,7}.

-- 1. Dozvoli negativni dana_prije (post-due marker = rok - current_date)
alter table podsjetnici drop constraint chk_podsjetnici_dana_prije;
alter table podsjetnici add constraint chk_podsjetnici_dana_prije
  check (dana_prije between -3650 and 365);

-- 2. Default pragova 60/30/15/7 (postojeći red mijenja SAMO ako je još na starom defaultu)
alter table postavke alter column dana_prije set default '{60,30,15,7}';
update postavke set dana_prije = '{60,30,15,7}'
  where id = 1 and dana_prije = '{30,14,7,1}';

-- 3. Novi RPC: pre-due (catch-up) + post-due (dnevno)
--    Mijenja se povratni tip → DROP pa CREATE (replace ne može promijeniti RETURNS TABLE).
drop function if exists get_due_podsjetnici(int[]);
create function get_due_podsjetnici(dana_prije_arr int[])
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
  -- PRE-DUE: najmanji JOŠ-neposlat prag čiji je prozor ušao, po terminu
  ( select distinct on (t.id)
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
        where p.termin_id = t.id and p.dana_prije <= d.d
      )
    order by t.id, d.d asc )
  union all
  -- POST-DUE: jedan red dnevno dok status nije izvrseno/otkazano
  ( select
      t.id,
      (t.rok_dospijeca - current_date),
      (t.rok_dospijeca - current_date),
      k.id,
      k.naziv,
      vp.naziv,
      t.rok_dospijeca,
      l.naziv
    from termini t
    join klijenti k        on k.id = t.klijent_id
    join vrste_provjera vp on vp.id = t.vrsta_provjere_id
    left join lokacije l   on l.id = t.lokacija_id
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca < current_date
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id
          and p.dana_prije = (t.rok_dospijeca - current_date)
      ) )
  order by rok_dospijeca, klijent_naziv;
$$;
