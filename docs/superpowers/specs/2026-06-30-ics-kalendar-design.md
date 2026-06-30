# `.ics` „Dodaj u kalendar" — prilog u podsjetnik-mejlu

**Datum:** 2026-06-30
**Status:** odobren dizajn → slijedi plan
**Kontekst:** Faza 1 traži (ako je moguće) sinhronizaciju termina s Outlook kalendarom. Pragmatičan put: svaki email-podsjetnik nosi **`.ics` prilog** → korisnik klikom dodaje termin u Outlook/Google/Apple kalendar. Nadovezuje se na već redizajniran reminder mejl.

## Obim
- Generator iCalendar teksta za jedan termin (čista funkcija, bez biblioteke).
- `.ics` prilog (`termin.ics`) u svakom reminder-mejlu.
- Cjelodnevni event na datum roka + alarm (VALARM) dan ranije.

## Van obima (zaseban posao)
- Dugme „Dodaj u kalendar" u dashboardu (download).
- Puna 2-smjerna Outlook/Graph API sinhronizacija.
- Vremenske zone / timed eventi (cjelodnevni event ih ne traži).
- Promjena logike motora (detekcija/rutiranje/throttling/idempotencija) — netaknuto.

## Postojeće stanje (potvrđeno)
- `lib/email/resend.ts`: `SendArgs = { to, subject, html }`; `sendEmail` poziva `resend.emails.send({from,to,subject,html})`; `drySend` vraća dry rezultat bez mreže. Resend `^6.14` podržava `attachments`.
- `lib/reminders/runReminders.ts`: po redu ima `r.vrsta_naziv`, `r.klijent_naziv`, `r.lokacija_naziv`, `r.rok_dospijeca` (ISO date), `r.termin_id`, `r.klijent_id`; `baseUrl = env.NEXT_PUBLIC_APP_URL`. Poziva `send({to, subject, html})`.
- `lib/date.ts`: `formatDatum`, `addMjeseci` (nema addDays — rok+1 dan računa se inline).
- Nema postojećeg ics/calendar koda.

## Rješenje

### 1. iCalendar generator — `lib/email/ics.ts`
```ts
export function buildTerminIcs(args: {
  vrsta: string
  klijent: string
  rok: string            // ISO "YYYY-MM-DD"
  terminId: string
  lokacija?: string | null
  baseUrl?: string
  now?: Date             // za determinističan test; default new Date()
}): string
```
- **Escaping** (iCal): pomoćna `icsEscape(s)` → backslash, zarez, tačka-zarez, novi red (`\\`, `\,`, `\;`, `\n`).
- **Datumi**: `DTSTART;VALUE=DATE:<YYYYMMDD>` (rok), `DTEND;VALUE=DATE:<YYYYMMDD>` (rok + 1 dan; iCal cjelodnevni DTEND je ekskluzivan). rok+1 računa se preko `Date.UTC` (TZ-safe), format `YYYYMMDD`.
- **UID** (stabilan po terminu — isti UID na svim podsjetnicima → kalendar ažurira isti event): `${terminId}@${host}`, gdje je `host = baseUrl ? new URL(baseUrl).hostname : "termini"`.
- **DTSTAMP**: `<now u UTC>` format `YYYYMMDDTHHMMSSZ`.
- **SUMMARY**: `icsEscape(`${vrsta} — ${klijent}`)`.
- **LOCATION**: `icsEscape(lokacija)` (red samo ako `lokacija`).
- **DESCRIPTION**: kratak tekst; ako `baseUrl` → dodaj „Detalji: `${baseUrl}/plan-aktivnosti?selected=${terminId}`".
- **VALARM**: `BEGIN:VALARM` / `ACTION:DISPLAY` / `TRIGGER:-P1D` / `DESCRIPTION:<SUMMARY>` / `END:VALARM`.
- **Zaglavlje**: `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//${APP_NAME}//Podsjetnici//BS` (iz `lib/brand.ts` — bez hardkodiranja, vidi [[no-hardcode-flag-everything]]), `METHOD:PUBLISH`, `CALSCALE:GREGORIAN`. `ics.ts` uvozi `APP_NAME`.
- **Linije spojene s CRLF** (`\r\n`) — iCal zahtjev. (Bez striktnog 75-oktet foldinga — Outlook/Google/Apple tolerišu duže linije; prihvatljivo za MVP.)
- Čista funkcija, unit-testabilna.

### 2. Prilog u mejlu — `lib/email/resend.ts`
- `SendArgs` proširiti: `attachments?: { filename: string; content: Buffer }[]`.
- `sendEmail`: kad `args.attachments` postoji, proslijedi u `resend.emails.send({ ..., attachments: args.attachments })`. (Resend node SDK prima `{ filename, content: Buffer }`.)
- `drySend`: ignoriše `attachments` (potpis prima isti `SendArgs`, ne koristi ih).

### 3. Motor — `lib/reminders/runReminders.ts`
- Prije `send(...)` izgraditi ics:
  ```ts
  const ics = buildTerminIcs({
    vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, rok: r.rok_dospijeca,
    terminId: r.termin_id, lokacija: r.lokacija_naziv, baseUrl,
  })
  ```
- U `send({...})` dodati: `attachments: [{ filename: "termin.ics", content: Buffer.from(ics, "utf-8") }]`.
- Ništa drugo ne mijenjati.

## Tok podataka
```
runReminders → buildTerminIcs(termin) → ics tekst
  → send({to, subject, html, attachments:[{filename:"termin.ics", content: Buffer(ics)}]})
  → Resend šalje mejl + .ics prilog
Korisnik klikne prilog → Outlook/Google/Apple „Dodaj u kalendar" → cjelodnevni event + alarm dan ranije
```

## Testiranje
- **Unit (`lib/email/ics.test.ts`)** s fiksnim `now`:
  - `DTSTART;VALUE=DATE:20260901` za rok `2026-09-01`; `DTEND;VALUE=DATE:20260902` (rok+1).
  - `SUMMARY` sadrži „Vrsta — Klijent"; escaping (npr. klijent „AS, d.o.o." → `AS\, d.o.o.`).
  - `LOCATION` prisutan kad ima lokacije; izostaje kad je null.
  - `VALARM` s `TRIGGER:-P1D`; `METHOD:PUBLISH`; `UID` sadrži `terminId`.
  - `DESCRIPTION` sadrži link kad ima `baseUrl`; bez `baseUrl` → bez `http`.
  - Linije završavaju `\r\n`; počinje `BEGIN:VCALENDAR`, završava `END:VCALENDAR`.
- **Unit (`lib/email/resend.test.ts` ili dopuna)**: `sendEmail` s `attachments` prosljeđuje ih Resend klijentu (spy na `emails.send`), bez ključa → `drySend` (ignoriše prilog).
- **Pravi test**: pošalji reminder s prilogom (kao raniji test-mejlovi) → otvori u Apple Mail/Outlook → „Dodaj u kalendar" kreira cjelodnevni event s alarmom.
- **Lint/typecheck/suite** zeleno; `pnpm build` prolazi. Bez DB migracije.

## Kriterijumi prihvatanja
- [ ] `buildTerminIcs` vraća validan iCalendar (VCALENDAR/VEVENT/VALARM, CRLF, METHOD:PUBLISH).
- [ ] Cjelodnevni event na datum roka (`DTSTART;VALUE=DATE`, `DTEND`=rok+1); alarm `TRIGGER:-P1D`.
- [ ] Stabilan `UID` po terminu (isti na svim podsjetnicima istog termina).
- [ ] SUMMARY/LOCATION/DESCRIPTION iCal-escaped; DESCRIPTION nosi deep-link kad ima `baseUrl`.
- [ ] `SendArgs.attachments` opcioni; `sendEmail` ih prosljeđuje Resend-u; `drySend` ih ignoriše.
- [ ] Motor šalje `termin.ics` prilog u svakom podsjetniku; logika motora netaknuta.
- [ ] lint/typecheck/test/build zeleni.

## Rizici / napomene
- Bez striktnog 75-oktet line-foldinga — prihvatljivo za ciljne klijente (Outlook/Google/Apple); ako neki strogi parser zafali, fold je follow-up.
- Resend prilog: potvrditi da SDK prima `content: Buffer` (v6) — ako traži base64 string, koristiti `content.toString("base64")` (implementer provjerava pri wiringu).
- `METHOD:PUBLISH` = „dodaj u kalendar" (ne meeting-invite s accept/decline). Namjerno za interne podsjetnike o rokovima.
