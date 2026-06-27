# PP‑1 — Klijent & Ugovor (ID karta) — Dizajn / Spec

Datum: 2026‑06‑27 · Status: odobren dizajn, čeka pisanje plana
Izvori: `Povratne informacije i funkcionalni zahtjevi za aplikaciju.docx`, `TEHPRO - Model podataka i mapa šablona izvještaja.md`, `ID karta - CARMEUSE DOBOJ.xlsx`, gap analiza (postojeći kod vs. povratne informacije).

---

## 1. Kontekst i cilj

Sinhronizacija aplikacije sa povratnim informacijama klijenta dekomponovana je u 5 pod‑projekata (PP). Ovo je **PP‑1**, temelj o kojem vise ostali:

- **PP‑1 · Klijent & Ugovor (ID karta)** — *ovaj spec*
- PP‑2 · Termin / status / izvršenje (statusi, broj nalaza, odgovorna osoba/izvršilac, način izvršenja)
- PP‑3 · Izvoz plana (Excel/PDF) + ID karta kao dokument
- PP‑4 · Podsjetnici (in‑app, dnevno nakon isteka, primaoci vezani za korisnike)
- PP‑5 · Obilasci (prava evidencija + bilješka)

**Cilj PP‑1:** omogućiti unos i prikaz kompletne „ID karte klijenta" (osnovni podaci, ugovor, kontakti, ugovorene usluge), centralizovati dokumente tako da ugovori/ponude imaju gdje da se čuvaju, i dati administratoru kontrolu nad vrstama usluga (deaktivacija + `vodi_dokumentaciju`).

## 2. Obim

**U obimu (gap #1, #3, #5):**
- ID‑karta polja na klijentu + odgovorna osoba ispred TEHPRO‑a.
- Entitet `ugovori` (jedan aktivan po klijentu) + ugovorene usluge vezane za ugovor.
- Klijent‑nivo `kontakt_osobe` (više njih) uz postojeće kontakte na lokaciji.
- Generalizacija `dokumenti` (klijent/ugovor/termin + tip).
- `vrste_provjera.vodi_dokumentaciju` + admin UI za izmjenu/deaktivaciju vrsta.

**Van obima (kasniji PP):**
- Način izvršenja (TEHPRO vs. praćenje), broj stručnog nalaza, razdvajanje odgovorna osoba/izvršilac, prošireni statusi → **PP‑2**.
- Izvoz Excel/PDF i generisanje ID karte kao Word/PDF dokumenta → **PP‑3**.
- Podsjetnici → **PP‑4**; Obilasci/bilješke → **PP‑5**.
- Oprema, obuke, zaposleni, nalazi, izvještaji, `oblast (ZNR/ZOP/ZŽS)` na usluzi → kasnije (YAGNI sad).

## 3. Donesene odluke

1. **Pristup A** — inkrementalno proširenje šeme po model‑docu; motor rokova (`termini`, `klijent_provjere`) se ne dira.
2. **Kontakti** — nova `kontakt_osobe` na nivou klijenta **i** zadržati postojeća kontakt polja na `lokacije` (kontakt specifičan za lokaciju). Tab „Kontakti" prikazuje oboje.
3. **Dokumenti** — generalizovati postojeću `dokumenti` tabelu (ne zasebna tabela).
4. **ID karta** — u PP‑1 samo unos + prikaz na kartici klijenta; generisanje ID karte kao dokumenta ide u PP‑3.

## 4. Model podataka

Imena polja prate `TEHPRO - Model podataka` dokument.

### 4.1 `klijenti` — nove kolone (sve nullable, bez prekida)
| kolona | tip | napomena |
|---|---|---|
| `adresa` | text | sjedište firme |
| `pib` | text | poreski broj |
| `maticni_broj` | text | |
| `sifra_djelatnosti` | text | |
| `telefon` | text | |
| `email` | text | |
| `zaduzeni_tehpro_id` | uuid → `korisnici(id)` ON DELETE SET NULL | odgovorna osoba ispred TEHPRO‑a |

Zadržava se postojeće: `naziv, napomena, tip_odnosa, podsjetnik_emails, created_at, updated_at`.

### 4.2 `ugovori` (nova tabela)
```
id                     uuid pk default gen_random_uuid()
klijent_id             uuid not null → klijenti(id) on delete cascade
zavodni_broj           text            -- "broj ugovora"
datum_potpisivanja     date
datum_isteka           date
vazenje_mjeseci        int             -- trajanje ugovora (nullable)
broj_obilazaka_mjesecno int            -- ugovoreni obilasci / mjesec (feed za PP‑5)
automatsko_obnavljanje boolean not null default false
aktivan                boolean not null default true
napomena               text
created_at             timestamptz not null default now()
```
- **Jedan aktivan ugovor po klijentu:** `CREATE UNIQUE INDEX ON ugovori(klijent_id) WHERE aktivan;`
- Više ugovora dozvoljeno (istorija/obnavljanje); samo jedan `aktivan`.

### 4.3 `kontakt_osobe` (nova tabela)
```
id          uuid pk default gen_random_uuid()
klijent_id  uuid not null → klijenti(id) on delete cascade
ime         text not null
funkcija    text
telefon     text
email       text
created_at  timestamptz not null default now()
```

### 4.4 `klijent_provjere` — nova kolona
| kolona | tip | napomena |
|---|---|---|
| `ugovor_id` | uuid → `ugovori(id)` ON DELETE SET NULL, nullable | „ugovorene usluge" = profil provjera vezan za aktivni ugovor; prikaz na ID karti. Postojeća logika motora ostaje. |

### 4.5 `vrste_provjera` — nova kolona
| kolona | tip | napomena |
|---|---|---|
| `vodi_dokumentaciju` | boolean NOT NULL default true | gap #5 |

### 4.6 `dokumenti` — generalizacija
```
+ klijent_id  uuid → klijenti(id) on delete cascade   -- NOT NULL nakon backfilla
+ ugovor_id   uuid → ugovori(id) on delete set null    -- nullable
  termin_id   uuid → termini(id)                        -- POSTAJE nullable
+ tip         text not null default 'ostalo'
              CHECK (tip in ('strucni_nalaz','zapisnik','ugovor','ponuda','fotografija','ostalo'))
```
- Invarijanta: svaki dokument ima `klijent_id`; `termin_id`/`ugovor_id` su opcione veze.
- Storage putanje: `klijenti/<id>/…`, `ugovori/<id>/…`, uz postojeće `termini/<id>/…`.

### 4.7 Read‑modeli
- `klijenti_view` — provjeriti da li treba dopuna (npr. naziv zaduženog TEHPRO, broj ugovora). Minimalno: dodati `ima_aktivan_ugovor` / `zaduzeni_tehpro_ime` ako zatreba prikazu liste; inače bez izmjene.
- `termini_view` — bez izmjene u PP‑1.

## 5. Migracije (Supabase, redoslijed)

1. `..._klijenti_idkarta_polja.sql` — ALTER `klijenti` (4.1).
2. `..._ugovori.sql` — CREATE `ugovori` + partial unique index (4.2).
3. `..._kontakt_osobe.sql` — CREATE `kontakt_osobe` (4.3).
4. `..._klijent_provjere_ugovor.sql` — ALTER `klijent_provjere` += `ugovor_id` (4.4).
5. `..._vrste_vodi_dokumentaciju.sql` — ALTER `vrste_provjera` (4.5).
6. `..._dokumenti_generalizacija.sql` — add `klijent_id/ugovor_id/tip` → **backfill `klijent_id`** iz `termini.klijent_id` → `ALTER … SET NOT NULL klijent_id` → drop NOT NULL `termin_id` (4.6).
7. `..._rls_audit_pp1.sql` — RLS politike + audit trigeri za nove tabele (vidi §6).

Primjena: prvo lokalni Docker (`pnpm db:reset` / lokalni stack) za test, zatim cloud preko `scripts/apply-cloud-migration.ts` (cloud baza nije u MCP). Nakon migracija: `pnpm db:types` (regen `db/types.ts`).

## 6. RLS / Audit / Uloge

- **RLS** na `ugovori`, `kontakt_osobe`: SELECT/INSERT/UPDATE/DELETE preko postojeće funkcije `ima_pristup_klijentu(klijent_id)` (operater/pregled vide samo dodijeljene klijente, admin sve). `pregled` = samo SELECT.
- **`dokumenti`** RLS proširiti da pristup ide preko `klijent_id` (ranije preko termina); zadržati postojeće obrasce.
- **Vrste usluga** (`vrste_provjera`) izmjena/deaktivacija = samo `admin` (guard `je_admin()` / server‑side `zahtijevajAdmina`).
- **Audit** trigeri (`audit_trigger`) dodati na `ugovori`, `kontakt_osobe`, `vrste_provjera`; `dokumenti` ako već nije pokriveno.

## 7. Server akcije i validacija (zod)

- `klijenti/actions.ts`:
  - proširiti `createKlijentSchema` / `updateKlijentSchema` na nova polja (4.1); `zaduzeni_tehpro_id` = uuid ili prazno→null.
  - nove: `createUgovor`, `updateUgovor`, `deleteUgovor` (server‑side enforce „jedan aktivan": pri postavljanju `aktivan=true` deaktivirati ostale u transakciji/RPC).
  - nove: `createKontakt`, `updateKontakt`, `deleteKontakt`.
- `dokumenti/actions.ts`:
  - `uploadDokumentAction` proširiti: prihvata `klijent_id` (obavezno) + opcione `ugovor_id`/`termin_id` + `tip`; bira storage prefiks po vezi.
  - revalidacija putanja: `/klijenti/[id]`, `/termini`, `/zapisnici`.
- `postavke/actions.ts`:
  - nove/proširene: `updateVrsta` (naziv, zakonski_osnov, interval), `toggleVrstaAktivna`, `toggleVodiDokumentaciju` — sve admin‑only.

Sve akcije vraćaju postojeći `ActionResult` oblik i koriste `revalidatePath`.

## 8. UI / komponente

- **Novi/izmjena klijenta** (`NoviKlijentButton`, `KlijentEditForm`) — proširiti formu na sva ID‑karta polja + `Select` za `zaduzeni_tehpro` iz aktivnih korisnika.
- **Tab „ID karta"** na `/klijenti/[id]` (`KlijentTabs` += `id-karta`): prikaz osnovnih podataka + aktivni ugovor + kontakti + ugovorene usluge (read‑only + dugmad za izmjenu). Postojeći tabovi (Termini/Lokacije/Kontakti/Dokumenti/Profil) ostaju.
- **Ugovor** — `UgovorSheet`/forma (CRUD, oznака aktivnog).
- **Kontakti** — `KontaktSheet`/forma (CRUD); tab „Kontakti" spaja klijent‑kontakte i lokacijske kontakte.
- **Dokumenti tab** — dodati upload kontrolu (klijent/ugovor nivo) + izbor `tip` + filter po tipu.
- **Postavke → Vrste pregleda** — uz postojeći interval, dodati: izmjenu naziva, prekidač `aktivna` (deaktivacija) i prekidač `vodi_dokumentaciju`.

## 9. Backfill / migracija podataka

- Postojeći klijenti: nova polja nullable → bez prekida; `tip_odnosa` ostaje (ne migrira se automatski u `ugovori`).
- **Obavezan backfill** `dokumenti.klijent_id` iz `termini.klijent_id` za sve postojeće redove **prije** `SET NOT NULL`.
- Postojeći `dokumenti.tip` = `'ostalo'` (default), osim AI zapisnika (`generated_by_ai=true`) → može se setovati `'zapisnik'` u istoj migraciji.

## 10. Testiranje (Docker + TDD)

- **Unit (vitest):** zod sheme (klijent/ugovor/kontakt), invarijanta „jedan aktivan ugovor", validacija `tip` dokumenta, helperi putanja storidža.
- **Integraciono (lokalni Docker Supabase + `.env`):** migracije prolaze i idempotentne su; backfill `dokumenti.klijent_id` tačan; RLS — operater vidi samo `ugovori`/`kontakt_osobe` dodijeljenih klijenata; upload dokumenta na klijent i ugovor nivou.
- **E2E (Playwright, `--workers=1`):** kreiraj klijenta s punom ID kartom → dodaj ugovor (postane aktivan) → dodaj 2 kontakta → otvori „ID karta" tab i provjeri prikaz → okači „ugovor" dokument na klijenta → u Postavkama deaktiviraj jednu vrstu i uključi `vodi_dokumentaciju`.
- **Build gate:** `pnpm typecheck` + `pnpm lint` + regen `db/types.ts` (bez diff‑a u CI).

## 11. Rizici i otvorena pitanja

- **Cloud baza nije u MCP** → migracije na cloud idu zasebnim skriptom; testiranje na lokalnom Docker‑u prvo.
- `klijenti_view`/`termini_view` možda traže dopunu zavisno od prikaza liste — potvrditi u fazi plana.
- „Jedan aktivan ugovor" — odabran partial unique index; akcija mora deaktivirati prethodni aktivni atomično (RPC ili dvije naredbe u transakciji).
- Postojeće necommit‑ovane izmjene na grani `docs/epik-a-auth-rls-audit` (IntervaliForm/ReminderForm/testovi) — PP‑1 ide na zasebnu granu da se ne miješa.

## 12. Veze sa kasnijim PP

- `ugovori.broj_obilazaka_mjesecno` → ulaz za **PP‑5** (auto‑kreiranje obilazaka).
- `dokumenti.tip` + generalizacija → temelj za **PP‑3** (izvoz/izvještaji) i PP‑5 (bilješke).
- `vrste_provjera.vodi_dokumentaciju` → koristi se u **PP‑2** (unos izvršenja) i izvještajima.
- `klijent_provjere.ugovor_id` → veže ugovorene usluge i kasniji „plan aktivnosti po klijentu".
