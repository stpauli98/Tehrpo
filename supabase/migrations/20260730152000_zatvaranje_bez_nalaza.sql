-- Zatvaranje aktivnosti bez nalaza (potvrđeno 30.07.2026.).
-- Aktivnost se smije označiti kao izvršena bez ijednog priloženog dokumenta samo ako je
-- korisnik admin ili operater sa smije_zatvoriti_bez_nalaza.
-- Trigger, ne CHECK constraint: uslov zavisi od auth.uid() (nije immutable) i od druge tabele.
-- Re-run safe.

create or replace function tg_zatvaranje_trazi_nalaz() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Zanima nas samo PRELAZAK u 'izvrseno'. Update-i unutar istog statusa prolaze.
  if NEW.status is distinct from 'izvrseno' or OLD.status = 'izvrseno' then
    return NEW;
  end if;
  -- Service-role putevi (cron, seed, import) nemaju auth.uid() → ne diramo ih.
  if auth.uid() is null then
    return NEW;
  end if;
  if smije_zatvoriti_bez_nalaza() then
    return NEW;
  end if;
  if not exists (select 1 from dokumenti d where d.termin_id = NEW.id) then
    raise exception 'nalaz_obavezan' using errcode = '23514';
  end if;
  return NEW;
end; $$;

drop trigger if exists zatvaranje_trazi_nalaz on termini;
create trigger zatvaranje_trazi_nalaz before update on termini
  for each row execute function tg_zatvaranje_trazi_nalaz();
