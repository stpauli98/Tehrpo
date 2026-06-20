-- Read-model za Termini ekran (Faza 3):
-- 1) Obogaćen termini_view sa joined nazivima (klijent/lokacija/vrsta) — flat read model
-- 2) get_termini_stats() RPC — 4 agregata u jednom pozivu (query-by-page rule)

-- Recreate view (drop + create jer mijenjamo set kolona)
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

-- Stats RPC — sve u jednom round-tripu
create or replace function get_termini_stats()
returns table (
  ukupno                 bigint,
  ovog_mjeseca           bigint,
  kasni                  bigint,
  izvrseno_ovog_mjeseca  bigint
)
language sql
stable
as $$
  select
    (select count(*) from termini),
    (select count(*) from termini
       where rok_dospijeca >= date_trunc('month', current_date)::date
         and rok_dospijeca <  (date_trunc('month', current_date) + interval '1 month')::date),
    (select count(*) from termini_view where status_izvedeni = 'kasni'),
    (select count(*) from termini
       where status = 'izvrseno'
         and datum_izvrsenja >= date_trunc('month', current_date)::date
         and datum_izvrsenja <  (date_trunc('month', current_date) + interval '1 month')::date);
$$;
