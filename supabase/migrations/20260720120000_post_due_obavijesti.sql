-- Ledger post-due obavijesti, ključan po CIKLUSU = coalesce(datum_zakazan, rok_dospijeca).
-- podsjetnici ostaje pre-due i istorijski ledger i ne dira se.
create table if not exists post_due_obavijesti (
  id          uuid        primary key default gen_random_uuid(),
  termin_id   uuid        not null references termini(id) on delete cascade,
  ciklus_rok  date        not null,
  kanal       text        not null check (kanal in ('interni','firma')),
  stanje      text        not null default 'u_toku'
                          check (stanje in ('u_toku','poslato','preskoceno')),
  razlog      text,
  claimed_at  timestamptz not null default now(),
  poslat_at   timestamptz,
  poslat_na   text[]      not null default '{}',
  resend_id   text,
  constraint uq_post_due unique (termin_id, ciklus_rok, kanal)
);

-- Bez zasebnog indeksa: uq_post_due (termin_id, ciklus_rok, kanal) ima prefiks
-- (termin_id, ciklus_rok) i pokriva svaki upit iz get_post_due_termine i claim_post_due.

-- RLS bez politika: piše i čita isključivo cron preko service-role klijenta (bypass RLS).
-- Supabase-ov alter default privileges ionako grantuje anon/authenticated, pa je RLS
-- bez politika jedino što tabelu drži zatvorenom kroz PostgREST.
alter table post_due_obavijesti enable row level security;

-- SUPRESIONI BACKFILL: termini koji su SADA u alarmu i koji se AKTIVNO spamuju
-- (post-due zapis u posljednjih 14 dana) dobijaju trag za TEKUĆI ciklus, po kanalu
-- koji je stvarno slao. Bez ovoga bi prvi run poslije deploya poslao mejlove.
-- Ne rekonstruiše se ništa iz dana_prije: ta aritmetika daje rok, a ciklus je
-- coalesce(datum_zakazan, rok_dospijeca) i za CARMEUSE se to razilazi.
insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, razlog, poslat_at)
select t.id,
       coalesce(t.datum_zakazan, t.rok_dospijeca),
       k.kanal,
       'poslato',
       'backfill_migracija',
       max(p.poslat_at)
from termini t
cross join (values ('interni'),('firma')) as k(kanal)
join podsjetnici p on p.termin_id = t.id and p.dana_prije < 0
where t.status in ('planirano','zakazano')
  and t.rok_dospijeca < current_date
  and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
  and p.kanal = k.kanal
  and p.poslat_at > now() - interval '14 days'
group by t.id, coalesce(t.datum_zakazan, t.rok_dospijeca), k.kanal
on conflict do nothing;
