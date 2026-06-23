# Dizajn: Profil provjera po klijentu

**Datum:** 2026-06-23
**Status:** Odobren dizajn → spreman za plan
**Pristup:** Standing "profil" tabela po klijentu + generisanje jednog termina po stavci (auto-cycle nastavlja)

## Kontekst i problem

Trenutno se "vrsta posla" ne vezuje za klijenta — `vrste_provjera` je globalni katalog, a klijent dobija vrstu samo kroz pojedinačni `termin` (Termini → Novi termin). Nema "profila" (koje provjere klijent ima, kojom dinamikom, na kojim lokacijama). Za stvarni onboarding novog klijenta to znači ručno kreiranje desetina termina. Ova funkcija uvodi **profil provjera po klijentu**: lista (vrsta, opciono lokacija, interval, zadnji datum) iz koje se generiše sljedeći termin, a postojeći auto-cycle nastavlja ponavljanje.

## Odluke (potvrđene s korisnikom)

- **Granularnost:** stavka profila **opciono** ima lokaciju (klijent sa objektima → po lokaciji; bez → nivo klijenta).
- **Generisanje:** **jedan (sljedeći) termin po stavci**; kad se izvrši, postojeći auto-cycle pravi naredni. NE generiše se cijela godina.
- **Prvi rok:** `rok = zadnji_datum + interval_mjeseci`.
- **Brisanje stavke ne dira postojeće termine** (oni se vode kroz Termini).

## Postojeća sredstva (provjereno)

- `vrste_provjera.podrazumevani_interval_mjeseci int` (1–120) — fallback interval.
- `termini.interval_mjeseci int` — per-termin interval koji auto-cycle (`tg_termini_*`) koristi za naredni rok.
- `createTermin` (`termini/actions.ts`) — obrazac duplikat-provjere: `klijent+vrsta+rok (+lokacija) neq otkazano`; lokacija-pripadnost klijentu.
- `KlijentTabs` — TABS niz (Termini/Lokacije/Kontakti/Dokumenti); dodaje se 5. tab.
- `cloud DATABASE_URL` (session pooler) u `.env.local` za DDL.

## Global Constraints (verbatim)

- Grana: `feature/profil-provjera` (NE `main`). Već kreirana.
- Cloud Supabase — DDL preko **`pg`-skripte** koja izvršava SAMO novu migraciju preko `DATABASE_URL` (host nema psql; `supabase db push` bi pokupio necommitovanu reminders WIP migraciju — izbjeći). DML/upiti preko `@supabase/supabase-js`.
- ⚠️ Cloud auto-uključuje RLS na nove tabele → migracija mora `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` (app koristi anon ključ, bez Auth-a).
- Bez duplikata: generisanje provjerava postojeći AKTIVAN termin (status ∉ {izvrseno, otkazano}) za (klijent+vrsta+lokacija) prije kreiranja.
- Desktop-only: bez `sm:`/`md:` breakpointa. ESLint `no-await-in-loop` (skripte: scoped disable).
- e2e protiv cloud-a + throwaway klijent + `finally` cleanup (kao u 03/04 higijeni).
- AGENTS.md: NIJE standardni Next.js — konsultovati `node_modules/next/dist/docs/` po potrebi.

---

## Sekcija 1 — Data model: `klijent_provjere`

```sql
create table klijent_provjere (
  id                uuid primary key default gen_random_uuid(),
  klijent_id        uuid not null references klijenti(id) on delete cascade,
  vrsta_provjere_id uuid not null references vrste_provjera(id) on delete restrict,
  lokacija_id       uuid references lokacije(id) on delete set null,
  interval_mjeseci  int check (interval_mjeseci is null or interval_mjeseci between 1 and 120),
  zadnji_datum      date not null,
  aktivan           bool not null default true,
  created_at        timestamptz not null default now()
);
-- jedna stavka po (klijent, vrsta, lokacija); null lokacija → sentinel za UNIQUE
create unique index uq_klijent_provjere
  on klijent_provjere (klijent_id, vrsta_provjere_id, coalesce(lokacija_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index idx_klijent_provjere_klijent on klijent_provjere (klijent_id);
alter table klijent_provjere disable row level security;
```

**Primjena na cloud:** migracija u `supabase/migrations/<ts>_klijent_provjere.sql`; `scripts/apply-cloud-migration.ts` (koristi `pg` + `DATABASE_URL`) izvršava TAJ fajl. `pnpm add -D pg @types/pg`.

Regen TS tipova (`db/types.ts`) za novu tabelu — preko `supabase gen types` ako radi protiv cloud-a, ili ručni dodatak tipa (provjeriti u planu).

---

## Sekcija 2 — Računica roka (`lib/date.ts`)

```ts
/** Datum + N mjeseci (ISO 'YYYY-MM-DD'), TZ-safe; clamp na zadnji dan kraćeg mjeseca. */
export function addMjeseci(isoDatum: string, mjeseci: number): string
```
Unit-testirati: prelaz godine (2026-11-15 +3 → 2027-02-15), clamp (2026-01-31 +1 → 2026-02-28), 0/1/12 mjeseci.

---

## Sekcija 3 — Server akcije (`klijenti/actions.ts`)

- **`createProfilProvjere(prev, formData)`**:
  - Polja: `klijent_id`, `vrsta_provjere_id`, `lokacija_id?` (prazan → null), `interval_mjeseci?` (prazan → null → fallback na vrsta default; ako su oba null → greška "Interval je obavezan"), `zadnji_datum` (required).
  - Integritet: ako `lokacija_id`, mora pripadati `klijent_id` (kao u `createTermin`).
  - Insert u `klijent_provjere` (UNIQUE → "Ova provjera već postoji u profilu.").
  - Generisanje termina: `interval = interval_mjeseci ?? vrsta.podrazumevani_interval_mjeseci`; `rok = addMjeseci(zadnji_datum, interval)`. Provjeri postoji li AKTIVAN termin (status ∉ {izvrseno, otkazano}) za (klijent+vrsta+lokacija); ako NE → insert termin (`status='planirano'`, `interval_mjeseci=interval`, `rok_dospijeca=rok`). Ako termin već postoji → profil-stavka se kreira, termin se NE duplira.
  - `revalidatePath` klijent detalja.
- **`deleteProfilProvjere(prev, formData)`**: briše `klijent_provjere` red po id-u. **Ne dira termine.**

---

## Sekcija 4 — UI: tab "Profil"

- `KlijentTabs`: dodati `{ value: "profil", label: "Profil" }` (5. tab). `VALID_TABS` u `[id]/page.tsx` + dohvat.
- `[id]/page.tsx`: dohvat profil-stavki za klijenta (join vrsta naziv + lokacija naziv), render `<ProfilTab>` kad `tab==="profil"`.
- `components/domain/ProfilTab.tsx`: tabela stavki — Vrsta · Lokacija (ili "—") · Interval (mj) · Zadnji datum · **Sljedeći rok** (`addMjeseci`) · akcija Obriši (`ObrisiProfilButton`, dva-koraka potvrda). Iznad: `<DodajProvjeruButton>`. Empty state.
- `components/domain/DodajProvjeruButton.tsx`: Sheet forma (`useActionState(createProfilProvjere)`) — Select vrsta (globalni katalog, prop), Select lokacija (klijentove lokacije + "— bez lokacije —", prop), Input interval (number, predpopunjen iz vrste pri izboru — opciono; minimalno prazan→fallback), Input zadnji_datum (date). Po uspjehu zatvori + `router.refresh()`.
- Testid-evi: `tab-profil`, `tab-profil-content`, `profil-row`, `dodaj-provjeru-btn`, `dodaj-provjeru-sheet`, `profil-vrsta`, `profil-lokacija`, `profil-interval`, `profil-zadnji-datum`, `profil-submit`, `obrisi-profil-btn`/`-potvrdi`.

---

## Verifikacija (gate)

- `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka; `pnpm exec vitest run lib/date.test.ts` (addMjeseci).
- Migracija primijenjena na cloud; `klijent_provjere` postoji, RLS off.
- e2e (`tests/e2e/16-profil.spec.ts`, throwaway klijent + `finally`): dodaj provjeru → stavka u tabeli + termin generisan (vidljiv u Termini); duplikat profila odbijen; brisanje stavke ne briše termin; bez lokacije radi.
- Regresija: `04-klijenti`, `03-termini`, `10-pregled` zeleni.

## Van opsega (YAGNI)

- "Primijeni na sve lokacije" odjednom (jedna stavka = jedna lokacija/nivo klijenta).
- Auto-import profila iz postojećih termina.
- Retroaktivna izmjena postojećih termina kad se profil-interval promijeni (mijenja samo nove).
- Uređivanje profil-stavke (za sad Dodaj/Obriši; edit kasnije ako zatreba).
