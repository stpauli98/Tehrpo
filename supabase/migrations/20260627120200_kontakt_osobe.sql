-- supabase/migrations/20260627120200_kontakt_osobe.sql
-- PP-1: Kontakt osobe na nivou klijenta (više njih). Lokacijski kontakti ostaju na `lokacije`.

create table if not exists kontakt_osobe (
  id         uuid primary key default gen_random_uuid(),
  klijent_id uuid not null references klijenti(id) on delete cascade,
  ime        text not null,
  funkcija   text,
  telefon    text,
  email      text,
  created_at timestamptz not null default now(),
  constraint chk_kontakt_ime check (length(trim(ime)) > 0)
);

create index if not exists idx_kontakt_osobe_klijent on kontakt_osobe (klijent_id);

alter table kontakt_osobe enable row level security;
drop policy if exists kontakt_sel on kontakt_osobe;
drop policy if exists kontakt_wr on kontakt_osobe;
create policy kontakt_sel on kontakt_osobe for select using ( ima_pristup_klijentu(klijent_id) );
create policy kontakt_wr  on kontakt_osobe for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

drop trigger if exists audit_kontakt_osobe on kontakt_osobe;
create trigger audit_kontakt_osobe after insert or update or delete on kontakt_osobe
  for each row execute function tg_audit();
