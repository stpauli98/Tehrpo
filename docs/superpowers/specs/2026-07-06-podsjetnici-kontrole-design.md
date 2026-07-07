# Kontrole email podsjetnika — prekidač + ručno pokretanje

**Datum:** 2026-07-06 · **Status:** odobren u razgovoru · **Grana:** `feat/podsjetnici-kontrole`

## Cilj

Admin u Postavkama (sekcija email podsjetnika) dobija: (1) **prekidač** koji uključuje/isključuje
automatsko dnevno slanje podsjetnika za TU instancu, i (2) **dugme „Pokreni sada"** koje odmah
okine puni ciklus slanja i prikaže rezultat — za testiranje crona na klik.

## Kontekst (zatečeno stanje)

- Reminder engine radi; Resend aktiviran na `tehpro-demo` (PROD baza) i `demo-app`; `tehpro-de` bez ključa (dry).
- **Vercel cron VEĆ postoji** (`vercel.json`, `0 6 * * *`, od 0dbc4a0 / 29.06.) i poziva GET
  `/api/cron/reminders` sa Bearer `CRON_SECRET` — od aktivacije Resenda automatika je ŽIVA.
- Postojeće dugme „pošalji testni email" (posaljiTestniEmail) testira SAMO dostavu — ne engine.
- Tri Vercel projekta dijele repo/vercel.json → cron se okida na sve tri instance; svaka ima svoju bazu.

## Odluke

| Pitanje | Odluka |
|---|---|
| Gdje živi prekidač | Kolona `podsjetnici_aktivni boolean NOT NULL DEFAULT true` u tabeli `postavke` (id=1) — per-instanca (svaka baza svoj flag) |
| Default | **`true`** — automatika je već živa i primaoci na tehpro su očišćeni; default false bi tiho ugasio ono što je korisnik upravo aktivirao. Isključivanje = svjesna radnja u UI. |
| Gating u ruti | SAMO **GET** (Vercel cron putanja) provjerava flag; isključeno → `{ok:true, skipped:"podsjetnici_iskljuceni"}` bez pokretanja enginea. **POST ostaje pun** (ručno/test/e2e — dugme mora raditi i kad je automatika ugašena). |
| „Pokreni sada" | Server action (admin-only, `jeAdmin`) koja server-side `fetch`-uje SOPSTVENI `/api/cron/reminders` POST-om sa Bearer `env.CRON_SECRET` (origin iz `headers()`), `{dryRun:false}`. Time se poštuje pravilo „admin klijent nikad u app/ request putu" — admin pristup ostaje u cron ruti. UI prikaže rezultat (poslano/preskočeno/greške). |
| UI smještaj | Postavke → postojeća sekcija email podsjetnika (uz `ReminderForm`) — prekidač + dugme + rezultat. |
| i18n | Novi ključevi u `postavke.*` (sr verbatim stil projekta, en/de prevodi, paritet test). Pattern C za poruke akcija. |
| Migracije | Lokalna migracija → `pnpm db:types` → cloud DEMO pa PROD (`db:apply-cloud` uz odgovarajući DATABASE_URL). **Redoslijed deploy-a: prvo migracije na obje cloud baze, tek onda merge koda** (kod čita novu kolonu). |

## Ponašanje

- Flag isključen: dnevni cron (GET) ne šalje ništa i vraća eksplicitan `skipped` razlog (vidljivo u Vercel cron logu). Dugme „Pokreni sada" (POST) i dalje šalje — to je namjerno (test i vanredno slanje).
- Flag uključen: ponašanje identično današnjem.
- Čitanje flaga u ruti tolerantno: `maybeSingle()` + default `true` ako red/kolona nedostaje (sigurnost za trenutak između deploy-a i migracije, iako je redoslijed migracija-prvo).

## Testiranje

- Unit: gating logika (GET+flag off → skipped; GET+flag on → run; POST ignoriše flag) — izdvojena čista funkcija.
- Postojeći e2e `06-podsjetnici` (POST dryRun) ostaje zelen bez izmjena (POST bypass).
- e2e dopuna: toggle se perzistira (obrazac postojećeg testa za pragove).
- Runtime verifikacija: dugme na produkciji šalje 5 dospjelih podsjetnika na nmil32@icloud.com; sutrašnji cron u 06:00 UTC = dokaz automatike (uz uključen flag).
