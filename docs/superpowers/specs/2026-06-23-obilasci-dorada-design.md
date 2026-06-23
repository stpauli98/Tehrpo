# Dizajn: Dorada Obilasci taba

**Datum:** 2026-06-23
**Status:** Odobren dizajn → spreman za plan implementacije
**Pristup:** A — izolovani zahvati, reuse-first

## Kontekst i cilj

Obilasci tab (`/obilasci`) grupiše termine **po gradu** radi efikasnog rasporeda izlazaka na teren. Toolbar: period (Mjesec/Kvartal/Godina) + mjesec/kvartal + godina. Kartice: klijent · vrsta · lokacija · datum · status; klik → `/termini?klijent_id=`.

**Glavni problem:** `lokacije.grad` praktično nije popunjen (od 33 lokacije samo 1 ima grad) → svih 849 termina ima `lokacija_grad = NULL` → sve pada u jednu grupu "Bez grada", pa tab ne daje vrijednost. Geografski podatak postoji u **nazivu** lokacije (`PRIJEDOR`, `Banja Luka - Kort`…), ali parser ga nikad ne izvlači u `grad`.

**Dvonivovska struktura (potvrđena s korisnikom):**
- **`grad`** = isključivo pravi grad (za grupisanje). Market/objekat nazivi (Kort, Delta, Emporium, Boska, Centrala, PJ, RS, FBiH) **nisu gradovi** i nikad ne ulaze u `grad`.
- **Market/objekat naziv** = drugi nivo, ostaje kao detalj lokacije na kartici (`lokacija_naziv`). Pod grupom "Banja Luka" vide se kartice s "Kort", "Delta", "Emporium".

## Global Constraints (verbatim)

- Grana: `fix/obilasci-dorada` (NE `main`).
- Cloud Supabase — e2e protiv cloud-a (`tests/e2e/db.ts`), bez lokalnog Dockera.
- Desktop-only: zabranjen `sm:`/`md:` breakpoint (ESLint). ESLint zabranjuje i `no-await-in-loop` (u testovima koristiti `Promise.all(...map())`).
- `izvediGrad` je jedini izvor istine za izvlačenje grada — koriste ga i parser i backfill skripta (DRY).
- Whitelist gradova: pravi BiH gradovi samo; market/negeo nazivi → "Bez grada".
- Default filter statusa: **Aktivni** = `status_izvedeni NOT IN (izvrseno, otkazano)`.
- AGENTS.md: NIJE standardni Next.js — kod iz spec-a/plana je tačan za ovaj codebase.

---

## Sekcija 1 — `izvediGrad` (srž)

Nova čista funkcija u `lib/obilasci.ts` (deterministička). Pravila redom:

```ts
// Whitelist pravih BiH gradova (fold ključ → kanonski oblik)
const GRADOVI_BIH: Record<string, string> = {
  "banja luka": "Banja Luka", "bijeljina": "Bijeljina", "brcko": "Brčko",
  "derventa": "Derventa", "doboj": "Doboj", "gradiska": "Gradiška",
  "istocno sarajevo": "Istočno Sarajevo", "prijedor": "Prijedor",
  "prnjavor": "Prnjavor", "trebinje": "Trebinje", "zvornik": "Zvornik",
  "laktasi": "Laktaši", "sarajevo": "Sarajevo", "mostar": "Mostar",
  "tuzla": "Tuzla", "zenica": "Zenica",
}

// fold: lowercase + skini dijakritiku (č/ć→c, š→s, ž→z, đ→d)
function foldGrad(s: string): string {
  return s.toLowerCase()
    .replace(/[čć]/g, "c").replace(/š/g, "s").replace(/ž/g, "z")
    .replace(/đ/g, "d").replace(/dž/g, "dz")
    .trim()
}

export function izvediGrad(naziv: string | null, postojeciGrad?: string | null): string | null {
  // 1. Postojeći grad se zadržava (npr. ručno postavljeni 'Laktasi')
  const pg = postojeciGrad?.trim()
  if (pg) return pg
  if (!naziv?.trim()) return null
  let s = naziv.trim()
  // 2. Višegradski (zarez) → prvi segment
  if (s.includes(",")) s = s.split(",")[0]!.trim()
  // 3. "Grad - Objekat" → prefiks prije ' - '
  if (s.includes(" - ")) s = s.split(" - ")[0]!.trim()
  // 4. Whitelist match (fold) → kanonski grad; inače null ("Bez grada")
  return GRADOVI_BIH[foldGrad(s)] ?? null
}
```

**Rezultat na trenutnim podacima:**
- `Banja Luka - Kort/Delta/Emporium/Boska` → **Banja Luka** (market ostaje u `lokacija_naziv`).
- `PRIJEDOR`, `ZVORNIK`, `BRČKO`, `DOBOJ`, `BIJELJINA`, `DERVENTA`, `GRADIŠKA`, `ISTOČNO SARAJEVO`, `PRNJAVOR`, `TREBINJE` → grad = sami.
- `ZVORNIK, BRČKO, BIJELJINA` → **Zvornik** (prvi segment).
- `KORT, DELTA` → "KORT" nije grad → **null** (Bez grada).
- `RS`, `FBiH - kancelarija`, `FBiH - skladište`, `Centrala`, `PJ 20` → **null** (Bez grada).
- `Dom zdravlja` (grad već 'Laktasi') → zadržava 'Laktasi'.

`groupByGrad` ostaje nepromijenjen (već stavlja "Bez grada" na kraj, ostalo abecedno).

---

## Sekcija 2 — Parser (budući importi/reseed)

`lib/excel/parser.types.ts`: tip `lokacije` proširiti na `{ firma_naziv: string; lokacija_naziv: string; grad: string | null }[]`.

`lib/excel/parser.ts`: u `addFirmaLokacija` (linija ~251) gdje se gradi `lokacijeArr`, dodati `grad: izvediGrad(lokacija)`:
```ts
lokacijeArr.push({ firma_naziv: firma, lokacija_naziv: lokacija, grad: izvediGrad(lokacija) })
```
Import `izvediGrad` iz `@/lib/obilasci` (ili relativno `../obilasci` ako alias ne radi u parser kontekstu — provjeriti postojeće importe parsera).

`scripts/seed-from-excel.ts`: `LokacijaRow` (linija 103) → `{ klijent_id: string; naziv: string; grad: string | null }`; push (linija 113) → `{ klijent_id: klijentId, naziv: lok.lokacija_naziv, grad: lok.grad }`. Upsert već radi onConflict `(klijent_id, naziv)` — `grad` se piše uz njega.

Tako svaki reseed iz Excela popunjava `grad` automatski.

---

## Sekcija 3 — Backfill postojećih (cloud, bez reseeda)

Nova skripta `scripts/backfill-lokacija-grad.mjs` (ESM, čita `.env.local`, koristi `SUPABASE_SERVICE_ROLE_KEY`):
- Učita sve `lokacije` (`id, naziv, grad`).
- Za svaku izračuna `noviGrad = izvediGrad(naziv, grad)`.
- Ažurira **samo** redove gdje se `grad` mijenja (ne dira termine; `termini_view` već izlaže `lokacija_grad`).
- Ispiše sažetak: koliko ažurirano, koliko ostalo "Bez grada", distribuciju gradova.

**Odluka (precizno):** napisati kao `scripts/backfill-lokacija-grad.ts` (konzistentno sa `seed-from-excel.ts`). Importi: `createAdminSupabaseClient` iz `../lib/supabase/admin`, `izvediGrad` iz `../lib/obilasci`. Dodati npm script u `package.json`: `"backfill:grad": "tsx --env-file=.env.local scripts/backfill-lokacija-grad.ts"`. Pokreće se sa `pnpm backfill:grad`. (`tsx --env-file` učitava `.env.local`; admin klijent koristi `SUPABASE_SERVICE_ROLE_KEY`.)

---

## Sekcija 4 — Filter statusa (UX)

`components/domain/ObilasciToolbar.tsx`: dodati status `Select` (uz period/godina). Opcije i default:
- `aktivni` — **Default** ("Aktivni"); server: `status_izvedeni NOT IN (izvrseno, otkazano)`.
- `svi` — bez filtera.
- `kasni`, `planirano`, `zakazano`, `izvrseno`, `otkazano` — `eq`.

`data-testid="obilasci-status"`. Vrijednost iz `sp.get("status") ?? "aktivni"`; `onValueChange` → `setParam("status", v)` (postojeći helper).

`app/(dashboard)/obilasci/page.tsx`: pročitati `status` (default `"aktivni"`), primijeniti na upit:
```ts
const status = typeof sp.status === "string" ? sp.status : "aktivni"
let q = supabase.from("termini_view").select(...).gte(...).lte(...)
if (status === "aktivni") q = q.not("status_izvedeni", "in", "(izvrseno,otkazano)")
else if (status !== "svi") q = q.eq("status_izvedeni", status)
q = q.order("lokacija_grad").order("rok_dospijeca")
```

---

## Sekcija 5 — Broj po gradu (UX)

`app/(dashboard)/obilasci/page.tsx`: u zaglavlju grupe dodati broj termina:
```tsx
<h2 className="font-semibold">{g.grad} <span className="text-slate-400 font-normal">({g.items.length})</span></h2>
```

---

## Verifikacija (gate)

`pnpm lint && pnpm typecheck && pnpm build` + unit (`lib/obilasci.test.ts` proširen za `izvediGrad`) + Playwright protiv cloud-a (nakon backfilla):
- `izvediGrad` jedinični: svi gore navedeni slučajevi (Banja Luka - Kort → Banja Luka, KORT/RS/FBiH/PJ → null, ZVORNIK,… → Zvornik, postojeći grad se čuva, dijakritika fold).
- Nakon backfilla: `/obilasci` prikazuje **više grupa gradova** (ne samo "Bez grada"); `obilasci-grupa` count > 1.
- Status filter: default "Aktivni" → nema izvršenih/otkazanih kartica; "Svi" → vraća izvršene.
- Broj po gradu vidljiv u zaglavlju.
- Regresija: `12-obilasci` ostaje zelen (uz eventualnu adaptaciju jer grupe više nisu sve "Bez grada").

## Van opsega (YAGNI)

- Ručni override KORT/DELTA → grad (odabran "prvi grad"/whitelist; ostaju "Bez grada").
- Izmjena klik-cilja kartice; ukupni zbir na vrhu stranice.
- Grad iz "mušterije"/klijenta (nemamo pouzdan izvor; kasnije iz pravih podataka).
