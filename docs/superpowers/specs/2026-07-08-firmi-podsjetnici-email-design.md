# Firmi-prilagođeni podsjetnici (email) — design

**Datum:** 2026-07-08
**Grana:** `feat/firmi-podsjetnici-email`

## Problem

Reminder engine šalje **jedan** mejl po roku svim primaocima u jednoj `to` listi
(`lib/reminders/recipients.ts:84`): Tehpro admini + dodijeljeni radnici + firmine
adrese zajedno. Posljedice za firmu (klijenta):

1. **Interna dugmad** („Otvori termin" → `/plan-aktivnosti`, „Otvori klijenta" →
   `/klijenti/{id}`) vode iza login-a — firma ih ne može otvoriti.
2. **Brend „Demo"** u tijelu (iz `NEXT_PUBLIC_APP_NAME`) — neprofesionalno za klijenta.
3. **Zajednički `to`** — firma i Tehpro interne adrese se vide međusobno (nema odvajanja).

Interni mejl (radnicima/adminima) je dobar kakav jeste.

## Cilj

Firma dobija **zaseban, klijentu-primjeren mejl**: bez internih dugmadi, fiksni TEHPRO
brend (nezavisno od `APP_NAME`), kratak potpis/kontakt. Interni mejl ostaje nepromijenjen.

## Odluke (potvrđene)

- **Izgled firminog mejla:** lagana varijanta — isti layout, minus dugmad, plus TEHPRO brend/potpis.
- **Brend/kontakt:** kroz env varijable (default TEHPRO), da radi i na demo i na pravom TEHPRO deploymentu bez hardkodiranja.
- **Idempotencija:** kolona `podsjetnici.kanal` (`interni`|`firma`) + unique `(termin_id, dana_prije, kanal)`.
- **Pragovi:** firme koriste iste `postavke.dana_prije` kao interni (bez zasebne konfiguracije).
- **Dupli primalac:** kanali su nezavisni — adresa koja je i radnik i firma dobija **oba** mejla (u produkciji firmini kontakti ≠ osoblje, pa je preklapanje rijetko; u demu korisno za poređenje varijanti).

## Komponente

### 1. Env config — `lib/env.ts`
Nove **opcione** varijable (zod, sa defaultima; ne ruše boot ako fale):
```
FIRM_BRAND_NAME     (default "TEHPRO")
FIRM_BRAND_TAGLINE  (default "Zaštita na radu i zaštita od požara")
FIRM_CONTACT_EMAIL  (opciono)
FIRM_CONTACT_PHONE  (opciono)
FIRM_CONTACT_WEB    (opciono)
```
Dodati i u `.env.local.example`. Potpis prikazuje samo popunjena polja.

### 2. Firmin template — `lib/email/templates.ts`
Nova funkcija `reminderHtmlFirma(args, locale)`:
- Isti „bulletproof" table layout kao `reminderHtml`.
- **Bez** `dugmadBlok`-a (nema `terminUrl`/`klijentUrl`).
- Header i footer koriste `FIRM_BRAND_*` (ne `APP_NAME`).
- Footer/potpis: `{FIRM_BRAND_NAME} — {FIRM_BRAND_TAGLINE}` + linija kontakata (email · telefon · web), samo popunjeni.
- Sadržaj: badge (rok/kašnjenje · dana), Rok dospijeća, Vrsta/Klijent/Lokacija — isti kao sad.
- `reminderSubject` ostaje isti (subject je neutralan, radi i za firmu).

Zadržati zajedničku logiku (badge, redovi, boje) u internom helperu da se ne duplira između `reminderHtml` i `reminderHtmlFirma`.

### 3. Razdvajanje primalaca — `lib/reminders/recipients.ts`
- `recipientsForKlijent` **više ne uključuje firmine adrese** — vraća samo interne
  (dodijeljeni ∪ admini ∪ `REMINDER_TO` base).
- Nova `firmaRecipientsForKlijent(index, klijentId)` → vraća samo firmine adrese
  (`klijentEmailsByKlijent`) — prazno ako global prekidač / per-firma isključen ili nema adresa.
- `buildRecipientIndex` ostaje (već drži `klijentEmailsByKlijent` odvojeno).

### 4. Slanje — `lib/reminders/runReminders.ts`
Po redu (terminu):
1. **Interni kanal:** ako ima internih primalaca → `reminderHtml` (sa dugmadima, `APP_NAME` brend) → `send({ to: interni, ... })` → audit `kanal='interni'`.
2. **Firmin kanal:** ako `firmaRecipients` nije prazan → `reminderHtmlFirma` (bez dugmadi, TEHPRO brend) → `send({ to: [noreply/from], bcc: firmaAdrese, ... })` → audit `kanal='firma'`.

- **BCC:** firmin mejl šalje firmine adrese kroz **BCC** (`to` = sender/no-reply adresa iz `EMAIL_FROM`), da se adrese ne vide. Zahtijeva proširenje `SendArgs`/`sendEmail` (`lib/email/resend.ts`) sa opcionim `bcc`.
- Idempotencija po kanalu: `insert podsjetnici {termin_id, dana_prije, kanal, poslat_na, resend_id}`; duplikat (unique) → skip „vec poslat".
- Dry-run i „nema RESEND_API_KEY" → kao sad, bez audit upisa.
- Throttling/cap (`maxPerRun`, batch) ostaje; sada broji **slanja** (interni + firmin su dva slanja).

### 5. Migracija — `supabase/migrations/<ts>_podsjetnici_kanal.sql`
```sql
alter table podsjetnici add column kanal text not null default 'interni'
  check (kanal in ('interni','firma'));
drop index if exists uq_podsjetnici_termin_dana;   -- unique INDEX (termin_id, dana_prije), iz 20260621
create unique index uq_podsjetnici_termin_dana_kanal
  on podsjetnici (termin_id, dana_prije, kanal);
```
Postojeći redovi → `kanal='interni'` (default). Regenerisati `db/types.ts`.
Primjena: local → DEMO → PROD (redom, `db:apply-cloud`, uz DEMO/PROD guard).

## Testiranje

- **Unit (`lib/reminders/recipients.test.ts`):** `recipientsForKlijent` bez firminih adresa; `firmaRecipientsForKlijent` samo firmine + gejtovanje (global/per-firma/prazno).
- **Unit (`lib/email/templates`):** `reminderHtmlFirma` — nema `href` ka `/plan-aktivnosti`/`/klijenti`, sadrži `FIRM_BRAND_NAME`, ne sadrži `APP_NAME` u headeru.
- **Unit (`runReminders.test.ts`):** dva kanala za firmu-primaoca; samo interni kad firma isključena; idempotencija po kanalu.
- **Dry-run na DEMO:** potvrdi dva kanala za Drina (interni + firma).
- **Live na DEMO:** firmin mejl na `nmil32@icloud.com` (poređenje sa internim).

## Van opsega (YAGNI)

- Zasebni pragovi za firme.
- Cross-dedup istih adresa između kanala.
- Promjena `APP_NAME` globalno (interni mejl i dalje koristi `APP_NAME`).
- Redizajn internog mejla.

## Task 1 (odvojeno, bez koda): render trenutnog mejla
Prije implementacije: generisati HTML trenutnog `reminderHtml` **sa** `baseUrl` (produkcijska
verzija sa dugmadima) i objaviti kao Artifact — vizuelna „before" referenca.
