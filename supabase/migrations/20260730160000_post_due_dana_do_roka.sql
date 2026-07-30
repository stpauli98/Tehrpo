-- get_post_due_termine vraća i dana_do_roka (kašnjenje prema ROKU).
--
-- Zašto: motor je do sada imao samo `dana_do_ciklusa` (= coalesce(datum_zakazan, rok) - danas)
-- i taj isti broj je završavao u predmetu i bedžu mejla. Za prezakazan termin to znači da
-- mejl protivrječi sam sebi — WAIKIKI / Ispitivanje hidranata na PROD-u 30.07.2026: rok
-- 27.06., zakazano 29.07., pa je naslov glasio "kasni 1 dan" dok je u tijelu istog mejla
-- pisalo "Rok dospijeća: 27.06.2026", a ekran /pregled je za isti termin javljao "kasni 33
-- dana". Tri površine, tri broja.
--
-- Podjela odgovornosti od sada:
--   ciklus (coalesce(datum_zakazan, rok))  → SAMO odluka KADA ponovo slati (where + claim).
--   rok_dospijeca                          → JEDINA osnova za broj "kasni N" bilo gdje.
-- `dana_do_ciklusa` ostaje u potpisu jer post_due ledger i dalje ključa po ciklusu.
--
-- ⚠ ZONA — tijelo je prekopirano iz 20260730120000_vremenska_zona_belgrade.sql (grane
-- fix/e2e-flake-otpornost / fix/e2e-specovi-yoink), NE iz starijeg 20260728141000.
-- Ta migracija je SQL sloj prebacila sa `current_date` (UTC sesija) na
-- `(now() at time zone 'Europe/Belgrade')::date`, jer je između ponoći i 01:00/02:00 po
-- lokalnom vremenu UTC datum još jučerašnji — termin s jučerašnjim rokom tada nije „kasni".
-- Kako ova migracija radi drop+create, kopiranje starijeg tijela bi tu ispravku tiho
-- poništilo baš u funkciji koja odlučuje kada ide alarm (i jeste je poništilo na DEMO-u u
-- prvoj verziji ove migracije). Jedina izmjena u odnosu na Belgrade verziju je DODATA
-- kolona `dana_do_roka` — i ona po Belgrade danu.
--
-- Redoslijed na svježem `db reset` je siguran: 20260730120000 (Belgrade, 12 kolona) pa
-- 20260730160000 (Belgrade, 13 kolona). Obrnut redoslijed nije moguć po timestampu, a
-- da i jeste, njihov `create or replace` bi pukao na promjeni potpisa umjesto da tiho prođe.
--
-- Mijenja se `returns table` potpis → nužan drop prije create. Grantovi se gube sa drop-om
-- i vraćaju se ispod.

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
  dana_do_roka    int,
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
         (ef.ciklus        - (now() at time zone 'Europe/Belgrade')::date),
         (ef.rok_dospijeca - (now() at time zone 'Europe/Belgrade')::date),
         l.id, l.naziv,
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
