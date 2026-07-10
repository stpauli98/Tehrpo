# Podsjetnici → primaoci iz kontakata firme — dizajn

**Datum:** 2026-07-09
**Grana:** `feat/podsjetnici-primaoci-iz-kontakata`
**Status:** dizajn odobren u brainstormingu; čeka pregled speca

## Cilj

Kad se firmi šalje podsjetnik (Kanal 2 / „Krug 2"), primaoci se **biraju iz već sačuvanih
kontakata te firme** (`kontakt_osobe`), a ne kucaju ručno svaki put. Korisnik u tabu
**Podsjetnici** vidi kontakte firme i samo ih **čekira**. Nema više ručnog unosa mejla i nema
odvojene liste adresa — **jedan izvor istine** je `kontakt_osobe`.

Ako neko nije među kontaktima, **ne može se izabrati**; da bi ga dodao, korisnik ode u tab
**Kontakt**, doda kontakt (s mejlom), pa ga onda čekira u Podsjetnici. Standardizovano i
intuitivno, bez dvostrukih izvora podataka.

**Ovaj dizajn zamjenjuje raniju odluku iz `2026-07-07-podsjetnici-v2-design.md`** (§ Van obima:
„Slanje na kontakt osobe … biramo eksplicitnu `podsjetnik_emails` listu"). Ta lista se sada
ukida u korist izbora iz kontakata.

## Kontekst (zatečeno stanje)

- **Kontakti firme:** tabela `kontakt_osobe` (migr. `20260627120200_kontakt_osobe.sql`):
  `id, klijent_id → klijenti(id) on delete cascade, ime (not null), funkcija, telefon,
  email (nullable), created_at`. Index `idx_kontakt_osobe_klijent (klijent_id)`. RLS scoped
  kroz `ima_pristup_klijentu(klijent_id)`. **Kontakt već ima `email` polje.**
  - CRUD: `app/(dashboard)/klijenti/actions.ts` — `kontaktFields` (:399–404), `createKontakt`
    (:409), `updateKontakt` (:422), `deleteKontakt` (:435).
  - UI: `components/domain/KontaktSheet.tsx` (dodaj/uredi), `KontaktiKlijentList.tsx` (lista),
    `IdKartaTab.tsx` (prikaz na id-karti). Fetch na stranici: `klijenti/[id]/page.tsx:115–116`
    (`from("kontakt_osobe").select("*").eq("klijent_id", id).order("ime")`), samo za tabove
    `id-karta`/`kontakti`.
- **Firmin kanal danas (odvojen od kontakata):** primaoci se čuvaju u
  `klijenti.podsjetnik_emails text[]` (migr. `20260621171350`), gated per-firma prekidačem
  `klijenti.salji_podsjetnik_klijentu` (migr. `20260708120000`) i globalnim
  `postavke.salji_klijentima` (isti fajl). **Nikakve veze sa `kontakt_osobe`** — mejl se kuca
  ručno.
  - UI unosa: `components/domain/KlijentPodsjetniciTab.tsx` (fetch :13
    `select("salji_podsjetnik_klijentu, podsjetnik_emails")`) → `KlijentPodsjetniciForm.tsx`
    (chip `Input type=email` :82–84; `dodaj()` :33–41; `spasi()` :25–31; toggle checkbox :50–58).
  - Akcija: `app/(dashboard)/klijenti/[id]/actions.ts` `updateKlijentPodsjetnici(klijentId,
    salji, emails)` (:12–28) → `update({salji_podsjetnik_klijentu, podsjetnik_emails}).eq("id",…)`.
  - Sekundarni unos: `KlijentEditForm.tsx:156–162` (comma-separated tekst polje
    `name="podsjetnik_emails"`) → `updateKlijent` (`klijenti/actions.ts:107–116`).
  - Admin pregled: `KoStaPrimaTab.tsx` čita `salji_klijentima` + per-firma flag/adrese (:19–21),
    računa `firmaPrima` (:40).
- **Engine (`lib/reminders/`):**
  - `runReminders.ts` :44–50 čita `postavke.salji_klijentima`; :68–71 čita `klijenti
    (id, salji_podsjetnik_klijentu, podsjetnik_emails)`; :72–77 `buildRecipientIndex`;
    Kanal 2 (:135–141) šalje firmine adrese u **BCC** (`reminderHtmlFirma`), audituje
    `kanal:"firma"`; Kanal 1 (interni) je odvojen i nepromijenjen.
  - `recipients.ts`: `KlijentReminderRow` (:34–38) = `{id, salji_podsjetnik_klijentu,
    podsjetnik_emails}`; `buildRecipientIndex` (:47–78) puni `klijentEmailsByKlijent` samo kad
    `saljiKlijentima && salji_podsjetnik_klijentu`, adrese kroz `EMAIL_RE`;
    `firmaRecipientsForKlijent` (:87–98) dedupe+validacija.
  - RPC `get_due_podsjetnici` **ne vraća** mejlove — engine ih traži zasebno. RPC ostaje
    nepromijenjen.
- **Stranica firme:** `klijenti/[id]/page.tsx` ima tab `podsjetnici` (uveden u v2), `VALID_TABS`
  na :30. RLS: `klijenti_upd = ima_pristup_klijentu(id) and not je_pregled()`.
- **PROD stvarno stanje (read-only analiza 2026-07-09):** 5 firmi, **1 kontakt ukupno**
  (ima mejl), **2 firme** imaju `podsjetnik_emails` (po 1 unos), **0 se poklapa** s kontaktom,
  2 orphan: `CARMEUSE → dzonifu@gmail.com`, `WAIKIKI → sef@firma.com`. Globalno slanje UKLJUČENO;
  1 firma ima per-firma slanje uključeno. → migracija dira **2 reda**, bez rizika po obimu.

## Odluke (iz brainstorminga)

| Pitanje | Odluka |
|---|---|
| Izvor primalaca | **Isključivo `kontakt_osobe`** — biraš iz sačuvanih kontakata firme |
| Ad-hoc / quick-add u Podsjetnici tabu | **Ne** — novi primalac se dodaje u tabu Kontakt pa čekira |
| Šta se čuva kao izbor | **Referenca na kontakt** (boolean flag na kontaktu), **ne kopija mejla** |
| Model | **`kontakt_osobe.podsjetnik_primalac boolean`** — bez nove tabele (kontakt već pripada tačno jednoj firmi) |
| Mejl u trenutku slanja | Čita se **aktuelni** `kontakt_osobe.email` → uvijek svjež; promjena mejla se automatski prati |
| Per-firma prekidač `salji_podsjetnik_klijentu` | **Ostaje** (pauza slanja bez gubljenja izbora) |
| Globalni `postavke.salji_klijentima` | **Ostaje** (master) |
| `klijenti.podsjetnik_emails` | **Ukida se** nakon migracije |
| Kontakt bez mejla | Prikazan u listi ali **disabled** (ne može se čekirati), s naznakom „nema email" |
| Orphan mejlovi pri migraciji | **Napraviti kontakt od svakog** (`ime=mejl`, `email=mejl`, `podsjetnik_primalac=true`) |

**Zašto boolean na kontaktu, a ne veza-tabela:** `kontakt_osobe.klijent_id` znači da kontakt
pripada tačno jednoj firmi, a izbor je na nivou firme (ne po-terminu). Flag na redu je najjednostavniji
model: nema praznih/orphan redova, briše se automatski s kontaktom (FK cascade), nema nove RLS
politike (izbjegava „nova tabela = 0 redova" footgun), i prati postojeći stil (`salji_podsjetnik_klijentu`
je i sam boolean na redu).

## Arhitektura

### 1. Model podataka (expand/contract — dvije migracije)

`drop column podsjetnik_emails` **nije unazad-kompatibilan**: ako se pusti prije nego novi kod
ode u deploy, stari kod (cron engine, `KlijentEditForm`) čita nepostojeću kolonu i puca; a novi
kod se ne može ni kompajlirati dok tipovi ne odraze novu šemu. Zato **expand/contract** — dodavanje
i migracija podataka su unazad-kompatibilni (stara kolona ostaje), a brisanje je zaseban korak
nakon što je novi kod svuda živ. Nema prozora rušenja.

**Migracija A (expand)** `supabase/migrations/<ts>_kontakt_podsjetnik_primalac.sql` — u jednoj
transakciji; **`podsjetnik_emails` OSTAJE** (stari kod i dalje radi):

```sql
begin;

-- 1) po-kontakt flag: „ovaj kontakt prima podsjetnike firme"
alter table kontakt_osobe
  add column podsjetnik_primalac boolean not null default false;

-- 2a) postojeći kontakt čiji se mejl poklapa s podsjetnik_emails svoje firme → flag
update kontakt_osobe ko
set podsjetnik_primalac = true
from klijenti k
where ko.klijent_id = k.id
  and ko.email is not null
  and lower(btrim(ko.email)) = any (
    select lower(btrim(e)) from unnest(k.podsjetnik_emails) e where btrim(e) <> ''
  );

-- 2b) orphan mejl (nema kontakta) → napravi kontakt (odluka iz brainstorminga)
insert into kontakt_osobe (klijent_id, ime, email, podsjetnik_primalac)
select k.id, lower(btrim(e)), lower(btrim(e)), true
from klijenti k
cross join lateral unnest(k.podsjetnik_emails) e
where btrim(e) <> ''
  and not exists (
    select 1 from kontakt_osobe ko
    where ko.klijent_id = k.id
      and ko.email is not null
      and lower(btrim(ko.email)) = lower(btrim(e))
  );

commit;
```

**Migracija B (contract)** `supabase/migrations/<ts+1>_drop_klijenti_podsjetnik_emails.sql` —
pušta se **tek nakon** što je novi kod deployan na sve instance (stari kod više ne referiše kolonu):

```sql
alter table klijenti drop column podsjetnik_emails;
```

- `salji_podsjetnik_klijentu` (klijenti) i `salji_klijentima` (postavke) se **ne diraju** →
  postojeće ponašanje slanja se čuva red-po-red (firma koja je slala i dalje šalje istim
  osobama; firma sa `salji=false` i dalje ne šalje, ali su joj kontakti flagovani spremni).
- **Napomena o audit trigeru:** `2a`/`2b` su DML nad `kontakt_osobe` → okida `tg_audit()`.
  Migracija ide preko `pg` (postgres rola, bez `auth.uid()`), isto kao `pnpm seed` koji već
  ubacuje kontakte servisnom rolom. Pošto seed radi, `tg_audit` toleriše odsutan actor — ali
  **provjeriti prije PROD-a** (dry na lokalnom/DEMO). Ako bi padao, obaviti 2a/2b uz privremeno
  `alter table kontakt_osobe disable trigger user;` unutar iste transakcije.
- **`drop column` (Migracija B) je nepovratan** — pušta se tek nakon zelenog lokalnog + DEMO
  prolaza **i** živog novog koda na svim instancama.

Regen `db/types.ts` iz **lokalnog** stack-a nakon svake migracije (vidi Rollout). Nakon Migracije
A tipovi imaju **i** `podsjetnik_emails` **i** `podsjetnik_primalac` — novi kod (koji ne koristi
`podsjetnik_emails`) se uredno kompajlira; kolona samo miruje do Migracije B.

**Pravilo slanja firmi (invarijanta):** firma dobija email **samo ako**
`postavke.salji_klijentima = true` **I** `klijenti.salji_podsjetnik_klijentu = true` **I** firma
ima bar jedan kontakt sa `podsjetnik_primalac = true` i validnim `email`. Interni primaoci
(Kanal 1) se time nikad ne mijenjaju.

### 2. Engine (`lib/reminders/`)

RPC nepromijenjen. Umjesto `klijenti.podsjetnik_emails`, firmine adrese dolaze iz flagovanih
kontakata.

**`runReminders.ts`:**
- Fetch `klijenti` (:68–71) mijenja se u `select("id, salji_podsjetnik_klijentu")` (bez
  `podsjetnik_emails`).
- **Novi batch-fetch** `kontakt_osobe` → `select("klijent_id, email, podsjetnik_primalac")`
  filtrirano `.eq("podsjetnik_primalac", true).not("email","is",null)` (isti oprez oko tihe
  PostgREST trunkacije koji već stoji za druge liste; koristi paginaciju/limit provjeru kao
  postojeći kod).

**`recipients.ts`:**
- `KlijentReminderRow` → `{ id: string; salji_podsjetnik_klijentu: boolean }` (izbaci
  `podsjetnik_emails`).
- Novi ulaz `KontaktPrimalacRow = { klijent_id: string; email: string | null }` (već filtriran
  na `podsjetnik_primalac=true`).
- `buildRecipientIndex(korisnici, dodjele, klijenti, kontaktiPrimaoci, saljiKlijentima)` puni
  `klijentEmailsByKlijent` iz mejlova flagovanih kontakata, **samo** kad
  `saljiKlijentima === true` **I** `salji_podsjetnik_klijentu === true` za tu firmu; svaka
  adresa i dalje prolazi `EMAIL_RE`.
- `firmaRecipientsForKlijent` — potpis i ponašanje nepromijenjeni (čita mapu).

**Invarijanta + test:** `saljiKlijentima === false` → `klijentEmailsByKlijent` prazan →
identično današnjem. Firma bez ijednog flagovanog kontakta → prazna lista → nema slanja.

### 3. UI

**A) Tab firme `Podsjetnici` (`KlijentPodsjetniciTab.tsx` + `KlijentPodsjetniciForm.tsx`):**
- `KlijentPodsjetniciTab` fetch se mijenja: umjesto `podsjetnik_emails`, dohvata
  `salji_podsjetnik_klijentu` (klijent) **+ kontakte firme** (`kontakt_osobe` →
  `id, ime, funkcija, email, podsjetnik_primalac`, `order("ime")`).
- `KlijentPodsjetniciForm`:
  - **Prekidač** „Šalji podsjetnike ovoj firmi" (`salji_podsjetnik_klijentu`) — ostaje.
  - **Chip input za mejl se uklanja.** Umjesto njega **checklist kontakata**:
    - `☑/☐ Ime — email@…` (kontakt s mejlom; klik toggle-a, auto-snima).
    - `⊘ Ime — nema email` (kontakt bez mejla; disabled, naznaka + link „dodaj email u
      Kontaktima" → tab `kontakti`).
    - **Prazno stanje** (firma nema kontakata): poruka „Nema kontakata. Dodaj kontakt u tabu
      Kontakt da bi izabrao primaoce." + link na tab `kontakti`.
- Auto-snimanje po kliku (kao dosadašnji chip `spasi()`), sa `revalidatePath`.

**B) Akcije (`app/(dashboard)/klijenti/[id]/actions.ts`):**
- `updateKlijentPodsjetnici(klijentId, salji, emails)` se **razdvaja** na:
  - `updateKlijentSaljiPodsjetnik(klijentId, salji: boolean)` → `update({salji_podsjetnik_klijentu})
    .eq("id", klijentId)` (SSR klijent; RLS `klijenti_upd`).
  - `updateKontaktPodsjetnikPrimalac(kontaktId, klijentId, primalac: boolean)` →
    `update({podsjetnik_primalac}).eq("id", kontaktId).eq("klijent_id", klijentId)` (SSR klijent;
    RLS `kontakt_osobe` scoped kroz `ima_pristup_klijentu`). `klijentId` u uslovu je dodatni
    tenant-guard.
- Obje `revalidatePath` tab firme.

**C) `KlijentEditForm.tsx:156–162` — uklanja se polje `podsjetnik_emails`;** `updateKlijent`
(`klijenti/actions.ts:107–116`) prestaje parsirati/pisati `podsjetnik_emails` (kolona ne postoji).

**D) `KoStaPrimaTab.tsx` (admin pregled) — `firmaPrima` i „adrese firme" se računaju iz
flagovanih kontakata** (`kontakt_osobe` gdje `podsjetnik_primalac=true` + validan mejl), umjesto
iz `podsjetnik_emails`. Obrazac ostaje isti (paralelni `select`-i spojeni u JS; bez view/RPC).

**i18n:** novi/izmijenjeni stringovi u `sr/en/de` (naznaka „nema email", prazno stanje, link).
Bez novih tabova (tab `podsjetnici` već postoji).

### 4. RLS

- Nova kolona `kontakt_osobe.podsjetnik_primalac` **nasljeđuje** postojeću RLS tabele
  (`ima_pristup_klijentu(klijent_id)`); toggle je `UPDATE` → postojeća update-politika
  (`mozeUrediti`, tj. pristup + `not je_pregled()`) važi. Nema nove tabele → nema nove politike.
- `pregled` rola ostaje read-only (ne može čekirati).

## Testovi

**Unit (Vitest, `lib/**/*.test.ts`):** proširiti `recipients.test.ts`:
1. `saljiKlijentima=false` → firmine adrese nikad (default ponašanje).
2. oba `true` + firma ima flagovan kontakt s mejlom → adresa dodata.
3. per-firma `false` uz globalni `true` → firma preskočena.
4. flagovan kontakt **bez** mejla → ignorisan (nema praznog primaoca).
5. dedupe: flagovani kontakt-mejl == interni primalac → jednom.
6. nevalidan mejl kontakta → odbačen kroz `EMAIL_RE`.
7. dva flagovana kontakta iste firme → obje adrese.

**E2E (Playwright, cloud DEMO, postojeći obrazac):**
- Firma → tab Podsjetnici: čekiranje kontakta se sačuva i prikaže; kontakt bez mejla je disabled;
  prazno stanje kad firma nema kontakata.
- Dodaš kontakt u tabu Kontakt → pojavi se kao izbor u Podsjetnici (jedan izvor istine).
- Regresija: per-firma toggle i dalje radi; „Pokreni sada" (POST, dry) šalje flagovanim
  kontaktima.
- **Izolacija (obavezno, kao u v2 specu):** DEMO ima živi `RESEND_API_KEY` i dijeljeni
  single-row `postavke`; svaki run `dryRun:true` (`drySend`); eksterne prekidače
  (`salji_klijentima`, `salji_podsjetnik_klijentu`) i `podsjetnik_primalac` flagove vratiti na
  polazno stanje nakon testa. Bez ovoga test može poslati stvarni mejl van TehPro-a.

## Rollout redoslijed (fail-safe, expand/contract)

**Preduslov — enumerirati sve instance baze.** Repo opslužuje **3 Vercel projekta koji svi
deployuju s `main`** (memory „Vercel deploy topology"), svaki sa svojom Supabase bazom. Potvrđene:
PROD `fqtqkehjidkzeasiegnq`, DEMO `mtwwotmwrasozmcgqwhc`. **Treći projekat (demo-app) — prije
rollouta provjeriti ima li zasebnu bazu**; ako ima, obje migracije idu i na nju. Pošto se sve tri
instance deployuju istovremeno (merge u `main`), **Migracija A mora biti na SVIM instance bazama
prije merge-a**.

### Faza 1 — Expand + kod (unazad-kompatibilno)

1. **Migracija A lokalno:** `pnpm db:reset` (ili apply na lokalni stack). Dry-provjera da
   `tg_audit` ne pada pri 2a/2b.
2. **Regen tipova iz LOKALNOG stack-a:** `pnpm db:types` po defaultu čita `DATABASE_URL` iz
   `.env.local` = **PROD** (`fqtqkehjidkzeasiegnq`). Prije regena privremeno aktivirati lokalni
   URL (ili `supabase gen types --db-url <lokalni-pooler>`), pa vratiti `.env.local`. Sad tipovi
   imaju i `podsjetnik_emails` i `podsjetnik_primalac`.
3. **Implementirati kod** (engine + akcije + UI) protiv novih tipova. `pnpm lint`,
   `pnpm typecheck`, `pnpm test:unit`, ciljani e2e — sve zeleno lokalno.
4. **Migracija A na DEMO:** `DATABASE_URL="$DATABASE_URL_DEMO" pnpm db:apply-cloud
   supabase/migrations/<A>.sql` (shell-set `DATABASE_URL` **nadjačava** `--env-file=.env.local`;
   goli `pnpm db:apply-cloud` ide na PROD!). Verifikovati flagove/kontakte. DEMO nema
   `DATABASE_URL` u `.env.development.local` → koristi se DEMO pooler URL (`mtwwotmwrasozmcgqwhc`).
5. **Migracija A na PROD** (+ treću bazu ako postoji): `pnpm db:apply-cloud
   supabase/migrations/<A>.sql` — **provjeriti ref (`fqtqkehjidkzeasiegnq`) prije pokretanja**.
   Očekivano na PROD-u: 2 nova kontakta (CARMEUSE, WAIKIKI). `podsjetnik_emails` **ostaje** (stari
   kod na PROD-u i dalje radi).
6. **Merge → deploy** koda na sve tri instance. Novi kod sad koristi `podsjetnik_primalac`; kolona
   postoji na svim bazama (korak 4–5).
7. **Verifikacija na deployanom kodu:** `Pokreni sada` (dry) → firma prima na flagovane kontakte;
   per-firma i globalni prekidač i dalje gate-uju; tab Podsjetnici prikazuje checklist.

### Faza 2 — Contract (tek kad je novi kod živ svuda)

8. **Migracija B (drop)** — kad je potvrđeno da nijedna instanca više ne referiše
   `podsjetnik_emails`: apply na lokalni stack → regen tipova (lokalno) → DEMO → PROD (+ treća),
   svaka s ref-provjerom. `pnpm typecheck` potvrđuje da nema preostalih referenci.
9. Finalni `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, e2e — zeleno prije zatvaranja grane.

## Van obima (YAGNI)

- Izbor primalaca **po pojedinačnom terminu/podsjetniku** (ostaje per-firma).
- Quick-add / ad-hoc mejl direktno u Podsjetnici tabu (svjesno odbačeno — jedan izvor istine).
- Slanje na lokacijske kontakte (`lokacije.kontakt_email`) — van obima; ovdje su samo
  `kontakt_osobe`.
- Veza-tabela / M:N kontakt↔firma (kontakt pripada jednoj firmi).
- Bilo kakva izmjena Kanala 1 (interni primaoci) ili RPC-a `get_due_podsjetnici`.
