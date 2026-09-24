-- Polise koje traže samo „bilo ko prijavljen" moraju tražiti AKTIVAN nalog.
--
-- Propust: `je_admin()`, `je_pregled()` i `ima_pristup_klijentu()` svi traže
-- `k.aktivan`, pa deaktivirani korisnik gotovo ništa ne pročita. Ali polise oblika
-- `auth.uid() is not null` ne provjeravaju ništa osim postojanja tokena.
--
-- Najgori slučaj je `klijenti_ins`:
--     with check ((auth.uid() IS NOT NULL) AND (NOT je_pregled()))
-- Pošto `je_pregled()` TAKOĐE traži `aktivan`, deaktiviranjem korisnika sa ulogom
-- `pregled` funkcija vraća false, pa mu `not je_pregled()` postaje true — deaktivacija
-- mu taj upis DAJE umjesto da ga oduzme. Uz trigger `tg_klijent_auto_dodjela` sebi
-- odmah upiše i `korisnik_klijent` red.
--
-- Uz ovo ide i globalna odjava pri deaktivaciji (postavke/actions.ts:postaviAktivan),
-- jer polisa ne pomaže ako token uopšte ne bi trebalo da postoji.

-- Helper: „prijavljen I aktivan". SECURITY DEFINER jer `korisnici_sel` je self-select,
-- a polisa mora moći provjeriti red i kad ga pozivalac ne bi vidio.
create or replace function public.je_aktivan()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from korisnici k
    where k.id = auth.uid() and k.aktivan
  );
$function$;

revoke execute on function public.je_aktivan() from public, anon;
grant  execute on function public.je_aktivan() to authenticated;

-- ── Upis klijenta: aktivan nalog koji nije `pregled` ─────────────────────────
drop policy if exists klijenti_ins on public.klijenti;
create policy klijenti_ins on public.klijenti
  for insert
  with check ( je_aktivan() and not je_pregled() );

-- ── Upis chat poruke: vlastiti red, aktivan nalog, ne `pregled` ──────────────
drop policy if exists chat_ins on public.chat_poruke;
create policy chat_ins on public.chat_poruke
  for insert
  with check ( korisnik_id = auth.uid() and je_aktivan() and not je_pregled() );

-- ── Šifarnici i postavke: čitanje traži aktivan nalog ────────────────────────
-- Sami po sebi nisu osjetljivi, ali deaktivirani nalog nema šta da čita.
drop policy if exists postavke_sel on public.postavke;
create policy postavke_sel on public.postavke
  for select using ( je_aktivan() );

drop policy if exists vrste_sel on public.vrste_provjera;
create policy vrste_sel on public.vrste_provjera
  for select using ( je_aktivan() );

drop policy if exists gradovi_sel on public.gradovi;
create policy gradovi_sel on public.gradovi
  for select using ( je_aktivan() );
