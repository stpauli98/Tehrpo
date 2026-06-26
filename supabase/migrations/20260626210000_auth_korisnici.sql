-- supabase/migrations/20260626210000_auth_korisnici.sql
-- EPIK A: profil korisnika, N:N dodjela klijenata, audit log, RLS helperi.
-- NE uključuje RLS (vidi 20260626211000_rls_enable.sql) — ovo je ne-rušeća migracija.

create type korisnik_uloga as enum ('admin','operater','pregled');

create table korisnici (
  id          uuid primary key references auth.users(id) on delete cascade,
  ime         text not null,
  email       text not null unique,
  uloga       korisnik_uloga not null default 'pregled',
  aktivan     bool not null default true,
  created_at  timestamptz not null default now(),
  constraint chk_korisnici_ime check (length(trim(ime)) > 0)
);

create table korisnik_klijent (
  korisnik_id  uuid not null references korisnici(id) on delete cascade,
  klijent_id   uuid not null references klijenti(id)  on delete cascade,
  primary key (korisnik_id, klijent_id)
);
create index idx_kk_korisnik on korisnik_klijent (korisnik_id);
create index idx_kk_klijent  on korisnik_klijent (klijent_id);

create table audit_log (
  id          bigint generated always as identity primary key,
  korisnik_id uuid references korisnici(id) on delete set null,
  akcija      text not null,
  entitet     text not null,
  entitet_id  text,
  staro       jsonb,
  novo        jsonb,
  vrijeme     timestamptz not null default now()
);
create index idx_audit_entitet on audit_log (entitet, entitet_id);
create index idx_audit_vrijeme on audit_log (vrijeme desc);

-- Helperi: SECURITY DEFINER da mogu čitati korisnici/korisnik_klijent i kad RLS bude uključen.
create or replace function je_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from korisnici k
    where k.id = auth.uid() and k.uloga = 'admin' and k.aktivan);
$$;

create or replace function je_pregled() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from korisnici k
    where k.id = auth.uid() and k.uloga = 'pregled' and k.aktivan);
$$;

create or replace function ima_pristup_klijentu(p_klijent_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select je_admin() or exists (
    select 1 from korisnik_klijent kk
    join korisnici k on k.id = kk.korisnik_id
    where kk.korisnik_id = auth.uid()
      and kk.klijent_id = p_klijent_id
      and k.aktivan);
$$;
