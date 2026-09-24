-- Porijeklo sadržaja generisanog zapisnika, kao ZASEBAN podatak.
--
-- ── ZAŠTO ─────────────────────────────────────────────────────────────────────
-- Nalaz N11: kad nema ANTHROPIC_API_KEY ili kad parsiranje modelovog odgovora padne,
-- `generateZapisnik` vrati šablonski tekst, a dokument se svejedno snimi kao pun AI
-- zapisnik. Prva popravka je to riješila tako što je `generated_by_ai` postavljala na
-- `izvor === "model"` — i time POKVARILA značenje postojeće kolone.
--
-- `generated_by_ai` odgovara na pitanje „je li ovaj dokument nastao generisanjem ili ga
-- je korisnik otpremio?" — a generisan jeste, bez obzira odakle mu tekst. Prenamjenom je
-- šablonski zapisnik postao neraspoznatljiv od ručno otpremljenog ugovora, što je druga
-- neistina umjesto prve (i oborilo je e2e 08-dokumenti i 35-dokument-pregled na oba browsera).
--
-- Ispravno je DODATI podatak, ne prenamijeniti postojeći:
--   generated_by_ai  → je li dokument generisan (nepromijenjeno značenje)
--   zapisnik_izvor   → odakle mu sadržaj: 'model' | 'sablon'
--
-- NULL znači „nije generisani zapisnik" (otpremljeni dokumenti) ili zapis stariji od ove
-- migracije. Zatečeni redovi se NE diraju: za njih se ne može pouzdano utvrditi porijeklo,
-- a lažno ih označiti kao 'model' bilo bi upravo ono što nalaz N11 prijavljuje.
--
-- Idempotentno / re-run-safe.

alter table dokumenti
  add column if not exists zapisnik_izvor text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_dokumenti_zapisnik_izvor'
  ) then
    alter table dokumenti
      add constraint chk_dokumenti_zapisnik_izvor
      check (zapisnik_izvor is null or zapisnik_izvor in ('model', 'sablon'));
  end if;
end
$$;

comment on column dokumenti.zapisnik_izvor is
  'Porijeklo sadržaja generisanog zapisnika: model (Claude) ili sablon (dry-run/degradacija). NULL = nije generisani zapisnik.';
