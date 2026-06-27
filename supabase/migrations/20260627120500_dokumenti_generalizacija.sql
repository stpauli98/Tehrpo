-- supabase/migrations/20260627120500_dokumenti_generalizacija.sql
-- PP-1: dokument se veže za klijenta (uvijek), opciono za ugovor/termin; + tip.
-- Backfill klijent_id iz termina PRIJE set not null; RLS prebačen na klijent_id.

-- 1) Nove kolone
alter table dokumenti add column if not exists klijent_id uuid references klijenti(id) on delete cascade;
alter table dokumenti add column if not exists ugovor_id  uuid references ugovori(id)  on delete set null;
alter table dokumenti add column if not exists tip text not null default 'ostalo';

-- 2) tip CHECK (ime constrainta stabilno; drop pa add radi re-run)
alter table dokumenti drop constraint if exists chk_dokumenti_tip;
alter table dokumenti add constraint chk_dokumenti_tip
  check (tip in ('strucni_nalaz','zapisnik','ugovor','ponuda','fotografija','ostalo'));

-- 3) Backfill klijent_id iz termina za postojeće redove
update dokumenti d
  set klijent_id = t.klijent_id
  from termini t
  where d.klijent_id is null and d.termin_id = t.id;

-- 3b) AI zapisnici → tip 'zapisnik'
update dokumenti set tip = 'zapisnik' where generated_by_ai = true and tip = 'ostalo';

-- 4) klijent_id obavezan, termin_id više nije
alter table dokumenti alter column klijent_id set not null;
alter table dokumenti alter column termin_id drop not null;

create index if not exists idx_dokumenti_klijent on dokumenti (klijent_id);
create index if not exists idx_dokumenti_ugovor  on dokumenti (ugovor_id);

-- 5) RLS: pristup preko klijent_id (ranije preko termin_id)
drop policy if exists dokumenti_sel on dokumenti;
drop policy if exists dokumenti_wr on dokumenti;
create policy dokumenti_sel on dokumenti for select using ( ima_pristup_klijentu(klijent_id) );
create policy dokumenti_wr on dokumenti for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );
