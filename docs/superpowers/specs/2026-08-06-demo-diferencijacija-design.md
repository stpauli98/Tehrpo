# Dizajn: Vizuelna diferencijacija DEMO verzije + disklejmer nakon prijave

**Datum:** 06.08.2026.
**Status:** odobreno

## Motivacija

Demo instanca aplikacije prikazuje se firmama koje su potencijalni klijenti za
custom razvoj. Demo mora biti jasno različit od produkcijske Tehpro instance —
vizuelno i porukom — tako da se ni po čemu ne može tumačiti kao Tehpro-ov
proizvod niti kao gotov proizvod uopšte. Demo je „kostur / faza 0": generička
osnova koja se za svaku firmu izrađuje po mjeri, u dogovoru sa tom firmom.

Napomena o kontekstu (nije dio koda): disklejmer namjerno **ne pominje Tehpro**
ni bilo koju treću stranu — pozicionira demo isključivo kao sopstveni generički
kostur. DEMO već koristi zasebnu bazu sa testnim podacima i env-driven naziv
(`NEXT_PUBLIC_APP_NAME=Demo`); u interfejsu se riječ „Tehpro" nigdje ne
prikazuje (postoje samo interni identifikatori poput DB kolone
`zaduzeni_tehpro_id`, nevidljivi krajnjem korisniku).

## Obim

Sve izmjene su aktivne **isključivo kad je `DEMO_MODE === true`**
(`NEXT_PUBLIC_DEMO_MODE=1`, postavljen samo na DEMO Vercel projektima —
`de.nextpixel.dev` i `demo.nextpixel.dev`). PROD deploy ostaje piksel-identičan
današnjem stanju.

### 1. Vizuelna diferencijacija

- **`data-demo` atribut na `<html>`**: `app/layout.tsx` postavlja atribut kad je
  `DEMO_MODE` uključen (build-time konstanta, nema hydration razlike).
- **CSS override u `app/globals.css`**: pod selektorom `html[data-demo]`
  prepisuju se postojeće brand varijable:
  - `--color-brand: #ea580c` (orange-600, umjesto plave #2563eb)
  - `--color-brand-dark: #c2410c` (orange-700, umjesto #1e40af)
  - `--color-brand-light: #ffedd5` (orange-100, umjesto #dbeafe)

  Time se svih ~32 mjesta koja koriste `bg-brand`/`text-brand`/`border-brand`
  (login forma, logo bedž, dugmad, sidebar) prefarbaju odjednom, bez izmjene
  ijedne komponente.
- **DEMO traka** (`components/shell/DemoTraka.tsx`, server komponenta):
  - Renderuje se u **root layoutu** (`app/layout.tsx`) iznad `{children}` → vidi
    se na svakom ekranu uključujući `/prijava`; vraća `null` kad `DEMO_MODE`
    nije uključen.
  - Tanka puna narandžasta traka (bg `--color-brand`, bijeli tekst), centriran
    tekst, ne može se zatvoriti. `data-testid="demo-traka"`.
  - Tekst (i18n ključ `shell.demoTraka.tekst`, sr):
    „DEMO VERZIJA — faza 0 · kostur, ne gotov proizvod".
- Postojeći mali DEMO bedž u TopBar-u ostaje netaknut.

### 2. Disklejmer modal nakon prijave

- **`components/shell/DemoDisklejmer.tsx`**, klijentska komponenta (`"use
  client"`), renderuje se iz `app/(dashboard)/layout.tsx`; kad `DEMO_MODE` nije
  uključen vraća `null` (gate se čita na module-nivou, poslije svih hookova nema
  potrebe — flag je build-time konstanta pa je grananje stabilno).
- **Jednom po prijavi**, mehanizam:
  - Ključ: `sessionStorage["demo-disklejmer-potvrdjen"]`.
  - Na mount: ako ključ ne postoji → modal otvoren; klik na „Razumijem" upisuje
    ključ i zatvara modal.
  - Stranica `/prijava` **briše ključ** na mount (mala klijentska logika u
    postojećoj `app/prijava/page.tsx`, aktivna samo u DEMO_MODE) → svaka nova
    prijava ponovo prikazuje modal, i poslije odjave/ponovne prijave u istom
    tabu.
- **Zatvaranje isključivo dugmetom „Razumijem"**: shadcn `Dialog` bez X dugmeta,
  bez zatvaranja na Escape i na klik van modala. `data-testid="demo-disklejmer"`.
- Sadržaj (sr katalog; en/de prevodi istog značenja):

  > **Dobrodošli u demo okruženje**
  >
  > Ovo je **kostur aplikacije — faza 0**, generička osnova koju razvijamo od
  > nule. Nije gotov proizvod i ne predstavlja proizvod bilo koje treće strane.
  >
  > Demo prikazuje samo **mali dio mogućnosti**. Svako rješenje se izrađuje
  > **po mjeri**: konačan obim, izgled i funkcionalnosti definišu se u dogovoru
  > sa firmom kojoj se rješenje implementira.
  >
  > Svi podaci u demo okruženju su testni i ne odnose se na stvarne firme.
  >
  > [ Razumijem ]

### 3. i18n

Svi novi stringovi idu u `messages/{sr,en,de}.json` sa key parity (tsc čuva):

- `shell.demoTraka.tekst`
- `shell.demoDisklejmer.naslov`, `.pasus1`, `.pasus2`, `.pasus3`, `.dugme`

`DemoTraka` je server komponenta (`getTranslations`), `DemoDisklejmer`
klijentska (`useTranslations`) — namespace `shell` je već u `CLIENT_NAMESPACES`
(`i18n/client-namespaces.ts`), pa klijentska komponenta ključeve dobija bez
dodatnih izmjena.

## Šta se NE mijenja

- PROD deploy (flag isključen): bez atributa, bez trake, bez modala, plava boja.
- Postojeći DEMO bedž u TopBar-u i logika `lib/demo.ts`.
- Baza, migracije, server akcije — izmjena je čisto prezentaciona.

## Greške i rubni slučajevi

- `sessionStorage` nedostupan (privatni režim sa blokadom): try/catch — modal se
  tada prikazuje pri svakoj navigaciji na dashboard layout mount; prihvatljivo
  za demo okruženje, bolje previše nego premalo.
- Fail-open sesija bez profila (korisnik `null` u layoutu): modal se svejedno
  prikazuje — vezan je za layout, ne za korisnika.

## Testiranje

- **Unit (Vitest):** nema nove čiste logike vrijedne izdvajanja; `lib/demo.ts`
  već ima testove. Ako se logika „prikaži jednom" izdvoji u čistu funkciju
  (čitanje/upis flaga), pokriti je unit testom.
- **E2E:** lokalni `.env` drži `NEXT_PUBLIC_DEMO_MODE` zakomentarisan → dev
  server za Playwright radi bez DEMO režima, postojeći specovi netaknuti. Novi
  e2e spec se ne dodaje (režim se ne može uključiti po-testu jer je build-time
  konstanta).
- **Ručna verifikacija:** `NEXT_PUBLIC_DEMO_MODE=1 pnpm dev` → provjeriti
  traku na `/prijava`, narandžastu boju, modal poslije prijave, „Razumijem",
  odjava → prijava → modal ponovo.

## Deploy

Merge u `main` → Vercel automatski deployuje sva tri Production projekta; DEMO
projekti već imaju `NEXT_PUBLIC_DEMO_MODE=1` pa izmjene odmah važe, PROD ostaje
bez promjene. Nema novih env varijabli.
