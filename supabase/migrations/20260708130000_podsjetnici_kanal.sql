-- Firmi-prilagođeni podsjetnici: razdvoji audit po kanalu (interni vs firma),
-- da oba mejla (interni sa dugmadima + firmin bez dugmadi) imaju nezavisan
-- "poslato" trag i ne dupliraju se.
alter table podsjetnici
  add column kanal text not null default 'interni'
  check (kanal in ('interni','firma'));

-- Zamijeni jedinstvenost (termin_id, dana_prije) → (termin_id, dana_prije, kanal).
drop index if exists uq_podsjetnici_termin_dana;  -- unique INDEX iz 20260621
create unique index uq_podsjetnici_termin_dana_kanal
  on podsjetnici (termin_id, dana_prije, kanal);
