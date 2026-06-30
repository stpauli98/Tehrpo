# Unapređenje reminder mejla — izgled + deep-linkovi (termin/klijent)

**Datum:** 2026-06-30
**Status:** odobren dizajn → slijedi plan
**Kontekst:** Email-podsjetnik radi (Resend + verifikovana domena `nextpixel.dev`), ali izgled je goli tekst i nema akcionih linkova. Korisnik traži: bogatiji izgled + **dva dugmeta** koja vode u dashboard (na termin i na klijenta).

## Obim
- Redizajn HTML šablona podsjetnika (`reminderHtml`): brendiran header u boji statusa, status-badge, istaknut rok, kartica detalja, **dva „bulletproof" dugmeta** („Otvori termin", „Otvori klijenta"), footer.
- Deep-linkovi: termin → `/plan-aktivnosti?selected=<termin_id>`; klijent → `/klijenti/<klijent_id>`.
- Nova env varijabla **`NEXT_PUBLIC_APP_URL`** za apsolutni base-URL (po deploymentu; cron nema request origin). **Bez hardkodiranja** — vidi [[no-hardcode-flag-everything]].
- Graceful: ako `NEXT_PUBLIC_APP_URL` nije postavljen → dugmad se izostave (nikad slomljen link).

## Van obima (zaseban posao)
- Povratak na deep-link nakon prijave (`returnTo` u `proxy.ts`/`/prijava`).
- Akcije iz mejla („označi izvršeno", „zakaži") — traže sigurne tokene/rute.
- Promjena logike motora (detekcija/rutiranje/throttling) — netaknuto.

## Postojeće stanje (potvrđeno)
- `lib/email/templates.ts`: `reminderSubject({vrsta, klijent, danaDoRoka})`, `reminderHtml({klijent, vrsta, rok, danaDoRoka, lokacija?})`, `escapeHtml`. HTML je goli tekst (max-width 560px, inline CSS); footer već koristi `APP_NAME — APP_TAGLINE` (brand-flagovan). Boja: kasni `#dc2626`, inače `#2563eb`.
- `lib/email/templates.test.ts`: testovi za subject + html (sadrži klijent/vrsta/rok; escape; izostavlja lokaciju; kašnjenje). **Redizajn mijenja strukturu → ovi testovi se ažuriraju.**
- `lib/reminders/runReminders.ts`: poziva `reminderHtml({klijent: r.klijent_naziv, vrsta: r.vrsta_naziv, ...})`; po redu ima `r.termin_id`, `r.klijent_id`, `r.klijent_naziv`, `r.vrsta_naziv`, `r.dana_do_roka`, `r.rok_dospijeca` (i lokacija ako postoji u RPC-u; ako ne, ostaje `null`).
- `lib/env.ts`: zod-validiran; nema URL polja osim `NEXT_PUBLIC_SUPABASE_URL`.
- Dashboard rute: klijent `app/(dashboard)/klijenti/[id]`; termin detalj = `/plan-aktivnosti?selected=<termin_id>` (lista view čita `selected`).

## Rješenje

### 1. Env: base-URL (`lib/env.ts`)
- Dodati `NEXT_PUBLIC_APP_URL: z.string().url().optional()` u shemu i `runtimeEnv` mapu.
- Vrijednost po deploymentu (npr. demo: `https://<demo-domena>`, tehpro: `https://<tehpro-domena>`). Postavlja se u Vercel env (i `.env.local` za lokalni test). Ne hardkodirati.

### 2. Šablon (`lib/email/templates.ts`)
- **Proširiti `reminderHtml` args** (sva nova polja opciona — povratno kompatibilno):
  ```ts
  reminderHtml(args: {
    klijent: string; vrsta: string; rok: string; danaDoRoka: number
    lokacija?: string | null
    terminId?: string; klijentId?: string; baseUrl?: string
  }): string
  ```
- **Linkovi** (samo ako `baseUrl` i odgovarajući id postoje):
  - termin: `${baseUrl}/plan-aktivnosti?selected=${encodeURIComponent(terminId)}`
  - klijent: `${baseUrl}/klijenti/${encodeURIComponent(klijentId)}`
- **Izgled** (email-safe: tabele + inline CSS, max-width 600px, bez vanjskog CSS/JS):
  - **Header**: traka u boji statusa (`boja`), lijevo `APP_NAME` (bold, bijelo), desno „Podsjetnik".
  - **Status badge**: kad `danaDoRoka < 0` → „KASNI · {danaTekst}" (crvena); inače „USKORO · {danaTekst}" (plava). Ispod badge-a **Rok** istaknut (`formatDatum(rok)`).
  - **Kartica detalja** (border, radius): Vrsta, Klijent, Lokacija (red samo ako `lokacija`). Sve kroz `escapeHtml`.
  - **Dugmad** (table-based „bulletproof", inline CSS, bez slika): „Otvori termin" (filled, boja statusa) i „Otvori klijenta" (outline). Renderuju se samo ako su odgovarajući link dostupni; ako nijedan → blok se izostavi.
  - **Footer**: `${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}` (nepromijenjeno).
- `reminderSubject` ostaje nepromijenjen.

### 3. Motor (`lib/reminders/runReminders.ts`)
- Pročitati `baseUrl` jednom po run-u: `const baseUrl = env.NEXT_PUBLIC_APP_URL` (ili `undefined`).
- Pri pozivu `reminderHtml(...)` dodati: `terminId: r.termin_id, klijentId: r.klijent_id, baseUrl`.
- Bez drugih izmjena (rutiranje/throttling/idempotencija netaknuti).

## Tok podataka
```
runReminders → reminderHtml({klijent, vrsta, rok, danaDoRoka, lokacija, terminId, klijentId, baseUrl})
  → HTML s 2 dugmeta (ako baseUrl+id) → sendEmail
Klik „Otvori termin" → {baseUrl}/plan-aktivnosti?selected=<termin_id>
Klik „Otvori klijenta" → {baseUrl}/klijenti/<klijent_id>
(ako korisnik nije ulogovan → /prijava; povratak na deep-link = van obima)
```

## Testiranje
- **Unit (`lib/email/templates.test.ts`)** — ažurirati postojeće za novu strukturu + dodati:
  - s `baseUrl`+`terminId`+`klijentId`: HTML sadrži `…/plan-aktivnosti?selected=<id>` i `…/klijenti/<id>` i tekstove dugmadi „Otvori termin"/„Otvori klijenta".
  - bez `baseUrl`: HTML **ne sadrži** dugmad ni `http`.
  - status badge: `danaDoRoka < 0` → sadrži „KASNI"; `>= 0` → „USKORO".
  - `escapeHtml` i dalje primijenjen na klijent/vrsta/lokacija; lokacija se izostavlja kad je `null`.
- **Vizuelni pregled**: skripta/uputstvo da se generiše HTML u fajl (`/tmp/...html`) i otvori u browseru; opciono pošalji test-mejl preko Resend-a (kao u prethodnom testu) prije finalizacije.
- **Lint/typecheck/suite** zeleno; `pnpm build` prolazi.
- Rollout: bez DB migracije. Postaviti `NEXT_PUBLIC_APP_URL` u Vercel env (demo+tehpro) + `.env.local` za lokalni test.

## Kriterijumi prihvatanja
- [ ] `reminderHtml` prima `terminId`/`klijentId`/`baseUrl` (opciono); povratno kompatibilan.
- [ ] Mejl ima brendiran header (`APP_NAME`), status badge (USKORO/KASNI), istaknut rok, karticu detalja, footer (`APP_NAME — APP_TAGLINE`).
- [ ] Dva „bulletproof" dugmeta vode na tačne dashboard URL-ove (termin: `?selected=`, klijent: `/klijenti/<id>`).
- [ ] Bez `NEXT_PUBLIC_APP_URL` → dugmad se izostave (bez slomljenih linkova).
- [ ] Motor prosljeđuje `termin_id`/`klijent_id`/`baseUrl`; logika motora netaknuta.
- [ ] `escapeHtml` na svim korisničkim vrijednostima; email-safe HTML (tabele, inline CSS, max-width 600px).
- [ ] lint/typecheck/test/build zeleni; bez hardkodiranog URL-a (sve iz env-a).

## Rizici / napomene
- Email klijenti (Outlook/Gmail) — koristiti table-based dugmad + inline CSS; bez flexboxa/vanjskog CSS-a. Držati jednostavnim.
- Deep-link iza prijave: ako primalac nije ulogovan, ide na `/prijava` i ne vraća se na link (prihvaćeno za MVP; `returnTo` je zaseban posao).
- `NEXT_PUBLIC_APP_URL` mora biti tačan po okruženju — pogrešna vrijednost = linkovi na pogrešan dashboard.
