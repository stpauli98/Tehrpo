-- supabase/migrations/20260626210500_audit_trigger.sql
-- Generički audit: bilježi INSERT/UPDATE/DELETE sa staro→novo (JSONB).
-- Akter = auth.uid() (null za service-role/cron = sistemska izmjena).

create or replace function tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(NEW.id::text, OLD.id::text);
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

create trigger audit_klijenti        after insert or update or delete on klijenti        for each row execute function tg_audit();
create trigger audit_lokacije        after insert or update or delete on lokacije        for each row execute function tg_audit();
create trigger audit_termini         after insert or update or delete on termini         for each row execute function tg_audit();
create trigger audit_vrste_provjera  after insert or update or delete on vrste_provjera  for each row execute function tg_audit();
create trigger audit_korisnici       after insert or update or delete on korisnici       for each row execute function tg_audit();
create trigger audit_korisnik_klijent after insert or update or delete on korisnik_klijent for each row execute function tg_audit();
create trigger audit_klijent_provjere after insert or update or delete on klijent_provjere for each row execute function tg_audit();
