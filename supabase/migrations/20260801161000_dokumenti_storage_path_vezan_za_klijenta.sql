-- N01 — `dokumenti.storage_path` mora biti vezan za klijenta NA NIVOU BAZE.
--
-- Rupa (dokazano na DEMO, ista politika i na PROD): RLS na `dokumenti` gate-uje isključivo
-- `klijent_id` (`dokumenti_ins`: ima_pristup_klijentu(klijent_id) and not je_pregled()),
-- a `storage_path` NIJE vezan ni za šta. Operater zato ubaci red sa SVOJIM `klijent_id` i
-- TUĐIM `storage_path` (putanja je pogodiva/procurila kroz `dokumenti` popis) i time:
--   1) dobije signed URL za tuđi fajl (app/api/dokumenti/[id]/route.ts uzima `storage_path`
--      iz RLS-ograničenog reda i potpisuje ga service-role ključem — RLS ga je pustio),
--   2) otključa i direktan Storage pristup, jer `ima_pristup_dokumentu(name)` gleda upravo
--      `exists (select 1 from dokumenti where storage_path = name and ima_pristup_klijentu(...))`
--      (20260701120000) → storage_dok_sel/_wr počnu puštati tuđi objekt (čitanje i PREPIS),
--   3) kroz app akciju obriše tuđi fajl (removeDokument ide service-role ključem).
--
-- Popravka je dvodijelna i namjerno ne dira RLS politike (druge grane ih paralelno mijenjaju):
--   (a) UNIQUE na `storage_path` — jedan fajl može pripadati najviše jednom `dokumenti` redu,
--       pa se tuđi fajl ne može "posvojiti" drugim redom pored postojećeg.
--   (b) BEFORE INSERT OR UPDATE trigger — putanja mora ležati u prostoru TOG klijenta:
--         `klijenti/{klijent_id}/{ime}`  → UUID iz putanje = NEW.klijent_id
--         `termini/{termin_id}/{ime}`    → termin iz putanje stvarno pripada NEW.klijent_id
--       Ostali oblici putanje se odbijaju (app generiše samo ova dva — lib/dokumenti.ts
--       `dokumentStoragePath`, app/(dashboard)/dokumenti/actions.ts, lib/zapisnik/snimi.ts).
--
-- Zatečeni podaci provjereni prije pisanja migracije (01.08.2026.):
--   DEMO: 30 redova (29 `termini/`, 1 `klijenti/`) — 0 neispravnih, 0 dupliranih putanja
--   PROD:  3 reda   ( 2 `termini/`, 1 `klijenti/`) — 0 neispravnih, 0 dupliranih putanja
--   (i 0 redova sa `termini/` putanjom a `termin_id is null`)
-- → nijedan postojeći red ne pada; sanacija podataka NIJE potrebna.
--
-- Re-run safe (idempotentno).

-- ── (a) Jedan fajl = najviše jedan red ───────────────────────────────────────
-- Uzgredna korist: `lib/dokumenti/popis.ts` keyset-paginira po `storage_path` bez indeksa
-- (svaka stranica je sortirala) — sad ima indeks i garantovanu jedinstvenost kursora.
create unique index if not exists dokumenti_storage_path_key on dokumenti (storage_path);

-- ── (b) Putanja mora pripadati klijentu iz reda ──────────────────────────────
-- security definer: `termini` je pod RLS-om, a provjera mora gledati STVARNO stanje baze,
-- a ne ono što pozivalac vidi (inače bi ishod zavisio od dodjela pozivaoca). Fiksiran
-- search_path kao kod ostalih helpera (20260729120000).
-- Service-role put (cron/seed/import, `auth.uid() is null`) NIJE izuzet: nijedan skript ne
-- piše `dokumenti`, a zatečeni podaci pravilo već zadovoljavaju — izuzetak bi samo vratio rupu.
create or replace function tg_dokumenti_provjeri_storage_path() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_dio   text[];
  v_scope text;
  v_id    uuid;
begin
  -- UPDATE koji ne dira nijednu od tri relevantne kolone nema šta da provjerava.
  if TG_OP = 'UPDATE'
     and NEW.storage_path is not distinct from OLD.storage_path
     and NEW.klijent_id   is not distinct from OLD.klijent_id
     and NEW.termin_id    is not distinct from OLD.termin_id then
    return NEW;
  end if;

  -- Tačno tri segmenta: prefiks / UUID / ime fajla. `safeName` (lib/dokumenti.ts) pretvara
  -- `/` u `_`, pa ime fajla nikad ne sadrži separator → `[^/]+` je tačan oblik.
  v_dio := regexp_match(
    NEW.storage_path,
    '^(klijenti|termini)/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/([^/]+)$'
  );
  if v_dio is null or v_dio[3] in ('.', '..') then
    raise exception 'storage_path_neispravan_oblik' using errcode = '23514',
      detail = format('storage_path=%L', NEW.storage_path);
  end if;

  v_scope := v_dio[1];
  v_id    := v_dio[2]::uuid;

  if v_scope = 'klijenti' then
    if v_id <> NEW.klijent_id then
      raise exception 'storage_path_tudji_klijent' using errcode = '23514';
    end if;
  else
    -- Putanja i kolona moraju pokazivati na isti termin (inače bi `termin_id` lagao o fajlu).
    if NEW.termin_id is not null and NEW.termin_id <> v_id then
      raise exception 'storage_path_drugi_termin' using errcode = '23514';
    end if;
    if not exists (
      select 1 from termini t where t.id = v_id and t.klijent_id = NEW.klijent_id
    ) then
      raise exception 'storage_path_tudji_termin' using errcode = '23514';
    end if;
  end if;

  return NEW;
end; $$;

drop trigger if exists provjeri_storage_path on dokumenti;
create trigger provjeri_storage_path before insert or update on dokumenti
  for each row execute function tg_dokumenti_provjeri_storage_path();

comment on function tg_dokumenti_provjeri_storage_path() is
  'N01: veže dokumenti.storage_path za dokumenti.klijent_id (klijenti/{klijent_id}/… ili termini/{termin_id}/… gdje termin pripada tom klijentu).';
comment on index dokumenti_storage_path_key is
  'N01: jedan Storage objekt smije imati najviše jedan dokumenti red — sprječava posvajanje tuđeg fajla.';
