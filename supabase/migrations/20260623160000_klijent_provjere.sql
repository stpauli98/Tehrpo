-- Profil provjera po klijentu: koje vrste klijent ima (opciono na lokaciji), interval, zadnji datum.
-- IF NOT EXISTS svuda → migracija je re-run sigurna (review-loop može ponoviti apply).
create table if not exists klijent_provjere (
  id                uuid primary key default gen_random_uuid(),
  klijent_id        uuid not null references klijenti(id) on delete cascade,
  vrsta_provjere_id uuid not null references vrste_provjera(id) on delete restrict,
  lokacija_id       uuid references lokacije(id) on delete set null,
  interval_mjeseci  int check (interval_mjeseci is null or interval_mjeseci between 1 and 120),
  zadnji_datum      date not null,
  aktivan           bool not null default true,
  created_at        timestamptz not null default now()
);

create unique index if not exists uq_klijent_provjere
  on klijent_provjere (klijent_id, vrsta_provjere_id, coalesce(lokacija_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_klijent_provjere_klijent on klijent_provjere (klijent_id);

-- App koristi anon ključ bez Auth-a → RLS off (kao ostale tabele)
alter table klijent_provjere disable row level security;
