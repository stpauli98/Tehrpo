-- Zatvara unakrsni pristup dokumentima druge firme.
--
-- Propust: pristup fajlu se izvodi iz tabele `dokumenti`, ne iz same putanje —
--   ima_pristup_dokumentu(p_path) = exists(select 1 from dokumenti
--                                          where storage_path = p_path
--                                            and ima_pristup_klijentu(klijent_id))
-- a politika `dokumenti_ins` ograničava SAMO `klijent_id`, nikad `storage_path`.
-- Operater je zato mogao upisati TUĐU putanju u SVOJ red i time sam sebi izdati
-- dozvolu za fajl druge firme (potvrđeno exploitom 31.07.2026: potpisivanje fajla
-- druge firme prije napada 400 NoSuchKey → poslije upisa 200 + preuzimanje).
--
-- Tri sloja, jer nijedan sam nije dovoljan:
--   1) UNIQUE(storage_path) — blokira pravljenje DRUGOG reda za već postojeći objekat
--      (to je tačan primitiv napada).
--   2) CHECK opsega putanje — putanja mora biti pod SVOJIM klijentom ili SVOJIM terminom.
--   3) Kompozitni FK (termin_id, klijent_id) — bez njega bi napadač zadovoljio CHECK
--      tako što uzme TUĐI termin_id uz SVOJ klijent_id: `dokumenti_ins` nikad nije
--      provjeravao da termin pripada toj firmi.
-- Plus triger koji pinuje `storage_path` na UPDATE, da se red ne može naknadno prevesti
-- na tuđi fajl (`dokumenti_upd` inače dozvoljava izmjenu kolone).

-- ── 1) Jedan red po objektu ───────────────────────────────────────────────────
-- Ujedno daje indeks koji je `lib/dokumenti/popis.ts` keyset paginaciji nedostajao.
create unique index if not exists uq_dokumenti_storage_path
  on public.dokumenti (storage_path);

-- ── 2) Termin mora pripadati istoj firmi ─────────────────────────────────────
-- MATCH SIMPLE (default): kad je termin_id NULL, FK se ne provjerava — dokumenti
-- vezani samo za klijenta ostaju validni.
alter table public.termini
  drop constraint if exists uq_termini_id_klijent;
alter table public.termini
  add constraint uq_termini_id_klijent unique (id, klijent_id);

alter table public.dokumenti
  drop constraint if exists fk_dokumenti_termin_klijent;
alter table public.dokumenti
  add constraint fk_dokumenti_termin_klijent
  foreign key (termin_id, klijent_id)
  references public.termini (id, klijent_id)
  on delete cascade;

-- ── 3) Putanja mora biti u vlastitom opsegu ──────────────────────────────────
-- Oblici koje kod stvarno gradi (lib/dokumenti.ts:dokumentStoragePath,
-- lib/zapisnik/snimi.ts): `klijenti/<klijent_id>/…` i `termini/<termin_id>/…`.
-- UUID ne sadrži `%` ni `_`, pa LIKE nema wildcard-zamku.
-- NOT VALID: novi i izmijenjeni redovi se provjeravaju odmah, postojeći se ne
-- diraju — da migracija ne padne na bazi sa zatečenim redovima. Validacija je
-- odvojen korak (vidi dno fajla).
alter table public.dokumenti
  drop constraint if exists chk_dokumenti_putanja_opseg;
alter table public.dokumenti
  add constraint chk_dokumenti_putanja_opseg check (
       storage_path like 'klijenti/' || klijent_id::text || '/%'
    or (termin_id is not null and storage_path like 'termini/' || termin_id::text || '/%')
  ) not valid;

-- ── 4) `storage_path` se ne smije prevesti na drugi fajl ─────────────────────
-- Bez ovoga bi `dokumenti_upd` (ima_pristup_klijentu + not je_pregled) dozvolio da
-- se postojeći red pokaže na tuđu putanju. Admin je izuzet jer legitimno seli fajlove;
-- service_role (auth.uid() IS NULL) takođe, jer cron/skripte rade van korisničkog konteksta.
create or replace function public.tg_dokument_pin_putanju()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is not null
     and not je_admin()
     and new.storage_path is distinct from old.storage_path then
    new.storage_path := old.storage_path;
  end if;
  return new;
end;
$$;

drop trigger if exists dokument_pin_putanju on public.dokumenti;
create trigger dokument_pin_putanju
  before update on public.dokumenti
  for each row execute function public.tg_dokument_pin_putanju();

-- ── Validacija zatečenih redova ──────────────────────────────────────────────
-- Na DEMO je provjereno prije primjene: 0 duplikata, 0 kršenja CHECK-a,
-- 0 dokumenata čiji termin pripada drugoj firmi (30 redova). Ako je isto i na
-- ciljnoj bazi, ovo prevodi CHECK iz NOT VALID u potpuno validan:
--   alter table public.dokumenti validate constraint chk_dokumenti_putanja_opseg;
-- Namjerno NIJE u migraciji: na bazi sa zatečenim neusklađenim redovima bi je
-- oborilo, a te redove treba prvo pogledati (ne popraviti naslijepo).
