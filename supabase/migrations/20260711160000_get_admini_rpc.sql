-- supabase/migrations/20260711160000_get_admini_rpc.sql
-- Lista aktivnih admina (ime + email) za kontakt.
-- RLS na korisnici (korisnici_sel: id = auth.uid() OR je_admin()) znači da operater
-- ne vidi tuđe redove — pa mu ovaj SECURITY DEFINER RPC izlaže SAMO kontakt admina
-- (ime, email), ništa drugo (uloga/aktivan/created_at se ne vraćaju).
create or replace function get_admini()
returns table (ime text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select k.ime, k.email
  from korisnici k
  where k.uloga = 'admin' and k.aktivan
  order by k.ime;
$$;

-- Definer funkcija koja vraća PII (email) → dostupna samo prijavljenim korisnicima.
revoke execute on function get_admini() from public;
grant execute on function get_admini() to authenticated;
