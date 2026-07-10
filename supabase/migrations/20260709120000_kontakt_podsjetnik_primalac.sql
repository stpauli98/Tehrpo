-- Podsjetnici: primaoci firminih podsjetnika biraju se iz kontakata (kontakt_osobe),
-- ne iz slobodne liste klijenti.podsjetnik_emails.
-- EXPAND korak: dodaj flag + migriraj postojeće podsjetnik_emails u kontakte.
-- podsjetnik_emails OSTAJE (drop je zasebna migracija B, nakon deploya novog koda).

begin;

-- 1) po-kontakt flag: „ovaj kontakt prima firmine podsjetnike"
alter table kontakt_osobe
  add column podsjetnik_primalac boolean not null default false;

-- 2a) postojeći kontakt čiji se mejl poklapa s podsjetnik_emails svoje firme → označi
update kontakt_osobe ko
set podsjetnik_primalac = true
from klijenti k
where ko.klijent_id = k.id
  and ko.email is not null
  and lower(btrim(ko.email)) = any (
    select lower(btrim(e)) from unnest(k.podsjetnik_emails) e where btrim(e) <> ''
  );

-- 2b) orphan mejl (nema kontakta) → napravi kontakt (ime=mejl, može se preimenovati)
insert into kontakt_osobe (klijent_id, ime, email, podsjetnik_primalac)
select distinct k.id, lower(btrim(e)), lower(btrim(e)), true
from klijenti k
cross join lateral unnest(k.podsjetnik_emails) e
where btrim(e) <> ''
  and not exists (
    select 1 from kontakt_osobe ko
    where ko.klijent_id = k.id
      and ko.email is not null
      and lower(btrim(ko.email)) = lower(btrim(e))
  );

commit;
