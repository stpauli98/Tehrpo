-- supabase/migrations/20260627120100_ugovori.sql
-- PP-1: Ugovori (1 klijent → N ugovora, jedan aktivan). RLS preko klijenta + audit.

create table if not exists ugovori (
  id                      uuid primary key default gen_random_uuid(),
  klijent_id              uuid not null references klijenti(id) on delete cascade,
  zavodni_broj            text,
  datum_potpisivanja      date,
  datum_isteka            date,
  vazenje_mjeseci         int,
  broj_obilazaka_mjesecno int,
  automatsko_obnavljanje  bool not null default false,
  aktivan                 bool not null default true,
  napomena                text,
  created_at              timestamptz not null default now(),
  constraint chk_ugovori_vazenje check (vazenje_mjeseci is null or vazenje_mjeseci between 1 and 600),
  constraint chk_ugovori_obilasci check (broj_obilazaka_mjesecno is null or broj_obilazaka_mjesecno between 0 and 31),
  constraint chk_ugovori_datumi check (datum_isteka is null or datum_potpisivanja is null or datum_isteka >= datum_potpisivanja)
);

create index if not exists idx_ugovori_klijent on ugovori (klijent_id);
-- Jedan aktivan ugovor po klijentu:
create unique index if not exists uq_ugovori_aktivan on ugovori (klijent_id) where aktivan;

-- RLS (preko klijenta; pregled = read-only)
alter table ugovori enable row level security;
drop policy if exists ugovori_sel on ugovori;
drop policy if exists ugovori_wr on ugovori;
create policy ugovori_sel on ugovori for select using ( ima_pristup_klijentu(klijent_id) );
create policy ugovori_wr  on ugovori for all
  using ( ima_pristup_klijentu(klijent_id) and not je_pregled() )
  with check ( ima_pristup_klijentu(klijent_id) and not je_pregled() );

-- Audit
drop trigger if exists audit_ugovori on ugovori;
create trigger audit_ugovori after insert or update or delete on ugovori
  for each row execute function tg_audit();
