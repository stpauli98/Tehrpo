# Zakazivanje po datumu + obavještenje o probijanju roka

**Datum:** 2026-07-10
**Grana:** `feat/plan-zakazani-datum`
**Status:** odobren dizajn (brainstorming), čeka plan implementacije

## Problem

Termin ima dva datuma: `rok_dospijeca` (rok — auto-računat, osnov za `kasni` i
podsjetnike) i `datum_zakazan` (kad je izvršenje stvarno zakazano). Sva tri
prikaza plana (`kalendar`, `lista`, `matrica`) pozicioniraju/sortiraju termin
**isključivo po `rok_dospijeca`**. Zato termin zakazan za 15.07. (rok 13.07.) u
kalendaru sjedi na 13.07., a ne na 15.07.

Korisnik smije zakazati **poslije** roka (nema DB ograničenja), ali trenutno
ništa ga ne upozori na to dok rok stvarno ne prođe (`StatusBadge` "zak." oznaka
se pali tek kad `status_izvedeni === "kasni"`).

## Cilj

1. Termin sa `datum_zakazan` prikazuje se u sva tri prikaza na **zakazanom
   datumu**; termin bez zakazanog datuma ostaje na roku.
2. Kad je `datum_zakazan > rok_dospijeca`: (a) **živo upozorenje u formi** i
   (b) **email odmah pri čuvanju** internim primaocima.

Rok ostaje istina u bazi i osnov za `kasni`/podsjetnike — mijenja se samo
**gdje se termin pozicionira** u prikazima.

## Arhitektura — jedan izvor istine: `datum_prikaza`

Nova računata kolona u `termini_view`:

```sql
coalesce(t.datum_zakazan, t.rok_dospijeca) as datum_prikaza
```

Pravilo važi za **sve statuse** (uključujući `izvrseno`/`otkazano`) — jedno
prosto pravilo, bez uslovnog `CASE`.

**Zašto kolona u view-u (a ne coalesce po prikazu):**
- Jedan izvor istine za sva tri prikaza + njihove API rute.
- PostgREST filtrira/sortira direktno: `.gte/.lte/.order("datum_prikaza")`.
- Mjesečni prozor kalendara/matrice radi ispravno i kad je zakazan datum u
  **drugom mjesecu** od roka (rok 31.07, zakazan 02.08 → termin se pojavi u
  augustu). Coalesce-u-JS to ne rješava jer bi upit i dalje dohvaćao po roku.

`status_izvedeni` se **ne mijenja** (`kasni` kad `rok_dospijeca < current_date`).
Posljedica: termin zakazan poslije roka sjedi na zakazanom datumu i, kad rok
stvarno prođe, tačka/badge postane crvena (`kasni`). To je poželjno — i dalje
signalizira kašnjenje.

### Migracija

- `klijenti_view` zavisi od `termini_view` → migracija rekreira **oba**
  (obrazac već postoji u `20260630120000_nacin_izvrsenja.sql`). Zadržati
  `security_invoker = on` na oba.
- Poslije: `pnpm db:types` (regeneriše `db/types.ts`, dodaje `datum_prikaza`
  u tip `termini_view` Row).
- Primjena: local → DEMO → PROD (cloud preko `pnpm db:apply-cloud <file>`,
  ref-guard za PROD).

## Promjene u prikazima

Kalendar i lista već rade `select("*")` → `datum_prikaza` dolazi besplatno,
mijenja se samo `.order`/`.gte`/`.lte`. Matrica bira eksplicitne kolone →
dodati `datum_prikaza` u select.

- **Kalendar** — `_views/kalendar.tsx`: grupisanje po `termin.datum_prikaza`
  (trenutno linija 59: `rok_dospijeca.slice(0,10)`). `?dan` sidebar filter isto.
  `kalendar/route.ts`: mjesečni prozor `.gte/.lte("datum_prikaza")`,
  `.order("datum_prikaza")`.
- **Lista** — `lista/route.ts`: `.order("datum_prikaza")`. Tabela (`TerminiTable`):
  zadržati kolonu roka + prikazati "zakazan" datum kad postoji (mala dorada, da
  se vidi razlika rok vs zakazan).
- **Matrica** — `matrica.tsx`: `dan`/`columnKey` iz `datum_prikaza`
  (trenutno linije 68, 81–82 iz `rok_dospijeca`). `matrica/route.ts`: dodati
  `datum_prikaza` u select, mjesečni i godišnji prozor po `datum_prikaza`.

**Konzistentnost API↔SC:** ako neka server-komponenta zrcali isti upit
(CLAUDE.md napomena o `plan-aktivnosti`), ažurirati oba.

## Živo upozorenje pri zakazivanju (client-side)

U **`TerminSheet`** i **`NoviTerminButton`**: čim izabrani `datum_zakazan > rok`,
ispod polja se pokaže non-blocking upozorenje, npr.:

> ⚠ Zakazano N dana poslije roka (13.07.). Dozvoljeno — biće poslano obavještenje.

Oba forma već imaju oba datuma na klijentu (`termin.rok_dospijeca`; u novom
terminu i rok i zakazan su u istoj formi) → nema round-tripa. Čuvanje **nije
blokirano**. Čista funkcija `jeZakazanoPoslijeRoka(rok, zakazan)` u `lib/` (ISO
leksikografsko poređenje), unit-testirana, koristi je i klijent i server.

## Transakcijski email (server action)

`updateTermin` i `createTermin`, **nakon** uspješnog upisa, ako
`datum_zakazan > rok_dospijeca`:

- `updateTermin` već dohvaća trenutni red radi status-sync — proširiti taj
  `select` da uzme i `rok_dospijeca`. `createTermin` ima oba iz forme.
- Novi modul `lib/reminders/zakazanoNakonRoka.ts`:
  - Učita red iz `termini_view` (klijent, vrsta, lokacija, rok, zakazan).
  - Sagradi **interni** kanal primalaca (admini + korisnici dodijeljeni
    klijentu + `REMINDER_TO`) reupotrebom `buildRecipientIndex` /
    `recipientsForKlijent`. **Nikad klijentu** (nema "firma" kanala).
  - Novi email template (subject + html), pošalje preko `sendEmail`
    (`drySend` bez `RESEND_API_KEY`).
- **Idempotencija:** SECURITY DEFINER RPC atomično "zauzme" par
  `(termin_id, datum_zakazan)` u novoj audit tabeli `termin_zakazano_obavijest`
  (`insert ... on conflict do nothing`, vraća da li je red novoubačen). Email
  ide **samo ako** je zauzimanje uspjelo:
  - Ponovni save istog zakazanog datuma → bez ponovnog maila.
  - Promjena na novi datum-poslije-roka → novi mail.
  - RPC jer server action radi kao korisnik (RLS), ne service-role.
- **Best-effort:** greška slanja se loguje i **nikad ne obara** čuvanje termina
  (wrap u try/catch, poslije DB update-a).
- `ActionResult` `{ok:true}` proširiti na `{ok:true, upozorenje?: string}` da
  forma po potvrdi može prikazati notice (uz živo klijentsko upozorenje).

### Redoslijed (best-effort, bez lažnog audita)

1. DB update/insert termina → ako padne, vrati grešku (kao sad).
2. Ako `datum_zakazan > rok`: pozovi RPC "claim".
3. Ako je claim novo → pošalji email; ako slanje padne, loguj (claim ostaje,
   ne pokušavamo ponovo — best-effort). Ako claim nije novo → preskoči.

## Rubni slučajevi

- **izvršeni/otkazani sa `datum_zakazan`:** isto pravilo (coalesce) → sjede na
  zakazanom. Prihvaćeno (najjednostavnije jedno pravilo).
- **zakazan u drugom mjesecu/godini od roka:** riješeno kolonom `datum_prikaza`
  (upit dohvaća po prikaznom datumu).
- **`datum_zakazan == rok`:** nije "poslije roka" → nema upozorenja/maila.
- **nema eligibilnih primalaca:** email se preskače (kao u `runReminders`), save
  svejedno prolazi.

## Testiranje

- **Unit:** `jeZakazanoPoslijeRoka(rok, zakazan)`; mapiranje `datum_prikaza` u
  matrici (bucketing po prikaznom datumu). Postojeći recipient testovi pokrivaju
  primaoce.
- **E2E:** proširiti `22-kasni-zakazano.spec.ts`:
  - (a) kalendar pozicionira zakazani termin na `datum_zakazan`, ne na rok.
  - (b) upozorenje se pojavi u formi kad se zakaže poslije roka.
  - Email: dry-run (bez ključa), provjera da audit red nastane.

## Dodirne tačke (fajlovi)

- `supabase/migrations/<ts>_datum_prikaza_i_zakazano_obavijest.sql`
  (rekreacija `termini_view`+`klijenti_view`, tabela `termin_zakazano_obavijest`,
  RPC claim)
- `db/types.ts` (regen)
- `app/api/plan-aktivnosti/{kalendar,lista,matrica}/route.ts`
- `app/(dashboard)/plan-aktivnosti/_views/{kalendar,matrica}.tsx`
- `components/domain/{TerminSheet,NoviTerminButton,TerminiTable}.tsx`
- `app/(dashboard)/termini/actions.ts` (+ `ActionResult`)
- `lib/termini.ts` ili novi `lib/plan-datum.ts` (`jeZakazanoPoslijeRoka`)
- `lib/reminders/zakazanoNakonRoka.ts` (novi), `lib/email/templates.ts` (novi template)
- `messages/{sr,en,de}.json` (upozorenje + email tekstovi, key-parity, bez ICU `one` za sr)
- `tests/e2e/22-kasni-zakazano.spec.ts`, novi unit test(ovi)

## Van opsega (YAGNI)

- Trajna vizuelna oznaka "rok probijen" svugdje (korisnik nije tražio).
- Poseban filter/popis "zakazano poslije roka".
- Integracija u reminder engine / cron (izabran je transakcijski email).
- Pozicioniranje izvršenih po `datum_izvrsenja`.
