-- supabase/migrations/20260730120000_ugovori_na_neodredjeno.sql
-- Yoink 2026-07-30, stavka 5: ugovor na neodređeno.
--
-- Zašto zasebna kolona a ne "prazan datum_isteka":
-- prazan datum trenutno znači i "bezročan ugovor" i "još nisam unio istek".
-- Bez eksplicitnog flaga ta dva stanja se ne mogu razlikovati, pa ni prikazati
-- ni izvijestiti različito.

alter table ugovori
  add column if not exists na_neodredjeno bool not null default false;

-- Neodređeno i konkretan istek se međusobno isključuju.
alter table ugovori drop constraint if exists chk_ugovori_neodredjeno;
alter table ugovori add constraint chk_ugovori_neodredjeno
  check (not (na_neodredjeno and datum_isteka is not null));

comment on column ugovori.na_neodredjeno is
  'Ugovor bez datuma isteka (na neodređeno). Isključuje datum_isteka.';
