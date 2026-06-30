-- Krug 2: per-korisnik prekidač za email-podsjetnike.
-- Default true → postojeće ponašanje (admini primaju) ostaje; operateri se uključuju kad Krug 2 krene.
alter table korisnici
  add column prima_podsjetnike boolean not null default true;
