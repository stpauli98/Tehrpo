# Plan aktivnosti — modal za izvoz (PDF/Excel) sa opcijama

**Datum:** 2026-07-11
**Grana:** `worktree-izolovana-sesija`
**Status:** dizajn (čeka pregled korisnika)

## 1. Problem

Trenutno "Plan aktivnosti" ima dva dugmeta u headeru — **Izvoz Excel** i **Izvoz PDF** — koja odmah skidaju fajl bez ikakvog izbora. Korisnik ne zna šta tačno dobija (koji period, sve ili filtrirano). Traži se: jedno "Preuzmi" dugme koje otvara mali modal gdje se biraju format i parametri, sa jasnim default-om i naprednim ("Prilagodi") opcijama.

## 2. Donesene odluke (brainstorming)

| Odluka | Izbor |
|--------|-------|
| Formati | **PDF + Excel** (bez Word-a) |
| Default period | **Ovaj mjesec** (tekući kalendarski mjesec) |
| Dodatne opcije perioda | Cijela godina · Određeni mjesec · Prilagođeni raspon (od–do) · Sve (bez vremena) |
| Opseg | **Sve aktivnosti** vs **Samo trenutno filtrirano** (preuzme stanje filter trake) |
| Živi broj | **Da** — "Izvešće se ~N aktivnosti", ažurira se dok se mijenjaju period/opseg |
| Dva dugmeta | Spojena u **jedno "Preuzmi" dugme** |

## 3. UX — modal

Jedno dugme `Preuzmi` (ikona Download) u headeru zamjenjuje oba postojeća. Klik otvara `Dialog` (postojeći `components/ui/dialog.tsx`).

**Sažeto (default stanje):**
```
┌─────────────────────────────────────────┐
│  Preuzmi izvještaj                  ✕   │
├─────────────────────────────────────────┤
│  Format                                 │
│    ▣ PDF        ▢ Excel                 │
│                                         │
│  Period:  Ovaj mjesec                   │
│                                         │
│  ▸ Prilagodi                            │
│                                         │
│  Izvešće se ~N aktivnosti               │
│                    [  Preuzmi  ]        │
└─────────────────────────────────────────┘
```

**Prošireno (nakon klika na "Prilagodi"):**
```
┌─────────────────────────────────────────┐
│  Preuzmi izvještaj                  ✕   │
├─────────────────────────────────────────┤
│  Format                                 │
│    ▣ PDF        ▢ Excel                 │
│                                         │
│  Period                                 │
│    ◉ Ovaj mjesec                        │
│    ○ Cijela godina        [2026 ▾]      │
│    ○ Određeni mjesec   [Mart ▾][2026 ▾] │
│    ○ Prilagođeni raspon                 │
│         od [__.__.____]  do [__.__.____]│
│    ○ Sve (bez vremenskog ograničenja)   │
│                                         │
│  Opseg                                  │
│    ◉ Sve aktivnosti                     │
│    ○ Samo trenutno filtrirano           │
│                                         │
│  ▾ Sakrij                               │
│  Izvešće se ~N aktivnosti               │
│                    [  Preuzmi  ]        │
└─────────────────────────────────────────┘
```

**Ponašanje:**
- Format: segmentirani prekidač (PDF default). Gradi se od `button.tsx`.
- Period: radio lista. Kontrole vezane uz opciju (godina/mjesec select, od/do date input) aktivne su samo kad je ta opcija izabrana.
- "Samo trenutno filtrirano" prikazuje ispod sažetak aktivnih filtera trake (npr. "status: kasni, klijent: X") da korisnik vidi šta preuzima; ako nema aktivnih filtera, opcija je i dalje dostupna ali sažetak kaže "nema aktivnih filtera".
- Živi broj: debounce (~300 ms) upit ka count endpointu na svaku promjenu period/opseg/filtera. Dok traje: "Računam…". Na grešku: sakrij broj (ne blokiraj download).
- "Preuzmi": gradi izvoz URL i pokreće download; modal se zatvara.
- Pristupačnost: `Dialog` hvata fokus, `Esc` zatvara, dugmad imaju `aria-label`. Segmentirani prekidač i radio grupe koriste ispravan `role`/`aria-checked`.

## 4. Arhitektura

Server generatori (`lib/plan-izvoz/pdf.ts`, `xlsx.ts`) ostaju **netaknuti**. Mijenja se: kako se bira period, dodaje se count grana i klijentski modal.

### 4.1 API ugovor — `GET /api/plan-aktivnosti/izvoz`

Aditivno proširenje postojeće rute (`app/api/plan-aktivnosti/izvoz/route.ts`). Novi parametri:

| Param | Vrijednosti | Značenje |
|-------|-------------|----------|
| `format` | `pdf` \| `xlsx` | (postojeći) |
| `opseg` | `sve` \| `filtrirano` | `sve` = ignoriši ne-periodske filtere; `filtrirano` = primijeni ih. Default `sve`. |
| `period` | `om` \| `god` \| `mj` \| `raspon` \| `svi` | `om`=ovaj mjesec (default), `god`=cijela godina, `mj`=određeni mjesec, `raspon`=od–do, `svi`=bez vremena. |
| `godina` | broj | za `god` i `mj` |
| `mjesec` | `1`–`12` | za `mj` |
| `od`, `do` | ISO `YYYY-MM-DD` | za `raspon` |
| `count` | `1` (opciono) | vrati `{ broj: N }` JSON umjesto fajla |
| status, q, klijent_id, lokacija, vrsta_id, nacin | (postojeći) | primjenjuju se **samo** kad `opseg=filtrirano` |

**Backward-compat:** ako `period` param **nedostaje**, ruta se ponaša kao dosad (legacy `mjesec`=`tn`/`svi`/`1-12` + `godina`, uz sve filtere). Stare veze/testovi rade nepromijenjeno.

### 4.2 Period resolver (novi helper)

Novi čisti helper (u `lib/plan-filteri.ts` ili novi `lib/plan-izvoz/period.ts`):

```
izvozPeriodRange(p): { from, to } | null
  om     → monthRange(currentYear, tekuciMjesec)        // iz todayIso()
  god    → periodRange("godina", godina)  → {od,do} → {from,to}
  mj     → monthRange(godina, mjesec)
  raspon → { from: od, to: do }   (validacija: od ≤ do; fallback ako nevažeće)
  svi    → null
```

Koristi postojeće helpere iz `lib/date.ts` (`monthRange`, `periodRange`, `todayIso`, `currentYear`). Validacija raspona: ako `od`/`do` nedostaju ili su nevažeći, tretiraj kao `svi` (ili vrati grešku 400 — **odluka u planu**, predlažem 400 sa jasnom porukom).

### 4.3 Refaktor primjene filtera

`applyPlanFilteri` trenutno primjenjuje i ne-periodske filtere i `mjesecRange`. Razdvojiti da izvoz može nezavisno birati period i opseg:

- `applyPlanFilteriBezDatuma(q, f)` — status, q, klijent, lokacija, vrsta, nacin (bez datuma).
- Datumski raspon se primjenjuje zasebno (`.gte/.lte("datum_prikaza", …)`).
- **Lista ruta ostaje identična po ponašanju:** `applyPlanFilteriBezDatuma` + `mjesecRange(f)`. (Postojeći `applyPlanFilteri` se može zadržati kao wrapper radi DRY-a.)
- **Izvoz ruta:** ako `opseg=filtrirano` → `applyPlanFilteriBezDatuma`; inače preskoči. Zatim primijeni `izvozPeriodRange(p)`.

### 4.4 Count grana

Ista ruta, `?count=1`: umjesto generisanja fajla, uradi `select("*", { count: "exact", head: true })` sa istim filterima/periodom i vrati `{ broj }`. `head:true` ne povlači redove (efikasno).

### 4.5 Download trigger (klijent)

Modal na "Preuzmi" gradi URL (`/api/plan-aktivnosti/izvoz?…`) i pokreće download navigacijom (`window.location.assign(url)` ili skriveni `<a download>` klik). Pošto ruta vraća `Content-Disposition: attachment`, stranica se ne mijenja.

### 4.6 PeriodLabel / naziv fajla

`periodLabel` u ruti proširiti za nove `period` moduse (za podnaslov u PDF/Excel i slug u nazivu fajla):
- `om` → "Jul 2026" (tekući mjesec)
- `god` → "2026"
- `mj` → "Mart 2026"
- `raspon` → "01.07.2026–15.07.2026"
- `svi` → postojeći `sviMjeseci` label

## 5. Izmjene po fajlu

| Fajl | Izmjena |
|------|---------|
| `components/domain/PlanIzvozModal.tsx` | **NOVO** — modal komponenta (zamjenjuje dugmad). |
| `components/domain/PlanIzvozDugmad.tsx` | Ukloniti (ili zadržati prazno/preusmjeriti na modal). Provjeriti reference. |
| `app/(dashboard)/plan-aktivnosti/page.tsx` | `<PlanIzvozDugmad />` → `<PlanIzvozModal />`. |
| `app/api/plan-aktivnosti/izvoz/route.ts` | Novi parametri (`opseg`, `period`, `od`, `do`, `count`), backward-compat grana, prošireni `periodLabel`, count grana. |
| `lib/plan-filteri.ts` | `applyPlanFilteriBezDatuma`; (opciono) izvozPeriodRange ovdje ili u novom fajlu. |
| `lib/plan-izvoz/period.ts` | **NOVO (opciono)** — `izvozPeriodRange` + tipovi. |
| `messages/{sr,en,de}.json` | Novi ključevi pod `plan.izvoz` (naslov modala, format, period opcije, opseg, "Prilagodi/Sakrij", "Izvešće se ~N", "Preuzmi", "Računam…"). |
| `tests/e2e/20-plan-aktivnosti.spec.ts` | Ažurirati ako referiše `izvoz-excel`/`izvoz-pdf`; dodati scenario za modal (otvori → izaberi period → download). |
| `lib/plan-izvoz/period.test.ts` | **NOVO** — unit testovi za `izvozPeriodRange` (svi modusi, granice godine, nevažeći raspon). |
| `lib/plan-izvoz/{pdf,xlsx}.test.ts` | Bez izmjena (generatori netaknuti). |

## 6. i18n

Novi ključevi u `plan.izvoz` (sr/en/de), npr.:
`preuzmi`, `naslovModala`, `format`, `formatPdf`, `formatExcel`, `period`, `periodOvajMjesec`, `periodGodina`, `periodMjesec`, `periodRaspon`, `periodSvi`, `od`, `do`, `opseg`, `opsegSve`, `opsegFiltrirano`, `prilagodi`, `sakrij`, `brojAktivnosti` (ICU sa `{broj}`), `racunam`, `nemaFiltera`. Poštovati `procedura-i18n` (bez ICU `one` za sr).

## 7. Testovi (TDD)

1. **Unit** `izvozPeriodRange`: svaki modus → tačan `{from,to}` ili `null`; granica godine; nevažeći `od/do`.
2. **Unit/integration** count grana: vraća `{broj}` koji odgovara filterima (može preko postojećeg test harness-a za rutu ako postoji, inače tanak test resolvera + mock).
3. **E2E**: modal se otvori; default = Ovaj mjesec; "Prilagodi" otkriva opcije; izbor "Cijela godina" mijenja broj; "Preuzmi" pokreće download (provjeri response `Content-Disposition`).
4. Postojeći pdf/xlsx unit + legacy export e2e ostaju zeleni (backward-compat).

## 8. Van obima (YAGNI)

- Word/docx format.
- Sopstveni filteri unutar modala (status/klijent biraju se samo preko postojeće trake, kroz "filtrirano").
- Kvartal kao poseban preset (postoji `periodRange("kvartal")` u kodu, ali nije tražen).
- Čuvanje/pamćenje zadnjeg izbora korisnika.
- Zakazani/automatski izvoz, slanje mejlom.

## 9. Rizici / otvorena pitanja

- **Default opseg = `sve`**: znači da default download (Ovaj mjesec + Sve) ignoriše trenutne filtere trake. Predlažem `sve` radi predvidljivosti; potvrditi u planu.
- **Nevažeći raspon (od>do ili prazno)**: 400 sa porukom vs tihi fallback na `svi`. Predlažem 400.
- **Locale**: aplikacija je default `sr`; ključevi se dodaju u sva tri fajla, ali live provjera samo za aktivni locale.
- **`opseg=filtrirano` u kalendar/matrica pogledu**: filter traka postoji samo u Listi. Modal je na nivou stranice; u kalendar/matrica pogledu "filtrirano" preuzima ono što je u URL-u (može biti prazno) — sažetak filtera to jasno prikazuje.
