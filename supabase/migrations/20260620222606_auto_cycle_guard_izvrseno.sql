-- Fix: tg_termini_auto_cycle ne smije re-okidati na re-save vec izvrsenog termina
-- Dodajemo: AND OLD.status IS DISTINCT FROM 'izvrseno'
-- Ovo osigurava da se ciklus stvara SAMO pri tranziciji u 'izvrseno',
-- ne pri naknadnim editima datum_izvrsenja kada je status vec 'izvrseno'.

create or replace function tg_termini_auto_cycle() returns trigger as $$
begin
  if OLD.datum_izvrsenja is null
     and NEW.datum_izvrsenja is not null
     and NEW.status = 'izvrseno'
     and OLD.status is distinct from 'izvrseno' then
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
