-- Poslovno pravilo (2026-07-03): dokumente briše ISKLJUČIVO administrator.
-- Ranije je dokumenti_wr (for all) dozvoljavala DELETE i operateru sa pristupom klijentu.
-- Insert/update semantika ostaje ista; sužava se samo DELETE. Re-run-safe.

-- dokumenti: razbij "for all" politiku na insert/update + admin-only delete
drop policy if exists dokumenti_wr on dokumenti;
drop policy if exists dokumenti_ins on dokumenti;
drop policy if exists dokumenti_upd on dokumenti;
drop policy if exists dokumenti_del on dokumenti;

create policy dokumenti_ins on dokumenti for insert
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

create policy dokumenti_upd on dokumenti for update
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

create policy dokumenti_del on dokumenti for delete
  using ( je_admin() );

-- storage.objects: isto suženje za direktan JWT pristup (defense-in-depth; app I/O
-- ide service-role klijentom pa ga ove politike ne diraju — vidi 20260701120000).
drop policy if exists storage_dok_wr on storage.objects;
drop policy if exists storage_dok_ins on storage.objects;
drop policy if exists storage_dok_upd on storage.objects;
drop policy if exists storage_dok_del on storage.objects;

create policy storage_dok_ins on storage.objects for insert
  with check (
    bucket_id = 'tehpro-dokumenti'
    and public.ima_pristup_dokumentu(name)
    and not public.je_pregled()
  );

create policy storage_dok_upd on storage.objects for update
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

create policy storage_dok_del on storage.objects for delete
  using (
    bucket_id = 'tehpro-dokumenti'
    and public.je_admin()
  );
