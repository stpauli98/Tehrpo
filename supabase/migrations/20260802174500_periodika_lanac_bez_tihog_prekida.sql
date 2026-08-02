-- C1 (02.08.2026.) — vrsta bez periodike: izvršenje više ne smije TIHO ubiti lanac obaveze.
--
-- ŠTA JE KVAR
--   tg_termini_auto_cycle po zatvaranju ponavljajućeg termina razrješava periodiku ovako:
--       coalesce(NEW.interval_mjeseci, vrste_provjera.podrazumevani_interval_mjeseci)
--   i ako ispadne NULL, grana `if v_interval is not null then` se jednostavno preskoči.
--   Posljedica: UPDATE prolazi, termin je „izvršen", sljedeći ciklus NE nastane, i nigdje
--   — ni u bazi, ni u UI, ni u logu — ne ostane trag da je zakonska obaveza ispala iz plana.
--   Ovo NIJE rubni slučaj: u PROD-u 20 od 24 vrste (sve aktivne) nemaju
--   podrazumevani_interval_mjeseci, a 11 termina je već zatvoreno bez razrješive periodike
--   (2 su i sada otvorena i čekaju isti kraj).
--
-- ZAŠTO NE TVRDA GREŠKA PRI ZATVARANJU
--   Razmatrano i odbačeno. Zatvaranje termina je upis dokaza da je zakonski pregled OBAVLJEN
--   — to je primarni zapis i ne smije se odbiti zbog toga što je nečija PODEŠENOST loša.
--   Konkretno: (a) u PROD-u bi 2 otvorena termina odmah postala nezatvoriva, a u DEMO 0 — pa
--   bi popravka pogodila upravo pravu bazu; (b) periodiku vrste mijenja SAMO administrator
--   (Postavke), dok termin zatvara operater — operater bi ostao zaključan bez ijedne radnje
--   koju sam može izvesti; (c) tvrda greška u trigeru obara i cijeli batch upis, pa bi jedan
--   loše podešen termin rušio nepovezane izmjene; (d) najgori ishod: korisnik pod pritiskom
--   isključi „ponavlja se" samo da bi mogao snimiti — i lanac ipak nestane, ali sada svojom
--   voljom i bez traga. Zato: ZATVARANJE PROLAZI, ali prekid dobija ime, red u dnevniku,
--   upozorenje u Postgres logu i alarm u monitoringu. Tiho je prestalo biti opcija.
--
-- TRI SLOJA (svi u ovoj migraciji, osim sloja 2 koji je u app kodu)
--   1) baza:   `prekinuti_lanci` (dnevnik prekida) + `zabiljezi_prekinut_lanac()` +
--              nova grana `else` u tg_termini_auto_cycle + popis već nastalih prekida.
--   2) app:    postaviVrstaInterval/updateVrsta odbijaju uklanjanje periodike dok o njoj
--              zavisi ijedan otvoren ponavljajući termin (app/(dashboard)/postavke/actions.ts).
--   3) nadzor: `zdravlje_periodike()` + spojeno u `zdravlje_sistema()` (polje `periodika`).
--
-- Idempotentno / re-run safe.

-- ═══ (0) Preduslovi ════════════════════════════════════════════════════════════
-- Migracije se na cloud puštaju RUČNO; preskok bi ovdje značio da `create or replace`
-- ispod prepiše tijelo trigera verzijom koja ne zna za kolone iz preskočene migracije.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='termini' and column_name='ponavlja_se') then
    raise exception 'C1 trazi 20260801100300_termini_ponavlja_se (nema termini.ponavlja_se)';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='termini' and column_name='nastao_iz_id') then
    raise exception 'C1 trazi 20260801180000_termin_nastao_iz_id (nema termini.nastao_iz_id)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='zdravlje_sistema') then
    raise exception 'C1 trazi 20260802160000_zdravlje_sistema (nema funkcije zdravlje_sistema)';
  end if;
end;
$$;

-- ═══ (1) Dnevnik prekinutih lanaca ═════════════════════════════════════════════
-- Jedan red po terminu koji je zatvoren, a nastavak nije mogao nastati. Ovo je INCIDENT
-- dnevnik (istorija), ne red čekanja — red se NE briše kad se stvar popravi; „riješenost"
-- se računa (postoji li opet otvoren termin za istu trojku), pa se ne može zaboraviti
-- ručno zatvoriti niti lažno prikazati kao riješeno.
create table if not exists public.prekinuti_lanci (
  termin_id         uuid        primary key references public.termini(id) on delete cascade,
  klijent_id        uuid        not null,
  lokacija_id       uuid,
  vrsta_provjere_id uuid        not null,
  datum_izvrsenja   date,
  zabiljezeno_at    timestamptz not null default now(),
  izvor             text        not null default 'trigger',
  razlog            text        not null,
  constraint chk_prekinuti_izvor check (izvor in ('trigger', 'popis'))
);

comment on table public.prekinuti_lanci is
  'C1: dnevnik lanaca koji su stali — termin je zatvoren kao ponavljajući, a periodika se '
  'nije mogla razriješiti (ni termini.interval_mjeseci ni vrste_provjera.podrazumevani_interval_mjeseci). '
  'Bez ovoga zatvaranje i nestanak zakonske obaveze izgledaju identično.';
comment on column public.prekinuti_lanci.izvor is
  'trigger = uhvaćeno u trenutku zatvaranja; popis = zatečeno stanje pronađeno pri primjeni ove migracije.';
comment on column public.prekinuti_lanci.razlog is
  'Ljudski čitljivo objašnjenje (koja vrsta, koji klijent) — da red bude upotrebljiv i bez join-ova.';

create index if not exists idx_prekinuti_lanci_klijent on public.prekinuti_lanci (klijent_id);
create index if not exists idx_prekinuti_lanci_vrsta   on public.prekinuti_lanci (vrsta_provjere_id);

-- RLS: čitanje po istom pravilu kao termini (operater vidi svoje firme, admin sve).
-- Upisa NEMA politike — jedini put upisa je SECURITY DEFINER funkcija ispod.
alter table public.prekinuti_lanci enable row level security;

drop policy if exists pl_sel on public.prekinuti_lanci;
create policy pl_sel on public.prekinuti_lanci for select using (ima_pristup_klijentu(klijent_id));

-- Supabase podrazumijevano daje sve na nove tabele; ovdje se izričito ostavlja samo SELECT.
-- (ON DELETE CASCADE sa termini radi nezavisno od ovih privilegija.)
revoke all on public.prekinuti_lanci from anon;
revoke insert, update, delete, truncate on public.prekinuti_lanci from authenticated;
grant select on public.prekinuti_lanci to authenticated;

-- ═══ (2) Upis prekida ══════════════════════════════════════════════════════════
-- SECURITY DEFINER jer tabela nema insert politiku (isti obrazac kao zabiljezi_cron_otkucaj).
-- Prima SAMO id termina i sve ostalo izvodi sama, pa prijavljeni korisnik ne može upisati
-- izmišljen prekid: funkcija odbija termin koji ne postoji, koji se ne ponavlja, koji nije
-- izvršen, ili kojem se periodika ipak može razriješiti.
create or replace function public.zabiljezi_prekinut_lanac(p_termin_id uuid, p_izvor text default 'trigger')
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  t       record;
  v_naziv text;
begin
  if p_izvor not in ('trigger', 'popis') then
    raise exception 'nepoznat izvor: %', p_izvor;
  end if;

  select tt.id, tt.klijent_id, tt.lokacija_id, tt.vrsta_provjere_id, tt.datum_izvrsenja,
         tt.ponavlja_se, tt.status, tt.interval_mjeseci,
         v.naziv as vrsta_naziv, v.podrazumevani_interval_mjeseci as vrsta_interval,
         k.naziv as klijent_naziv
    into t
    from public.termini tt
    join public.vrste_provjera v on v.id = tt.vrsta_provjere_id
    join public.klijenti k       on k.id = tt.klijent_id
   where tt.id = p_termin_id;

  if not found then
    raise exception 'prekinut lanac: termin % ne postoji', p_termin_id;
  end if;
  if not t.ponavlja_se or t.status <> 'izvrseno' or t.datum_izvrsenja is null then
    raise exception 'prekinut lanac: termin % nije zatvoren ponavljajući termin', p_termin_id;
  end if;
  if coalesce(t.interval_mjeseci, t.vrsta_interval) is not null then
    raise exception 'prekinut lanac: termin % ima razrjesivu periodiku', p_termin_id;
  end if;

  v_naziv := format('Vrsta „%s" nema periodiku (podrazumevani_interval_mjeseci je prazan), '
                    'a termin klijenta „%s" je zatvoren kao ponavljajući — sljedeći ciklus nije nastao.',
                    t.vrsta_naziv, t.klijent_naziv);

  insert into public.prekinuti_lanci as p
    (termin_id, klijent_id, lokacija_id, vrsta_provjere_id, datum_izvrsenja, izvor, razlog)
  values (t.id, t.klijent_id, t.lokacija_id, t.vrsta_provjere_id, t.datum_izvrsenja, p_izvor, v_naziv)
  on conflict (termin_id) do update set
    zabiljezeno_at = now(),
    datum_izvrsenja = excluded.datum_izvrsenja,
    razlog          = excluded.razlog;
end;
$$;

comment on function public.zabiljezi_prekinut_lanac(uuid, text) is
  'C1: upisuje red u prekinuti_lanci. Zove je tg_termini_auto_cycle kad periodiku ne može '
  'razriješiti. Sama provjerava da prekid zaista postoji, pa se ne može lažirati.';

revoke all on function public.zabiljezi_prekinut_lanac(uuid, text) from public;
revoke all on function public.zabiljezi_prekinut_lanac(uuid, text) from anon;
grant execute on function public.zabiljezi_prekinut_lanac(uuid, text) to authenticated;
grant execute on function public.zabiljezi_prekinut_lanac(uuid, text) to service_role;

-- ═══ (3) Trigger: prekid dobija ime ════════════════════════════════════════════
-- Tijelo je DOSLOVNO prekopirano iz zadnje aktivne verzije
-- (20260801180000_termin_nastao_iz_id.sql — provjereno pg_get_functiondef-om na PROD-u
-- 02.08.2026.), a dodata je SAMO `else` grana. Uslovi ulaska, kolone INSERT-a (uključujući
-- `nastao_iz_id`) i prenos nacin_izvrsenja/ponavlja_se su nepromijenjeni.
-- PAŽNJA za buduće izmjene: svako sljedeće `create or replace function tg_termini_auto_cycle()`
-- MORA zadržati i `nastao_iz_id` u INSERT-u i ovu `else` granu.
create or replace function tg_termini_auto_cycle() returns trigger
language plpgsql as $$
declare
  v_interval int;
begin
  if (
    (TG_OP = 'INSERT'
      and NEW.ponavlja_se
      and NEW.datum_izvrsenja is not null
      and NEW.status = 'izvrseno')
    or
    (TG_OP = 'UPDATE'
      and NEW.ponavlja_se
      and OLD.datum_izvrsenja is null
      and NEW.datum_izvrsenja is not null
      and NEW.status = 'izvrseno'
      and OLD.status is distinct from 'izvrseno')
  ) then
    v_interval := coalesce(
      NEW.interval_mjeseci,
      (select podrazumevani_interval_mjeseci from vrste_provjera where id = NEW.vrsta_provjere_id)
    );
    if v_interval is not null then
      insert into termini (
        klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
        datum_zadnjeg, rok_dospijeca, status, nacin_izvrsenja, ponavlja_se,
        nastao_iz_id
      )
      values (
        NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
        NEW.datum_izvrsenja,
        NEW.datum_izvrsenja, -- placeholder; tg_compute_rok prepisuje
        'planirano',
        NEW.nacin_izvrsenja,
        NEW.ponavlja_se,
        NEW.id
      );
    else
      -- C1: OVDJE je lanac do sada tiho stajao. Zatvaranje i dalje prolazi (v. obrazloženje
      -- u zaglavlju), ali prekid se zapisuje i viče u log. Upis ide kroz SECURITY DEFINER
      -- funkciju jer prekinuti_lanci nema insert politiku; `perform` ne smije oboriti
      -- zatvaranje, pa je omotan u exception blok — dnevnik je važan, ali nije važniji od
      -- zapisa da je pregled obavljen.
      begin
        perform public.zabiljezi_prekinut_lanac(NEW.id, 'trigger');
      exception when others then
        raise warning 'C1: upis u prekinuti_lanci nije uspio za termin %: %', NEW.id, sqlerrm;
      end;
      raise warning
        'C1: lanac je STAO — termin % (klijent %, vrsta %) zatvoren je kao ponavljajući, a periodika se ne može razrijesiti; sljedeci ciklus NIJE napravljen',
        NEW.id, NEW.klijent_id, NEW.vrsta_provjere_id;
    end if;
  end if;
  return NEW;
end;
$$;

comment on function tg_termini_auto_cycle() is
  'Po zatvaranju ponavljajućeg termina pravi sljedeći ciklus. C1: ako se periodika ne može '
  'razriješiti (ni termin ni vrsta nemaju interval), zatvaranje prolazi ali se prekid upisuje '
  'u prekinuti_lanci i loguje kao WARNING — nikad više tiho.';

-- ═══ (4) Popis već nastalih prekida ════════════════════════════════════════════
-- Prekidi nastali PRIJE ove migracije nemaju red u dnevniku. Bez popisa bi monitoring
-- tvrdio da je sve u redu, a 11 lanaca u PROD-u je već stalo. Kriterij je isti koji trigger
-- primjenjuje u trenutku zatvaranja, primijenjen na zatečeno stanje.
do $$
declare v_n int;
begin
  insert into public.prekinuti_lanci
    (termin_id, klijent_id, lokacija_id, vrsta_provjere_id, datum_izvrsenja, izvor, razlog)
  select t.id, t.klijent_id, t.lokacija_id, t.vrsta_provjere_id, t.datum_izvrsenja, 'popis',
         format('Zatečeno pri popisu: vrsta „%s" nema periodiku, a termin klijenta „%s" '
                'je zatvoren kao ponavljajući — sljedeći ciklus nije nastao.', v.naziv, k.naziv)
    from public.termini t
    join public.vrste_provjera v on v.id = t.vrsta_provjere_id
    join public.klijenti k       on k.id = t.klijent_id
   where t.ponavlja_se
     and t.status = 'izvrseno'
     and t.datum_izvrsenja is not null
     and t.interval_mjeseci is null
     and v.podrazumevani_interval_mjeseci is null
  on conflict (termin_id) do nothing;
  get diagnostics v_n = row_count;
  raise notice 'C1 popis: upisano % zatecenih prekinutih lanaca', v_n;
end;
$$;

-- ═══ (5) Nadzor: „ova vrsta nema periodiku, njeni lanci će stati" ══════════════
-- Zasebna funkcija, a ne samo blok unutar zdravlje_sistema(), iz dva razloga:
--   • zdravlje_sistema() se u ovom auditu prepisuje iz više migracija; ako neka kasnija
--     verzija prepiše spoj ispod, ovaj dio nadzora i dalje postoji i vraća se jednom linijom;
--   • omogućava ciljan poziv (`select zdravlje_periodike()`), bez računanja cijelog zdravlja.
-- SECURITY DEFINER + ista kapija kao zdravlje_sistema(): brojači su SISTEMSKI (sve firme),
-- pa bi invoker verzija operateru pokazala krnje brojeve i alarm bi tiho splasnuo.
create or replace function public.zdravlje_periodike()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_vrste_bez   integer := 0;
  v_vrste_rizik integer := 0;
  v_otvoreni    integer := 0;
  v_prek_uk     integer := 0;
  v_prek_ner    integer := 0;
  v_prek_najst  date;
  v_primjeri    jsonb   := '[]'::jsonb;
  v_alarmi      jsonb   := '[]'::jsonb;
begin
  if not (
    coalesce(public.je_admin(), false)
    or coalesce(auth.role(), '') = 'service_role'
    or session_user = 'postgres' or session_user like 'postgres.%'
  ) then
    raise exception 'zdravlje_periodike: dozvoljeno samo administratoru' using errcode = '42501';
  end if;

  select count(*)::int into v_vrste_bez
    from public.vrste_provjera v
   where v.aktivna and v.podrazumevani_interval_mjeseci is null;

  -- Otvoreni termini kojima se periodika NE MOŽE razriješiti — svaki od njih je lanac koji
  -- će stati čim ga neko zatvori. Ovo je jedini brojač koji zaista boli; broj vrsta bez
  -- periodike sam po sebi nije kvar (jednokratne vrste su legitimne).
  select count(*)::int, count(distinct t.vrsta_provjere_id)::int
    into v_otvoreni, v_vrste_rizik
    from public.termini t
    join public.vrste_provjera v on v.id = t.vrsta_provjere_id
   where t.ponavlja_se
     and t.datum_izvrsenja is null
     and t.status in ('planirano', 'zakazano')
     and t.interval_mjeseci is null
     and v.podrazumevani_interval_mjeseci is null;

  select coalesce(jsonb_agg(x order by x->>'otvorenih_termina' desc), '[]'::jsonb)
    into v_primjeri
    from (
      select jsonb_build_object('vrsta', v.naziv, 'otvorenih_termina', count(*)::int) as x
        from public.termini t
        join public.vrste_provjera v on v.id = t.vrsta_provjere_id
       where t.ponavlja_se
         and t.datum_izvrsenja is null
         and t.status in ('planirano', 'zakazano')
         and t.interval_mjeseci is null
         and v.podrazumevani_interval_mjeseci is null
       group by v.naziv
       order by count(*) desc
       limit 10
    ) s;

  -- „Nerijeseno" = lanac je stao i obaveza se NIJE vratila u plan: za istu trojku
  -- (klijent, lokacija, vrsta) ne postoji nijedan otvoren termin. Računa se, ne pamti —
  -- pa se sam gasi kad neko isplanira sljedeći pregled, i ne može se lažno zatvoriti.
  select count(*)::int,
         count(*) filter (
           where not exists (
             select 1 from public.termini o
              where o.klijent_id = p.klijent_id
                and o.vrsta_provjere_id = p.vrsta_provjere_id
                and o.lokacija_id is not distinct from p.lokacija_id
                and o.status in ('planirano', 'zakazano')
                and o.datum_izvrsenja is null
           )
         )::int,
         min(p.datum_izvrsenja)
    into v_prek_uk, v_prek_ner, v_prek_najst
    from public.prekinuti_lanci p;

  if v_prek_ner > 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'lanac_prekinut', 'nivo', 'kritican',
      'poruka', format('%s zakonskih obaveza je ispalo iz plana: termin je zatvoren, a sljedeći ciklus nije nastao (vrsta bez periodike).', v_prek_ner));
  end if;

  if v_otvoreni > 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'periodika_nedostaje', 'nivo', 'upozorenje',
      'poruka', format('%s otvorenih termina se vodi kao ponavljajuće, a periodika im se ne može razriješiti (%s vrsta bez podrazumijevanog intervala) — po izvršenju lanac staje.',
        v_otvoreni, v_vrste_rizik));
  end if;

  return jsonb_build_object(
    'signali', jsonb_build_object(
      'vrste_bez_periodike',        v_vrste_bez,
      'vrste_sa_ugrozenim_lancem',  v_vrste_rizik,
      'otvoreni_bez_periodike',     v_otvoreni,
      'ugrozene_vrste',             v_primjeri,
      'prekinuti_lanci_ukupno',     v_prek_uk,
      'prekinuti_lanci_nerijeseni', v_prek_ner,
      'prvi_prekid_datum',          v_prek_najst
    ),
    'alarmi', v_alarmi
  );
end;
$$;

comment on function public.zdravlje_periodike() is
  'C1: odgovara na „koje vrste nemaju periodiku i čiji će lanci stati?" — broj ugroženih '
  'otvorenih termina + dnevnik već nastalih prekida (prekinuti_lanci), sa gotovim alarmima. '
  'Spaja se u zdravlje_sistema() pod ključem `periodika`.';

revoke all on function public.zdravlje_periodike() from public;
revoke all on function public.zdravlje_periodike() from anon;
grant execute on function public.zdravlje_periodike() to authenticated;
grant execute on function public.zdravlje_periodike() to service_role;

-- ═══ (6) Spoj u zdravlje_sistema() ═════════════════════════════════════════════
-- Tijelo ispod je DOSLOVNA kopija iz 20260802160000_zdravlje_sistema.sql; jedine izmjene su
-- deklaracija `v_per` i tri linije spoja neposredno prije računanja presude (označene sa C1).
-- Ako neka kasnija migracija ponovo prepiše zdravlje_sistema() iz starije kopije, spoj se
-- gubi (funkcija zdravlje_periodike() ostaje) — vraća se dodavanjem ista tri reda.

create or replace function public.zdravlje_sistema()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_danas        date        := (now() at time zone 'Europe/Belgrade')::date;
  v_sat          integer     := extract(hour from (now() at time zone 'Europe/Belgrade'))::int;
  v_post         record;
  v_dana         integer[];
  v_cron         jsonb       := '{}'::jsonb;
  v_pod_pokrenut timestamptz;
  v_pod_uspjeh   timestamptz;
  v_pod_greske   integer     := 0;
  v_signali      jsonb;
  v_per          jsonb;      -- C1: periodika (zdravlje_periodike())
  v_alarmi       jsonb       := '[]'::jsonb;
  v_stanje       text        := 'ok';
  -- pre-due
  v_ceka_pre     integer := 0;
  v_min_dana     integer;
  -- post-due
  v_ceka_post    integer := 0;
  v_propusteno   integer := 0;
  v_post_zaglav  integer := 0;
  -- digest
  v_dig_datum    date;
  v_dig_zaglav   integer := 0;
  -- mejlovi
  v_m24_ok       integer := 0;
  v_m24_gr       integer := 0;
  v_m7_ok        integer := 0;
  v_m7_gr        integer := 0;
  v_m_zadnji     timestamptz;
  v_bounce       integer := 0;
  v_bez_traga    integer := 0;
  -- primaoci
  v_prim_uk      integer := 0;
  v_prim_admin   integer := 0;
  v_prim_lose    integer := 0;
  -- storage
  v_zbs          integer := 0;
  v_zbs_dana     integer;
begin
  -- Pristup: administrator (ekran), service_role (dnevni sažetak / cron) ili direktna
  -- superuser veza (psql / `pnpm audit:sql`, koja ionako vidi cijelu bazu). Operater i
  -- „pregled" NE vide sistemsko zdravlje — brojači obuhvataju sve firme.
  -- `session_user`, ne `current_user`: unutar SECURITY DEFINER-a je current_user uvijek
  -- vlasnik funkcije, pa bi provjera po njemu propustila svakoga. PostgREST se veže kao
  -- `authenticator` i ovom granom NE prolazi.
  if not (
    coalesce(public.je_admin(), false)
    or coalesce(auth.role(), '') = 'service_role'
    or session_user = 'postgres' or session_user like 'postgres.%'
  ) then
    raise exception 'zdravlje_sistema: dozvoljeno samo administratoru' using errcode = '42501';
  end if;

  select p.podsjetnici_aktivni, p.vrijeme_slanja_sat, p.zadnje_slanje_datum,
         p.salji_klijentima, p.dana_prije
    into v_post
    from public.postavke p where p.id = 1;

  -- Isti fallback kao lib/reminders/recipients.ts (DEFAULT_DANA) — baza bez reda `postavke`
  -- je legitimno stanje, ne kvar.
  v_dana := case
              when v_post.dana_prije is null or cardinality(v_post.dana_prije) = 0
                then array[60, 30, 15, 7]
              else v_post.dana_prije
            end;

  -- ── otkucaji ──
  select coalesce(jsonb_object_agg(
           o.posao,
           jsonb_build_object(
             'zadnje_pokretanje',  o.zadnje_pokretanje,
             'sati_od_pokretanja', round(extract(epoch from (now() - o.zadnje_pokretanje)) / 3600.0, 1),
             'zadnji_uspjeh',      o.zadnji_uspjeh,
             'sati_od_uspjeha',    case when o.zadnji_uspjeh is null then null
                                        else round(extract(epoch from (now() - o.zadnji_uspjeh)) / 3600.0, 1) end,
             'zadnji_ishod',       o.zadnji_ishod,
             'uzastopne_greske',   o.uzastopne_greske,
             'zadnja_greska',      o.zadnja_greska,
             'detalji',            o.detalji
           )
         ), '{}'::jsonb)
    into v_cron
    from public.cron_otkucaji o;

  select o.zadnje_pokretanje, o.zadnji_uspjeh, o.uzastopne_greske
    into v_pod_pokrenut, v_pod_uspjeh, v_pod_greske
    from public.cron_otkucaji o where o.posao = 'podsjetnici';

  -- ── pre-due: šta bi motor poslao DA JE POZVAN OVOG TRENUTKA ──
  select count(*)::int, min(d.dana_do_roka)
    into v_ceka_pre, v_min_dana
    from public.get_due_podsjetnici(v_dana) d;

  -- ── post-due ──
  select count(*)::int,
         -- „Propušteno" nije isto što i „čeka": termin koji je istekao POSLIJE zadnjeg
         -- uspješnog kruga legitimno čeka sljedeći. Propušten je onaj koji je bio dospio
         -- već u trenutku zadnjeg uspješnog kruga, a obavijest svejedno nije otišla.
         count(*) filter (
           where v_pod_uspjeh is not null
             and t.ciklus_rok < (v_pod_uspjeh at time zone 'Europe/Belgrade')::date
         )::int
    into v_ceka_post, v_propusteno
    from public.get_post_due_termine() t;

  select count(*)::int into v_post_zaglav
    from public.post_due_obavijesti
   where stanje = 'u_toku' and claimed_at < now() - interval '1 hour';

  -- ── digest ──
  select max(datum) into v_dig_datum from public.digest_slanja where stanje = 'poslato';
  select count(*)::int into v_dig_zaglav
    from public.digest_slanja
   where stanje = 'u_toku' and claimed_at < now() - interval '1 hour';

  -- ── mejlovi (24 h / 7 dana) ──
  select count(*) filter (where status = 'poslato' and created_at >= now() - interval '24 hours')::int,
         count(*) filter (where status = 'greska_slanja' and created_at >= now() - interval '24 hours')::int,
         count(*) filter (where status = 'poslato')::int,
         count(*) filter (where status = 'greska_slanja')::int,
         max(created_at) filter (where status = 'poslato'),
         count(*) filter (where delivery_status in ('bounced', 'delivery_failed', 'complained'))::int
    into v_m24_ok, v_m24_gr, v_m7_ok, v_m7_gr, v_m_zadnji, v_bounce
    from public.mejl_log
   where created_at >= now() - interval '7 days';

  -- ── mejl poslat, ali bez traga u dnevniku ──
  -- Upis u `mejl_log` je NAMJERNO best-effort (lib/email/posaljiIzabiljezi.ts: greška se
  -- samo loguje da neuspjeh dnevnika ne obori slanje). Posljedica: mejl ode, a u
  -- „Poslatim mejlovima" ga nema. Motorski ledgeri (`podsjetnici`, `post_due_obavijesti`,
  -- `digest_slanja`) pamte isti `resend_id`, pa se razlika mjeri tačno, bez nagađanja.
  -- 'dry-run'/'unknown' se izuzimaju: to nisu stvarna slanja ('demo' JESTE u dnevniku).
  select count(*)::int into v_bez_traga
    from (
      select resend_id, poslat_at from public.podsjetnici
      union all
      select resend_id, poslat_at from public.post_due_obavijesti where stanje = 'poslato'
      union all
      select resend_id, poslat_at from public.digest_slanja where stanje = 'poslato'
    ) l
   where l.resend_id is not null
     and l.resend_id not in ('dry-run', 'unknown')
     and l.poslat_at >= now() - interval '7 days'
     and not exists (select 1 from public.mejl_log m where m.resend_id = l.resend_id);

  -- ── interni primaoci: bez ijednog, svaki podsjetnik se tiho „preskače" ──
  -- Lista nerutabilnih zona je preslikana iz lib/reminders/recipients.ts (NERUTABILNE_ZONE).
  -- Ako se tamo promijeni, ovdje ostaje samo UPOZORENJE neprecizno — slanje ne zavisi od nje.
  select count(*) filter (where k.aktivan and k.prima_podsjetnike)::int,
         count(*) filter (where k.aktivan and k.prima_podsjetnike and k.uloga = 'admin')::int,
         count(*) filter (
           where k.aktivan and k.prima_podsjetnike and exists (
             select 1 from unnest(array['local','test','example','invalid','localhost',
                                        'example.com','example.net','example.org',
                                        'home.arpa','alt','internal']) z(z)
              where split_part(lower(k.email), '@', 2) = z.z
                 or split_part(lower(k.email), '@', 2) like '%.' || z.z
           )
         )::int
    into v_prim_uk, v_prim_admin, v_prim_lose
    from public.korisnici k;

  -- ── storage: red čekanja za brisanje ──
  select count(*)::int, max((now()::date - trazeno_at::date))::int
    into v_zbs, v_zbs_dana
    from public.za_brisanje_iz_storagea;

  v_signali := jsonb_build_object(
    'cron', v_cron,
    'pre_due', jsonb_build_object(
      'aktivan',              coalesce(v_post.podsjetnici_aktivni, true),
      'sat_slanja',           coalesce(v_post.vrijeme_slanja_sat, 8),
      'zadnje_slanje_datum',  v_post.zadnje_slanje_datum,
      'marker_danasnji',      v_post.zadnje_slanje_datum is not distinct from v_danas,
      'dana_prije',           to_jsonb(v_dana),
      'ceka_slanje',          v_ceka_pre,
      'najhitniji_dana_do_roka', v_min_dana
    ),
    'post_due', jsonb_build_object(
      'ceka_obavijest',   v_ceka_post,
      'propusteno',       v_propusteno,
      'zaglavljeni_claim', v_post_zaglav
    ),
    'digest', jsonb_build_object(
      'zadnji_datum',      v_dig_datum,
      'zaglavljeni_claim', v_dig_zaglav
    ),
    'mejlovi', jsonb_build_object(
      'poslato_24h', v_m24_ok, 'greske_24h', v_m24_gr,
      'poslato_7d',  v_m7_ok,  'greske_7d',  v_m7_gr,
      'zadnji_poslat_at', v_m_zadnji,
      'neuspjela_dostava_7d', v_bounce,
      'bez_traga_u_dnevniku_7d', v_bez_traga
    ),
    'primaoci', jsonb_build_object(
      'interni_ukupno',  v_prim_uk,
      'admini',          v_prim_admin,
      'nerutabilne_adrese', v_prim_lose,
      'salji_klijentima', coalesce(v_post.salji_klijentima, false)
    ),
    'storage', jsonb_build_object(
      'ceka_brisanje',  v_zbs,
      'najstarije_dana', v_zbs_dana
    )
  );

  -- ── presuda ──────────────────────────────────────────────────────────────
  -- Pragovi su namjerno nisko postavljeni: sistem šalje malo mejlova dnevno, pa bi visok
  -- prag značio da ispad kod jednog jedinog zakonskog roka prođe nevidljivo. Lažan alarm
  -- košta jedan pogled u ekran; propušten alarm košta rok o kojem niko nije obaviješten.

  -- 26 h = dva promašena termina (09:00 i 13:00 UTC) + rezerva za pomjeranje cron-a.
  if v_pod_pokrenut is null then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'cron_nikad', 'nivo', 'kritican',
      'poruka', 'Cron „podsjetnici" nije zabilježio nijedan otkucaj. Ili nije deployan, ili CRON_SECRET ne prolazi.');
  elsif v_pod_pokrenut < now() - interval '26 hours' then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'cron_ne_radi', 'nivo', 'kritican',
      'poruka', format('Cron „podsjetnici" nije pozvan %s h (zadnji put %s).',
        round(extract(epoch from (now() - v_pod_pokrenut)) / 3600.0, 1),
        to_char(v_pod_pokrenut at time zone 'Europe/Belgrade', 'DD.MM.YYYY HH24:MI')));
  end if;

  if coalesce(v_pod_greske, 0) >= 2 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'cron_pada', 'nivo', 'kritican',
      'poruka', format('Cron „podsjetnici" je pao %s puta zaredom.', v_pod_greske));
  end if;

  -- Ostali poslovi su dnevni; 50 h = dva promašena termina.
  if exists (select 1 from public.cron_otkucaji o
              where o.posao <> 'podsjetnici' and o.zadnje_pokretanje < now() - interval '50 hours') then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'cron_odrzavanje_ne_radi', 'nivo', 'upozorenje',
      'poruka', 'Poslovi održavanja (čišćenje audita/storagea) nisu pozvani duže od 50 h.');
  end if;

  -- Ugašen prekidač je legitimna odluka, ali NE SMIJE biti tiha: dok stoji, nijedan
  -- zakonski rok ne izlazi iz sistema.
  if not coalesce(v_post.podsjetnici_aktivni, true) then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'podsjetnici_iskljuceni', 'nivo', 'upozorenje',
      'poruka', 'Automatsko slanje podsjetnika je ISKLJUČENO u Postavkama.');
  -- +2 h poslije izabranog sata: cron ide na puni sat, a krug može trajati i par minuta.
  elsif v_sat >= coalesce(v_post.vrijeme_slanja_sat, 8) + 2
        and v_post.zadnje_slanje_datum is distinct from v_danas then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'slanje_nije_krenulo', 'nivo', 'kritican',
      'poruka', format('Danas (%s) dnevni krug podsjetnika nije odrađen, a prošlo je %s h od izabranog sata.',
        to_char(v_danas, 'DD.MM.YYYY'), v_sat - coalesce(v_post.vrijeme_slanja_sat, 8)));
  end if;

  if v_propusteno > 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'istekli_bez_obavijesti', 'nivo', 'kritican',
      'poruka', format('%s isteklih termina nije dobilo obavijest ni nakon uspješnog kruga.', v_propusteno));
  elsif v_ceka_post > 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'istekli_cekaju', 'nivo', 'upozorenje',
      'poruka', format('%s isteklih termina čeka obavijest u sljedećem krugu.', v_ceka_post));
  end if;

  -- Marker kaže da je krug prošao, a red nije prazan → ili nema primalaca, ili je cap
  -- odgodio ostatak. Oba puta mejl NIJE otišao.
  if v_ceka_pre > 0 and v_post.zadnje_slanje_datum is not distinct from v_danas then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'podsjetnici_zaostaju', 'nivo', 'upozorenje',
      'poruka', format('Današnji krug je prošao, a %s podsjetnika i dalje čeka (nema primalaca ili je cap odgodio).', v_ceka_pre));
  end if;

  if v_prim_uk = 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'nema_primalaca', 'nivo', 'kritican',
      'poruka', 'Nijedan aktivan korisnik ne prima podsjetnike — interni kanal se tiho preskače.');
  elsif v_prim_lose > 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'nerutabilne_adrese', 'nivo', 'upozorenje',
      'poruka', format('%s primalaca ima adresu u zoni koja ne postoji na javnom DNS-u (npr. .local/.test).', v_prim_lose));
  end if;

  -- Isti prag kao HTTP 5xx u cron ruti (B3): ≥50% pokušaja palo, uz bar jednu grešku.
  if v_m24_gr > 0 and v_m24_gr::numeric / nullif(v_m24_ok + v_m24_gr, 0) >= 0.5 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'slanje_pada', 'nivo', 'kritican',
      'poruka', format('U zadnja 24 h palo je %s od %s pokušaja slanja.', v_m24_gr, v_m24_ok + v_m24_gr));
  end if;

  if v_bez_traga > 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'mejl_bez_traga', 'nivo', 'upozorenje',
      'poruka', format('%s mejlova je poslato, a nema ih u dnevniku (upis u mejl_log je pao).', v_bez_traga));
  end if;

  if v_bounce > 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'dostava_pada', 'nivo', 'upozorenje',
      'poruka', format('%s mejlova u 7 dana nije isporučeno (bounce/odbijeno/spam).', v_bounce));
  end if;

  -- Claim uzet a ishod nikad upisan: mejl je možda otišao, a možda nije — i jedno i drugo
  -- traži ljudsku provjeru prije nego što sistem pokuša ponovo.
  if v_post_zaglav + v_dig_zaglav > 0 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'zaglavljen_claim', 'nivo', 'upozorenje',
      'poruka', format('%s zauzeća starijih od 1 h nema upisan ishod (post-due %s, digest %s).',
        v_post_zaglav + v_dig_zaglav, v_post_zaglav, v_dig_zaglav));
  end if;

  -- Metenje storagea se može TRAJNO onesposobiti bez ijedne greške: bez
  -- CISCENJE_STORAGEA_APPLY=1 ruta zauvijek vraća uredan `{ ok: true, probno: true }`.
  -- Ovaj alarm je precizan i SAM SE GASI čim se prekidač uključi (otkucaj prestane nositi
  -- probno=true) — javlja se tek kad probni prolaz zaista ima šta da obriše.
  if exists (
    select 1 from public.cron_otkucaji o
     where o.posao = 'ciscenje-storagea'
       and (o.detalji ->> 'probno') = 'true'
       and coalesce((o.detalji ->> 'biObrisano')::int, 0) > 0
  ) then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'metenje_probno', 'nivo', 'upozorenje',
      'poruka', 'Metenje storagea radi u PROBNOM režimu — našlo je šta da obriše, a ne briše ništa (CISCENJE_STORAGEA_APPLY nije "1").');
  end if;

  -- Red čekanja koji se ne prazni. PAŽNJA: dok potrošač ne briše redove iz
  -- `za_brisanje_iz_storagea` (v. O1-monitoring.md, nalaz „red se ne prazni"), ovaj alarm
  -- ostaje upaljen i nakon uspješnog metenja. Namjerno je `upozorenje`, ne `kritican`.
  if v_zbs > 0 and coalesce(v_zbs_dana, 0) >= 3 then
    v_alarmi := v_alarmi || jsonb_build_object('kod', 'sweep_ne_brise', 'nivo', 'upozorenje',
      'poruka', format('%s fajlova čeka brisanje iz storagea, najstariji %s dana.', v_zbs, v_zbs_dana));
  end if;

  -- ── C1: periodika ────────────────────────────────────────────────────────
  -- Vrsta bez podrazumijevanog intervala tiho ubija lanac obaveze pri zatvaranju termina.
  -- Signali i alarmi se računaju u zdravlje_periodike() i samo se ulijevaju ovdje, da ovaj
  -- fajl ne mora znati detalje (i da preživi buduće prepisivanje ove funkcije).
  v_per     := public.zdravlje_periodike();
  v_signali := v_signali || jsonb_build_object('periodika', v_per -> 'signali');
  v_alarmi  := v_alarmi  || (v_per -> 'alarmi');

  select case when count(*) filter (where a->>'nivo' = 'kritican') > 0 then 'kritican'
              when count(*) > 0 then 'upozorenje'
              else 'ok' end
    into v_stanje
    from jsonb_array_elements(v_alarmi) a;

  return jsonb_build_object(
    'vrijeme', to_char(now() at time zone 'Europe/Belgrade', 'DD.MM.YYYY HH24:MI'),
    'datum',   v_danas,
    'stanje',  v_stanje,
    'alarmi',  v_alarmi,
    'signali', v_signali
  );
end;
$$;

comment on function public.zdravlje_sistema() is
  'O1: jedan poziv = odgovor na „radi li sistem danas?". Vraća sirove signale (otkucaji '
  'cron-a, red čekanja pre-due/post-due, mejlovi 24 h/7 d, primaoci, storage) I gotovu '
  'presudu (alarmi + stanje ok/upozorenje/kritican). SECURITY DEFINER jer su brojači '
  'sistemski; pristup: administrator ili service_role.';

revoke all on function public.zdravlje_sistema() from public;
revoke all on function public.zdravlje_sistema() from anon;
grant execute on function public.zdravlje_sistema() to authenticated;
grant execute on function public.zdravlje_sistema() to service_role;
