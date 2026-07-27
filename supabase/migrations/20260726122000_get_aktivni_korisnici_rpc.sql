-- supabase/migrations/20260726122000_get_aktivni_korisnici_rpc.sql
-- Lista aktivnih korisnika (id + ime) kao izvor za "Zaduženi" combobox (S8.6).
-- Sve uloge (admin/operater/pregled) — zadužen može biti bilo koji AKTIVAN korisnik,
-- pa se namjerno NE filtrira po `uloga`; filtrira se samo `aktivan` (deaktivirani
-- korisnik se više ne nudi za nova zaduženja, a stara zaduženja ostaju netaknuta).
--
-- ZAŠTO SECURITY DEFINER (za razliku od get_termini_godine, koji je invoker):
-- RLS polisa `korisnici_sel` je self-select — `id = auth.uid() or je_admin()`
-- (20260626211000_rls_enable.sql:106). Direktan `from("korisnici")` bi operateru
-- vratio SAMO njegov vlastiti red, pa bi combobox imao tačno jednu stavku. To je
-- tiha regresija koju admin-testiranje NE otkriva (admin kroz `je_admin()` vidi sve),
-- zato izbor zaduženog mora ići kroz definer RPC koji kontrolisano probija RLS.
--
-- ŠTA JE TAČNO IZLOŽENO (PII minimizacija, isti princip kao get_admini):
-- samo `id` (uuid, potreban kao FK vrijednost) i `ime` (ime kolege, za prikaz u
-- comboboxu). NIKAD `email`, `uloga`, `aktivan` ni `created_at` — RPC nije zamjena
-- za administraciju korisnika. Presedan za obim izlaganja: `get_admini()`
-- (20260711160000) već svakom `authenticated` korisniku vraća `ime` I `email`
-- aktivnih admina; ovaj RPC po redu izlaže STROGO MANJE (bez email-a), samo nad
-- širim skupom (svi aktivni, ne samo admini) — što je inherentno svrsi: zadužen
-- može biti bilo koji aktivan korisnik.
-- NB: `termini.zaduzeni` je danas SLOBODAN TEKST (`20260620200651_termini.sql:20`),
-- nije FK — `termini_view` nema kolonu sa imenom zaduženog, a jedino mjesto gdje se
-- `korisnici.ime` danas vidi (`aktivnost_view.korisnik_ime`) je admin-only. Upravo
-- to je nalaz N6 koji S8.6 rješava, pa je ovaj RPC njegov preduslov.
--
-- `set search_path = public` je obavezna definer higijena: bez toga pozivalac može
-- podmetnuti svoju šemu u search_path i preusmjeriti `korisnici` na svoju tabelu.
create or replace function get_aktivni_korisnici()
returns table (id uuid, ime text)
language sql
stable
security definer
set search_path = public
as $$
  select k.id, k.ime
  from korisnici k
  where k.aktivan
  order by k.ime;
$$;

-- Definer funkcija koja probija RLS → nikad anon; samo prijavljeni korisnici.
revoke execute on function get_aktivni_korisnici() from public;
grant execute on function get_aktivni_korisnici() to authenticated;
