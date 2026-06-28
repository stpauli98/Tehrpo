# Optimizacija brzine učitavanja — Dizajn / Spec

Datum: 2026‑06‑28 · Status: odobren dizajn, čeka pisanje plana
Izvori: mjerenje živog demoa (`demo.nextpixel.dev`), inspekcija koda (`lib/supabase/server.ts`, dashboard stranice, `_views`), Next.js 16.2.9 docs (`node_modules/next/dist/docs`).

---

## 1. Kontekst i cilj

Korisnik prijavljuje da prelazak iz taba u tab i mijenjanje prikaza unutar taba (lista/matrica/kalendar) traje dugo. **Cilj:** aplikacija se učitava i navigira osjetno brže — navigacija i prebacivanje prikaza djeluju instant, a stvarna latencija upita je drastično niža.

Kod je **dijeljen** između demo deploya i prave aplikacije, pa sve izmjene korista obje.

## 2. Uzroci (dokazani)

1. **Geografija — funkcija i baza na različitim kontinentima.** Zaglavlje živog servera: `x-vercel-id: fra1::iad1::…` → serverless funkcija se izvršava u **`iad1` (US‑East)**, a Supabase baza je u **`eu-west-1` (Irska)**. Svaki upit ide transatlantski (~150ms po round‑tripu). TTFB `/prijava` (bez upita) već 0.65–1.0s.
2. **Nema keširanja.** `lib/supabase/server.ts` koristi `cookies()` → svaka dashboard stranica je dinamična (nekeširana). Nema `react-query`/`swr`/`unstable_cache`/`"use cache"` (provjereno u `package.json` + grep). Svaki render = svjež upit.
3. **Nema instant shell‑a.** Nijedan `loading.tsx` ne postoji → blank ekran dok se cijela stranica ne izrenderuje na serveru.
4. **Waterfall upiti.** Npr. `obilasci/page.tsx`: `await searchParams → await createServerSupabaseClient() → await from("lokacije") → await from("termini_view")` — uzastopno, ne `Promise.all`.
5. **Prebacivanje prikaza = puna navigacija + refetch.** `PlanViewSwitcher` radi `router.push(?view=…)` u `startTransition` → server re‑render `plan-aktivnosti` → `_view` (lista/matrica/kalendar) ponovo dohvata sve.

## 3. Obim

**U obimu:**
- Infrastruktura: Vercel region uz bazu; streaming shell (`loading.tsx`/Suspense); paralelizacija upita; per‑request dedup (`cache()`).
- Klijentski keš (TanStack Query) za interaktivne prikaze plan‑aktivnosti.
- Prefetch navigacije.
- Selektivni server‑keš (`unstable_cache` + tagovi) za referentne podatke, vođen mjerenjem.
- Mjerenje prije/poslije i zaštita E2E testovima.

**Van obima (YAGNI sad):**
- Globalni `cacheComponents: true` / PPR — odgođeno osim ako mjerenja poslije Faze 1+2 ne pokažu jasnu potrebu.
- Redis / edge KV / eksterni keš sloj.
- Multi‑region deploy.
- Refaktori nevezani za brzinu.

## 4. Donesene odluke

1. **Pristup C (Hibrid):** prvo niskorizične infrastrukturne i rendering pobjede + klijentski keš, pa **mjerimo**, pa selektivni server‑keš samo gdje vrijedi. Bez globalnog mode‑switcha (`cacheComponents`) jer mijenja rendering semantiku cijele (prave) aplikacije i nosi rizik regresija u modifikovanom Next.js‑u.
2. **Region `dub1` (Dublin)** — ista AWS regija kao Supabase `eu-west-1` (Irska) → najniža latencija baze; usput i bliže korisniku (BiH) nego `iad1`. Alternativa `fra1` (Frankfurt) ako `dub1` nije dostupan na planu.
3. **TanStack Query (React Query)**, ne SWR — bolji keš/mutation/invalidation model za CRUD‑tešku aplikaciju; postoje devtools.
4. **Server‑keš samo za org‑wide referentne podatke** (`vrste_provjera`, lista klijenata). Per‑user RLS‑skopirani podaci ostaju dinamični (bez rizika curenja između korisnika/uloga `je_admin`/`je_pregled`).
5. **Fazni, reverzibilni redoslijed** — svaka faza zasebno isporučiva; E2E mora biti zelen prije sljedeće.

## 5. Dizajn po fazama

### Faza 1 — Infrastruktura i rendering (nizak rizik, najveći dobitak)
- **1.1 Region:** `vercel.json` sa `{ "regions": ["dub1"] }`; redeploy. Očekivano: latencija upita ~150ms → ~15ms.
- **1.2 Streaming shell:** dodati `loading.tsx` (skeleton) po dashboard ruti i/ili `<Suspense>` granice oko sporih dijelova; statički shell (sidebar/topbar) renderuje odmah.
- **1.3 Paralelizacija:** uzastopne `await` upite pretvoriti u `Promise.all` (`obilasci`, `pregled`, `_views`, druge stranice s >1 upitom). Klijent (`createServerSupabaseClient`) napraviti jednom i dijeliti.
- **1.4 Dedup:** zajedničke readove (trenutni korisnik, vrste) umotati u React `cache()` da se ne dupliraju u istom renderu.

### Faza 2 — Klijentski keš za interaktivne prikaze
- **2.1 TanStack Query:** provider u dashboard layoutu; podaci za plan‑aktivnosti prikaze dohvaćaju se kroz route handler/server action i keširaju klijentski uz kratak `staleTime`. Prebacivanje lista↔matrica↔kalendar čita iz keša → instant nakon prvog dohvata. Mutacije (izmjene termina) invalidiraju relevantne query ključeve.
- **2.2 Prefetch:** `<Link prefetch>` na sidebar navigaciji; prefetch‑on‑hover na switcheru prikaza da je sljedeći prikaz „topao".

### Faza 3 — Selektivni server‑keš (vođen mjerenjem)
- **3.1 Mjerenje:** TTFB prije/poslije na živom demu (skripta s `curl -w` na ključne rute; po mogućnosti i autentifikovane preko sesije).
- **3.2 `unstable_cache` + tagovi:** referentne readove (`vrste_provjera`, lista klijenata) umotati u `unstable_cache` s tagovima (`vrste`, `klijenti`); `revalidateTag` pozvati u relevantnim write akcijama (server actions za create/update/delete). Keš uz svježinu (invalidacija‑na‑upis). `unstable_cache` ne smije čitati cookies → koristi se samo za ne‑per‑user podatke.

## 6. Sigurnost / izolacija podataka

- Server‑keš (Faza 3) primjenjuje se **isključivo** na org‑wide referentne podatke; ništa što ovisi o `auth.uid()`/RLS pristupu se ne kešira globalno.
- Klijentski keš (Faza 2) živi u korisnikovom pretraživaču (per‑sesija) → nema dijeljenja između korisnika.
- Demo je single‑admin; prava app ima uloge (`je_admin`/`je_pregled`/`ima_pristup_klijentu`) — dizajn to poštuje.

## 7. Greške i stanja čekanja

- `loading.tsx` po ruti za pending stanje (skeleton umjesto blank).
- `error.tsx` granice po ruti gdje ih nema, da pad jednog upita ne obori cijeli prikaz.
- React Query: `isPending`/`isError` stanja u prikazima.

## 8. Testiranje i mjerenje (kriteriji uspjeha)

- **Regresije:** postojeći Playwright E2E (`pnpm test:e2e`) mora ostati zelen nakon svake faze.
- **Svježina:** nakon upisa (kreiraš/izmijeniš termin) lista/prikaz se osvježi (test invalidacije keša).
- **Brzina (mjerljivo):** TTFB ključnih ruta izmjeren prije i poslije; cilj — autentifikovana dashboard navigacija osjetno ispod sekunde; prebacivanje prikaza nakon prvog dohvata ~instant (bez novog mrežnog round‑tripa).
- **Region potvrda:** `x-vercel-id` nakon Faze 1 pokazuje EU compute region (`dub1`/`fra1`), ne `iad1`.

## 9. Kontrola rizika i redoslijed

Faza 1 → verifikacija (E2E zelen + demo radi + mjerenje) → Faza 2 → verifikacija → Faza 3 → verifikacija. Svaka faza je zasebno isporučiva i reverzibilna. Rad ide na grani `perf/optimizacija-brzine-ucitavanja`.

## 10. Otvorena pitanja

- Da li `dub1` dostupan na trenutnom Vercel planu (ako ne → `fra1`). Provjerava se pri Fazi 1.
- Obim Faze 2: da li sve tri prikaza odmah ili prvo lista, pa ostali. Odlučuje se u planu na osnovu mjerenja Faze 1.
