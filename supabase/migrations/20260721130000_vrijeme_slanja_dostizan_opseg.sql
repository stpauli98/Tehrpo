-- Vrijeme slanja mora biti u opsegu koji cron raspored stvarno dostiže.
--
-- Raspored (vercel.json): "0 9 * * *" i "0 13 * * *" UTC → po Beču 10/14 zimi,
-- 11/15 ljeti. Gate je `sat >= vrijeme_slanja_sat`, pa sve iznad 14 nikad ne
-- prođe zimi, a iznad 15 ni ljeti — ruta uredno vrati `izvan_sata` i 200, bez
-- greške i bez traga. DEMO je zatečen na 23, dakle u tom tihom kvaru.
--
-- Dosad je jedina brana bila validacija u server akciji, koja štiti samo put
-- kroz UI; ovo pokriva i direktan upis u bazu.

-- 1. Normalizuj zatečene vrijednosti PRIJE ograničenja — inače bi `add constraint`
--    odbio postojeći red i migracija bi pukla.
--    Granica 11 je sat prvog LJETNOG run-a: 12 je najmanja vrijednost koja ga
--    pouzdano preskače u obje sezone.
update postavke
set vrijeme_slanja_sat = case when vrijeme_slanja_sat <= 11 then 8 else 13 end
where vrijeme_slanja_sat is distinct from (case when vrijeme_slanja_sat <= 11 then 8 else 13 end);

-- 2. Ukloni stari, sada suvišni check (0..23) iz 20260708120000_podsjetnici_v2.sql.
--    Novi check ispod je stroži i strogo ga obuhvata (0..14 ⊂ 0..23) — zadržavanje
--    oba bi za vrijednosti izvan OBA opsega (npr. negativne) i dalje bilo tehnički
--    ispravno, ali bi Postgres uvijek prijavio STARIJE (prvo nastalo) ograničenje,
--    ne ono koje stvarno opisuje dostižan opseg — suvišno je i zbunilo bi poruku.
alter table postavke drop constraint if exists chk_postavke_sat;

-- 3. Tek sada novo ograničenje.
alter table postavke drop constraint if exists chk_postavke_vrijeme_slanja_sat;
alter table postavke add constraint chk_postavke_vrijeme_slanja_sat
  check (vrijeme_slanja_sat between 0 and 14);
