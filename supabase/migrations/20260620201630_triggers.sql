-- Triggers: compute_rok + auto_cycle
-- Spec §4.4 (storage_cleanup ODGOĐEN do Phase 7)

-- TRIGGER 1: compute_rok
-- BEFORE INSERT/UPDATE — ako je datum_zadnjeg postavljen, izračunaj
-- rok_dospijeca = datum_zadnjeg + interval mjeseci.
-- Ako interval_mjeseci nije postavljen, koristi default iz vrste_provjera.
create function tg_termini_compute_rok() returns trigger as $$
declare
  v_interval int;
begin
  if NEW.datum_zadnjeg is not null then
    v_interval := coalesce(
      NEW.interval_mjeseci,
      (select podrazumevani_interval_mjeseci from vrste_provjera where id = NEW.vrsta_provjere_id)
    );
    if v_interval is not null then
      NEW.rok_dospijeca := NEW.datum_zadnjeg + (v_interval || ' months')::interval;
    end if;
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$ language plpgsql;

create trigger tg_termini_compute_rok_biud
  before insert or update on termini
  for each row execute function tg_termini_compute_rok();


-- TRIGGER 2: auto_cycle
-- AFTER UPDATE — okida se na tranziciji datum_izvrsenja NULL → NOT NULL
-- + status = 'izvrseno'. Insertuje sljedeći termin u ciklusu.
-- Idempotentno: ne okida na re-update istog datum_izvrsenja.
create function tg_termini_auto_cycle() returns trigger as $$
begin
  if OLD.datum_izvrsenja is null
     and NEW.datum_izvrsenja is not null
     and NEW.status = 'izvrseno' then
    insert into termini (
      klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
      datum_zadnjeg, rok_dospijeca, status
    )
    values (
      NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
      NEW.datum_izvrsenja,
      NEW.datum_izvrsenja, -- placeholder; tg_compute_rok prepisuje
      'planirano'
    );
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger tg_termini_auto_cycle_au
  after update on termini
  for each row execute function tg_termini_auto_cycle();
