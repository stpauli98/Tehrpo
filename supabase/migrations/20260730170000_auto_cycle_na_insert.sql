-- Auto-ciklus i za termin unesen odmah kao 'izvrseno' (2026-07-30).
-- tg_termini_auto_cycle_au je AFTER UPDATE, pa INSERT sa status='izvrseno' nije generisao
-- sljedeći ciklus — periodika bi za tu uslugu tiho stala. Kapija za zatvaranje bez nalaza
-- (20260730153000) već pokriva INSERT; ovo je njena druga polovina (najavljeno u komentaru
-- te migracije: "tako ubačen termin preskače i tg_termini_auto_cycle").
--
-- Funkcija SE MIJENJA (nije samo bind na INSERT): najnovija definicija (20260630120000)
-- neuslovno čita OLD.datum_izvrsenja i OLD.status. Na INSERT-u OLD ne postoji (nije
-- dodijeljen), pa bi svaki insert u termini pukao sa "record OLD is not assigned yet" da smo
-- funkciju vezali nepromijenjenu. Dodat je TG_OP prekidač — isti obrazac kao u
-- tg_zatvaranje_trazi_nalaz i tg_postavi_kreirao (20260730153000): svaki OLD. pristup je iza
-- provjere TG_OP = 'UPDATE'. INSERT grana ne treba OLD uopšte — insert je po definiciji
-- prelazak, nema prethodnog stanja. Interval-gate (v_interval) i nacin_izvrsenja kolona iz
-- 20260630120000 su zadržani nepromijenjeni.
-- Re-run safe.

create or replace function tg_termini_auto_cycle() returns trigger
language plpgsql as $$
declare
  v_interval int;
begin
  if (
    (TG_OP = 'INSERT'
      and NEW.datum_izvrsenja is not null
      and NEW.status = 'izvrseno')
    or
    (TG_OP = 'UPDATE'
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
        datum_zadnjeg, rok_dospijeca, status, nacin_izvrsenja
      )
      values (
        NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
        NEW.datum_izvrsenja,
        NEW.datum_izvrsenja, -- placeholder; tg_compute_rok prepisuje
        'planirano',
        NEW.nacin_izvrsenja
      );
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_termini_auto_cycle_ai on termini;
create trigger tg_termini_auto_cycle_ai
  after insert on termini
  for each row execute function tg_termini_auto_cycle();
