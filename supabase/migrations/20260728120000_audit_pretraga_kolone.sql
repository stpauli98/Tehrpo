-- Aktivnost je pucala na statement_timeout (9,5 s > 8 s). Uz keyset paginaciju
-- (20260728121000), ovo je drugi dio popravke: pretraga po tekstu dobija indeks.
--
-- ZAŠTO GENERISANE KOLONE, a ne izraz u indeksu:
-- `pretraga_tekst` se čita i u SELECT-u nove RPC, ne samo u WHERE — stored kolona
-- se izračuna jednom pri upisu umjesto pri svakom čitanju. `klijent_ref` uz to
-- zamjenjuje `tekst_u_uuid(case …)` izraz iz obrisanog aktivnost_view-a, pa join
-- na `klijenti` ide preko običnog uuid = uuid uslova i može koristiti btree.
--
-- OPCLASS ŠEMA: pg_trgm je instaliran u `public` (ne `extensions`) i na DEMO i na
-- PROD. `extensions.gin_trgm_ops` NE postoji i obara migraciju.
--
-- LOCK: dodavanje STORED generisane kolone prepisuje tabelu uz ACCESS EXCLUSIVE.
-- Na ~5.500 redova / 2,5 MB to je ispod sekunde. Provjeriti trajanje na DEMO-u
-- prije PROD apply-a.

create extension if not exists pg_trgm;

alter table audit_log
  add column if not exists pretraga_tekst text
  generated always as (
    coalesce(entitet, '')      || ' ' ||
    coalesce(entitet_id, '')   || ' ' ||
    coalesce(akcija, '')       || ' ' ||
    coalesce(staro::text, '')  || ' ' ||
    coalesce(novo::text, '')   || ' ' ||
    coalesce(detalji::text, '')
  ) stored;

alter table audit_log
  add column if not exists klijent_ref uuid
  generated always as (
    tekst_u_uuid(
      case when entitet = 'klijenti'
           then coalesce(novo ->> 'id', staro ->> 'id', entitet_id)
           else coalesce(novo ->> 'klijent_id', staro ->> 'klijent_id')
      end)
  ) stored;

create index if not exists idx_audit_pretraga
  on audit_log using gin (pretraga_tekst public.gin_trgm_ops);

create index if not exists idx_audit_klijent_ref
  on audit_log (klijent_ref);

-- Keyset listanje: (vrijeme desc, id desc). Postojeći idx_audit_vrijeme ostaje —
-- koristi ga Plan aktivnosti; ovaj samo dodaje tie-break po id.
create index if not exists idx_audit_vrijeme_id
  on audit_log (vrijeme desc, id desc);

analyze audit_log;
