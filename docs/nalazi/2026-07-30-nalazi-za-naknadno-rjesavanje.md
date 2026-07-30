# Nalazi za naknadno rješavanje — yoink batch 30.07.2026

Prikupljeno tokom izvršavanja `docs/superpowers/plans/2026-07-30-yoink-batch.md`
na grani `feat/yoink-batch-2026-07-30`.

Ovaj fajl je **commit-ovan namjerno**: radni ledger živi u `.superpowers/sdd/`
koji je gitignore-ovan i briše se kad se plan završi, pa bi se nalazi izgubili.

Ništa sa ovog spiska nije uzrokovano batch-om osim gdje je izričito rečeno.

---

## A. Za odluku — dodiruje produkciju

### A1. FK bug vjerovatno živ na PROD-u — brisanje lokacije puca

**Ozbiljnost:** visoka. Korisnik na produkciji ne može obrisati lokaciju koja ima
vezan kontakt.

`fk_kontakt_lokacija_ista_firma` (uveden u
`supabase/migrations/20260728140000_kontakt_lokacija.sql`) je **kompozitni** strani
ključ `(lokacija_id, klijent_id) → lokacije (id, klijent_id)` sa `on delete set null`
**bez liste kolona**.

Standardni `SET NULL` na kompozitnom ključu nulira **sve** kolone ključa — dakle i
`klijent_id`, koji je `NOT NULL` na `kontakt_osobe`. Rezultat: brisanje lokacije
puca sa `23502 null value in column klijent_id ... violates not-null constraint`.

**Popravka postoji** i primijenjena je **samo na DEMO**:
`supabase/migrations/20260730123000_fix_kontakt_osobe_lokacija_fk_set_null.sql`
koristi `on delete set null (lokacija_id)` (PostgreSQL 15+; DEMO i PROD su na PG 17).

**Šta treba:** odluka o primjeni na PROD. Migracija je napisana i testirana, nije
destruktivna, i ne dira podatke — samo redefiniše constraint.

```bash
POTVRDI_PROD=da pnpm db:apply-cloud --prod \
  supabase/migrations/20260730123000_fix_kontakt_osobe_lokacija_fk_set_null.sql
```

Prije toga provjeriti da PROD stvarno ima staru definiciju:

```sql
select pg_get_constraintdef(oid) from pg_constraint
where conname = 'fk_kontakt_lokacija_ista_firma';
```

---

### A2. DEMO drift — `klijent_provjere.lokacija_id` nije NOT NULL

**Ozbiljnost:** srednja. Poslovno pravilo nije na snazi na DEMO.

Migracija `supabase/migrations/20260703102000_klijent_provjere_lokacija_obavezna.sql`
radi backfill pa izvršava `alter column lokacija_id set not null`, uz komentar da
„svaka provjera u profilu mora imati konkretnu lokaciju". Nijedna kasnija migracija
to ne poništava.

Stvarno stanje na DEMO (provjereno 30.07.2026):

| provjera | rezultat |
|---|---|
| `is_nullable` | `YES` (očekivano `NO`) |
| redova u `klijent_provjere` | 41 |
| redova sa `lokacija_id IS NULL` | **20** |
| FK `on delete` | i dalje `SET NULL`, ne `RESTRICT` |

DEMO **nema** `supabase_migrations.schema_migrations` tabelu, pa se iz metapodataka
ne može utvrditi je li migracija ikad pokrenuta. Dokazivo je samo da trenutno nije
na snazi.

**Zašto se ne može samo ponovo pokrenuti:** ta migracija ima `DO` blok koji podiže
grešku ako red ne može automatski da se razriješi. Tri od četiri pogođena klijenta
imaju **po dvije lokacije**, što je upravo „nerazrješiva" grana — migracija bi pala
ponovo.

**Šta treba:** ručno razriješiti tih 20 redova (odlučiti kojoj lokaciji svaki
pripada), pa tek onda ponovo primijeniti migraciju. Lokalni Docker stack **jeste**
primijenio migraciju (seed nema multi-lokacijski slučaj), pa je drift
local-ahead-of-DEMO.

---

## B. Alatke i workflow

### B1. `pnpm db:types` čita LOKALNI stack, ne DEMO

`package.json` → `"db:types": "supabase gen types typescript --local"`.

Lokalni Docker stack ima svoj drift (dvije verzije migracija u lokalnoj historiji
bez odgovarajućih fajlova), i za `klijent_provjere.lokacija_id` je `NOT NULL` dok je
na DEMO nullable.

Posljedica: `db/types.ts` je tokom ovog batch-a generisan **iz DEMO-a**
(`supabase gen types typescript --db-url $DATABASE_URL_DEMO`) da bi odražavao bazu
na kojoj aplikacija stvarno radi. **Sljedeći ko pokrene dokumentovani `pnpm db:types`
tiho vraća `klijent_provjere.lokacija_id` na non-null** i poništava tu ispravku.

**Šta treba:** odlučiti je li izvor istine za tipove lokalni stack ili DEMO, pa
uskladiti skriptu sa tom odlukom. Skripta **nije** mijenjana u ovom batch-u.

---

### B2. `pnpm cleanup:test-data` ne čisti sve

`scripts/cleanup-test-data.ts` ne briše `E2E Lokacija` / `E2E Kontakt` redove kada su
vezani za **stvarnog** (ne-junk) klijenta. E2E testovi koji vezuju podatke za
postojećeg klijenta ostavljaju smeće u DEMO bazi.

---

### B3. Playwright bez `--workers=1` spuriozno pada

`pnpm test:e2e` ispravno prosljeđuje `--workers=1`, ali direktno pokretanje
(`pnpm exec playwright test <spec> --project=chromium`) ne — a specovi dijele
globalni singleton red `postavke` sa `id=1`, pa paralelni workeri jedan drugom mijenjaju
stanje ispod nogu.

**Šta treba:** ili `workers: 1` u `playwright.config.ts`, ili napomena u CLAUDE.md.

---

## C. Postojeći pad testa

### C1. `tests/e2e/21-info-tooltips.spec.ts` — strict-mode violation

Playwright strict-mode pad na tooltipu taba (duplikat teksta: isti string postoji i u
`sr-only` spanu i u CSS tooltip bubble-u unutar istog `TabsTrigger`-a).

Reprodukovano na **nedirnutoj** grani preko `git stash` — nije uzrokovano ovim
batch-om. Nije popravljeno jer je van opsega, i namjerno nije „popravljeno"
slabljenjem asertacije.

---

## D. Sitnice iz batch-a (nisu blokirajuće)

| # | Nalaz | Gdje |
|---|---|---|
| D1 | Opseg važenja ugovora `1–600` hardkodiran na tri mjesta umjesto `VAZENJE_MIN`/`VAZENJE_MAX` iz `lib/ugovori-vazenje.ts` | `klijenti/actions.ts`, `UgovorSheet.tsx` (min/max) |
| D2 | i18n ključ `klijenti.ugovorSheet.istekNeodredjeno` je **mrtav** — trebao je objasniti korisniku zašto je polje „Datum isteka" postalo neaktivno, ali nigdje nije povezan. Rupa potiče iz plana, ne iz implementacije. | `messages/{sr,en,de}.json` |
| D3 | Nema server guarda za `na_neodredjeno=true` + `vazenje_mjeseci` (DB CHECK pokriva samo `datum_isteka`). Nedostižno kroz UI — samo ručno sklopljen POST. | `klijenti/actions.ts` |
| D4 | `updateKontaktSchema` nasljeđuje četiri nova opciona polja preko dijeljenog `kontaktFields` iako ih `updateKontakt` nikad ne čita — inertna Zod površina. | `klijenti/actions.ts` |

**D2 je jedini sa vidljivim efektom za korisnika** — vrijedi ga povezati.

---

## E. Iz analize, svjesno izostavljeno iz plana

**Šabloni izvještaja i bilješki nisu uređivi kroz UI.** Dokument (poglavlje o
ovlaštenjima) traži da administrator može mijenjati šablone izvještaja i bilješki
bez angažovanja programera. Trenutno su hardkodirani u `lib/zapisnik/template.ts` i
`lib/zapisnik/content.ts`.

Korisnik je stavku 3 (uloge i ovlaštenja) izričito preskočio za ovaj batch, pa ovo
nije rupa u izvršenju — ali ostaje jedina neispunjena stavka iz dokumenta koju je
analiza našla.

Sve ostalo iz te liste već radi: korisnici, klijenti, postavke, vrste usluga,
periodici, primaoci podsjetnika, vrijeme slanja, read-only uloga, reset lozinke i
audit log (`/aktivnost`, admin-only).
