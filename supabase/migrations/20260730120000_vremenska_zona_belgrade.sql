-- Standardizacija vremenske zone: JEDINA zona aplikacije je Europe/Belgrade.
--
-- Supabase sesija radi u UTC, pa je current_date UTC datum — između 00:00 i
-- 01:00/02:00 po lokalnom (Belgrade) vremenu current_date je još JUČERAŠNJI dan:
-- termin s jučerašnjim rokom nije "kasni", upis današnjeg datum_izvrsenja pada
-- na check constraintu, a statistike "ovog mjeseca" prvog u mjesecu pokazuju
-- prethodni mjesec. Standard (TS parnjak: todayIso() u lib/date.ts):
--   "danas" = (now() at time zone 'Europe/Belgrade')::date
--
-- Sve ispod je CREATE OR REPLACE / drop+add constrainta nad NEIZMIJENJENIM
-- potpisima — ACL-ovi (grantovi/revoke-ovi, uklj. eventualni anon-revoke iz
-- 20260729150000) i security_invoker se čuvaju; tijela su doslovno prekopirana
-- iz zadnjih aktivnih verzija, jedina izmjena je izvor "danas" i zona.

-- 1) chk_termini_datumi (iz 20260620200651): "datum_izvrsenja ne u budućnosti"
--    po Belgrade danu. Revalidacija postojećih redova je bezbjedna: Belgrade
--    datum >= UTC datum, pa svaki red validan pod starim uslovom prolazi i novi.
alter table termini drop constraint chk_termini_datumi;
alter table termini add constraint chk_termini_datumi check (
  (datum_izvrsenja is null or datum_izvrsenja <= (now() at time zone 'Europe/Belgrade')::date)
  and (datum_zakazan is null or datum_zakazan >= '2020-01-01')
  and (interval_mjeseci is null or interval_mjeseci between 1 and 120)
);

-- 2) termini_view (zadnja verzija: 20260710140000): 'kasni' po Belgrade danu.
--    Set kolona nepromijenjen → create or replace bez drop-a (klijenti_view,
--    koji čita status_izvedeni iz ovog view-a, automatski nasljeđuje ispravku).
create or replace view termini_view as
select
  t.*,
  case
    when t.status = 'izvrseno' then 'izvrseno'
    when t.status = 'otkazano' then 'otkazano'
    when t.rok_dospijeca < (now() at time zone 'Europe/Belgrade')::date then 'kasni'
    else t.status::text
  end as status_izvedeni,
  coalesce(t.datum_zakazan, t.rok_dospijeca) as datum_prikaza,
  k.naziv as klijent_naziv,
  l.naziv as lokacija_naziv,
  l.grad  as lokacija_grad,
  v.naziv as vrsta_naziv
from termini t
left join klijenti k       on k.id = t.klijent_id
left join lokacije l       on l.id = t.lokacija_id
left join vrste_provjera v on v.id = t.vrsta_provjere_id;

-- create or replace ne garantuje reloptions — eksplicitno (idempotentno):
alter view termini_view set (security_invoker = on);

-- 3) get_termini_stats (iz 20260620214413): "ovog mjeseca" po Belgrade danu.
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
       where rok_dospijeca >= date_trunc('month', now() at time zone 'Europe/Belgrade')::date
         and rok_dospijeca <  (date_trunc('month', now() at time zone 'Europe/Belgrade') + interval '1 month')::date),
    (select count(*) from termini_view where status_izvedeni = 'kasni'),
    (select count(*) from termini
       where status = 'izvrseno'
         and datum_izvrsenja >= date_trunc('month', now() at time zone 'Europe/Belgrade')::date
         and datum_izvrsenja <  (date_trunc('month', now() at time zone 'Europe/Belgrade') + interval '1 month')::date);
$$;

-- 4) get_due_podsjetnici (zadnja verzija: 20260728141000): due-prozor i
--    dana_do_roka (ide u tekst mejla) po Belgrade danu.
create or replace function get_due_podsjetnici(dana_prije_arr int[])
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
      t.id                                                            as termin_id,
      d.d                                                             as dana_prije,
      (t.rok_dospijeca - (now() at time zone 'Europe/Belgrade')::date) as dana_do_roka,
      k.id                                                            as klijent_id,
      k.naziv                                                         as klijent_naziv,
      vp.naziv                                                        as vrsta_naziv,
      t.rok_dospijeca,
      l.id                                                            as lokacija_id,
      l.naziv                                                         as lokacija_naziv
    from termini t
    join klijenti k        on k.id = t.klijent_id
    join vrste_provjera vp on vp.id = t.vrsta_provjere_id
    left join lokacije l   on l.id = t.lokacija_id
    cross join unnest(dana_prije_arr) as d(d)
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca >= (now() at time zone 'Europe/Belgrade')::date
      and d.d >= (t.rok_dospijeca - (now() at time zone 'Europe/Belgrade')::date)
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id and p.dana_prije >= 0 and p.dana_prije <= d.d
      )
    order by t.id, d.d asc
  ) s
  order by s.rok_dospijeca, s.klijent_naziv;
$$;

-- 5) get_post_due_termine (zadnja verzija: 20260728141000): uslov alarma i
--    dana_do_ciklusa (ide u tekst mejla) po Belgrade danu.
create or replace function get_post_due_termine()
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
      and t.rok_dospijeca < (now() at time zone 'Europe/Belgrade')::date
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < (now() at time zone 'Europe/Belgrade')::date
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
         (ef.ciklus - (now() at time zone 'Europe/Belgrade')::date), l.id, l.naziv,
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

-- 6) get_istekli_termini (iz 20260721121000): jedina eksplicitna zona u SQL
--    sloju prelazi sa Europe/Vienna na Europe/Belgrade (offset identičan —
--    ponašanje isto, standard je jedna zona). p_danas šalje aplikacija,
--    izračunat u Europe/Belgrade (lokalniSatIDatum / todayIso).
create or replace function get_istekli_termini(p_danas date)
returns table (
  termin_id       uuid,
  klijent_id      uuid,
  klijent_naziv   text,
  vrsta_naziv     text,
  rok_dospijeca   date,
  datum_zakazan   date,
  ciklus_rok      date,
  dana_do_ciklusa int,
  lokacija_naziv  text
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
      and t.rok_dospijeca < p_danas
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < p_danas
  )
  select ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus,
         (ef.ciklus - p_danas), l.naziv
  from ef
  join klijenti k        on k.id = ef.klijent_id
  join vrste_provjera vp on vp.id = ef.vrsta_provjere_id
  left join lokacije l   on l.id = ef.lokacija_id
  -- Termin koji je DANAS dobio pojedinačnu obavijest ne ulazi u današnji digest.
  -- poslat_at je popunjen samo za stvarno poslate; 'preskoceno' redovi ga nemaju,
  -- pa termin koji je danas preskočen (nema primalaca) i dalje pripada digestu.
  -- Kastuje se u beogradsku zonu, ne sesijsku (UTC na Supabase-u), da se poredi
  -- sa istim danom kao i p_danas.
  where not exists (
    select 1 from post_due_obavijesti o
    where o.termin_id = ef.id and (o.poslat_at at time zone 'Europe/Belgrade')::date = p_danas
  )
  order by ef.ciklus, k.naziv;
$$;
