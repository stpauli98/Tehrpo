-- Faza 6: konfiguracija podsjetnika, idempotencija, due RPC

-- 1. per-klijent dodatni primaoci podsjetnika
alter table klijenti
  add column podsjetnik_emails text[] not null default '{}';

-- 2. globalne postavke podsjetnika (single-row)
create table postavke (
  id          int primary key default 1,
  dana_prije  int[] not null default '{30,14,7,1}',
  updated_at  timestamptz not null default now(),
  constraint chk_postavke_singleton check (id = 1)
);
insert into postavke (id) values (1) on conflict (id) do nothing;

-- 3. idempotencija: jedan podsjetnik po (termin, prag)
--    drop redundantnog ne-unique indeksa nad istim kolonama (iz supporting_tables migracije)
drop index if exists idx_podsjetnici_termin;
create unique index uq_podsjetnici_termin_dana on podsjetnici (termin_id, dana_prije);

-- 4. due reminders RPC: za svaki prag d, termini sa rok = current_date + d,
--    status aktivan (planirano/zakazano), bez postojeceg podsjetnika za taj prag
create or replace function get_due_podsjetnici(dana_prije_arr int[])
returns table (
  termin_id              uuid,
  dana_prije             int,
  klijent_naziv          text,
  vrsta_naziv            text,
  rok_dospijeca          date,
  lokacija_naziv         text,
  lokacija_kontakt_email text,
  podsjetnik_emails      text[]
)
language sql
stable
as $$
  select
    t.id              as termin_id,
    d.d               as dana_prije,
    k.naziv           as klijent_naziv,
    vp.naziv          as vrsta_naziv,
    t.rok_dospijeca   as rok_dospijeca,
    l.naziv           as lokacija_naziv,
    l.kontakt_email   as lokacija_kontakt_email,
    k.podsjetnik_emails as podsjetnik_emails
  from unnest(dana_prije_arr) as d(d)
  join termini t
    on t.rok_dospijeca = current_date + d.d
   and t.status in ('planirano','zakazano')
  join klijenti k        on k.id = t.klijent_id
  join vrste_provjera vp on vp.id = t.vrsta_provjere_id
  left join lokacije l   on l.id = t.lokacija_id
  where not exists (
    select 1 from podsjetnici p
    where p.termin_id = t.id and p.dana_prije = d.d
  )
  order by t.rok_dospijeca, k.naziv;
$$;
