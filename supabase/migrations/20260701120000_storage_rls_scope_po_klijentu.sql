-- Storage RLS: izolacija dokumenata po klijentu (zatvara tehnički dug iz 20260627110000).
-- Ranije: storage_dok_sel/_wr su gate-ovali samo na `auth.uid() is not null` → bilo koji
-- prijavljeni korisnik je mogao LIST-ati i preuzeti/obrisati fajlove SVIH klijenata direktno
-- preko Storage API-ja (potvrđeno pentestom 2026-07-01), zaobilazeći `ima_pristup_klijentu`.
--
-- Putanje NISU uniformne (`klijenti/{id}/…`, `ugovori/{id}/…`, `termini/{id}/…`), pa se pristup
-- ne može pouzdano izvesti iz prefiksa. Izvor istine je `dokumenti.klijent_id`: objekt je
-- dostupan akko postoji `dokumenti` red sa tim `storage_path` čijem klijentu korisnik ima pristup.
--
-- Napomena: sav app I/O nad storage-om ide preko service-role klijenta (lib/supabase/storage.ts),
-- koji zaobilazi RLS — legitimni upload/download/signed-URL tokovi ostaju nepromijenjeni. Ove
-- politike pogađaju isključivo direktan pristup korisničkim JWT-om (napadačku površinu).
-- Re-run-safe.

-- SECURITY DEFINER helper: zaobilazi RLS na `dokumenti` (čita sve redove), pa eksplicitno
-- provjerava pristup preko `ima_pristup_klijentu` (koji gleda tekući auth.uid()). Fiksiran
-- search_path (kao ostali helperi) — bez search_path hijack-a.
create or replace function public.ima_pristup_dokumentu(p_path text)
  returns boolean
  language sql
  stable security definer
  set search_path to 'public'
as $function$
  select exists (
    select 1 from dokumenti d
    where d.storage_path = p_path
      and ima_pristup_klijentu(d.klijent_id)
  );
$function$;

drop policy if exists storage_dok_sel on storage.objects;
create policy storage_dok_sel on storage.objects for select
  using (
    bucket_id = 'tehpro-dokumenti'
    and public.ima_pristup_dokumentu(name)
  );

drop policy if exists storage_dok_wr on storage.objects;
create policy storage_dok_wr on storage.objects for all
  using (
    bucket_id = 'tehpro-dokumenti'
    and public.ima_pristup_dokumentu(name)
    and not public.je_pregled()
  )
  with check (
    bucket_id = 'tehpro-dokumenti'
    and public.ima_pristup_dokumentu(name)
    and not public.je_pregled()
  );
