-- N03 (01.08.2026.): „Jednokratan" termin ne smije pokretati auto-ciklus.
--
-- Tabela termini nije imala gdje da zapamti izbor „Jednokratno / Ponavlja se" iz
-- forme za novi termin (components/domain/NoviTerminDialog.tsx šalje ponavlja_se
-- samo za „Ponavlja se", a createTermin ga je koristio ISKLJUČIVO za odluku o
-- profil-stavki u klijent_provjere — INSERT u termini je bio identičan za oba
-- izbora). Zato je tg_termini_auto_cycle po zatvaranju svakog termina posezao za
-- podrazumijevanim intervalom VRSTE:
--     coalesce(NEW.interval_mjeseci, vrste_provjera.podrazumevani_interval_mjeseci)
-- i jednokratnom unosu pravio nasljednika. Lanac se nije prekidao — i to dijete je
-- po zatvaranju pravilo unuka, a za takve fantome su već slati podsjetnici.
--
-- Popravka:
--   1) kolona termini.ponavlja_se (DEFAULT true — postojeći redovi i svi ostali
--      putevi upisa, npr. generisanje termina iz profila usluge u
--      app/(dashboard)/klijenti/actions.ts, zadržavaju dosadašnje ponašanje);
--   2) OBJE grane trigera (INSERT i UPDATE) traže NEW.ponavlja_se;
--   3) dijete nasljeđuje NEW.ponavlja_se (ostaje ponavljajuće, lanac se nastavlja).
--
-- Ostatak funkcije je doslovno prekopiran iz zadnje aktivne verzije
-- (20260730170000_auto_cycle_na_insert.sql): TG_OP prekidač (na INSERT-u OLD ne
-- postoji), interval-gate (v_interval is not null) i prenos nacin_izvrsenja.
-- Re-run safe.

alter table termini add column if not exists ponavlja_se boolean not null default true;

comment on column termini.ponavlja_se is
  'false = jednokratan termin: po izvršenju se NE generiše sljedeći ciklus (tg_termini_auto_cycle). Default true = dosadašnje ponašanje.';

create or replace function tg_termini_auto_cycle() returns trigger
language plpgsql as $$
declare
  v_interval int;
begin
  if (
    (TG_OP = 'INSERT'
      and NEW.ponavlja_se
      and NEW.datum_izvrsenja is not null
      and NEW.status = 'izvrseno')
    or
    (TG_OP = 'UPDATE'
      and NEW.ponavlja_se
      and OLD.datum_izvrsenja is null
      and NEW.datum_izvrsenja is not null
      and NEW.status = 'izvrseno'
      and OLD.status is distinct from 'izvrseno')
  ) then
    v_interval := coalesce(
      NEW.interval_mjeseci,
      (select podrazumevani_interval_mjeseci from vrste_provjera where id = NEW.vrsta_provjere_id)
    );
    if v_interval is not null then
      insert into termini (
        klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
        datum_zadnjeg, rok_dospijeca, status, nacin_izvrsenja, ponavlja_se
      )
      values (
        NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
        NEW.datum_izvrsenja,
        NEW.datum_izvrsenja, -- placeholder; tg_compute_rok prepisuje
        'planirano',
        NEW.nacin_izvrsenja,
        NEW.ponavlja_se
      );
    end if;
  end if;
  return NEW;
end;
$$;
