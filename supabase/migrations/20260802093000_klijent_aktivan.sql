-- B1 (02.08.2026.): klijent se nije mogao ugasiti — mejlovi za bivšeg klijenta doživotno.
--
-- Zatečeno stanje:
--   • tabela `klijenti` NEMA nijedan prekidač; jedini način da klijent nestane iz
--     motora rokova je DELETE, a on pada na FK RESTRICT čim postoji ijedan termin;
--   • `ugovori.aktivan` i `ugovori.datum_isteka` NEMAJU nikakav efekat na motor —
--     nijedna od tri funkcije koje hrane mejlove ne dodiruje tabelu `ugovori`;
--   • `get_istekli_termini` (sedmični digest) nema gornju granicu po starosti roka,
--     pa termin ostaje u digestu dok se ne zatvori — potvrđeno 47 dana i dalje.
-- Posljedica: prvi klijent koji raskine saradnju trajno šumi internom timu, a
-- jedini „lijek" je brisanje istorije koje baza ionako ne dozvoljava.
--
-- Popravka:
--   1) `klijenti.aktivan boolean not null default true` — postojeći redovi i svaki
--      novi klijent ostaju aktivni (nema promjene ponašanja bez izričite akcije);
--   2) filter `k.aktivan` u SVA TRI izvora mejlova (provjereno nad živom bazom, ne
--      nad fajlovima migracija): get_due_podsjetnici (60/30/15/7 prije roka),
--      get_post_due_termine (poslije roka, interni + firma kanal),
--      get_istekli_termini (sedmični digest);
--   3) `klijent_aktivan` izložen kroz `klijenti_view` i `termini_view` da UI i
--      /api/plan-aktivnosti mogu filtrirati bez dodatnog upita.
--
-- Šta se NAMJERNO ne mijenja:
--   • termini, dokumenti, zapisnici, poslati mejlovi i audit ostaju netaknuti i
--     vidljivi — gašenje klijenta je prestanak SLANJA, a ne brisanje istorije;
--   • `termini_view` i `klijenti_view` i dalje vraćaju SVE redove (samo dobijaju
--     dodatnu kolonu) — filtriranje istorije bi zakonsku evidenciju sakrilo;
--   • ugovor sa isteklim `datum_isteka` NE gasi klijenta automatski (obrazloženo
--     u komentaru kolone `klijenti.aktivan` ispod).
--
-- Idempotentno i sigurno za ponovno pokretanje.

-- ── 1. Prekidač ────────────────────────────────────────────────────────────────

alter table public.klijenti
  add column if not exists aktivan boolean not null default true;

comment on column public.klijenti.aktivan is
  'false = saradnja ugašena: klijent ispada iz SVIH mejlova (podsjetnici prije roka, '
  'obavijesti poslije roka, sedmični digest). Istorija, dokumenti i termini ostaju '
  'netaknuti i vidljivi; vraćanje na true odmah vraća klijenta u motor rokova. '
  'NAMJERNO odvojeno od ugovori.aktivan/datum_isteka: istek ugovora je papirologija '
  'koja kasni i često se obnavlja, a zakonska obaveza pregleda (ZNR/ZOP) ne prestaje '
  'sa ugovorom — automatsko gašenje po isteku bi tiho zaustavilo podsjetnike usred '
  'pregovora o obnovi, i to bez ijednog vidljivog traga. Gašenje mora biti svjesna, '
  'vidljiva i reverzibilna radnja.';

-- Djelimični indeks: sve tri funkcije ispod filtriraju po aktivan = true.
create index if not exists klijenti_aktivan_idx on public.klijenti (id) where aktivan;

-- ── 2. Izvori mejlova ──────────────────────────────────────────────────────────
-- Tijela prekopirana iz ŽIVE baze (pg_get_functiondef na DEMO/PROD, 02.08.2026.);
-- jedina izmjena je dodatni uslov `and k.aktivan`.

-- 2a) Podsjetnici prije roka (runReminders → oba kanala: interni i firma).
create or replace function public.get_due_podsjetnici(dana_prije_arr integer[])
returns table(
  termin_id uuid, dana_prije integer, dana_do_roka integer, klijent_id uuid,
  klijent_naziv text, vrsta_naziv text, rok_dospijeca date, lokacija_id uuid, lokacija_naziv text
)
language sql
stable
as $function$
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
      and k.aktivan                                     -- B1: ugašen klijent ne šalje
      and t.rok_dospijeca >= (now() at time zone 'Europe/Belgrade')::date
      and d.d >= (t.rok_dospijeca - (now() at time zone 'Europe/Belgrade')::date)
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id and p.dana_prije >= 0 and p.dana_prije <= d.d
      )
    order by t.id, d.d asc
  ) s
  order by s.rok_dospijeca, s.klijent_naziv;
$function$;

-- 2b) Obavijesti poslije roka (runPostDue).
create or replace function public.get_post_due_termine()
returns table(
  termin_id uuid, klijent_id uuid, klijent_naziv text, vrsta_naziv text,
  rok_dospijeca date, datum_zakazan date, ciklus_rok date, dana_do_ciklusa integer,
  dana_do_roka integer, lokacija_id uuid, lokacija_naziv text,
  treba_interni boolean, treba_firma boolean
)
language sql
stable
set search_path to 'public'
as $function$
  with ef as (
    select t.*, coalesce(t.datum_zakazan, t.rok_dospijeca) as ciklus
    from termini t
    join klijenti kk on kk.id = t.klijent_id      -- B1: ugašen klijent ne šalje
    where t.status in ('planirano','zakazano')
      and kk.aktivan
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
$function$;

-- 2c) Sedmični digest isteklih (runDigest).
create or replace function public.get_istekli_termini(p_danas date)
returns table(
  termin_id uuid, klijent_id uuid, klijent_naziv text, vrsta_naziv text,
  rok_dospijeca date, datum_zakazan date, ciklus_rok date, dana_do_ciklusa integer,
  lokacija_naziv text
)
language sql
stable
set search_path to 'public'
as $function$
  with ef as (
    select t.*, coalesce(t.datum_zakazan, t.rok_dospijeca) as ciklus
    from termini t
    join klijenti kk on kk.id = t.klijent_id      -- B1: ugašen klijent ne šalje
    where t.status in ('planirano','zakazano')
      and kk.aktivan
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
$function$;

-- ── 3. Vidljivost prekidača za UI i plan ───────────────────────────────────────
-- Kolone se DODAJU NA KRAJ (create or replace view to zahtijeva); nijedan red se
-- ne gubi — filtriranje je odluka pozivaoca, ne view-a.

-- `with (security_invoker = on)` se NAVODI IZRIČITO: create or replace view bez
-- WITH klauzule resetuje reloptions, pa bi view tiho postao security_definer i
-- zaobišao RLS (`ima_pristup_klijentu`) — operater bi vidio tuđe firme.
create or replace view public.klijenti_view with (security_invoker = on) as
 select k.id,
    k.naziv,
    k.napomena,
    k.created_at,
    k.updated_at,
    k.tip_odnosa,
    COALESCE(lok.broj_lokacija, 0::bigint) AS broj_lokacija,
    COALESCE(t.broj_termina, 0::bigint) AS broj_termina,
    COALESCE(t.broj_aktivnih, 0::bigint) AS broj_aktivnih,
    COALESCE(t.broj_kasni, 0::bigint) AS broj_kasni,
    COALESCE(t.broj_izvrseno, 0::bigint) AS broj_izvrseno,
    k.aktivan
   FROM klijenti k
     LEFT JOIN ( SELECT lokacije.klijent_id,
            count(*) AS broj_lokacija
           FROM lokacije
          GROUP BY lokacije.klijent_id) lok ON lok.klijent_id = k.id
     LEFT JOIN ( SELECT termini_view.klijent_id,
            count(*) AS broj_termina,
            count(*) FILTER (WHERE termini_view.status_izvedeni = ANY (ARRAY['planirano'::text, 'zakazano'::text])) AS broj_aktivnih,
            count(*) FILTER (WHERE termini_view.status_izvedeni = 'kasni'::text) AS broj_kasni,
            count(*) FILTER (WHERE termini_view.status = 'izvrseno'::termini_status) AS broj_izvrseno
           FROM termini_view
          GROUP BY termini_view.klijent_id) t ON t.klijent_id = k.id;

comment on view public.klijenti_view is
  'Klijenti + brojači termina/lokacija. Kolona `aktivan` = B1 prekidač slanja; view '
  'NE filtrira po njoj (lista klijenata mora prikazati i ugašene, samo drugačije).';

-- termini_view: dodaje se samo `klijent_aktivan` kao izvedena kolona; ostatak
-- definicije se ne dira (čita se iz žive baze i ponovo upisuje u DO bloku ispod,
-- da migracija ne zavisi od toga koja je verzija view-a zatečena).
do $$
declare
  v_def text;
begin
  if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'termini_view')
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'termini_view' and column_name = 'klijent_aktivan'
     )
  then
    select pg_get_viewdef('public.termini_view'::regclass, true) into v_def;
    -- Skidamo završni ';' i omotavamo zatečeni select u podupit + LEFT JOIN na
    -- klijente. LEFT (ne INNER) da view ne može izgubiti nijedan red ni u slučaju
    -- da RLS nad `klijenti` sakrije firmu koju termin i dalje pominje.
    v_def := rtrim(btrim(v_def), ';');
    execute format(
      'create or replace view public.termini_view with (security_invoker = on) as '
      'select tv.*, coalesce(k.aktivan, true) as klijent_aktivan '
      'from (%s) tv left join public.klijenti k on k.id = tv.klijent_id',
      v_def
    );
  end if;
end $$;

comment on view public.termini_view is
  'Termini + izvedeni status. `klijent_aktivan` = B1 prekidač klijenta; view NE '
  'filtrira po njemu (istorija i zakonska evidencija moraju ostati vidljive) — '
  'plan/kalendar/matrica filtriraju same.';
