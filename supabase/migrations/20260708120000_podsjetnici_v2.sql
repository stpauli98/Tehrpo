-- Podsjetnici v2: podesivo vrijeme slanja, "poslato danas" marker, Krug 2 (slanje firmama).

-- postavke: sat slanja (lokalno Europe/Vienna) + datum zadnjeg auto-runa + globalni Krug-2 prekidač
alter table postavke
  add column vrijeme_slanja_sat  smallint not null default 8,
  add column zadnje_slanje_datum date,
  add column salji_klijentima    boolean  not null default false;
alter table postavke
  add constraint chk_postavke_sat check (vrijeme_slanja_sat between 0 and 23);

-- klijenti: per-firma prekidač za slanje podsjetnika firmi (podsjetnik_emails već postoji)
alter table klijenti
  add column salji_podsjetnik_klijentu boolean not null default false;
