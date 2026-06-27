-- supabase/migrations/20260627120000_klijenti_idkarta_polja.sql
-- PP-1: ID-karta polja na klijentu + odgovorna osoba ispred TEHPRO-a.
-- Sve nullable → ne-rušeća migracija. Re-run safe (add column if not exists).

alter table klijenti add column if not exists adresa            text;
alter table klijenti add column if not exists pib               text;
alter table klijenti add column if not exists maticni_broj      text;
alter table klijenti add column if not exists sifra_djelatnosti text;
alter table klijenti add column if not exists telefon           text;
alter table klijenti add column if not exists email             text;
alter table klijenti add column if not exists zaduzeni_tehpro_id uuid
  references korisnici(id) on delete set null;

create index if not exists idx_klijenti_zaduzeni on klijenti (zaduzeni_tehpro_id);
