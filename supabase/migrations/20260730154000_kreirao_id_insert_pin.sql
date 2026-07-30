-- Zatvara posljednju rupu u vlasništvu zapisa (pregled cijele grane, 30.07.2026.).
-- Re-run safe.
--
-- 20260730153000 je pinovao kreirao_id na UPDATE-u, ali INSERT grana je i dalje puštala
-- eksplicitno zadan kreirao_id kroz (samo je punila kolonu kad je NULL). Ne-admin je tako
-- mogao INSERT-ovati nov red i pripisati ga kolegi (lažno vlasništvo i audit trag), iako
-- ne dobija time pravo brisanja tuđeg POSTOJEĆEG reda (ta rupa je već zatvorena).
-- Dohvatljivo bez aplikacije: anon ključ i URL su u browser bundle-u, PostgREST prima POST
-- direktno. RLS/trigeri su jedina barijera.
--
-- Fix: na INSERT-u, za ne-admina sa auth.uid() koji ima korisnici profil, kreirao_id se
-- TIHO prisiljava na auth.uid() bez obzira šta je poslano (isti stil kao UPDATE pin —
-- ne raise, da ne pukne klijent koji šalje puni red).
-- Nepromijenjeno:
--   - auth.uid() is null (service-role: cron, seed, import) → ne diramo, šta god bilo poslano.
--   - Admin i dalje smije eksplicitno zadati tuđi kreirao_id (re-atribucija ostaje moguća).
--   - FK čuvar (exists u korisnici) ostaje — bez njega bi prisilan upis mogao pući na FK
--     za auth.users red bez profila.
--   - UPDATE grana (20260730153000) je nepromijenjena.
--
-- Trigeri su već vezani na ime funkcije (postavi_kreirao, before insert or update na sve
-- pet tabela) — dovoljno je zamijeniti tijelo funkcije, trigere nije potrebno ponovo praviti.
create or replace function tg_postavi_kreirao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' then
    -- Prisili na auth.uid() osim kad admin eksplicitno zadaje NEKU vrijednost (re-atribucija).
    if auth.uid() is not null
       and (NEW.kreirao_id is null or not je_admin())
       and exists (select 1 from korisnici k where k.id = auth.uid()) then
      NEW.kreirao_id := auth.uid();
    end if;
    return NEW;
  end if;

  -- UPDATE. OLD postoji samo ovdje. Nepromijenjeno iz 20260730153000.
  if auth.uid() is not null and not je_admin()
     and NEW.kreirao_id is distinct from OLD.kreirao_id then
    NEW.kreirao_id := OLD.kreirao_id;
  end if;
  return NEW;
end; $$;
