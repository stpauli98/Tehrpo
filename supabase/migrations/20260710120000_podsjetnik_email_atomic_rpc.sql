-- Atomske ad-hoc primalac operacije nad klijenti.podsjetnik_emails (issue #23).
-- SECURITY INVOKER (NE definer): tenant-scoped mutacija mora poštovati klijenti_upd RLS
-- (ima_pristup_klijentu); definer bi zaobišao RLS.
create or replace function dodaj_podsjetnik_email(p_klijent_id uuid, p_email text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_updated int;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return 'nevalidan';
  end if;
  if exists (
    select 1 from kontakt_osobe
    where klijent_id = p_klijent_id
      and lower(btrim(coalesce(email, ''))) = v_email
  ) then
    return 'kontakt';
  end if;
  update klijenti
    set podsjetnik_emails = array_append(podsjetnik_emails, v_email)
    where id = p_klijent_id
      and not (v_email = any(podsjetnik_emails));
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return 'ok';
  end if;
  if exists (
    select 1 from klijenti
    where id = p_klijent_id and v_email = any(podsjetnik_emails)
  ) then
    return 'postoji';
  end if;
  return 'nedostupno';
end;
$$;

create or replace function ukloni_podsjetnik_email(p_klijent_id uuid, p_email text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update klijenti
    set podsjetnik_emails = array_remove(podsjetnik_emails, lower(btrim(coalesce(p_email, ''))))
    where id = p_klijent_id;
end;
$$;
