-- supabase/migrations/20260729130000_get_zaduzeni_dodjele_rpc.sql
-- Firma-scoped prijedlozi za polje "Zaduženi"
-- (docs/superpowers/specs/2026-07-29-zaduzeni-po-firmi-design.md).
--
-- get_aktivni_korisnici() (20260726122000) vraća SVE aktivne korisnike bez obzira na firmu —
-- prejednostavno za operatera koji radi samo par klijenata. Ovaj RPC vraća parove
-- (klijent_id, ime) za korisnike koji TRENUTNO IMAJU PRISTUP toj firmi — ista logika kao
-- ima_pristup_klijentu() (20260626210000): admin (uvijek, sve firme) union operater/pregled
-- sa eksplicitnom dodjelom u korisnik_klijent (dodjelu uređuje admin u
-- Postavke → Korisnici, KorisniciTab/KorisniciTabela).
--
-- SECURITY DEFINER iz istog razloga kao get_aktivni_korisnici: RLS polisa `korisnici_sel`
-- je self-select — direktan upit sa klijenta bi operateru vratio samo njega samog.
-- PII minimizacija, isti princip kao get_aktivni_korisnici: samo klijent_id (uuid,
-- potreban za grupisanje na klijentu) i ime — NIKAD email/uloga/id korisnika.
--
-- `set search_path = public, pg_temp` je obavezna definer higijena (20260729120000_search_path_pg_temp.sql):
-- pg_temp mora biti eksplicitno naveden (i posljednji) da prijavljeni korisnik ne može
-- podmetnuti `pg_temp.korisnici`/`pg_temp.klijenti` i preusmjeriti funkciju na svoje podatke.
create or replace function get_zaduzeni_dodjele()
returns table (klijent_id uuid, ime text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select kl.id, k.ime
  from klijenti kl
  cross join korisnici k
  where k.aktivan and k.uloga = 'admin'
  union
  select kk.klijent_id, k.ime
  from korisnik_klijent kk
  join korisnici k on k.id = kk.korisnik_id
  where k.aktivan
  order by 1, 2;
$$;

-- Definer funkcija koja probija RLS → nikad anon; samo prijavljeni korisnici.
revoke execute on function get_zaduzeni_dodjele() from public;
grant execute on function get_zaduzeni_dodjele() to authenticated;
