-- N05: tg_termini_compute_rok smije preračunavati rok SAMO kad se ulaz stvarno promijeni.
--
-- Kvar (do ove migracije): funkcija iz 20260620201630_triggers.sql je BEZUSLOVNO
-- računala rok_dospijeca = datum_zadnjeg + interval na SVAKOM INSERT-u I UPDATE-u.
-- Interval se čita kao coalesce(termin.interval_mjeseci, vrsta.podrazumevani_interval_mjeseci),
-- pa je promjena podrazumijevanog intervala VRSTE tiho „naoružala" sve termine te vrste
-- koji nemaju vlastiti interval: prvi sljedeći, potpuno nepovezan edit (npr. samo napomena
-- ili datum zakazan) prepisivao je zakonski rok novim, pomjerenim datumom. Zakonski rok
-- pregleda iz ZNR/ZOP ne smije se mijenjati kao bočni efekat uređivanja napomene.
--
-- Ponašanje POSLIJE:
--   INSERT  — računa kao i do sada (bezuslovno). Bitno: tg_termini_auto_cycle ubacuje
--             novi ciklus sa rok_dospijeca = datum_izvrsenja kao PLACEHOLDER i oslanja se
--             na to da ga ovaj trigger prepiše. Ta grana se namjerno NE mijenja.
--   UPDATE  — računa samo ako se promijenio datum_zadnjeg ili interval_mjeseci
--             (`is distinct from` → i NULL↔vrijednost prelazi se hvata).
--   Ručna korekcija — ako je pozivalac u istom UPDATE-u sam poslao drugačiji
--             rok_dospijeca, njegova vrijednost se poštuje i trigger je ne dira.
--
-- Ne dira se: postavljanje updated_at (ostaje na svakom INSERT/UPDATE) ni sam trigger
-- binding tg_termini_compute_rok_biud (BEFORE INSERT OR UPDATE) — mijenja se samo tijelo
-- funkcije, pa nema potrebe za drop/create trigera.
--
-- Idempotentno / re-run safe (create or replace). Ne mijenja podatke.
-- NAPOMENA: ovo zaustavlja BUDUĆI drift; već nastali drift u podacima se ovom
-- migracijom NE sanira (svjesno — sanacija je poslovna odluka, ide zasebno).

create or replace function tg_termini_compute_rok() returns trigger
language plpgsql as $$
declare
  v_interval int;
  v_racunaj  boolean;
begin
  if TG_OP = 'INSERT' then
    v_racunaj := true;
  else
    -- Preračunaj samo kad se stvarno promijenio ULAZ računa.
    v_racunaj := (NEW.datum_zadnjeg is distinct from OLD.datum_zadnjeg)
              or (NEW.interval_mjeseci is distinct from OLD.interval_mjeseci);
    -- Eksplicitna ručna korekcija roka ima prednost nad računom.
    if NEW.rok_dospijeca is distinct from OLD.rok_dospijeca then
      v_racunaj := false;
    end if;
  end if;

  if v_racunaj and NEW.datum_zadnjeg is not null then
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
$$;
