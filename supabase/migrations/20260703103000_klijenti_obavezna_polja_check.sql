-- Obavezna polja klijenta (odluka 2026-07-03): adresa, telefon, email.
-- Faza A (ova migracija): CHECK constraints protiv praznih/neispravnih vrijednosti,
-- NOT VALID da postojeći prod redovi (uneseni prije pravila) ne obore primjenu —
-- pravila važe za sve NOVE upise i izmjene.
-- Faza B (kasnije, kad se postojeći klijenti dopune stvarnim podacima):
--   alter table klijenti validate constraint chk_klijenti_email_format; (itd.)
--   alter table klijenti alter column adresa/telefon/email set not null;
-- Obaveznost se do tada sprovodi na formi i u server akcijama. Re-run-safe.

alter table klijenti drop constraint if exists chk_klijenti_email_format;
alter table klijenti add constraint chk_klijenti_email_format
  check (email is null or email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$') not valid;

alter table klijenti drop constraint if exists chk_klijenti_adresa_neprazna;
alter table klijenti add constraint chk_klijenti_adresa_neprazna
  check (adresa is null or length(trim(adresa)) > 0) not valid;

alter table klijenti drop constraint if exists chk_klijenti_telefon_neprazan;
alter table klijenti add constraint chk_klijenti_telefon_neprazan
  check (telefon is null or length(trim(telefon)) > 0) not valid;

alter table klijenti drop constraint if exists chk_klijenti_pib_neprazan;
alter table klijenti add constraint chk_klijenti_pib_neprazan
  check (pib is null or length(trim(pib)) > 0) not valid;

alter table klijenti drop constraint if exists chk_klijenti_maticni_neprazan;
alter table klijenti add constraint chk_klijenti_maticni_neprazan
  check (maticni_broj is null or length(trim(maticni_broj)) > 0) not valid;

alter table klijenti drop constraint if exists chk_klijenti_sifra_neprazna;
alter table klijenti add constraint chk_klijenti_sifra_neprazna
  check (sifra_djelatnosti is null or length(trim(sifra_djelatnosti)) > 0) not valid;
