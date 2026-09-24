-- Interna provjera pozivaoca u tri SECURITY DEFINER RPC-a, da ACL (grant/revoke)
-- ne bude JEDINA kontrola. Uz 20260731101000 (anon revoke) ovo je drugi sloj.
--
-- Potvrđeno na DEMO 31.07.2026.: nalog sa ulogom `pregled` i BEZ ijedne dodjele
-- klijenta — koji ispravno dobija prazne `klijenti`, `termini`, `klijenti_view` i
-- samo svoj red iz `korisnici` — kroz `get_admini()` je dobijao imena i PRAVE
-- e-mail adrese svih administratora. To je gotova lista meta za phishing upravo
-- onih naloga koji jedini mogu otvarati korisnike.
--
-- Odabir uslova je namjerno različit po funkciji; provjereni su svi pozivaoci:
--
--   get_admini            → `not je_pregled()`. Jedini pozivalac je
--     app/(dashboard)/klijenti/[id]/page.tsx:127, iza `trebaOpcije`, za fallback
--     „Dodaj provjeru" („operater ne može u Postavke, pa mu prikazujemo kome da se
--     javi"). `pregled` to dugme nema (upisna radnja), pa gubi ništa. Ovdje su
--     e-mailovi, tj. jedini stvarno osjetljiv podatak od tri.
--
--   get_aktivni_korisnici → SAMO `auth.uid() is not null`. NAMJERNO se NE sužava na
--     admina: app/(dashboard)/klijenti/page.tsx:38 i klijenti/[id]/page.tsx:104 ga
--     zovu baš zato da OPERATER dobije punu listu (RLS `korisnici_sel` je self-select
--     pa bi mu direktan from() vratio samo njega). Sužavanje na `je_admin()` bi tiho
--     slomilo operaterov izbor „zaduženi". Vraća imena i UUID-e, bez e-mailova.
--
--   get_zaduzeni_dodjele  → SAMO `auth.uid() is not null`, iz istog razloga: RPC
--     postoji da operater uopšte dobije prijedloge za „Zaduženi"
--     (lib/queries/aktivni-korisnici.ts:5-9). Vraća imena i klijent_id, bez e-mailova.
--
-- SVJESNO OSTAJE: svaki prijavljeni radnik (uklj. `pregled`) i dalje vidi imena
-- kolega i spisak klijent_id vrijednosti. To je interni imenik na koji se čitav ekran
-- oslanja. Ako se traži da ga ni `pregled` ne vidi, cijena je da toj ulozi nestane
-- kolona/filter „Zaduženi" — to je proizvodna odluka, ne popravka propusta.

create or replace function public.get_admini()
returns table(ime text, email text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select k.ime, k.email
  from korisnici k
  where k.uloga = 'admin' and k.aktivan
    and auth.uid() is not null
    and not je_pregled()
  order by k.ime;
$function$;

create or replace function public.get_aktivni_korisnici()
returns table(id uuid, ime text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select k.id, k.ime
  from korisnici k
  where k.aktivan
    and auth.uid() is not null
  order by k.ime;
$function$;

create or replace function public.get_zaduzeni_dodjele()
returns table(klijent_id uuid, ime text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select kl.id, k.ime
  from klijenti kl
  cross join korisnici k
  where k.aktivan and k.uloga = 'admin'
    and auth.uid() is not null
  union
  select kk.klijent_id, k.ime
  from korisnik_klijent kk
  join korisnici k on k.id = kk.korisnik_id
  where k.aktivan
    and auth.uid() is not null
  order by 1, 2;
$function$;

-- `create or replace` ne dira ACL, ali ponavljamo grant radi svježih baza gdje se
-- ove dvije migracije primjenjuju u nizu.
revoke execute on function public.get_admini()             from public, anon;
revoke execute on function public.get_aktivni_korisnici()  from public, anon;
revoke execute on function public.get_zaduzeni_dodjele()   from public, anon;
grant  execute on function public.get_admini()             to authenticated;
grant  execute on function public.get_aktivni_korisnici()  to authenticated;
grant  execute on function public.get_zaduzeni_dodjele()   to authenticated;
