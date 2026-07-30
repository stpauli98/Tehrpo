-- supabase/migrations/20260730123000_fix_kontakt_osobe_lokacija_fk_set_null.sql
-- Bug otkriven dok se verifikovao E2E flow za Task 5 (ravni kontakti → kontakt_osobe):
-- brisanje lokacije koja ima vezan kontakt_osobe red je pucalo sa
-- "null value in column klijent_id of relation kontakt_osobe violates not-null
-- constraint" (23502), umjesto da samo otkači kontakt od lokacije.
--
-- Uzrok: fk_kontakt_lokacija_ista_firma (iz 20260728140000_kontakt_lokacija.sql)
-- je KOMPOZITNI strani ključ (lokacija_id, klijent_id) → lokacije (id, klijent_id)
-- sa `on delete set null` BEZ liste kolona. Standardni SET NULL na kompozitnom FK-u
-- nulira SVE kolone ključa — dakle i klijent_id, koji je NOT NULL na kontakt_osobe.
-- To je isključivo kolateralna šteta ove definicije; kontakt treba ostati vezan
-- za istu firmu, samo mu treba otkačiti lokaciju.
--
-- Fix: PostgreSQL 15+ podržava listu kolona uz SET NULL — `on delete set null
-- (lokacija_id)` — nulira SAMO navedenu kolonu, klijent_id ostaje netaknut.
-- DEMO i PROD su na PG 17, pa je sintaksa dostupna.

alter table kontakt_osobe
  drop constraint if exists fk_kontakt_lokacija_ista_firma;

alter table kontakt_osobe
  add constraint fk_kontakt_lokacija_ista_firma
    foreign key (lokacija_id, klijent_id)
    references lokacije (id, klijent_id)
    on delete set null (lokacija_id);
