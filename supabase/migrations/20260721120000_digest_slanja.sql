-- Ledger sedmičnog digesta. Ključ je (primalac, dan) — jedan digest po osobi po danu.
-- `datum` je LOKALNI BEČKI datum iz lokalniSatIDatum, ne current_date (UTC): isti izvor
-- koji koristi i trebaDigest. Da se razilaze, u kasnim večernjim satima bi ključ i odluka
-- pokazivali na različite dane.
create table if not exists digest_slanja (
  id             uuid        primary key default gen_random_uuid(),
  primalac_email text        not null,
  datum          date        not null,
  stanje         text        not null default 'u_toku'
                             check (stanje in ('u_toku','poslato')),
  claimed_at     timestamptz not null default now(),
  poslat_at      timestamptz,
  resend_id      text,
  -- Dokazni trag: mejl_log bilježi DA je digest poslat, ali ne i ŠTA je u njemu pisalo.
  termin_ids     uuid[]      not null default '{}',
  constraint uq_digest_slanja unique (primalac_email, datum)
);

create index if not exists idx_digest_slanja_datum on digest_slanja (datum desc);

-- RLS bez politika: piše i čita isključivo cron preko service-role klijenta (bypass RLS).
-- Supabase-ov alter default privileges ionako grantuje anon/authenticated, pa je RLS
-- bez politika jedino što tabelu drži zatvorenom kroz PostgREST.
alter table digest_slanja enable row level security;
