-- Whole-branch review fixevi (EPIK A).
-- Re-run-safe (drop ... if exists prije create).

-- 1) MUST-FIX: storage_dok_wr je dozvoljavao 'pregled' (read-only ulogu) da PIŠE/BRIŠE
--    dokumente (nedostajao 'not je_pregled()' koji svaka relaciona _wr politika ima).
drop policy if exists storage_dok_wr on storage.objects;
create policy storage_dok_wr on storage.objects for all
  using ( bucket_id = 'tehpro-dokumenti' and auth.uid() is not null and not public.je_pregled() )
  with check ( bucket_id = 'tehpro-dokumenti' and auth.uid() is not null and not public.je_pregled() );
-- NAPOMENA (tehnički dug, ADR): objekti NISU izolovani po klijentu (samo auth.uid() not null).
-- Bilo koji prijavljeni korisnik može preuzeti/obrisati tuđe fajlove preko storage API-ja.
-- Prihvatljivo za MVP (jedan tim povjerenja); post-MVP: scope po path-u (termini/{termin_id}/...)
-- ili posluži preko signed URL-a iza row-level RLS provjere.

-- 2) SHOULD-FIX: auditovati i dokumenti i postavke (compliance — brisanje dokumenta /
--    promjena pragova podsjetnika mora ostaviti trag).
drop trigger if exists audit_dokumenti on dokumenti;
create trigger audit_dokumenti after insert or update or delete on dokumenti
  for each row execute function tg_audit();
drop trigger if exists audit_postavke on postavke;
create trigger audit_postavke after insert or update or delete on postavke
  for each row execute function tg_audit();

-- 3) SHOULD-FIX: audit_log je append-only kroz RLS (samo SELECT politika), ali RLS NE
--    pokriva TRUNCATE. Oduzmi TRUNCATE od anon/authenticated (defense-in-depth).
revoke truncate on audit_log from anon, authenticated;

-- 4) DOKUMENTACIJA (reproducibilnost): u bazi postoji custom event trigger
--    `ensure_rls` → public.rls_auto_enable() (SECURITY DEFINER, search_path=pg_catalog) koji
--    AUTOMATSKI radi `enable row level security` na svakoj novoj public tabeli. ZBOG NJEGA su
--    korisnici/korisnik_klijent/audit_log imali RLS=true prije 20260626211000 (NIJE bio
--    "agentov eksperiment" kako je tamo pogrešno napisano). Posljedica: nova tabela bez
--    politike → tiho vraća 0 redova (RLS-enabled-but-policyless). Funkcija se ovdje hvata u
--    verziju radi vidljivosti; sam event trigger zahtijeva elevirane privilegije (supabase_admin)
--    pa se NE kreira iz ove migracije (postoji u cloud bazi). Vidi AGENTS.md.
create or replace function public.rls_auto_enable()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then
        raise log 'rls_auto_enable: failed on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$function$;
