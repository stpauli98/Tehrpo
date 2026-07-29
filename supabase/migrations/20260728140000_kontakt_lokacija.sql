-- Kontakt osoba može pripadati jednoj lokaciji firme.
--   lokacija_id IS NULL    → kontakt firme: prima podsjetnike za SVE lokacije
--   lokacija_id postavljen → kontakt lokacije: prima samo za tu lokaciju
--
-- Lokacijski kontakti se DODAJU firminim, ne zamjenjuju ih — „kontakt firme" znači
-- „prati sve", pa centrala ne ispada iz obavještenja čim lokacija dobije koordinatora.
--
-- Postojeći redovi dobijaju NULL, pa se ponašaju tačno kao dosad: migracija NE mijenja
-- kome šta stiže. Vezivanje je svjesna radnja korisnika kroz UI.

-- Brava: lokacija mora pripadati ISTOJ firmi kao kontakt. Bez složenog stranog ključa
-- moglo bi se kontakt jedne firme vezati za lokaciju druge — RLS to ne bi uhvatio jer
-- oba reda mogu biti vidljiva istom korisniku.
alter table lokacije
  drop constraint if exists uq_lokacije_id_klijent;
alter table lokacije
  add constraint uq_lokacije_id_klijent unique (id, klijent_id);

alter table kontakt_osobe
  add column if not exists lokacija_id uuid;

alter table kontakt_osobe
  drop constraint if exists fk_kontakt_lokacija_ista_firma;
alter table kontakt_osobe
  add constraint fk_kontakt_lokacija_ista_firma
    foreign key (lokacija_id, klijent_id)
    references lokacije (id, klijent_id)
    on delete set null;

create index if not exists idx_kontakt_osobe_lokacija
  on kontakt_osobe (klijent_id, lokacija_id);

comment on column kontakt_osobe.lokacija_id is
  'NULL = kontakt firme (prima podsjetnike za sve lokacije); postavljen = prima samo za tu lokaciju.';
