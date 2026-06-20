-- dokumenti, podsjetnici, chat_poruke + indexes + pg_trgm
-- Spec §4.1 tables 5-7, §4.2 indexes 6-10

-- pg_trgm extension za fuzzy search po nazivu firme
create extension if not exists pg_trgm;

-- 5. DOKUMENTI (storage refs)
create table dokumenti (
  id               uuid primary key default gen_random_uuid(),
  termin_id        uuid not null references termini(id) on delete cascade,
  naziv            text not null,
  storage_path     text not null,
  mime_type        text,
  velicina_bajt    bigint,
  generated_by_ai  bool not null default false,
  uploaded_at      timestamptz not null default now()
);

create index idx_dokumenti_termin on dokumenti (termin_id);

-- 6. PODSJETNICI (audit log)
create table podsjetnici (
  id          uuid primary key default gen_random_uuid(),
  termin_id   uuid not null references termini(id) on delete cascade,
  dana_prije  int not null,
  poslat_na   text[] not null,
  poslat_at   timestamptz not null default now(),
  resend_id   text,
  constraint chk_podsjetnici_dana_prije check (dana_prije between 0 and 365)
);

create index idx_podsjetnici_termin on podsjetnici (termin_id, dana_prije);

-- 7. CHAT_PORUKE (AI istorija)
create type chat_uloga as enum ('user','assistant');

create table chat_poruke (
  id                uuid primary key default gen_random_uuid(),
  konverzacija_id   uuid not null,
  uloga             chat_uloga not null,
  sadrzaj           text not null,
  alat_pozivi       jsonb,
  created_at        timestamptz not null default now()
);

create index idx_chat_konverzacija on chat_poruke (konverzacija_id, created_at);

-- Trigram search po nazivu firme (klijenti tabela iz Task 1)
create index idx_klijenti_naziv_trgm on klijenti using gin (naziv gin_trgm_ops);
