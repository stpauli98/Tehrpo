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

-- 5) Upisni put (jedini). Bez INSERT politike → direktan authenticated INSERT je odbijen.
create or replace function zabiljezi_mejl_log(
  p_tip        mejl_tip,
  p_primaoci   text[],
  p_subject    text,
  p_termin_id  uuid,
  p_klijent_id uuid,
  p_resend_id  text,
  p_status     mejl_status,
  p_greska     text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- service_role (cron): auth.uid() NULL → trusted server-context.
  -- authenticated: mora je_admin() ILI ima_pristup_klijentu(p_klijent_id).
  if auth.uid() is not null
     and not ( je_admin()
               or ( p_klijent_id is not null and ima_pristup_klijentu(p_klijent_id) ) )
  then
    return;  -- nema prava → tiho preskoči (best-effort; wrapper ne baca)
  end if;

  insert into mejl_log
    (tip, primaoci, subject, termin_id, klijent_id, resend_id, status, greska, delivery_status)
  values
    (p_tip, p_primaoci, p_subject, p_termin_id, p_klijent_id, p_resend_id, p_status, p_greska, 'nepoznato');
end; $$;

revoke execute on function zabiljezi_mejl_log(mejl_tip,text[],text,uuid,uuid,text,mejl_status,text)
  from public, anon;
grant  execute on function zabiljezi_mejl_log(mejl_tip,text[],text,uuid,uuid,text,mejl_status,text)
  to authenticated, service_role;
