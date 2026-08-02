-- C3 — uloga „pregled" i dalje piše u bazu kroz SECURITY DEFINER funkcije.
--
-- Popravka B6 (20260802134500) zatvorila je samo `oznaci_mejl_pregledan`.
-- Revizija SVIH SECURITY DEFINER funkcija u živoj bazi (pg_proc.prosecdef = true,
-- šema public, 27 funkcija) pokazala je da su preživjela DVA upisna puta koja
-- „pregled" i dalje može pozvati preko PostgREST-a:
--
--   1) zabiljezi_mejl_log            (20260713120000_mejl_log.sql)
--      Gejt je bio samo je_admin() ILI ima_pristup_klijentu(p_klijent_id).
--      Uloga „pregled" ima dodjele klijenata (PROD: 2/2 pregled korisnika imaju
--      dodjelu) → prolazi drugi uslov i fabrikuje zapise u dnevniku mejlova:
--      lažni primaoci, lažan subject, lažan status „poslato". Tabela mejl_log
--      nema INSERT politiku, pa je ovaj RPC bio JEDINI upisni put — i bio je otvoren.
--
--   2) zabiljezi_zakazano_obavijest  (20260710160000_zakazano_obavijest_prekidac.sql)
--      Isti scope-guard (ima_pristup_klijentu) → „pregled" prolazi i troši
--      idempotencijski slot u termin_zakazano_obavijest. Posljedica je TRAJNA:
--      `on conflict (termin_id, datum_zakazan) do nothing` znači da stvarna
--      obavijest „zakazano poslije roka" za taj termin i datum više NIKAD neće
--      biti poslata. Tiho gubljenje zakonske obavijesti — najskuplja klasa greške
--      u ovom sistemu.
--
-- Rješenje je obrazac koji projekat već koristi u `oznaci_mejl_pregledan`:
-- `if je_pregled() then return; end if;` kao PRVI izvršni korak.
--
-- SERVICE-ROLE PUT OSTAJE OTVOREN: je_pregled() čita auth.uid(); cron (Vercel) i
-- skripte rade pod service_role ključem gdje auth.uid() vraća NULL → exists(...)
-- je false → je_pregled() je false → gejt ih ne dodiruje. Isto važi za direktan
-- psql pristup kao `postgres`.
--
-- Idempotentno / re-run-safe: samo `create or replace function` sa NEPROMIJENJENIM
-- signaturama (ACL se pri replace-u čuva; grant-ovi se ipak ponavljaju radi
-- samodostatnosti, isto kao u izvornim migracijama). Nema DDL-a nad tabelama,
-- nema novih ograničenja → nema potrebe za sanacijom zatečenih redova.
--
-- SVJESNO NIJE GEJTOVANO — `zabiljezi_dogadjaje`:
--   Ta funkcija upisuje u audit_log SAMO vlastitu telemetriju pozivaoca
--   (korisnik_id je prisilno auth.uid(), akcija ograničena na
--   NAVIGATE/VIEW/LOGIN/LOGOUT/FILTER). To nije korisnički podatak nego revizioni
--   trag. Gejtovanje bi obrisalo prijave, odjave i preglede upravo onih naloga
--   čije je čitanje jedino što ima smisla revidirati (read-only uloga) — dakle
--   smanjilo bi bezbjednost umjesto da je poveća. Ostaje otvoreno namjerno.

-- ── 1) zabiljezi_mejl_log ─────────────────────────────────────────────────────
create or replace function zabiljezi_mejl_log(
  p_tip        mejl_tip,
  p_primaoci   text[],
  p_subject    text,
  p_termin_id  uuid,
  p_klijent_id uuid,
  p_resend_id  text,
  p_status     mejl_status,
  p_greska     text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- C3: read-only uloga ne piše ni preko definer funkcije.
  -- Stoji PRIJE svega ostalog; za service_role je auth.uid() NULL → je_pregled()
  -- je false → cron/skripte prolaze nepromijenjeno.
  if je_pregled() then return; end if;

  -- service_role (cron): auth.uid() NULL → trusted server-context.
  -- authenticated: mora je_admin() ILI ima_pristup_klijentu(p_klijent_id).
  if auth.uid() is not null
     and not ( je_admin()
               or ( p_klijent_id is not null and ima_pristup_klijentu(p_klijent_id) ) )
  then
    return;  -- nema prava → tiho preskoči (best-effort; wrapper ne baca)
  end if;

  insert into mejl_log
    (tip, primaoci, subject, termin_id, klijent_id, resend_id, status, greska, delivery_status)
  values
    (p_tip, p_primaoci, p_subject, p_termin_id, p_klijent_id, p_resend_id, p_status, p_greska, 'nepoznato');
end; $$;

revoke execute on function zabiljezi_mejl_log(mejl_tip,text[],text,uuid,uuid,text,mejl_status,text)
  from public, anon;
grant  execute on function zabiljezi_mejl_log(mejl_tip,text[],text,uuid,uuid,text,mejl_status,text)
  to authenticated, service_role;

-- ── 2) zabiljezi_zakazano_obavijest ───────────────────────────────────────────
create or replace function zabiljezi_zakazano_obavijest(
  p_termin_id uuid,
  p_datum_zakazan date,
  p_base text[]
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_klijent  uuid;
  v_primaoci text[];
  v_inserted int;
begin
  -- C3: read-only uloga ne troši idempotencijski slot. Vraća '{}' — isto što i
  -- ostali „preskoči" izlazi, pa pozivalac (lib/reminders/zakazanoNakonRoka.ts)
  -- to već ispravno tumači kao razlog „preskoceno" i ne šalje mejl.
  if je_pregled() then return '{}'; end if;

  -- PREKIDAČ: ako je "zakazano poslije roka" obavijest isključena u postavkama,
  -- tiho preskoči (ne računaj primaoce, ne zauzimaj idempotencijski slot).
  -- coalesce(..., true): red/kolona koja nedostaje = uključeno (fail-safe na staro ponašanje).
  if not coalesce((select zakazano_obavijest_aktivna from postavke where id = 1), true) then
    return '{}';
  end if;

  select klijent_id into v_klijent from termini where id = p_termin_id;
  if v_klijent is null then
    return '{}';
  end if;

  -- Scope guard: DEFINER bypass-uje RLS, pa moramo ručno provjeriti da pozivalac
  -- ima pristup ovom klijentu (isti helper kao RLS policije; čita auth.uid()).
  if not ima_pristup_klijentu(v_klijent) then
    return '{}';
  end if;

  select array(
    select distinct lower(btrim(email)) as e
    from (
      select k.email
      from korisnici k
      where k.aktivan and k.prima_podsjetnike
        and (
          k.uloga = 'admin'
          or exists (
            select 1 from korisnik_klijent kk
            where kk.korisnik_id = k.id and kk.klijent_id = v_klijent
          )
        )
      union
      select unnest(coalesce(p_base, '{}'))
    ) s(email)
    where lower(btrim(email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) into v_primaoci;

  if v_primaoci is null or array_length(v_primaoci, 1) is null then
    return '{}';
  end if;

  insert into termin_zakazano_obavijest (termin_id, datum_zakazan, poslat_na)
  values (p_termin_id, p_datum_zakazan, v_primaoci)
  on conflict (termin_id, datum_zakazan) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    return '{}';  -- već poslato za ovaj (termin, datum_zakazan)
  end if;

  return v_primaoci;
end;
$$;

revoke execute on function zabiljezi_zakazano_obavijest(uuid, date, text[]) from public;
revoke execute on function zabiljezi_zakazano_obavijest(uuid, date, text[]) from anon;
grant  execute on function zabiljezi_zakazano_obavijest(uuid, date, text[]) to authenticated;

-- Evidenciju u primijenjene_migracije NE pišemo odavde — nju popunjava
-- scripts/apply-cloud-migration.ts zajedno sa kontrolnom sumom fajla.
