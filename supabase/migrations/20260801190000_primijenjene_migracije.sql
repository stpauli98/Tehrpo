-- Evidencija primijenjenih migracija (N10, 2026-08-01).
--
-- Zašto: migracije se na cloud (DEMO/PROD) puštaju ručno, jedna po jedna, kroz
-- `pnpm db:apply-cloud`. Nigdje se nije bilježilo ŠTA je stvarno prošlo, pa se
-- preskok nije mogao primijetiti: migracije 20260703102000 i 20260703103000 od
-- 03.07.2026. nisu primijenjene NI na DEMO NI na PROD, a to je otkriveno tek
-- auditom mjesec dana kasnije. Bez evidencije se ne vidi ni suprotno — da se
-- ista migracija pusti dva puta, ili da je fajl izmijenjen POSLIJE primjene.
--
-- Tabelu popunjava scripts/apply-cloud-migration.ts (jedini put do cloud-a).
-- Ista DDL je i u skripti (bootstrap), pa evidencija radi i u okruženju u koje
-- ova migracija još nije stigla — namjerno, da se problem ne ujede za rep.
--
-- Idempotentno i sigurno za ponovno pokretanje.

create table if not exists public.primijenjene_migracije (
  naziv text primary key,
  kontrolna_suma text not null,
  primijenjeno_at timestamptz not null default now(),
  primijenio text,
  broj_primjena integer not null default 1,
  samo_evidencija boolean not null default false
);

comment on table public.primijenjene_migracije is
  'Koja migracija je stvarno primijenjena na OVU bazu. Piše scripts/apply-cloud-migration.ts.';
comment on column public.primijenjene_migracije.naziv is
  'Ime fajla iz supabase/migrations, npr. 20260703102000_klijent_provjere_lokacija_obavezna.sql';
comment on column public.primijenjene_migracije.kontrolna_suma is
  'sha256 sadržaja fajla u trenutku primjene — hvata naknadnu izmjenu već primijenjene migracije.';
comment on column public.primijenjene_migracije.broj_primjena is
  'Koliko puta je puštena (>1 samo uz --ponovo).';
comment on column public.primijenjene_migracije.samo_evidencija is
  'true = red je upisan bez izvršavanja SQL-a (--samo-evidencija), za naknadno popisivanje istorije.';

alter table public.primijenjene_migracije enable row level security;

-- Čitanje samo administratorima (UI/dijagnostika). Upis ide isključivo kroz
-- skriptu koja se veže direktno na bazu (superuser/service-role → zaobilazi RLS),
-- pa politike za insert/update namjerno NEMA.
drop policy if exists pm_sel on public.primijenjene_migracije;
create policy pm_sel on public.primijenjene_migracije
  for select using (je_admin());
