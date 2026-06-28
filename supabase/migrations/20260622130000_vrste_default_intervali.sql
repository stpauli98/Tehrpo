-- Default intervali (mjeseci) po vrsti pregleda.
-- Polazne vrijednosti koje korisnik kasnije mijenja u Postavkama (IntervaliForm).
-- Guard: postavljamo SAMO gdje je interval trenutno NULL → idempotentno + ne gazi
-- ručne izmjene korisnika pri ponovnom pokretanju migracija.
-- Napomena: za većinu pregleda zakon dopušta i kraći rok utvrđen Aktom o procjeni
-- rizika (per-termin override preko termini.interval_mjeseci).

-- Uslovi radne sredine (mikroklima, osvjetljenost, buka, zračenje) — 3 god
update vrste_provjera set podrazumevani_interval_mjeseci = 36
  where podrazumevani_interval_mjeseci is null and naziv ilike '%ljetnjem%';
update vrste_provjera set podrazumevani_interval_mjeseci = 36
  where podrazumevani_interval_mjeseci is null and naziv ilike '%zimskom%';

-- Hemijske štetnosti — 3 god
update vrste_provjera set podrazumevani_interval_mjeseci = 36
  where podrazumevani_interval_mjeseci is null and naziv ilike '%hemijsk%';

-- Pregled opreme za rad — 3 god
update vrste_provjera set podrazumevani_interval_mjeseci = 36
  where podrazumevani_interval_mjeseci is null and naziv ilike '%opreme za rad%';

-- Elektroinstalacije — 3 god (stalne; privremene 1 god, podesivo po terminu)
update vrste_provjera set podrazumevani_interval_mjeseci = 36
  where podrazumevani_interval_mjeseci is null and naziv ilike '%elektroinstalacija%';

-- Elektroizolaciona zaštitna oprema — 1 god
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%elektroizolacion%';

-- Lift — 1 god
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%lifta%';

-- Sredstva lične zaštite — 1 god
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%lične zaštite%';

-- Gromobranske instalacije — 1 god (može 12/24/48 po klasi objekta)
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%gromobransk%';

-- STS — 1 god (orijentaciono)
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%STS%';

-- Regalna skladišta — 1 god (EN 15635)
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%regalnih%';

-- Sistem za dojavu požara — 6 mj
update vrste_provjera set podrazumevani_interval_mjeseci = 6
  where podrazumevani_interval_mjeseci is null and naziv ilike '%za dojavu požara%';

-- Sistem za gašenje požara — 6 mj
update vrste_provjera set podrazumevani_interval_mjeseci = 6
  where podrazumevani_interval_mjeseci is null and naziv ilike '%za gašenje požara%';

-- Protiv-panična rasvjeta — 1 god (orijentaciono)
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%panič%';

-- Servis PP aparata — 6 mj
update vrste_provjera set podrazumevani_interval_mjeseci = 6
  where podrazumevani_interval_mjeseci is null and naziv ilike '%PP aparata%';

-- Hidranti — 6 mj
update vrste_provjera set podrazumevani_interval_mjeseci = 6
  where podrazumevani_interval_mjeseci is null and naziv ilike '%hidranata%';

-- Posude pod pritiskom — 1 god (orijentaciono, zavisi od registra)
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%posuda pod pritiskom%';

-- Ventili sigurnosti — 1 god (orijentaciono)
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%ventila sigurnosti%';

-- Ex zone — 3 god (po kategoriji)
update vrste_provjera set podrazumevani_interval_mjeseci = 36
  where podrazumevani_interval_mjeseci is null and naziv ilike '%Ex zon%';

-- Obuke ZNR — 1 god (orijentaciono; po riziku radnog mjesta)
update vrste_provjera set podrazumevani_interval_mjeseci = 12
  where podrazumevani_interval_mjeseci is null and naziv ilike '%zaštite na radu%';

-- Obuke ZOP — 3 god (orijentaciono)
update vrste_provjera set podrazumevani_interval_mjeseci = 36
  where podrazumevani_interval_mjeseci is null and naziv ilike '%zaštite od požara%';

-- Obilazak — mjesečno (ugovorni, ne zakonski)
update vrste_provjera set podrazumevani_interval_mjeseci = 1
  where podrazumevani_interval_mjeseci is null and naziv ilike 'Obilazak';

-- Akt o procjeni rizika - revizija: namjerno bez defaulta (radi se po izmjenama
-- uslova rada / organizacije, nema fiksne periodike).
