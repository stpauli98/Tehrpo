# Podsjetnici v2 — dizajn

**Datum:** 2026-07-07
**Grana:** `feat/podsjetnici-v2`
**Status:** dizajn odobren, čeka pregled speca

## Cilj

Tri nove admin-kontrolisane mogućnosti za sistem email podsjetnika, sve sinhronizovane
sa postojećom dodjelom radnik↔firma:

1. **Podesivo vrijeme slanja** — admin bira sat (0–23, lokalno vrijeme Europe/Sarajevo)
   u kojem instanca šalje dnevne podsjetnike. Trenutno je fiksno 06:00 UTC.
2. **Slanje firmama (Krug 2)** — admin može uključiti slanje podsjetnika i firmama
   (klijentima), globalno + per-firma. Do sada se klijentu NIKAD nije slalo.
3. **Upravljanje dodjelom radnik↔firma sa obje strane** + pregled „ko šta prima".

Sistem je **multi-instanca / multi-baza**: jedan projekat (repo) opslužuje više Vercel
deploymenta, svaki sa svojom Supabase bazom, svojim klijentima i svojim podsjetnicima.
Svaka instanca čita/piše isključivo svoju bazu; ova tri podešavanja su per-instanca.

## Kontekst (zatečeno stanje)

- **Engine:** `lib/reminders/runReminders.ts` — čita `postavke.dana_prije`, zove RPC
  `get_due_podsjetnici(dana_prije_arr)`, gradi indeks primalaca (`recipients.ts`:
  dodijeljeni ∪ admini ∪ `REMINDER_TO`, uslov `aktivan && prima_podsjetnike`), šalje
  preko Resend-a, upisuje idempotentan audit red u `podsjetnici` (`poslat_na text[]`,
  jedinstveni indeks `uq_podsjetnici_termin_dana` nad `(termin_id, dana_prije)`).
- **RPC** `get_due_podsjetnici` (migr. `20260629120000`) vraća pre-due (catch-up) +
  post-due redove; **više NE vraća `podsjetnik_emails`** (izbačen iz povratnog tipa).
- **Cron ruta:** `app/api/cron/reminders/route.ts` — fail-closed Bearer auth
  (`cronAuth.ts`); GET poštuje flag `postavke.podsjetnici_aktivni` (gate: `gating.ts`),
  POST uvijek radi (ručno/„Pokreni sada"/e2e).
- **Vercel cron:** `vercel.json` → `{"path": "/api/cron/reminders", "schedule": "0 6 * * *"}`.
  Vercel tim je na **Hobby planu** → cron je ograničen na **jednom dnevno** (hourly nije
  moguć bez nadogradnje na Pro).
- **Postavke tabela** (single-row, id=1): `dana_prije int[]`, `podsjetnici_aktivni bool`,
  `updated_at`. RLS `postavke_wr` = `je_admin()`.
- **Klijenti tabela:** već ima `podsjetnik_emails text[] not null default '{}'` (dodano u
  `20260621171350`, ali trenutno **neiskorišteno** jer ga RPC više ne vraća).
- **Dodjele:** `korisnik_klijent (korisnik_id, klijent_id)` — N:N, RLS-om zaštićena.
  UI postoji jednosmjerno: Postavke → Korisnici → `postaviDodjele(korisnikId, klijentIds[])`.
- **Stranica firme** `app/(dashboard)/klijenti/[id]/page.tsx`: tabovi preko `KlijentTabs`,
  `VALID_TABS = ["id-karta","termini","lokacije","kontakti","dokumenti","profil"]`, tab iz
  `searchParam`. Već dohvata `podsjetnik_emails` direktno iz `klijenti` tabele.
- **i18n:** next-intl, jezici `sr/en/de` (`de` čeka native review).

## Odluke (iz brainstorminga)

| Pitanje | Odluka |
|---|---|
| Krug 2 — gdje živi prekidač | **Globalni + per-firma**: email firmi ide samo ako su OBA `true` |
| Adrese firme | **`klijenti.podsjetnik_emails`** (eksplicitna lista, kolona već postoji) |
| Granularnost/TZ vremena | **Puni sat, lokalna zona (Europe/Sarajevo)** |
| Dodjele — šta fali | **Dodjela sa strane firme** + **pregled „ko šta prima"** |
| Mehanizam sata | **GitHub Actions** (hourly) okida cron rutu; gate po satu u aplikaciji |

## Arhitektura

### 1. Model podataka (jedna migracija)

Nova migracija `supabase/migrations/2026070713xxxx_podsjetnici_v2.sql`:

```sql
-- postavke: sat slanja + globalni Krug-2 prekidač
alter table postavke
  add column vrijeme_slanja_sat smallint not null default 6,
  add column salji_klijentima  boolean  not null default false;
alter table postavke
  add constraint chk_postavke_sat check (vrijeme_slanja_sat between 0 and 23);

-- klijenti: per-firma Krug-2 prekidač (podsjetnik_emails već postoji)
alter table klijenti
  add column salji_podsjetnik_klijentu boolean not null default false;
```

- `vrijeme_slanja_sat smallint default 6` — čuva postojeće ponašanje (slalo se ~06h).
- `salji_klijentima default false` i `salji_podsjetnik_klijentu default false` — Krug 2 je
  isključen dok ga admin svjesno ne uključi; migracija sama po sebi ne mijenja kome stižu mailovi.
- `korisnik_klijent` — bez izmjene sheme.

**Pravilo slanja firmi (invarijanta):** firma dobija email na `klijenti.podsjetnik_emails`
**samo ako** `postavke.salji_klijentima = true` **I** `klijenti.salji_podsjetnik_klijentu = true`
**I** `podsjetnik_emails` nije prazna. Interni primaoci (dodijeljeni ∪ admini ∪ REMINDER_TO)
se time nikad ne uklanjaju — Krug 2 samo **dodaje** firmine adrese.

**Rollout migracije:** lokalno (`pnpm db:reset`) → `pnpm db:types` → DEMO
(`pnpm db:apply-cloud <fajl>` sa `DATABASE_URL_DEMO`) → PROD (`pnpm db:apply-cloud`).
Cloud nije dostupan kroz Supabase MCP.

### 2. Mehanizam sata

Vercel Hobby ne dozvoljava hourly cron, pa „sat" dolazi izvana, a odluka je u aplikaciji.

**GitHub Actions** `.github/workflows/reminders.yml`:
- `on.schedule: - cron: "0 * * * *"` (svaki puni sat; GH cron je uvijek UTC) + `workflow_dispatch`.
- Po jedan korak po instanci:
  `curl -sS --max-time 120 -X GET -H "Authorization: Bearer ${{ secrets.CRON_SECRET_<INST> }}" "${{ secrets.URL_<INST> }}/api/cron/reminders" || true`
  — `|| true` da pad jedne instance ne obori job. URL i CRON_SECRET po instanci u GitHub Secrets.
- Nova instanca = jedan korak + dva secreta.

**Gate po satu** (`app/api/cron/reminders/route.ts`, samo GET grana):
GET radi punu obradu samo ako je `podsjetnici_aktivni = true` **I** trenutni sat u
`Europe/Sarajevo` == `vrijeme_slanja_sat`. Inače `{ ok: true, skipped: "izvan_sata_slanja" }`.
POST i dalje zaobilazi i flag i sat.

Novi helper u `lib/reminders/gating.ts`:
```ts
export function jeSatSlanja(vrijemeSat: number, now: Date, timeZone = "Europe/Sarajevo"): boolean {
  const sat = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", hour12: false,
  }).format(now))
  // 24 → 0 (Intl vraća "24" za ponoć u nekim okruženjima)
  return (sat % 24) === vrijemeSat
}
```
Čist, `now` i TZ se ubacuju (bez skrivenog `Date.now()`), DST se rješava sam.

**Zašto je tačno / rizici:**
- Idempotencija (`uq_podsjetnici_termin_dana` + audit anti-join) štiti od dvostrukog
  okidanja u istom satu. GH Actions zna kasniti par minuta ili se okinuti dvaput — drugi
  prolaz vidi „već poslato" i preskoči.
- Gate poredi **sat**, ne tačan trenutak → cijeli jednosatni prozor je validan; kašnjenje
  unutar sata i dalje prolazi.
- Postojeći Vercel dnevni cron ostaje kao **rezerva** (prolazi kroz isti gate; ako se
  poklopi sa satom, idempotencija štiti od duplikata).
- Ako GH Actions potpuno propusti sat (rijetko), taj dan se preskače — dnevni Vercel cron
  je rezerva samo ako mu je fiksni sat jednak izabranom; inače se propušteni pragovi
  catch-up mehanizmom pošalju sljedeći dan (pre-due prozor).

### 3. Engine i primaoci firmi (Krug 2)

RPC ostaje **nepromijenjen** (izbjegava se rizičan DROP/CREATE na tri baze). Logika Kruga 2
živi u `lib/reminders/`.

**`runReminders.ts`** — dodatni batch-fetchevi uz postojeće:
- `postavke` → čita i `salji_klijentima`.
- novi fetch `klijenti` → `id, salji_podsjetnik_klijentu, podsjetnik_emails`
  (isti oprez oko tihe PostgREST trunkacije koji već stoji za `korisnik_klijent`).

**`recipients.ts`:**
- `buildRecipientIndex(korisnici, dodjele, klijenti, saljiKlijentima)` gradi dodatnu mapu
  `klijentEmailsByKlijent: Map<klijent_id, string[]>`, punjenu **samo** kad
  `saljiKlijentima === true` **I** `salji_podsjetnik_klijentu === true` za tu firmu; svaka
  adresa prolazi kroz postojeći `EMAIL_RE`.
- `recipientsForKlijent(index, klijentId, base)` spaja interne ∪ firmine adrese kroz
  postojeći `assembleRecipients` (dedupe + validacija + lowercase).

**Invarijanta + test:** `saljiKlijentima === false` → `klijentEmailsByKlijent` prazan →
ponašanje identično današnjem („klijentu se nikad ne šalje"). Ovo je default.

**Audit red** `podsjetnici.poslat_na` bilježi punu listu (uklj. firmine adrese kad su poslate).

Throttling, cap, idempotencija, dry-run bez ključa — nepromijenjeno.

### 4. UI

**A) Postavke → Email podsjetnici** (admin, postojeća sekcija):
- **Vrijeme slanja** — `Select` 0–23 („07:00"…), napomena „po lokalnom vremenu (Sarajevo)".
  Akcija `updateVrijemeSlanja(sat)` (admin, RLS `postavke_wr`).
- **Globalni prekidač „Šalji podsjetnike i firmama"** (`salji_klijentima`) uz upozorenje da
  mailovi izlaze van TehPro-a. Akcija `updateSaljiKlijentima(bool)`.

**B) Postavke → novi pregled „Ko šta prima"** (admin, read-only):
- Tabela red-po-firmi: **Dodijeljeni radnici** (iz `korisnik_klijent`, samo
  `prima_podsjetnike`), **Firma prima?** (badge da/ne po per-firma + globalnom flagu),
  **Adrese firme** (`podsjetnik_emails`). Server component, jedan round-trip preko view/RPC-a.

**C) Stranica firme `klijenti/[id]` → novi tab `"podsjetnici"`** (admin/operater po RLS-u):
- **Per-firma toggle** `salji_podsjetnik_klijentu` + editor liste `podsjetnik_emails`
  (dodaj/ukloni, validacija `EMAIL_RE`). Akcija `updateKlijentPodsjetnici(klijentId, {salji, emails})`.
- **Dodjela sa strane firme** — lista radnika sa kvačicama „dodijeljen ovoj firmi", piše u
  istu `korisnik_klijent`. Nova akcija `postaviDodjeleZaKlijenta(klijentId, korisnikIds[])`
  (obrnuti pogled na postojeći `postaviDodjele`).
- Dodati `"podsjetnici"` u `VALID_TABS` + `KlijentTabs` + i18n `klijenti.tabs`.

**Sinhronizacija:** „Postavke → Korisnici → dodjela" i „Firma → dodjela radnika" čitaju/pišu
**istu** `korisnik_klijent` tabelu; pregled „Ko šta prima" je izvedeni prikaz nad njom +
firminim adresama. Jedan izvor istine, bez kopiranja.

**i18n:** svi novi stringovi u `sr/en/de`.

### 5. Testovi

**Unit (Vitest, `lib/**/*.test.ts`):**
- `gating.test.ts` — `jeSatSlanja`: poklapanje, ne-poklapanje, DST granica (isti UTC → drugi
  lokalni sat ljeti/zimi), ponoć (24→0), ubačeni `now`+TZ.
- `recipients.test.ts` (proširenje): (1) `salji_klijentima=false` → firmine adrese nikad;
  (2) oba `true` + neprazna lista → dodate; (3) per-firma `false` uz globalni `true` →
  preskočena; (4) dedupe firmina==interna; (5) prazna lista → nema praznog slanja;
  (6) nevalidna adresa → odbačena.

**E2E (Playwright, cloud DEMO, postojeći obrazac):**
- Postavke: promjena sata + globalnog togglea se sačuva i prikaže.
- Firma: per-firma toggle + dodavanje/uklanjanje adrese; dodjela radnika sa strane firme se
  odrazi u „Postavke → Korisnici" (dvosmjerni sync).
- Regresija: POST „Pokreni sada" radi bez obzira na sat.

## Rollout redoslijed (fail-safe)

1. Migracija: lokalno → `db:types` → DEMO → PROD. Defaulti čuvaju postojeće ponašanje.
2. Deploy koda (engine + gate + UI) na sve instance.
3. GitHub Actions workflow + Secrets (URL/CRON_SECRET po instanci). Vercel dnevni cron ostaje rezerva.
4. Verifikacija: `Pokreni sada` (dry) po instanci; potvrda da gate propušta samo u izabranom satu.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, ciljani e2e — sve zeleno prije merge-a.

## Van obima (YAGNI)

- Minutna granularnost vremena (cron je ionako hourly).
- Slanje na kontakt osobe / lokacijske adrese (biramo eksplicitnu `podsjetnik_emails` listu).
- Per-radnik izbor „u koje vrijeme" (vrijeme je per-instanca, ne per-korisnik).
- Nadogradnja na Vercel Pro (GitHub Actions pokriva potrebu besplatno).
