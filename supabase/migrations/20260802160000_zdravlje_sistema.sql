-- O1 (02.08.2026.): monitoring — kvar mora biti vidljiv bez čitanja Vercel logova.
--
-- ŠTA JE RUPA
-- Sistem nema nijedan trag o tome DA JE cron uopšte pozvan. Sve što ostaje iza uspješnog
-- kruga je posljedica slanja (`podsjetnici`, `post_due_obavijesti`, `mejl_log`,
-- `postavke.zadnje_slanje_datum`). Na dan kad nema šta da se pošalje — a takvih dana je
-- većina — mrtav cron i miran dan izgledaju IDENTIČNO. Tako je pre-due motor stajao 9 dana
-- a da to niko nije primijetio, i tako se metenje storagea može trajno onesposobiti
-- (CISCENJE_STORAGEA_APPLY nije "1") bez ijednog signala.
--
-- ŠTA OVA MIGRACIJA DODAJE
--   1) `cron_otkucaji` — jedan red po poslu, „srce": kad je posao zadnji put POKRENUT, kad
--      je zadnji put USPIO, koliko puta zaredom je pao, i sažetak zadnjeg kruga (jsonb).
--      Piše ga `zabiljezi_cron_otkucaj` iz same cron rute, na kraju SVAKOG poziva — i kad
--      nije poslato ništa. Odsustvo svježeg otkucaja je onda samo po sebi dokaz kvara.
--      Jedan red po poslu (upsert), ne istorija: red ne raste, ne treba mu čišćenje.
--   2) `zabiljezi_cron_otkucaj(...)` — upis otkucaja (SECURITY DEFINER, samo service_role).
--   3) `zdravlje_sistema()` — JEDAN poziv koji odgovara na pitanje „radi li sistem danas?":
--      vraća sirove brojače (signali) I gotovu presudu (alarmi + stanje), pa isti odgovor
--      mogu koristiti ekran, dnevni sažetak i ručni `curl`, bez ijednog novog servisa.
--
-- ODNOS PREMA B3 (cron vraća 5xx kad slanje pada)
-- HTTP status pokriva SAMO krugove u kojima je cron zaista pozvan i nešto pokušao. Ova
-- migracija pokriva komplementarnu polovinu: cron koji NIJE pozvan, krug koji je prošao
-- „uspješno" a ništa nije poslao, i tihi zaostatak (istekli rokovi bez obavijesti).
--
-- Idempotentno i sigurno za ponovno pokretanje.

-- ─────────────────────── 1) Srce: red po cron poslu ───────────────────────
create table if not exists public.cron_otkucaji (
  posao             text        primary key,
  zadnje_pokretanje timestamptz not null default now(),
  zadnji_uspjeh     timestamptz,
  zadnji_ishod      text        not null default 'ok',
  uzastopne_greske  integer     not null default 0,
  zadnja_greska     text,
  detalji           jsonb       not null default '{}'::jsonb,
  constraint chk_cron_ishod check (zadnji_ishod in ('ok', 'preskoceno', 'greska')),
  constraint chk_cron_posao check (length(btrim(posao)) > 0)
);

comment on table public.cron_otkucaji is
  'O1: „srce" cron poslova — dokaz da je posao POKRENUT, nezavisan od toga da li je imao šta '
  'da pošalje. Jedan red po poslu (upsert iz zabiljezi_cron_otkucaj). Bez ovoga mrtav cron i '
  'miran dan izgledaju isto.';
comment on column public.cron_otkucaji.zadnje_pokretanje is
  'Svaki poziv rute, bez obzira na ishod — ovo je signal „mašina je živa".';
comment on column public.cron_otkucaji.zadnji_uspjeh is
  'Samo ishod ok/preskoceno. „preskoceno" (npr. već slato danas, izvan sata) JESTE uspjeh: '
  'posao je odlučio da nema šta da radi, što je normalno stanje, ne kvar.';
comment on column public.cron_otkucaji.uzastopne_greske is
  'Resetuje se na 0 pri prvom ne-greška ishodu. Prag alarma je 2 — jedna greška može biti '
  'trenutni ispad Resend-a/mreže, dvije zaredom su kvar.';
comment on column public.cron_otkucaji.detalji is
  'Sažetak zadnjeg kruga koji ruta već računa (poslato, greske, odgodjeno, trajanjeMs, '
  'probni režim metenja...). Namjerno slobodan oblik — ovo je dijagnostika, ne ugovor.';

-- RLS: čitanje samo administratorima. Upis NEMA politiku — ide isključivo kroz
-- SECURITY DEFINER funkciju ispod (service_role iz cron rute), kao kod `primijenjene_migracije`.
alter table public.cron_otkucaji enable row level security;

drop policy if exists co_sel on public.cron_otkucaji;
create policy co_sel on public.cron_otkucaji for select using (je_admin());

-- ─────────────────────── 2) Upis otkucaja ───────────────────────
-- SECURITY DEFINER jer tabela nema insert/update politiku: jedini put upisa je ova funkcija,
-- a pravo na nju ima samo service_role (cron ruta). Time nijedan prijavljeni korisnik ne može
-- lažirati „cron je radio".
create or replace function public.zabiljezi_cron_otkucaj(
  p_posao   text,
  p_ishod   text,
  p_detalji jsonb default '{}'::jsonb,
  p_greska  text  default null
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_ishod not in ('ok', 'preskoceno', 'greska') then
    raise exception 'nepoznat ishod: %', p_ishod;
  end if;

  insert into public.cron_otkucaji as c
    (posao, zadnje_pokretanje, zadnji_uspjeh, zadnji_ishod, uzastopne_greske, zadnja_greska, detalji)
  values (
    p_posao,
    now(),
    case when p_ishod = 'greska' then null else now() end,
    p_ishod,
    case when p_ishod = 'greska' then 1 else 0 end,
    case when p_ishod = 'greska' then left(coalesce(p_greska, 'bez poruke'), 2000) else null end,
    coalesce(p_detalji, '{}'::jsonb)
  )
  on conflict (posao) do update set
    zadnje_pokretanje = now(),
    -- Uspjeh se pamti kao ZADNJI uspjeh, ne briše se prvom greškom: razmak između
    -- „zadnji uspjeh" i „sada" je mjera koliko dugo sistem stvarno ne radi.
    zadnji_uspjeh     = case when p_ishod = 'greska' then c.zadnji_uspjeh else now() end,
    zadnji_ishod      = p_ishod,
    uzastopne_greske  = case when p_ishod = 'greska' then c.uzastopne_greske + 1 else 0 end,
    zadnja_greska     = case when p_ishod = 'greska' then left(coalesce(p_greska, 'bez poruke'), 2000) else null end,
    detalji           = coalesce(p_detalji, '{}'::jsonb);
end;
$$;

comment on function public.zabiljezi_cron_otkucaj(text, text, jsonb, text) is
  'O1: upisuje otkucaj cron posla. Zove se na kraju SVAKOG poziva cron rute, uključujući '
  'preskočene krugove — otkucaj je dokaz da je mašina pozvana, ne da je nešto poslato.';

revoke all on function public.zabiljezi_cron_otkucaj(text, text, jsonb, text) from public;
revoke all on function public.zabiljezi_cron_otkucaj(text, text, jsonb, text) from anon;
revoke all on function public.zabiljezi_cron_otkucaj(text, text, jsonb, text) from authenticated;
grant execute on function public.zabiljezi_cron_otkucaj(text, text, jsonb, text) to service_role;

-- ─────────────────────── 3) Jedan poziv = odgovor „radi li sistem danas?" ───────────────────────
-- SECURITY DEFINER: brojači su SISTEMSKI (koliko isteklih rokova čeka obavijest UKUPNO), a ne
-- „koliko ih vidi ovaj korisnik". Kad bi funkcija bila invoker, RLS bi operateru pokazao samo
-- njegove firme i alarm bi tiho nestao. Zato pristup gejtuje eksplicitna provjera ispod.
--
-- Namjerno NE duplira definicije motora: „šta čeka slanje" pita iste RPC-e koje zove i sam
-- motor (get_due_podsjetnici / get_post_due_termine). Prepisana kopija bi vremenom odlutala
-- od motora i nadzor bi tvrdio da je sve u redu dok motor misli suprotno.
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
