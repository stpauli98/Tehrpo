-- 2026-07-10: datum_prikaza (coalesce zakazan/rok) kao pozicijska osnova plana +
-- audit "zakazano poslije roka" + atomski claim RPC za transakcijski email.

-- 1) termini_view dobija datum_prikaza. klijenti_view zavisi → rekreiraju se OBA
--    (obrazac iz 20260630120000_nacin_izvrsenja.sql; t.* je pozicijski razvijen,
--    nova kolona se ne pojavi bez rekreiranja).
drop view if exists klijenti_view;
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
  coalesce(t.datum_zakazan, t.rok_dospijeca) as datum_prikaza,
  k.naziv as klijent_naziv,
  l.naziv as lokacija_naziv,
  l.grad  as lokacija_grad,
  v.naziv as vrsta_naziv
from termini t
left join klijenti k       on k.id = t.klijent_id
left join lokacije l       on l.id = t.lokacija_id
left join vrste_provjera v on v.id = t.vrsta_provjere_id;

create view klijenti_view as
select
  k.id,
  k.naziv,
  k.napomena,
  k.created_at,
  k.updated_at,
  k.tip_odnosa,
  coalesce(lok.broj_lokacija, 0) as broj_lokacija,
  coalesce(t.broj_termina, 0)    as broj_termina,
  coalesce(t.broj_aktivnih, 0)   as broj_aktivnih,
  coalesce(t.broj_kasni, 0)      as broj_kasni,
  coalesce(t.broj_izvrseno, 0)   as broj_izvrseno
from klijenti k
left join (
  select klijent_id, count(*) as broj_lokacija
  from lokacije
  group by klijent_id
) lok on lok.klijent_id = k.id
left join (
  select
    klijent_id,
    count(*)                                                                        as broj_termina,
    count(*) filter (where status_izvedeni = any (array['planirano', 'zakazano'])) as broj_aktivnih,
    count(*) filter (where status_izvedeni = 'kasni')                               as broj_kasni,
    count(*) filter (where status = 'izvrseno')                                     as broj_izvrseno
  from termini_view
  group by klijent_id
) t on t.klijent_id = k.id;

alter view termini_view  set (security_invoker = on);
alter view klijenti_view set (security_invoker = on);

-- 2) Audit: koje "zakazano poslije roka" obavijesti su poslane. Idempotencija po
--    (termin_id, datum_zakazan). Interna tabela — pristup samo preko DEFINER RPC ispod.
create table if not exists termin_zakazano_obavijest (
  id            uuid primary key default gen_random_uuid(),
  termin_id     uuid not null references termini(id) on delete cascade,
  datum_zakazan date not null,
  poslat_na     text[] not null default '{}',
  created_at    timestamptz not null default now(),
  unique (termin_id, datum_zakazan)
);
alter table termin_zakazano_obavijest enable row level security;
-- Namjerno BEZ ijedne policy-a (ni admin-read, za razliku od audit_log): čita/piše
-- isključivo DEFINER RPC ispod, koji sam provjerava ima_pristup_klijentu().

-- 3) Atomski claim + računanje internih primalaca (bypass caller RLS: DEFINER).
--    Vraća listu primalaca za slanje; prazan niz = ne šalji (već poslato / nema primalaca).
--    Interni primaoci = admini (aktivan+prima_podsjetnike) ∪ dodijeljeni klijentu ∪ base(env).
--    NIKAD klijent (nema "firma" kanala).
create or replace function zabiljezi_zakazano_obavijest(
  p_termin_id uuid,
  p_datum_zakazan date,
  p_base text[]
) returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_klijent  uuid;
  v_primaoci text[];
  v_inserted int;
begin
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

-- 4) DEFINER + PUBLIC execute = svaki ulogovani (ili anon sa važećim termin UUID-om)
--    mogao bi enumerisati interne email-ove, preduhitriti claim ili ubaciti audit šum.
--    Server akcija poziva RPC kao 'authenticated' — samo tu ulogu i puštamo.
revoke execute on function zabiljezi_zakazano_obavijest(uuid, date, text[]) from public;
grant execute on function zabiljezi_zakazano_obavijest(uuid, date, text[]) to authenticated;
