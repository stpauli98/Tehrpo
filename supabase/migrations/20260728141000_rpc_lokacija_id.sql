-- Obje RPC-e vraćaju i lokacija_id, ne samo lokacija_naziv.
--
-- Zašto: primaoci firminog kanala biraju se po lokaciji termina (kontakt_osobe.lokacija_id).
-- Do sada je motor imao samo NAZIV lokacije — dovoljan za tekst u mejlu, beskoristan za
-- odabir primalaca. Otud je kontakt lokacije 2 dobijao podsjetnik za lokaciju 1.
--
-- Mijenja se `returns table` potpis → nužan drop prije create. Provjereno da ih nijedna
-- SQL funkcija ni pogled ne poziva; jedini pozivaoci su TypeScript (runReminders,
-- runPostDue, rlsCoverage).
--
-- Tijela su doslovno prekopirana iz 20260720121000 odnosno 20260720122000; jedina izmjena
-- je dodata kolona. Ne mijenjati logiku u istom potezu.

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
  lokacija_id    uuid,
  lokacija_naziv text
)
language sql
stable
as $$
  select * from (
    select distinct on (t.id)
      t.id                             as termin_id,
      d.d                              as dana_prije,
      (t.rok_dospijeca - current_date) as dana_do_roka,
      k.id                             as klijent_id,
      k.naziv                          as klijent_naziv,
      vp.naziv                         as vrsta_naziv,
      t.rok_dospijeca,
      l.id                             as lokacija_id,
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

drop function if exists get_post_due_termine();

create function get_post_due_termine()
returns table (
  termin_id       uuid,
  klijent_id      uuid,
  klijent_naziv   text,
  vrsta_naziv     text,
  rok_dospijeca   date,
  datum_zakazan   date,
  ciklus_rok      date,
  dana_do_ciklusa int,
  lokacija_id     uuid,
  lokacija_naziv  text,
  treba_interni   boolean,
  treba_firma     boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with ef as (
    select t.*, coalesce(t.datum_zakazan, t.rok_dospijeca) as ciklus
    from termini t
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca < current_date
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
  ),
  otvoren as (
    select ef.id as tid, kan.kanal,
           not exists (
             select 1 from post_due_obavijesti o
             where o.termin_id = ef.id
               and o.ciklus_rok = ef.ciklus
               and o.kanal = kan.kanal
               and (o.stanje in ('poslato','preskoceno')
                    or (o.stanje = 'u_toku' and o.claimed_at >= now() - interval '15 minutes'))
           ) as treba
    from ef cross join (values ('interni'),('firma')) as kan(kanal)
  )
  select ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus,
         (ef.ciklus - current_date), l.id, l.naziv,
         bool_or(o.treba) filter (where o.kanal = 'interni'),
         bool_or(o.treba) filter (where o.kanal = 'firma')
  from ef
  join klijenti k        on k.id = ef.klijent_id
  join vrste_provjera vp on vp.id = ef.vrsta_provjere_id
  left join lokacije l   on l.id = ef.lokacija_id
  join otvoren o         on o.tid = ef.id
  group by ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus, l.id, l.naziv
  having bool_or(o.treba)
  order by ef.ciklus, k.naziv;
$$;

-- Grantovi se gube sa drop-om — moraju se vratiti (v. 20260720122000).
revoke execute on function get_post_due_termine() from public, anon, authenticated;
grant  execute on function get_post_due_termine() to service_role;
