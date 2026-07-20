-- Termini u alarmu, sa naznakom koji kanal još nije obrađen za tekući ciklus.
-- ALARM traži OBA uslova: rok je prošao I efektivni datum je prošao. Bez prvog uslova
-- bi termin sa rokom u budućnosti i propuštenim datum_zakazan slao lažnu uzbunu.
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
    -- Kanal je "otvoren" ako nema reda, ILI je red zaglavljen u 'u_toku' duže od 15 min.
    -- Zaglavljeni claim MORA biti vidljiv ovdje, inače je oporavak nedostižan i smrt
    -- procesa između claim-a i slanja trajno guta jedinu obavijest za taj ciklus.
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
         (ef.ciklus - current_date), l.naziv,
         bool_or(o.treba) filter (where o.kanal = 'interni'),
         bool_or(o.treba) filter (where o.kanal = 'firma')
  from ef
  join klijenti k        on k.id = ef.klijent_id
  join vrste_provjera vp on vp.id = ef.vrsta_provjere_id
  left join lokacije l   on l.id = ef.lokacija_id
  join otvoren o         on o.tid = ef.id
  group by ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus, l.naziv
  having bool_or(o.treba)
  order by ef.ciklus, k.naziv;
$$;

-- Supabase daje EXECUTE direktno roli authenticated kroz alter default privileges,
-- pa revoke from public, anon NIJE dovoljan.
revoke execute on function get_post_due_termine() from public, anon, authenticated;
grant  execute on function get_post_due_termine() to service_role;
