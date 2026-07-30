-- supabase/migrations/20260730121000_lokacije_kontakti_u_kontakt_osobe.sql
-- Yoink 2026-07-30, stavke 8+9: uklanjanje ravnih kontakt polja sa lokacije.
--
-- Kontekst: lokacije su imale kontakt_osoba/_email/_telefon kao slobodna tekst
-- polja, PARALELNO sa pravim kontakt_osobe redovima vezanim preko lokacija_id.
-- Ravna polja nisu pokretala ništa — podsjetnici čitaju isključivo
-- kontakt_osobe.podsjetnik_primalac. Komentar u actions.ts je to i najavljivao:
-- „ona ostaju dok se podaci ne presele u kontakt_osobe".
--
-- Ova migracija preseljava podatke pa briše kolone.

-- 1) Prebaci svaki popunjen ravni kontakt u pravi kontakt_osobe red.
--    podsjetnik_primalac = false: zatečeni podaci nikad nisu ni slali podsjetnike,
--    pa ih uključivanje ovdje bi tiho proširilo krug primalaca.
insert into kontakt_osobe (klijent_id, ime, email, telefon, lokacija_id, podsjetnik_primalac)
select
  l.klijent_id,
  coalesce(nullif(btrim(l.kontakt_osoba), ''), l.naziv),  -- ime je NOT NULL
  nullif(btrim(l.kontakt_email), ''),
  nullif(btrim(l.kontakt_telefon), ''),
  l.id,
  false
from lokacije l
where (
        coalesce(btrim(l.kontakt_osoba), '')   <> ''
     or coalesce(btrim(l.kontakt_email), '')   <> ''
     or coalesce(btrim(l.kontakt_telefon), '') <> ''
      )
  -- Idempotentno: ne diraj lokaciju koja već ima vezan kontakt sa istim imenom.
  -- Zagrade oko OR grupe su OBAVEZNE — AND veže jače od OR, pa bi bez njih
  -- provjera postojanja važila samo za posljednji uslov i migracija bi pri
  -- ponovnom pokretanju napravila duplikate.
  and not exists (
    select 1 from kontakt_osobe ko
    where ko.lokacija_id = l.id
      and lower(btrim(ko.ime)) = lower(btrim(coalesce(nullif(btrim(l.kontakt_osoba), ''), l.naziv)))
  );

-- Drop kolona NIJE ovdje — ide zasebnom migracijom TEK poslije provjere da su
-- svi podaci stvarno prebačeni. Vidi 20260730122000_lokacije_drop_kontakt_kolone.sql.
