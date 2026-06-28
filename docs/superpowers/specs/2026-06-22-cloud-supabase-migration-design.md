# Cloud Supabase Migracija — Design / Runbook

**Datum:** 2026-06-22
**Status:** Odobreno, u izvođenju
**Cilj:** Prebaciti Tehpro MVP sa lokalnog Docker Supabase stacka na hostovani (cloud) Supabase projekat `fqtqkehjidkzeasiegnq`, uključujući schemu, sve podatke i fajlove u storage bucketu.

## Kontekst

App je već Supabase-native (14 SQL migracija, `lib/supabase/*` klijenti, `tehpro-dokumenti` storage bucket, triggeri, RPC). "Lokalna baza" = lokalni Docker stack (`supabase start`, portovi 54321/54322). Migracija znači: provizioniran cloud projekat + prebačeni schema/podaci/fajlovi + app preusmjeren na cloud. **Ostajemo na Supabase** (ne mijenjamo bazu) — alternativa (Neon/plain PG) bi tražila prepisivanje storage/RPC/RLS sloja bez koristi.

## Ciljni projekat

- ref: `fqtqkehjidkzeasiegnq`, regija `eu-west-1`, Postgres 17
- Novi API key format: `sb_publishable_*` (= anon), `sb_secret_*` (= service_role) — kompatibilno sa supabase-js 2.108.
- Konekcija za migracije/scripts: **Session pooler** (IPv4) `aws-0-eu-west-1.pooler.supabase.com:5432`, user `postgres.fqtqkehjidkzeasiegnq`. (Direct `db.<ref>.supabase.co` je IPv6-only — ne resolvuje iz Docker kontejnera.)
- Cloud je na početku potpuno prazan (0 tabela, nema migration history, nema bucketa).

## Baseline (lokalno, za provjeru parnosti)

| Tabela | Redova |  | Tabela | Redova |
|---|---|---|---|---|
| termini | 836 | | chat_poruke | 20 |
| lokacije | 32 | | podsjetnici | 12 |
| klijenti | 30 | | dokumenti | 4 |
| vrste_provjera | 23 | | postavke | 1 |

\+ 14 migracija, 4 fajla u `tehpro-dokumenti` bucketu.

## Pristup (odabran: A)

- **A — CLI `db push` + `pg_dump`/`psql` preko Docker-a (odabrano).** Reproducibilno, koristi postojeće migracije.
- B — ručno preko Studio SQL editora. Odbačeno (nije reproducibilno).
- C — Supabase branching/restore. Odbačeno (overkill).

`psql`/`pg_dump` se izvršavaju iz `supabase_db_tehpro-mvp` kontejnera (host nema `psql`). Lokalni Postgres unutar kontejnera je na portu `5432` (host-mapping je 54322).

## Koraci

1. **Env mapiranje** (`.env.local`, gitignored): aktivni `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` → cloud vrijednosti; `DATABASE_URL` → session pooler; lokalni blok zakomentarisan radi lakog switch-backa na Docker dev.
2. **Schema → cloud:** `supabase db push --db-url <cloud-pooler>` — primjenjuje svih 14 migracija (tabele, triggeri, RPC, `tehpro-dokumenti` bucket).
3. **Podaci → cloud:** `pg_dump --data-only --schema=public` (lokalno) → `psql` (cloud), sve u jednoj transakciji sa `SET session_replication_role = replica;` (gasi trigere/FK enforcement tokom load-a → nema duplikata od auto-cycle/read-model trigera; sekvence dolaze preko `setval`). Storage metadata se ovdje NE kopira.
4. **Storage fajlovi → cloud:** Node skript (`scripts/migrate-storage-to-cloud.mjs`) — listanje objekata iz lokalnog `tehpro-dokumenti`, download (local admin) → upload upsert (cloud admin). Rekreira `storage.objects`; string putanje u `public.dokumenti` (već prebačene) ostaju validne.
5. **Verifikacija (gate):** `pnpm build` + lint + app protiv cloud-a + Playwright E2E + provjera row-count parnosti (lokalno vs cloud) + dokument se otvara (signed URL) + vizuelna provjera.

## Svjesno van scope-a (odluka korisnika)

- **RLS ostaje ISKLJUČEN** na cloud-u za sada. ⚠️ `sb_publishable_*` ključ je javan → baza je čitljiva/upisiva preko interneta dok je RLS off. Prihvatljivo samo dok URL ostaje privatan; ostaviti vidljiv TODO/warning. Buduće: service-role na serveru + RLS on, ili puni Auth + policy-ji.
- Bez Vercel deploy-a, bez Supabase Auth-a.

## Rizici i mitigacije

| Rizik | Mitigacija |
|---|---|
| Triggeri dupliraju podatke tokom load-a | `session_replication_role = replica` u load transakciji |
| FK redoslijed | replica mode preskače FK enforcement |
| Novi `sb_*` ključevi nekompatibilni | provjereno — supabase-js 2.108 podržava |
| `db push` preko poolera | session pooler (port 5432) podržava DDL; fallback: konkatenacija SQL kroz psql |
| Sekvence ne resetovane | `pg_dump --data-only` uključuje `setval` |
| Switch-back na lokalno | lokalni blok zakomentarisan u `.env.local` |
