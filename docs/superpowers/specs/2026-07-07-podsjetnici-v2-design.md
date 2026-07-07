# Podsjetnici v2 — dizajn

**Datum:** 2026-07-07
**Grana:** `feat/podsjetnici-v2`
**Status:** dizajn odobren; spec revidiran nakon adversarijalnog reviewa (v2), čeka pregled

## Cilj

Tri nove admin-kontrolisane mogućnosti za sistem email podsjetnika, sve sinhronizovane
sa postojećom dodjelom radnik↔firma:

1. **Podesivo vrijeme slanja** — admin bira sat (0–23, lokalno vrijeme Europe/Sarajevo)
   od kojeg instanca šalje dnevne podsjetnike. Trenutno je fiksno 06:00 UTC (Vercel cron).
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
  post-due redove. Pre-due koristi prozor + range anti-join → **propušteni prag se resenduje
  narednog dana**. Post-due koristi tačan dnevni marker (`dana_prije = rok - current_date`)
  → post-due za jedan potpuno preskočen dan se ne replayuje, ali se sam sanira sljedećim
  dnevnim markerom. RPC **više NE vraća `podsjetnik_emails`** (izbačen iz povratnog tipa).
- **Cron ruta:** `app/api/cron/reminders/route.ts` — fail-closed Bearer auth
  (`cronAuth.ts`); GET poštuje flag `postavke.podsjetnici_aktivni` (gate: `gating.ts`),
  POST uvijek radi (ručno/„Pokreni sada"/e2e). Vercel cron ulazi preko GET-a.
- **Vercel cron:** `vercel.json` → `{"path": "/api/cron/reminders", "schedule": "0 6 * * *"}`
  (06:00 UTC = 07:00 zimi / 08:00 ljeti po Europe/Sarajevo). Napomena: CLAUDE.md tvrdnja
  „no crons array yet" je ZASTARJELA — cron JE ožičen. Vercel tim je na **Hobby planu** →
  cron je ograničen na **jednom dnevno** (hourly nije moguć bez nadogradnje na Pro).
- **Postavke tabela** (single-row, id=1): `dana_prije int[]`, `podsjetnici_aktivni bool`,
  `updated_at`. RLS `postavke_wr` = `je_admin()` (SSR/anon klijent primjenjuje RLS).
- **Klijenti tabela:** već ima `podsjetnik_emails text[] not null default '{}'`. Kolona se
  **već čita i uređuje** na stranici firme (`KlijentEditForm`); samo je **engine podsjetnika
  trenutno ne koristi** jer je RPC više ne vraća.
- **Dodjele:** `korisnik_klijent (korisnik_id, klijent_id)` — N:N. RLS: `kk_sel` =
  `korisnik_id = auth.uid() or je_admin()`, **`kk_wr` = `je_admin()` (upis samo admin)**.
  UI postoji jednosmjerno: Postavke → Korisnici → `postaviDodjele(korisnikId, klijentIds[])`,
  koji je gated `zahtijevajAdmina()` i koristi **service-role admin klijent** (zaobilazi RLS).
- **Stranica firme** `app/(dashboard)/klijenti/[id]/page.tsx`: tabovi preko `KlijentTabs`,
  `VALID_TABS = ["id-karta","termini","lokacije","kontakti","dokumenti","profil"]`, tab iz
  `searchParam`. `klijenti_upd` RLS = `ima_pristup_klijentu(id) and not je_pregled()`
  (operater sa pristupom smije uređivati klijenta; `updateKlijent` koristi SSR klijent).
- **`Ko šta prima` presedan:** `components/domain/KorisniciTab.tsx` je server komponenta koja
  već čita `korisnici` + `klijenti` + `korisnik_klijent` sa tri paralelna `select`-a spojena
  u JS — isti obrazac koristimo za novi pregled (bez novog view-a/RPC-a).
- **i18n:** next-intl, jezici `sr/en/de` (`de` čeka native review).

## Odluke (iz brainstorminga + reviewa)

| Pitanje | Odluka |
|---|---|
| Krug 2 — gdje živi prekidač | **Globalni + per-firma**: email firmi ide samo ako su OBA `true` |
| Adrese firme | **`klijenti.podsjetnik_emails`** (eksplicitna lista, kolona već postoji) |
| Granularnost/TZ vremena | **Puni sat, lokalna zona (Europe/Sarajevo)** |
| Semantika sata | **„šalji u prvom satu ≥ izabranog, najviše jednom dnevno"** (ne tačna jednakost) |
| Dodjele — šta fali | **Dodjela sa strane firme** (admin-only) + **pregled „ko šta prima"** |
| Mehanizam sata | **GitHub Actions** (hourly, UTC) okida cron rutu; gate u aplikaciji |

## Arhitektura

### 1. Model podataka (jedna migracija)

Nova migracija `supabase/migrations/2026070713xxxx_podsjetnici_v2.sql`:

```sql
-- postavke: sat slanja + „poslato danas" marker + globalni Krug-2 prekidač
alter table postavke
  add column vrijeme_slanja_sat  smallint not null default 6,
  add column zadnje_slanje_datum date,                     -- lokalni datum zadnjeg auto-runa (nullable)
  add column salji_klijentima    boolean  not null default false;
alter table postavke
  add constraint chk_postavke_sat check (vrijeme_slanja_sat between 0 and 23);

-- klijenti: per-firma Krug-2 prekidač (podsjetnik_emails već postoji)
alter table klijenti
  add column salji_podsjetnik_klijentu boolean not null default false;
```

- `vrijeme_slanja_sat default 6` = „ne šalji prije 06:00 po lokalnom vremenu (Sarajevo)".
  **Napomena o ponašanju:** stari sistem je slao u 06:00 **UTC** (= 07/08 lokalno). Novi
  default (06:00 **lokalno**) NIJE isti trenutak — efektivno najranije slanje pomjera se
  ~1–2h ranije i po lokalnom je satu (svjesna posljedica lokalne semantike, ne „očuvano
  ponašanje"). Vrijednost je admin-podesiva, pa instanca može odabrati bilo koji sat.
- `zadnje_slanje_datum` (nullable) — lokalni datum kad je auto-run zadnji put prošao gate;
  osigurava „najviše jednom dnevno" (vidi §2).
- `salji_klijentima default false` i `salji_podsjetnik_klijentu default false` — Krug 2 je
  isključen dok ga admin svjesno ne uključi; migracija sama ne mijenja kome stižu mailovi.
- `korisnik_klijent` — bez izmjene sheme.
- **Pregled „Ko šta prima" ne uvodi novi view/RPC** (koristi paralelne `select`-e, §4B),
  pa migracija ostaje samo ova tri `alter`-a.

**Pravilo slanja firmi (invarijanta):** firma dobija email na `klijenti.podsjetnik_emails`
**samo ako** `postavke.salji_klijentima = true` **I** `klijenti.salji_podsjetnik_klijentu = true`
**I** `podsjetnik_emails` nije prazna. Interni primaoci (dodijeljeni ∪ admini ∪ REMINDER_TO)
se time nikad ne uklanjaju — Krug 2 samo **dodaje** firmine adrese.

**Rollout migracije:** lokalno (`pnpm db:reset`) → regen tipova iz **lokalnog** stack-a
(vidi Rollout §, jer `db:types` po defaultu gađa PROD) → DEMO → PROD. Defaulti čuvaju
„nikad klijentu"; cloud nije dostupan kroz Supabase MCP.

### 2. Mehanizam sata

Vercel Hobby ne dozvoljava hourly cron, pa „sat" dolazi izvana (svaki puni sat), a odluka
kada tačno poslati je u aplikaciji.

**GitHub Actions** `.github/workflows/reminders.yml`:
- `on.schedule: - cron: "0 * * * *"` (svaki puni sat; GH cron je uvijek UTC) + `workflow_dispatch`.
- Po jedan korak po instanci:
  `curl -sS --max-time 120 -X GET -H "Authorization: Bearer ${{ secrets.CRON_SECRET_<INST> }}" "${{ secrets.URL_<INST> }}/api/cron/reminders" || true`
  — `|| true` da pad jedne instance ne obori job. URL i CRON_SECRET po instanci u GitHub Secrets.
- Nova instanca = jedan korak + dva secreta.

**Gate** (`app/api/cron/reminders/route.ts`, samo GET grana). GET radi punu obradu ako:
1. `postavke.podsjetnici_aktivni = true`, **I**
2. lokalni sat (Europe/Sarajevo) **≥** `vrijeme_slanja_sat`, **I**
3. `zadnje_slanje_datum` **nije** današnji lokalni datum (nije već slato danas).

Nakon **uspješnog** runa (bez greške) postavlja `zadnje_slanje_datum = <današnji lokalni datum>`.
Ako uslov nije ispunjen → `{ ok: true, skipped: "<razlog>" }` (`izvan_sata` / `vec_slato_danas`
/ `podsjetnici_iskljuceni`). POST i dalje **zaobilazi** gate u cijelosti i **ne dira**
`zadnje_slanje_datum` (ručno/test/e2e).

Novi helperi u `lib/reminders/gating.ts` (čisti, `now`+TZ se ubacuju — bez `Date.now()`):

```ts
export function lokalniSatIDatum(now: Date, timeZone = "Europe/Sarajevo"): { sat: number; datum: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
  }).formatToParts(now)
  const g = (t: string) => p.find((x) => x.type === t)!.value
  const sat = Number(g("hour")) % 24          // 24 → 0 (ponoć u nekim okruženjima)
  return { sat, datum: `${g("year")}-${g("month")}-${g("day")}` }  // ISO lokalni datum
}

/** Treba li auto-run slati sada: sat dostignut i danas još nije slato. */
export function trebaSlatiSada(vrijemeSat: number, zadnjeSlanjeDatum: string | null, now: Date, timeZone = "Europe/Sarajevo"): boolean {
  const { sat, datum } = lokalniSatIDatum(now, timeZone)
  return sat >= vrijemeSat && zadnjeSlanjeDatum !== datum
}
```

**Zašto je „≥ + jednom dnevno" bolje od „tačan sat ==":**
- **GH Actions kašnjenje** (često 10–30 min, ponekad preskočen tik): bilo koji hourly tik
  na/nakon ciljnog sata koji danas još nije slao pokreće tačno jedan run — kašnjenje ne
  uzrokuje promašaj.
- **DST spring-forward** (zadnja nedjelja marta, lokalni sat 02 ne postoji): ako je izabran
  preskočeni sat, sljedeći tik (npr. 03) je ≥ 02 i danas nije slato → šalje se istog dana.
  Nema tihog preskoka. (Fall-back ponovljeni sat: „jednom dnevno" spriječi dupli run;
  idempotencija je dodatni štit.)
- **Vercel dnevni cron postaje STVARNA rezerva:** 06:00 UTC = 07/08 lokalno ≥ 6 (default) i,
  ako GH Actions nije poslao tog jutra, prolazi gate i šalje; ako je GH već poslao,
  `zadnje_slanje_datum = danas` ga preskoči. Fail-safe bez DST-kalkulacije.

**Preostali rizici:**
- **Dupli run u istoj minuti** (GH + Vercel prije nego iko upiše datum): idempotencija
  (`uq_podsjetnici_termin_dana`) spriječi dvostruko slanje; drugi run najviše pošalje 0 novih.
- **Cijeli dan bez ijednog tika** (GH i Vercel oba padnu 24h): taj dan se preskoči; pre-due
  pragovi se saniraju narednog dana (catch-up prozor), post-due za taj dan se ne replayuje
  (naredni dan emituje svoj marker). Prihvatljivo za dnevne podsjetnike.

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

**A) Postavke → Email podsjetnici** (admin; `postavke_wr = je_admin()` + `zahtijevajAdmina()` guard):
- **Vrijeme slanja** — `Select` 0–23 („07:00"…), napomena „šalje se u prvom satu ≥ izabranog,
  po lokalnom vremenu (Sarajevo)". Akcija `updateVrijemeSlanja(sat)` — SSR klijent, `zahtijevajAdmina()`.
- **Globalni prekidač „Šalji podsjetnike i firmama"** (`salji_klijentima`) uz upozorenje da
  mailovi izlaze van TehPro-a. Akcija `updateSaljiKlijentima(bool)` — SSR klijent, `zahtijevajAdmina()`.

**B) Postavke → novi pregled „Ko šta prima"** (admin-only stranica, read-only):
- Tabela red-po-firmi: **Dodijeljeni radnici** (iz `korisnik_klijent`, samo `prima_podsjetnike`),
  **Firma prima?** (badge da/ne po per-firma flagu I globalnom), **Adrese firme** (`podsjetnik_emails`).
- **Implementacija = obrazac `KorisniciTab`:** server komponenta sa paralelnim `select`-ovima
  (`postavke`, `korisnici` filter `prima_podsjetnike`, `korisnik_klijent`, `klijenti`), spojeno u
  JS. **Bez novog view-a/RPC-a** (izbjegava `security_invoker` footgun); RLS se primjenjuje kroz
  SSR klijent, a stranica je admin-gated. Ako bi se ikad uveo view, MORA `set (security_invoker = on)`.

**C) Stranica firme `klijenti/[id]` → novi tab `"podsjetnici"`:**
Tab ima dvije zone sa **različitim pravom pristupa** — RLS to nalaže, pa se ne smije objediniti:

- **Zona 1 — per-firma slanje (admin + operater sa pristupom):** toggle `salji_podsjetnik_klijentu`
  + editor liste `podsjetnik_emails` (dodaj/ukloni, validacija `EMAIL_RE`). Akcija
  `updateKlijentPodsjetnici(klijentId, {salji, emails})` — **SSR klijent** (RLS `klijenti_upd`
  = `ima_pristup_klijentu(id) and not je_pregled()` primjenjuje pravo). Operater ne može „pustiti"
  mailove sam jer globalni `salji_klijentima` (admin-only) i dalje mora biti uključen.
- **Zona 2 — dodjela radnika firmi (SAMO admin):** lista radnika sa kvačicama „dodijeljen".
  Akcija `postaviDodjeleZaKlijenta(klijentId, korisnikIds[])` — **mora vjerno preslikati
  `postaviDodjele`: `zahtijevajAdmina()` guard + service-role admin klijent**, jer je `kk_wr`
  = `je_admin()` (SSR upis operatera bi RLS odbio). Ova zona je **skrivena/onemogućena za
  ne-admina**. **`kk_wr` se NE olabavljuje.**

**Sinhronizacija:** „Postavke → Korisnici → dodjela" i „Firma → dodjela radnika" pišu **istu**
`korisnik_klijent` tabelu (obje admin-only); pregled „Ko šta prima" je izvedeni prikaz nad njom
+ firminim adresama. Jedan izvor istine, bez kopiranja.

**i18n:** svi novi stringovi u `sr/en/de`; novi tab u `klijenti.tabs` + `VALID_TABS`.

### 5. Testovi

**Unit (Vitest, `lib/**/*.test.ts`):**
- `gating.test.ts` — `lokalniSatIDatum` + `trebaSlatiSada`: sat < izabrani → false; sat ≥
  izabrani i nije slato danas → true; `zadnje_slanje_datum == danas` → false (jednom dnevno);
  DST granica (isti UTC → drugi lokalni sat/datum ljeti/zimi); spring-forward preskočeni sat
  (izbor 02, prvi tik 03 → true); ponoć (24→0); ubačeni `now`+TZ.
- `recipients.test.ts` (proširenje): (1) `salji_klijentima=false` → firmine adrese nikad;
  (2) oba `true` + neprazna lista → dodate; (3) per-firma `false` uz globalni `true` →
  preskočena; (4) dedupe firmina==interna; (5) prazna lista → nema praznog slanja;
  (6) nevalidna adresa → odbačena.

**E2E (Playwright, cloud DEMO, postojeći obrazac):**
- Postavke: promjena sata + globalnog togglea se sačuva i prikaže.
- Firma: per-firma toggle + dodavanje/uklanjanje adrese (operater-put); dodjela radnika sa
  strane firme (admin-put) se odrazi u „Postavke → Korisnici" (dvosmjerni sync).
- Regresija: POST „Pokreni sada" radi bez obzira na sat/datum.
- **Izolacija (obavezno):** DEMO ima **živi RESEND_API_KEY** (procuri kroz merge `.env.local`),
  a `postavke` je **dijeljeni single-row (id=1)**. Zato: svaki POST run ide sa `dryRun: true`
  (`drySend`); novi eksterni prekidači (`salji_klijentima`, `salji_podsjetnik_klijentu`) se
  nakon testa **vraćaju na `false`**; toggle vrijednosti se restauriraju (kao postojeći
  `06-podsjetnici` spec). Bez ovoga test može poslati stvarni email van TehPro-a.

## Rollout redoslijed (fail-safe)

1. **Migracija lokalno:** `pnpm db:reset`.
2. **Regen tipova iz LOKALNOG stack-a:** `db:types` po defaultu čita aktivni `DATABASE_URL` iz
   `.env.local` = **PROD** (`fqtqkehjidkzeasiegnq`), pa bi regenerisao stare tipove. Prije
   `pnpm db:types` privremeno aktivirati lokalni URL (odkomentarisati liniju
   `DATABASE_URL=postgresql://postgres:...@127.0.0.1:54322/postgres`, zakomentarisati PROD),
   ili pozvati `supabase gen types --db-url <lokalni-pooler>` direktno. Vratiti `.env.local`.
3. **DEMO cloud:** `DATABASE_URL="$DATABASE_URL_DEMO" pnpm db:apply-cloud supabase/migrations/<fajl>.sql`
   (shell-set `DATABASE_URL` **nadjačava** `--env-file=.env.local`; goli `pnpm db:apply-cloud`
   ide na PROD!).
4. **PROD cloud:** `pnpm db:apply-cloud supabase/migrations/<fajl>.sql` — **provjeri ref
   (`fqtqkehjidkzeasiegnq`) prije pokretanja** (svjestan PROD upis).
5. **Deploy koda + GH Actions ZAJEDNO:** engine + gate + UI se deployuju, a GH Actions workflow
   + Secrets se ožiče u istom prozoru, tako da hourly okidač postoji čim gate stupi na snagu.
   (I da GH Actions kasni, Vercel 06:00 UTC = 07/08 lokalno ≥ 6 prolazi „≥ + jednom dnevno"
   gate, pa ne postoji prozor u kojem ništa ne šalje.)
6. Verifikacija: `Pokreni sada` (dry) po instanci; potvrda da gate propušta na/nakon izabranog
   sata i tačno jednom dnevno.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, ciljani e2e — sve zeleno prije merge-a.

## Van obima (YAGNI)

- Minutna granularnost vremena (cron je ionako hourly).
- Slanje na kontakt osobe / lokacijske adrese (biramo eksplicitnu `podsjetnik_emails` listu).
- Per-radnik izbor „u koje vrijeme" (vrijeme je per-instanca, ne per-korisnik).
- Nadogradnja na Vercel Pro (GitHub Actions pokriva potrebu besplatno).
- Olabavljivanje `kk_wr` RLS-a da operater dodjeljuje radnike (ostaje admin-only).

## Izmjene nakon adversarijalnog reviewa (v2)

Review (6 dimenzija, verifikacija svakog nalaza protiv koda) → 19 potvrđenih. Ugrađeno:
- **Semantika sata „== " → „≥ + jednom dnevno"** (`zadnje_slanje_datum`) — rješava DST
  spring-forward preskok, GH Actions kašnjenje, i oživljava Vercel cron kao stvarnu rezervu.
- **DEMO migracija:** `DATABASE_URL="$DATABASE_URL_DEMO" pnpm db:apply-cloud` (goli poziv = PROD).
- **`db:types`** eksplicitno iz lokalnog stack-a (default gađa PROD `DATABASE_URL`).
- **RLS/pristup na tabu firme:** dodjela radnika je admin-only (service-role + `zahtijevajAdmina`),
  per-firma toggle/adrese operater-put (SSR + `klijenti_upd`); `kk_wr` se ne dira.
- **„Ko šta prima"** = `KorisniciTab` obrazac (paralelni select), bez novog view-a/RPC-a.
- **Default 6** = 06:00 lokalno (ne „očuvano" 06:00 UTC) — prose ispravljen.
- **E2E izolacija:** `dryRun:true` + restauracija dijeljenog single-row-a i eksternih prekidača.
- **CLAUDE.md** „no crons array yet" je zastarjela (cron je ožičen) — repo-doc follow-up, van speca.
