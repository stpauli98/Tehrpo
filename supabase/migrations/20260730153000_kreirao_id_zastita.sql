-- Zatvaranje dvije rupe koje je otkrio pregled cijele grane (30.07.2026.).
-- Re-run safe.
--
-- 1) kreirao_id je bio pisljiv na UPDATE-u (20260730150000 postavlja trigger samo `before
--    insert`). `*_upd` politike puštaju operatera da mijenja BILO KOJU kolonu na dodijeljenoj
--    firmi, pa je operater sa samo `smije_brisati_svoje` mogao prepisati vlasništvo na sebe
--    i time obrisati tuđi red. Dokazano na lokalnom DB-u:
--      A) delete tuđeg termina  -> 0 redova
--      B) update kreirao_id=ja  -> 1 red
--      C) delete poslije toga   -> 1 red
--    Dohvatljivo i bez aplikacije: anon ključ i URL su u browser bundle-u, pa je PATCH na
--    PostgREST direktan. RLS je jedina barijera i nije držala.
--
-- 2) Kapija "zatvaranje bez nalaza" (20260730152000) je bila samo `before update`, pa je
--    operater mogao INSERT-ovati termin odmah u status='izvrseno' bez nalaza. Dokazano:
--      D) INSERT status=izvrseno bez nalaza -> prošao
--      E) UPDATE na izvrseno bez nalaza     -> odbijen: nalaz_obavezan
--    Sporedni efekat: tako ubačen termin preskače i tg_termini_auto_cycle (AFTER UPDATE),
--    pa se sljedeći ciklus nikad ne generiše.

-- ── 1) Vlasništvo: postavi na INSERT, pinuj na UPDATE ────────────────────────
-- Pinujemo TIHO (NEW.kreirao_id := OLD.kreirao_id) umjesto raise: klijent koji šalje
-- pun red kroz PATCH i slučajno uključi nepromijenjenu vrijednost ne smije početi da pada.
-- Admin smije prepisati vlasništvo (npr. prenos zapisa) — prekidači se za njega ne konsultuju.
-- security definer: čita korisnici (self-select RLS) da FK ne padne za nepostojeći profil.
create or replace function tg_postavi_kreirao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' then
    -- Nepromijenjeno ponašanje iz 20260730150000.
    if NEW.kreirao_id is null and auth.uid() is not null
       and exists (select 1 from korisnici k where k.id = auth.uid()) then
      NEW.kreirao_id := auth.uid();
    end if;
    return NEW;
  end if;

  -- UPDATE. OLD postoji samo ovdje.
  -- auth.uid() is null = service-role put (cron, seed, import) → ne diramo ga, isti
  -- izuzetak kao svuda u ovoj grani.
  if auth.uid() is not null and not je_admin()
     and NEW.kreirao_id is distinct from OLD.kreirao_id then
    NEW.kreirao_id := OLD.kreirao_id;
  end if;
  return NEW;
end; $$;

drop trigger if exists postavi_kreirao on klijenti;
create trigger postavi_kreirao before insert or update on klijenti
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on lokacije;
create trigger postavi_kreirao before insert or update on lokacije
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on ugovori;
create trigger postavi_kreirao before insert or update on ugovori
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on termini;
create trigger postavi_kreirao before insert or update on termini
  for each row execute function tg_postavi_kreirao();
drop trigger if exists postavi_kreirao on dokumenti;
create trigger postavi_kreirao before insert or update on dokumenti
  for each row execute function tg_postavi_kreirao();

-- ── 2) Nalaz kapija i na INSERT-u ────────────────────────────────────────────
-- Svaki OLD. pristup je iza TG_OP = 'UPDATE' — na INSERT-u je OLD NULL.
-- INSERT sa status='izvrseno' je po definiciji prelazak: novi red nema dokumenata
-- (ne mogu postojati prije nego što termin postoji), pa pada osim uz dozvolu.
create or replace function tg_zatvaranje_trazi_nalaz() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Zanima nas samo PRELAZAK u 'izvrseno'.
  if NEW.status is distinct from 'izvrseno' then
    return NEW;
  end if;
  -- Update unutar istog statusa nije prelazak.
  if TG_OP = 'UPDATE' and OLD.status = 'izvrseno' then
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
create trigger zatvaranje_trazi_nalaz before insert or update on termini
  for each row execute function tg_zatvaranje_trazi_nalaz();

-- ── M1: komentar kolone nije pratio politike ─────────────────────────────────
-- 20260730151000 gate-uje i kontakt_osobe i klijent_provjere istim prekidačem.
comment on column korisnici.smije_brisati_klijente is
  'Operater briše klijenta, ugovor, lokaciju, kontakt osobu i profil provjere.';
