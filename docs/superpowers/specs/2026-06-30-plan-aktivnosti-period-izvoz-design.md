# Plan aktivnosti — period "tekući+naredni" + izvoz (Excel/PDF)

**Datum:** 2026-06-30
**Status:** odobren dizajn → slijedi plan
**Kontekst:** Završetak zahtjeva R3 ("Plan aktivnosti") iz `../Povratne informacije i funkcionalni zahtjevi za aplikaciju.docx` §5. Audit je našao da centralni plan postoji (lista/kalendar/matrica + filteri), ali nedostaju: (a) period "tekući + naredni mjesec" i (b) **izvoz u Excel i PDF** (§5: "Potrebno je omogućiti izvoz plana aktivnosti u Excel i PDF format kako bi se plan mogao dostavljati sektoru…").

## Obim
- Period "tekući + naredni mjesec" kao opcija filtera mjeseca i kao **default** Plana aktivnosti.
- Izvoz trenutno-filtriranog plana u **Excel (.xlsx)** i **PDF**, kao server-generisani fajlovi za download.

## Van obima (zaseban posao)
Statusi §10 koji fale u enumu ("U toku / Čeka dokumentaciju / Čeka otklanjanje nedostataka"); generisanje izvještaja; obuke+polaznici; obilasci auto-2/mjesec; mobilna verzija; Outlook/.ics.

## Postojeće stanje (potvrđeno)
- Centralni ekran `app/(dashboard)/plan-aktivnosti/page.tsx` → `_views/{lista,kalendar,matrica}.tsx` (client, TanStack Query) → `app/api/plan-aktivnosti/{lista,kalendar,matrica}/route.ts`.
- Filter UI `components/domain/TerminiFilters.tsx`; opcije mjeseca `lib/termini-filters.ts` ("svi" + 1..12).
- `lista` ruta filtrira `termini_view` (kolone: `klijent_naziv, lokacija_naziv, vrsta_naziv, rok_dospijeca, status_izvedeni, interval_mjeseci, zaduzeni`, + t.*); default mjeseca je "svi".
- `exceljs` već je dependency (koristi se za import/seed). PDF biblioteke nema.
- `lib/date.ts` ima `MONTHS_BS`, `monthRange`, `periodRange` (mjesec/kvartal/godina) — ali se `periodRange` ne koristi u lista ruti.

## Rješenje

### 1. Period "tekući + naredni mjesec"
- **`lib/date.ts`** — nova čista funkcija:
  `tekuciNarednomMjesecuRange(danas?: Date): { from: string; to: string }` → `from` = prvi dan tekućeg mjeseca (ISO `YYYY-MM-DD`), `to` = zadnji dan **narednog** mjeseca; ispravno preko granice godine (dec→jan). TZ-safe (UTC, kao ostatak `date.ts`).
- **`lib/termini-filters.ts`** — dodati opciju `{ value: "tn", label: "Tekući + naredni mjesec" }` na vrh liste; `mjesec` filter sada prima "tn" | "svi" | "1".."12".
- **Default** Plana aktivnosti = "tn". `TerminiFilters.tsx`: `const mjesec = params.get("mjesec") ?? "tn"` (umjesto "svi"); godina-filter se sakriva kad je mjesec "tn" ili "svi" (postojeća logika za "svi").
- **`lista` ruta** primjenjuje "tn" preko `tekuciNarednomMjesecuRange()` na `rok_dospijeca` (`.gte(from).lte(to)`).
- **`kalendar`/`matrica` rute** su mjesečne mreže: kad `mjesec ∉ {1..12}` (tj. "tn"/"svi") koriste **tekući mjesec/godinu** kao fallback (mala robustnost izmjena; bez nove navigacije).

### 2. Dijeljeni filter helper (sprječava drift lista↔izvoz)
- **`lib/plan-filteri.ts`** (server):
  - `type PlanFilteri = { status?: string; klijent?: string; lokacija?: string; vrsta?: string; mjesec: string; godina: number; q?: string }`
  - `parsePlanFilteri(sp: URLSearchParams): PlanFilteri` — izvuče i validira filtere iz query stringa.
  - `primijeniPlanFiltere(query, f: PlanFilteri)` — primijeni iste filtere na supabase query builder nad `termini_view` (status/klijent/lokacija/vrsta `.eq`, `q` `.ilike`, mjesec: "tn"→range, "1..12"→`monthRange(godina,mjesec)`, "svi"→bez datumskog opsega). Vraća query.
- `lista` ruta se refaktoriše da koristi `parsePlanFilteri`+`primijeniPlanFiltere` (umjesto inline logike) — isti rezultat, ali jedan izvor istine; `izvoz` ruta koristi isto.

### 3. Izvoz ruta
- **`app/api/plan-aktivnosti/izvoz/route.ts`** (`runtime="nodejs"`, GET):
  - `format` = `xlsx` | `pdf` (default `xlsx`); ostali params = filteri.
  - SSR Supabase klijent (RLS po dodjeli — operater izvozi samo svoje), `parsePlanFilteri` → `primijeniPlanFiltere` nad `termini_view`, `order by rok_dospijeca`.
  - Mapira redove u `PlanRed[]` i poziva builder; vraća `Response` sa `Content-Type` i `Content-Disposition: attachment; filename="plan-aktivnosti-<period>.<ext>"`.
  - Greška → JSON 500 (kao ostale rute).
- **`type PlanRed = { klijent: string; lokacija: string; usluga: string; rok: string; status: string; periodikaMj: number | null; odgovorna: string }`** (zajednički za buildere).

### 4. Builderi
- **`lib/plan-izvoz/xlsx.ts`** — `planToXlsx(rows: PlanRed[], meta: { naslov: string; period: string }): Promise<Buffer>` preko `exceljs`: zaglavlje (naziv firme iz `APP_NAME` + period), bold header red, kolone **Klijent · Lokacija · Usluga · Rok · Status · Periodika (mj) · Odgovorna osoba**, auto širine.
- **`lib/plan-izvoz/pdf.ts`** — `planToPdf(rows, meta): Promise<Buffer>` preko **`pdf-lib`** (nova dep; serverless-pouzdana, ugrađen StandardFonts.Helvetica — bez .afm font-fajl problema koje `pdfkit` ima na Vercelu). Jednostavna tabela: naslov + period, header red, redovi s prelomom stranice (A4 landscape), datumi formatirani `formatDatum`.
- `APP_NAME` iz `lib/brand.ts`.

### 5. UI
- **`components/domain/PlanIzvozDugmad.tsx`** (client): dva dugmeta "Izvoz Excel" / "Izvoz PDF" koja kao `<a href download>` vode na `/api/plan-aktivnosti/izvoz?format=…&<trenutni filteri>` (čita iste search params kao filteri). Render u toolbaru Plana aktivnosti (`plan-aktivnosti/page.tsx` ili u `TerminiFilters`).

## Tok podataka (izvoz)
```
Dugme "Izvoz PDF" → GET /api/plan-aktivnosti/izvoz?format=pdf&mjesec=tn&klijent=…
  → SSR Supabase (RLS) → parsePlanFilteri → primijeniPlanFiltere(termini_view) → redovi
  → map u PlanRed[] → planToPdf(rows, meta) → Buffer
  → Response (application/pdf, attachment)
```

## Testiranje
- **Unit:** `tekuciNarednomMjesecuRange` (uklj. dec→jan granicu); `parsePlanFilteri` (default mjesec="tn", validacija godine, prazni params); `planToXlsx` (re-parse preko exceljs → provjeri header + broj redova + vrijednost ćelije); `planToPdf` (Buffer ne-prazan, počinje `%PDF-`).
- **Lint/typecheck/suite** zeleni. `pnpm build` (nova ruta + dep) prolazi.
- **Ručno (lokalno dev):** otvori Plan aktivnosti (default "tn"), klikni Izvoz Excel/PDF → fajl se skine s tačnim redovima i poštuje aktivne filtere.
- Rollout: merge → auto-deploy (Vercel). **Bez DB migracije** (read-only + izvoz). Bez Resend zavisnosti.

## Kriterijumi prihvatanja
- [ ] Plan aktivnosti se otvara na "Tekući + naredni mjesec"; opcija postoji u dropdownu; "svi"/pojedinačni mjeseci i dalje rade.
- [ ] "tn" prikazuje tačno termine s `rok_dospijeca` u [prvi dan tekućeg, zadnji dan narednog].
- [ ] Dugmad "Izvoz Excel"/"Izvoz PDF" skidaju fajl koji odražava **trenutne filtere** (klijent/lokacija/vrsta/status/period/pretraga).
- [ ] Excel i PDF imaju kolone Klijent·Lokacija·Usluga·Rok·Status·Periodika·Odgovorna + zaglavlje s nazivom firme i periodom.
- [ ] Operater izvozi samo svoje klijente (RLS), admin sve.
- [ ] `lista` ruta i `izvoz` ruta dijele isti filter helper (nema duplikata logike).
- [ ] lint/typecheck/test:unit prolaze; build prolazi s `pdf-lib`.

## Rizici / napomene
- `pdf-lib` nema gotov "table" helper → ručno pozicioniranje teksta + prelom stranice; držati jednostavnim (jedna tabela, fiksne širine kolona, A4 landscape).
- Veliki izvoz (mnogo termina) → PDF s više stranica; prihvatljivo. Bez cap-a (za razliku od podsjetnika), ali realan obim plana je desetine-stotine redova.
- Izvoz čita preko SSR (RLS) klijenta — sporiji od admin klijenta ali ispravno skopiran po dodjeli; u skladu s pravilom "service-role samo van request-patha".
