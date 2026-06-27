-- Fix: tg_audit() je koristio NEW.id / OLD.id, što PUCA na tabelama bez `id`
-- kolone (npr. korisnik_klijent ima kompozitni PK) → "record new has no field id".
-- Posljedica: SVAKI insert/update/delete na korisnik_klijent je bacao grešku
-- (dodjela klijenata korisniku — Task 9 postaviDodjela — bila je polomljena).
-- Robusno: izvuci id preko to_jsonb(...)->>'id' (vrati NULL ako kolone nema, bez greške).
create or replace function tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id');
  insert into audit_log (korisnik_id, akcija, entitet, entitet_id, staro, novo)
  values (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_id,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end
  );
  return coalesce(NEW, OLD);
end; $$;
