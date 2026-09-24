-- supabase/migrations/20260814100000_storage_bucket_neutralno_ime.sql
--
-- Ime bucketa curi korisniku: potpisani URL glasi
--   https://<ref>.supabase.co/storage/v1/object/sign/<bucket>/<putanja>?token=…
-- i stoji u adresnoj traci svakome ko otvori ili preuzme dokument. Na instanci koja
-- se pokazuje drugim firmama kao demo, `tehpro-dokumenti` je time vidljiv brend.
--
-- Zato bucket ime prelazi u env (`DOKUMENTI_BUCKET`, `lib/dokumenti/bucket.ts`), a
-- politike moraju pokrivati OBA imena: DEMO prelazi na neutralno `dokumenti`, dok
-- Tehpro instanca ostaje na `tehpro-dokumenti` dok joj se bucket ne preseli.
-- Jedan izraz na obje baze = nema šemskog drifta (v. `demo-baza-drift`).
--
-- Kad i Tehpro instanca pređe na `dokumenti`, iz oba izraza se briše stari literal.
-- Re-run safe.

drop policy if exists storage_dok_sel on storage.objects;
create policy storage_dok_sel on storage.objects for select
  using (
    bucket_id in ('tehpro-dokumenti', 'dokumenti')
    and ima_pristup_dokumentu(name)
  );

drop policy if exists storage_dok_del on storage.objects;
create policy storage_dok_del on storage.objects for delete
  using (
    bucket_id in ('tehpro-dokumenti', 'dokumenti')
    and je_admin()
  );
