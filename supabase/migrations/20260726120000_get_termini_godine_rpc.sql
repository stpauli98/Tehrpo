-- supabase/migrations/20260726120000_get_termini_godine_rpc.sql
-- Raspon godina koje stvarno postoje u terminima — tačno jedan red (min_godina, max_godina).
-- Zamjenjuje hardkodovani `currentYear() ± 1` u filterima godine (standard S8.1);
-- konzumenti u UI-u su van obima ove grane, ovdje se isporučuje samo izvor podataka.
--
-- ZAŠTO SECURITY INVOKER (podrazumijevano — ovdje NAMJERNO NEMA `security definer`):
--   RLS polisa `termini_sel` (`ima_pristup_klijentu(klijent_id)`,
--   20260626211000_rls_enable.sql:60) namjerno sužava termine na klijente kojima
--   korisnik ima pristup. Raspon godina mora pratiti isti filter: operater ne smije
--   u padajućem meniju dobiti godine koje postoje isključivo kod tuđih klijenata —
--   to bi i odalo postojanje tih podataka i nudilo godine koje njemu daju praznu listu.
--   Definer bi ovdje bio tiha rupa u RLS-u, pa se svjesno ne koristi.
--
-- ZAŠTO IZVOR `termini` A NE `termini_view`:
--   view nema kolonu `godina` niti ikakav godišnji agregat (S8.1 izričito traži agregat
--   „nad termini"), a obje datumske kolone ionako prolaze kroz `t.*`; direktan pristup
--   tabeli izbjegava 3 nepotrebna left joina (20260620214413_termini_read_model.sql).
--
-- ZAŠTO OBJE DATUMSKE KOLONE:
--   filter godine u UI-u gađa i rok dospijeća i zakazani datum, pa raspon mora pokriti obje.
--   `datum_zakazan` je nullable (20260620200651_termini.sql:17), dok je `rok_dospijeca`
--   NOT NULL. Postgres `least()`/`greatest()` PRESKAČU NULL argumente, pa se za red bez
--   zakazanog datuma izraz svede na sam `rok_dospijeca` — nema potrebe za coalesce.
--   Prazna (ili RLS-om praznom svedena) tabela → agregat vraća jedan red sa NULL/NULL;
--   taj slučaj hvata `godineRaspon()` u lib/queries/godine.ts (fallback: tekuća ± 1).
create or replace function get_termini_godine()
returns table (min_godina int, max_godina int)
language sql
stable
as $$
  select
    min(least(extract(year from t.rok_dospijeca), extract(year from t.datum_zakazan)))::int
      as min_godina,
    max(greatest(extract(year from t.rok_dospijeca), extract(year from t.datum_zakazan)))::int
      as max_godina
  from termini t;
$$;

-- Grants po presedanu 20260711160000_get_admini_rpc.sql — nikad PUBLIC (ni anon).
revoke execute on function get_termini_godine() from public;
grant execute on function get_termini_godine() to authenticated;
