-- 2026-07-10: prekidač za automatsku "zakazano poslije roka" obavijest.
-- Rupa: posaljiZakazanoNakonRoka (lib/reminders/zakazanoNakonRoka.ts, okinut iz
-- termini/actions.ts pri upisu/izmjeni termina poslije roka) slao je BEZUSLOVNO —
-- master prekidač podsjetnika (postavke.podsjetnici_aktivni) ga NIJE gasio, niti je
-- postojao ijedan drugi prekidač. Uvodimo zaseban per-instanca prekidač i gejtujemo
-- ga U SAMOM DEFINER RPC-u: kad je isključen, RPC ne računa primaoce i ne zauzima
-- idempotencijski slot → nijedan pozivalac (app, skripta, budući kod) ne može poslati.

-- 1) Prekidač (default ON — zadržava postojeće ponašanje dok admin ne isključi).
--    Nedostajuća kolona bi (privremeno, između deploy-a i migracije) značila da RPC
--    ne postoji u novoj verziji pa se ni ne poziva; coalesce niže je dodatna tolerancija.
alter table postavke
  add column if not exists zakazano_obavijest_aktivna boolean not null default true;

-- 2) RPC + gejt. Tijelo identično 20260710140000_datum_prikaza_i_zakazano_obavijest.sql
--    uz DODAT prekidački check na vrhu. Ostalo (scope-guard, atomski claim, primaoci)
--    ostaje nepromijenjeno.
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

-- ACL: signatura nepromijenjena → create or replace čuva postojeće grant-ove, ali
-- ih ponavljamo radi samodostatnosti migracije (isti obrazac kao izvorna migracija).
revoke execute on function zabiljezi_zakazano_obavijest(uuid, date, text[]) from public;
revoke execute on function zabiljezi_zakazano_obavijest(uuid, date, text[]) from anon;
grant execute on function zabiljezi_zakazano_obavijest(uuid, date, text[]) to authenticated;
