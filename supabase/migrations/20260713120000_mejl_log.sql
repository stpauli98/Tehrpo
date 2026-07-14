-- Dnevnik mejlova (observability). Vidi docs/superpowers/specs/2026-07-13-mejl-log-nadzor-design.md
-- Idempotentna migracija (DO-guard enumi, if not exists, create or replace, drop policy if exists).

-- 1) Enumi
do $$ begin
  create type mejl_tip as enum
    ('podsjetnik_interni','podsjetnik_firma','zakazano_nakon_roka','test');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mejl_status as enum ('poslato','greska_slanja');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mejl_dostava_status as enum
    ('nepoznato','delivered','opened','delivery_failed','bounced','complained');
exception when duplicate_object then null; end $$;

-- 2) Tabela
create table if not exists mejl_log (
  id              uuid                primary key default gen_random_uuid(),
  created_at      timestamptz         not null    default now(),
  tip             mejl_tip            not null,
  primaoci        text[]              not null    default '{}',
  subject         text                not null,
  termin_id       uuid                references termini(id)  on delete set null,
  klijent_id      uuid                references klijenti(id) on delete set null,
  resend_id       text,
  status          mejl_status         not null,
  greska          text,
  delivery_status mejl_dostava_status not null    default 'nepoznato',
  delivery_at     timestamptz,
  pregledano_at   timestamptz,
  pregledano_od   uuid                references korisnici(id) on delete set null
);

-- 3) Indeksi
create index if not exists idx_mejl_log_created  on mejl_log (created_at desc);
create index if not exists idx_mejl_log_klijent  on mejl_log (klijent_id);
create index if not exists idx_mejl_log_resend   on mejl_log (resend_id);
create index if not exists idx_mejl_log_nepregledano on mejl_log (created_at desc)
  where pregledano_at is null
    and (status = 'greska_slanja'
         or delivery_status in ('bounced','complained','delivery_failed'));

-- 4) RLS — troslojni SELECT
alter table mejl_log enable row level security;
grant select on mejl_log to authenticated;

drop policy if exists mejl_log_sel on mejl_log;
create policy mejl_log_sel on mejl_log for select using (
  je_admin()
  or ( klijent_id is not null and ima_pristup_klijentu(klijent_id) )
);
