-- Foundation tables: klijenti, lokacije, vrste_provjera
-- Spec §4.1 tables 1-3

create extension if not exists pgcrypto; -- gen_random_uuid()

-- 1. KLIJENTI
create table klijenti (
  id          uuid primary key default gen_random_uuid(),
  naziv       text not null,
  napomena    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chk_klijenti_naziv check (length(trim(naziv)) > 0)
);

-- 2. LOKACIJE (1 klijent → N lokacija)
create table lokacije (
  id              uuid primary key default gen_random_uuid(),
  klijent_id      uuid not null references klijenti(id) on delete cascade,
  naziv           text not null,
  grad            text,
  regija          text,
  adresa          text,
  kontakt_osoba   text,
  kontakt_email   text,
  kontakt_telefon text,
  created_at      timestamptz not null default now()
);

create index idx_lokacije_klijent on lokacije (klijent_id);

-- 3. VRSTE PROVJERA (catalog)
create table vrste_provjera (
  id                              uuid primary key default gen_random_uuid(),
  naziv                           text not null unique,
  sifra                           text,
  podrazumevani_interval_mjeseci  int,
  zakonski_osnov                  text,
  napomena                        text,
  aktivna                         bool not null default true,
  constraint chk_vrste_interval check (
    podrazumevani_interval_mjeseci is null
    or podrazumevani_interval_mjeseci between 1 and 120
  )
);
