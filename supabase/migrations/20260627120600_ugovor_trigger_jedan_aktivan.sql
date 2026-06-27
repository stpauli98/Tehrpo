-- supabase/migrations/20260627120600_ugovor_trigger_jedan_aktivan.sql
-- PP-1: "jedan aktivan ugovor po klijentu" atomično u DB-u.
-- BEFORE INSERT/UPDATE: ako je NEW.aktivan, deaktiviraj ostale ugovore istog klijenta
-- u ISTOJ transakciji → nema partial-write rizika (deactivate+insert su atomični),
-- i nikad se ne narušava partial unique index uq_ugovori_aktivan.
-- Rekurzija nemoguća: kaskadni UPDATE postavlja aktivan=false → grana se ne okida ponovo.

create or replace function tg_ugovor_jedan_aktivan() returns trigger
language plpgsql as $$
begin
  if NEW.aktivan then
    update ugovori
      set aktivan = false
      where klijent_id = NEW.klijent_id and aktivan and id <> NEW.id;
  end if;
  return NEW;
end; $$;

drop trigger if exists ugovor_jedan_aktivan on ugovori;
create trigger ugovor_jedan_aktivan before insert or update on ugovori
  for each row execute function tg_ugovor_jedan_aktivan();
