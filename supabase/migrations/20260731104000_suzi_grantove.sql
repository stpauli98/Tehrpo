-- Sužava tabelarne grantove na ono što aplikacija stvarno koristi.
--
-- Zatečeno stanje (provjereno na DEMO 31.07.2026.): SVE tabele i viewovi daju i roli
-- `anon` i roli `authenticated` pun skup — SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER. To je Supabase default (`alter default privileges ... grant all`),
-- ne namjera. RLS je jedina barijera.
--
-- Kroz PostgREST ovo NIJE iskoristivo (ne izlaže TRUNCATE, a RLS blokira ostalo — i to
-- je empirijski potvrđeno: anon dobija 401, `pregled` bez dodjela dobija prazne skupove).
-- Ali `TRUNCATE` NE podliježe RLS-u. Zato svaki budući propust koji dopusti izvršavanje
-- SQL-a u kontekstu tih rola odmah eskalira sa „čitanje jednog reda" na „brisanje cijele
-- tabele". Uklanjamo privilegije koje ničemu ne služe.
--
-- Namjerno se NE dira `SELECT/INSERT/UPDATE/DELETE` za `authenticated` — te operacije
-- aplikacija koristi i sve su pod RLS-om.

-- ── anon: aplikacija mu ne treba nijedna tabelarna operacija ─────────────────
-- Anon ključ služi samo za prijavu (GoTrue) i za nošenje korisnikovog JWT-a.
-- Sve polise ionako vraćaju false za anon (svaka se svodi na auth.uid()/je_admin()/
-- ima_pristup_klijentu()), pa je ovo poravnanje grantova sa stvarnim stanjem.
revoke all on all tables in schema public from anon;

-- ── authenticated: skini samo ono što RLS ne pokriva ili se ne koristi ───────
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- ── Da novi objekti ne ponove isti default ───────────────────────────────────
-- Bez ovoga bi sljedeća `create table` opet dobila pun grant za obje role.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- Napomena: `audit_log` je već imao `revoke truncate from anon, authenticated`
-- (20260711130000); ovo isto pravilo sada važi za sve tabele.
