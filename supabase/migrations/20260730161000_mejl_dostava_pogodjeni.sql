-- mejl_log pamti KOJE su adrese pogođene neuspjelom dostavom.
--
-- Zašto: jedan red u mejl_log je JEDAN Resend send (jedan `email_id`) sa više primalaca,
-- a Resend za taj send šalje jedan `email.bounced` event. Do sada je taj jedan event
-- postavljao `delivery_status='bounced'` za cijeli red, pa je mejl koji je stigao dvojici
-- od tri primaoca u „Poslatim mejlovima" izgledao kao da nije stigao nikome.
-- PROD, 30.07.2026: dva reda su bila crvena samo zbog `admin@tehpro.local` (rezervisan TLD,
-- bez MX zapisa), dok su ostali primaoci mejl uredno dobili.
--
-- Resend u `data.to` bounce eventa vraća POGOĐENE adrese. Čuvamo ih, pa prikaz može reći
-- „Odbijeno (1 od 3)" i imenovati adresu umjesto da laže o cijelom sendu.
--
-- Namjerno NIJE dirano: `jeGreska` i `get_mejl_greske_broj` i dalje broje djelimičan bounce
-- kao grešku. Adresa koja tiho ispadne iz podsjetnika je upravo ono što sistem treba da
-- uhvati — pogrešna je bila etiketa, ne to što red traži pažnju.

-- 1) Kolona. `not null default '{}'` → stari redovi su „nemamo podatak", što `dostavaObim`
--    konzervativno tumači kao potpun neuspjeh (bez izmišljanja).
alter table mejl_log
  add column if not exists dostava_pogodjeni text[] not null default '{}';

-- 2) Upisni RPC dobija pogođene adrese. Potpis se mijenja → drop pa create (dodavanje
--    parametra sa DEFAULT-om bi napravilo preklapajući overload i učinilo 3-argumentni
--    poziv dvosmislenim). `search_path = public, pg_temp` je zadržan iz
--    20260729120000_search_path_pg_temp.sql — bez pg_temp se hardening tiho gubi.
drop function if exists azuriraj_mejl_dostavu(text, mejl_dostava_status, timestamptz);

create function azuriraj_mejl_dostavu(
  p_resend_id  text,
  p_status     mejl_dostava_status,
  p_at         timestamptz,
  p_pogodjeni  text[] default '{}'
) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v int;
begin
  update mejl_log
     set delivery_status = p_status,
         delivery_at     = p_at,
         -- Pogođene adrese pamtimo samo za neuspjehe; uspješan događaj ih ne briše,
         -- da se istorija ranijeg problema ne izgubi kad kasnije stigne 'opened'.
         dostava_pogodjeni = case when p_status in ('bounced','complained','delivery_failed')
                                  then coalesce(p_pogodjeni, '{}') else dostava_pogodjeni end,
         pregledano_at   = case when p_status in ('bounced','complained','delivery_failed')
                                then null else pregledano_at end,
         pregledano_od   = case when p_status in ('bounced','complained','delivery_failed')
                                then null else pregledano_od end
   where resend_id = p_resend_id
     and mejl_dostava_rang(p_status) > mejl_dostava_rang(delivery_status);
  get diagnostics v = row_count;
  return v;  -- 0 = nepoznat id ILI niži/isti rang (oba OK)
end; $$;

revoke execute on function azuriraj_mejl_dostavu(text,mejl_dostava_status,timestamptz,text[]) from public, anon, authenticated;
grant  execute on function azuriraj_mejl_dostavu(text,mejl_dostava_status,timestamptz,text[]) to service_role;

-- 3) View + čitni RPC moraju propustiti kolonu do ekrana.
--    (security_invoker=on je OBAVEZAN — bez njega view zaobilazi RLS.)
--    Nova kolona ide na KRAJ liste: `create or replace view` dopušta samo dodavanje na
--    kraj, umetanje u sredinu odbija ("cannot change name of view column"). Redoslijed
--    kolona u view-u ionako ne utiče na RPC ispod — bira po imenu.
create or replace view mejl_log_view
with (security_invoker = on) as
select m.id, m.created_at, m.tip, m.primaoci, m.subject,
       m.termin_id, m.klijent_id, kl.naziv as klijent_naziv,
       m.resend_id, m.status, m.greska,
       m.delivery_status, m.delivery_at,
       m.pregledano_at, m.pregledano_od, ko.ime as pregledao_ime,
       m.dostava_pogodjeni
from mejl_log m
left join klijenti  kl on kl.id = m.klijent_id
left join korisnici ko on ko.id = m.pregledano_od;
grant select on mejl_log_view to authenticated;

-- Potpis povratne tabele se mijenja → drop pa create (v. 20260713120000 za original).
drop function if exists get_poslati_mejlovi(mejl_tip,mejl_status,timestamptz,timestamptz,boolean,boolean,int,int);

create function get_poslati_mejlovi(
  p_tip               mejl_tip    default null,
  p_status            mejl_status default null,
  p_od                timestamptz default null,
  p_do                timestamptz default null,
  p_samo_greske       boolean     default false,
  p_samo_nepregledane boolean     default false,
  p_limit             int         default 50,
  p_offset            int         default 0
) returns table (
  id uuid, created_at timestamptz, tip mejl_tip, primaoci text[], subject text,
  termin_id uuid, klijent_id uuid, klijent_naziv text, resend_id text,
  status mejl_status, greska text, delivery_status mejl_dostava_status,
  delivery_at timestamptz, dostava_pogodjeni text[],
  pregledano_at timestamptz, pregledao_ime text,
  ukupno bigint
) language sql stable security invoker set search_path = public as $$
  with f as (
    select * from mejl_log_view v
    where (p_tip    is null or v.tip = p_tip)
      and (p_status is null or v.status = p_status)
      and (p_od     is null or v.created_at >= p_od)
      and (p_do     is null or v.created_at <  p_do)
      and (not p_samo_greske
           or v.status = 'greska_slanja'
           or v.delivery_status in ('bounced','complained','delivery_failed'))
      and (not p_samo_nepregledane or v.pregledano_at is null)
  )
  select f.id, f.created_at, f.tip, f.primaoci, f.subject, f.termin_id, f.klijent_id,
         f.klijent_naziv, f.resend_id, f.status, f.greska, f.delivery_status,
         f.delivery_at, f.dostava_pogodjeni, f.pregledano_at, f.pregledao_ime,
         count(*) over () as ukupno
  from f
  order by f.created_at desc
  limit greatest(p_limit,0) offset greatest(p_offset,0);
$$;

grant execute on function
  get_poslati_mejlovi(mejl_tip,mejl_status,timestamptz,timestamptz,boolean,boolean,int,int)
  to authenticated;
