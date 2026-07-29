-- Zatvara probijanje SECURITY DEFINER funkcija podmetanjem tabele u pg_temp.
--
-- ŠTA JE BILA RUPA:
-- PostgreSQL pretražuje `pg_temp` PRVI, prije svega ostalog, osim ako je pg_temp
-- eksplicitno naveden u search_path-u — tada važi navedena pozicija. Sve naše
-- definer funkcije imale su `set search_path = public`, dakle bez pg_temp, pa je
-- pg_temp i dalje išao prvi. Prijavljen korisnik smije praviti temp tabele
-- (`has_database_privilege(current_user, current_database(), 'TEMP')` = true), pa
-- je mogao podmetnuti vlastitu `pg_temp.korisnici` i preusmjeriti svaku definer
-- funkciju koja čita `korisnici` na svoje podatke.
--
-- REPRODUKOVANO UŽIVO NA DEMO (2026-07-29), kao role=authenticated s JWT-om
-- običnog operatera, sve u transakciji uz rollback:
--
--   je_admin() prije:                    false
--   direktan select iz audit_log prije:  0 redova
--   >>> create temp table korisnici as select <moj_id>, 'admin', true <<<
--   je_admin() poslije:                  true
--   direktan select iz audit_log poslije: 5 REDOVA
--
-- Dakle probijena je i RLS polisa `audit_sel` na audit_log, ne samo guard u
-- funkcijama — jer i polisa zove `je_admin()`. Isti trik pogađa i `tg_audit()`
-- (podmetni `pg_temp.audit_log` i tvoje izmjene se ne bilježe = izbjegavanje
-- revizije) i `ima_pristup_klijentu()` (pristup tuđim firmama).
--
-- KOLIKO JE BILO OZBILJNO: nije bilo daljinski dostupno. PostgREST ne izlaže DDL,
-- pa napadač nije mogao napraviti temp tabelu kroz aplikaciju — treba mu direktna
-- veza na bazu, a tada ionako ima kredencijale. Ovo je dubinska odbrana, ne
-- zakrpa aktivnog proboja. Zato ide kao zaseban, mali PR.
--
-- POPRAVKA: navedi pg_temp EKSPLICITNO, i to POSLJEDNJI. Time public pobjeđuje,
-- a pg_temp ostaje dostupan (funkcija koja bi ga stvarno trebala i dalje radi).
-- Koristi se `alter function ... set search_path`, a NE prepisivanje tijela —
-- nema šanse da se tijelo nenamjerno razlikuje od onoga što je na cloudu.
--
-- IZOSTAVLJEN je `rls_auto_enable()` (search_path=pg_catalog): to je event trigger
-- koji ne postoji ni u jednoj migraciji u ovom repou i dira ga platforma; ne
-- diramo ga bez zasebne odluke. Isto tako nisu dirane `security invoker` funkcije —
-- one se izvršavaju s pravima pozivaoca, pa podmetanje ne donosi eskalaciju
-- privilegija, samo štetu samom sebi.
--
-- IDEMPOTENTNO: `alter function ... set` je bezuslovno postavljanje; ponovno
-- puštanje ne mijenja ništa.

alter function public.azuriraj_mejl_dostavu(p_resend_id text, p_status mejl_dostava_status, p_at timestamp with time zone) set search_path = public, pg_temp;
alter function public.get_admini() set search_path = public, pg_temp;
alter function public.get_aktivni_korisnici() set search_path = public, pg_temp;
alter function public.get_aktivnost_strana(p_od timestamp with time zone, p_do timestamp with time zone, p_korisnik uuid, p_akcija text, p_entitet text, p_pretraga text, p_prije_vrijeme timestamp with time zone, p_prije_id bigint, p_limit integer) set search_path = public, pg_temp;
alter function public.ima_pristup_dokumentu(p_path text) set search_path = public, pg_temp;
alter function public.ima_pristup_klijentu(p_klijent_id uuid) set search_path = public, pg_temp;
alter function public.je_admin() set search_path = public, pg_temp;
alter function public.je_pregled() set search_path = public, pg_temp;
alter function public.obrisi_stare_dogadjaje() set search_path = public, pg_temp;
alter function public.oznaci_mejl_pregledan(p_id uuid) set search_path = public, pg_temp;
alter function public.tg_audit() set search_path = public, pg_temp;
alter function public.tg_klijent_auto_dodjela() set search_path = public, pg_temp;
alter function public.zabiljezi_dogadjaje(p_dogadjaji jsonb) set search_path = public, pg_temp;
alter function public.zabiljezi_mejl_log(p_tip mejl_tip, p_primaoci text[], p_subject text, p_termin_id uuid, p_klijent_id uuid, p_resend_id text, p_status mejl_status, p_greska text) set search_path = public, pg_temp;
alter function public.zabiljezi_zakazano_obavijest(p_termin_id uuid, p_datum_zakazan date, p_base text[]) set search_path = public, pg_temp;
