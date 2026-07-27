-- supabase/migrations/20260726121000_gradovi_tabela.sql
-- S8.2 (01-standardi §17b st.2, nalaz Obilasci N5): katalog gradova seli iz hardkodirane
-- `GRADOVI_BIH` whiteliste u kodu (lib/obilasci.ts:6-13) u bazu, da se lista može mijenjati
-- bez deploya. Kod zadržava statičnu whitelistu SAMO kao offline fallback (Excel import
-- pipeline + backfill skripta rade prije/bez baze) — v. lib/obilasci.ts `izvediGrad`.
-- Idempotentno (create table if not exists / drop policy if exists / on conflict do nothing)
-- → bezbjedan re-apply na DEMO i PROD (lockstep).

-- ───────────────────────── 1) Tabela ─────────────────────────
-- Kanonski naziv JE primarni ključ (bez surogat uuid-a): grad se svuda referiše nazivom
-- (`lokacije.grad` je text, `izvediGrad` vraća naziv), pa bi uuid dodao join bez ijednog
-- potrošača i otvorio put dupliranim nazivima. PK indeks ujedno pokriva `order by naziv`.
create table if not exists gradovi (
  naziv      text        primary key,
  created_at timestamptz not null default now()
);

comment on table gradovi is
  'Katalog kanonskih naziva gradova (S8.2). Naziv = ključ; održava ga admin.';

-- ───────────────────────── 2) RLS ─────────────────────────
-- KRITIČNO: cloud event trigger automatski uključuje RLS na svakoj novoj public tabeli, pa
-- tabela BEZ polise tiho vraća 0 redova (CLAUDE.md „RLS gotchas"). Zato RLS uključujemo
-- EKSPLICITNO (lokal == cloud, bez drifta) i odmah dodajemo obje polise u ISTOJ migraciji.
-- Model preslikan sa `vrste_provjera` (20260626211000_rls_enable.sql:89-94) — isti tip
-- objekta: globalni katalog, nije klijent-skopiran, ne sadrži PII.
alter table gradovi enable row level security;

drop policy if exists gradovi_sel on gradovi;
drop policy if exists gradovi_wr  on gradovi;
-- Čitanje: svaki prijavljen korisnik (uključujući `pregled`) — lista gradova nije povjerljiva
-- i treba svima koji vide lokacije/obilaske; `ima_pristup_klijentu` ovdje nema šta da veže.
create policy gradovi_sel on gradovi for select using ( auth.uid() is not null );
-- Pisanje: samo admin (katalog održava admin; operater ne smije praviti nove kanonske nazive
-- jer bi razbio grupisanje po gradu). `for all` pokriva insert/update/delete jednom polisom.
create policy gradovi_wr  on gradovi for all using ( je_admin() ) with check ( je_admin() );

-- ───────────────────────── 3) Seed ─────────────────────────
-- Tačno 16 kanonskih vrijednosti iz `GRADOVI_BIH` (lib/obilasci.ts:6-13), doslovno prepisane —
-- početno stanje mora biti bit-identično dosadašnjem ponašanju `izvediGrad`.
-- `on conflict do nothing` → re-apply ne gazi naknadne admin izmjene i ne diže grešku.
-- NAPOMENA: `pnpm seed` (wipe+repopulate iz Excela) NE dira `gradovi` — briše samo
-- termini / klijent_provjere / lokacije / klijenti (scripts/seed-from-excel.ts) — pa seed
-- ovog kataloga preživljava svaki re-seed; jedini put brisanja je `pnpm db:reset`.
insert into gradovi (naziv) values
  ('Banja Luka'),
  ('Bijeljina'),
  ('Brčko'),
  ('Derventa'),
  ('Doboj'),
  ('Gradiška'),
  ('Istočno Sarajevo'),
  ('Prijedor'),
  ('Prnjavor'),
  ('Trebinje'),
  ('Zvornik'),
  ('Laktaši'),
  ('Sarajevo'),
  ('Mostar'),
  ('Tuzla'),
  ('Zenica')
on conflict (naziv) do nothing;
