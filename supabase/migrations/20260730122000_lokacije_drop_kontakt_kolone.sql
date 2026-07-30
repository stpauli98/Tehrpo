-- supabase/migrations/20260730122000_lokacije_drop_kontakt_kolone.sql
-- Yoink 2026-07-30, stavke 8+9, drugi korak: uklanjanje ravnih kontakt kolona.
--
-- Odvojeno od 20260730121000 namjerno: prebacivanje podataka mora biti
-- provjereno PRIJE nego što se izvor nepovratno obriše.

alter table lokacije drop column if exists kontakt_osoba;
alter table lokacije drop column if exists kontakt_email;
alter table lokacije drop column if exists kontakt_telefon;
