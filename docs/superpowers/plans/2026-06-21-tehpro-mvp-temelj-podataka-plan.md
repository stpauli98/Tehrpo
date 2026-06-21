# Temelj podataka — Firma/Lokacija hijerarhija + ispravan import + interval po vrsti (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ispraviti import Tehpro Excela tako da podaci postanu tačni i skalabilni: dvoblokovni parser (pregledi + OBILASCI), hijerarhija **firma → lokacija** (umjesto trenutnih lokacija-nivoa "klijenata"), kanonizacija duplikata, i konfigurabilan **interval po vrsti** (postojeća kolona) koji oživi auto-cycle.

**Architecture:** `klijenti` tabela = FIRME (WAIKIKI, NEW YORKER, TRANSFERA, CARMEUSE…); `lokacije` se puni (WAIKIKI → Banja Luka - Delta, Zvornik…); `termini.klijent_id` = firma, `termini.lokacija_id` = lokacija. Parser razdvaja dva bloka po sheet-u i mapira složene Excel nazive na (firma, lokacija) preko **whitelist-a poznatih firmi** + kanonizacijske mape. Interval po vrsti koristi POSTOJEĆU kolonu `vrste_provjera.podrazumevani_interval_mjeseci` (triggeri je već čitaju) — dodaje se samo UI u /postavke. Jedina nužna schema izmjena je popravka `klijenti_view` fanout buga + `UNIQUE(lokacije.klijent_id, naziv)` + opcioni auto-cycle guard.

**Tech Stack:** Next.js 16.2.9, React 19, Supabase JS SDK + lokalni Docker, exceljs (parser), tsx (seed), Zod v4, Tailwind v4 + @base-ui/react, Vitest, Playwright.

## Global Constraints

- **Local-only**: Docker Supabase (`supabase_db_tehpro-mvp`), psql preko `docker exec`. Migracije `pnpm db:reset && pnpm seed`. Git push na kraju. Bez Vercel/cloud.
- **Tačna imena tabela**: `klijenti` (=firme), `lokacije`, `termini`, `vrste_provjera` (NE `vrste_provjere`), `podsjetnici`, `postavke`.
- **Postojeće kolone — NE praviti duplikate**: `termini.lokacija_id` (FK→lokacije, ON DELETE SET NULL) i `termini.interval_mjeseci` već postoje; `vrste_provjera.podrazumevani_interval_mjeseci` (CHECK 1..120) već postoji i triggeri je koriste. NE dodavati `vrste_provjera.interval_mjeseci`.
- **Triggeri (NE mijenjati osim T2 guarda)**: `tg_termini_compute_rok` već radi `rok = datum_zadnjeg + coalesce(termin.interval_mjeseci, vrsta.podrazumevani_interval_mjeseci) mjeseci`; `tg_termini_auto_cycle` kopira interval + postavlja `datum_zadnjeg = datum_izvrsenja` na novom terminu.
- **`klijent_id` semantika**: termini.klijent_id → FIRMA (parent); termini.lokacija_id → konkretna lokacija (NULL ako firma nema lokacije / za Block-1 vrste bez lokacije).
- **Reseed redoslijed (FK)**: termini (ON DELETE RESTRICT na klijent/vrsta) → obrisati termine PRVO, pa lokacije, pa klijente/vrste, pa re-import. Seed mora biti idempotentan.
- **TS strict** (noUncheckedIndexedAccess, noUnused*); **ESLint** `no-await-in-loop` (scripts/ izuzet) + bez `sm:`/`md:`. pnpm. `@/` alias radi u app kodu; u vitest testovima koristiti **relativne** importe (alias puca na spaced path — postojeći pattern).
- **Bez dummy podataka**: seed isključivo iz stvarnog Excela; interval ostaje NULL dok ga korisnik ne unese u /postavke.
- **Kanonizacija je lossy** → mapiranje firma/lokacija/vrsta mora proći **human-confirm gate** (Task 3) prije konačnog reseed-a.

## Ključne odluke (default; potvrđuju se u Task 3 gate-u)
1. **Firma split = whitelist prefix-match** (NE naivni delimiter split, jer "NEW YORKER"/"MARKET AS"/"DOM ZDRAVLJA" imaju 2 riječi). Lokacija = ostatak nakon firme (strip vodećih `-`/razmaka). Bez ostatka → lokacija NULL.
2. **TRANSFERA** = jedna firma sa lokacijama `RS`, `FBiH - skladište`, `FBiH - kancelarija` (varijante `FBIH skladište`/`FBIH SKLADIŠTE` → `FBiH - skladište`).
3. **Range-datum** (`21.-22.01.2026.`, `21.01.-22.01.2026.`) → uzeti **početni** datum.
4. **auto-cycle bez intervala** → **preskočiti** kreiranje sljedećeg termina (guard `v_interval IS NOT NULL`) da se ne pravi smeće-termin koji odmah "kasni".
5. **Interval** = postojeća `vrste_provjera.podrazumevani_interval_mjeseci`; samo UI u /postavke.
6. **OBILASCI** blok → vrsta `"Obilazak"`; klijent = ime iz kolone A (isto firma/lokacija mapiranje).

---

## File Structure

**Izmijenjeno:**
- `lib/excel/parser.ts` — dvoblokovni parser, firma/lokacija split, kanonizacija, range-datumi, drop "po ugovoru".
- `lib/excel/parser.types.ts` — `ParsedTermin` + `firma_naziv`, `lokacija_naziv`; `ParseResult` + `firme`, `lokacije`.
- `lib/excel/parser.test.ts` + `tests/fixtures/tehpro-mini.xlsx` — novi scenariji (2 bloka, OBILASCI, "po ugovoru", range, duplikati).
- `scripts/seed-from-excel.ts` — firme→lokacije→termini(lokacija_id)→vrste(+Obilazak).
- `app/(dashboard)/postavke/page.tsx` + `app/(dashboard)/postavke/actions.ts` — sekcija intervala.
- `components/domain/NoviTerminButton.tsx` + `app/(dashboard)/termini/actions.ts` — lokacija picker + lokacija_id.
- `components/domain/TerminiFilters.tsx` + `app/(dashboard)/termini/page.tsx` — opcioni lokacija filter.
- `components/domain/PrikazToolbar.tsx` + `app/(dashboard)/prikaz/page.tsx` — opcioni lokacija filter.
- `app/(dashboard)/plan/page.tsx` + `components/domain/MonthCalendar.tsx` — firma · lokacija prikaz.
- `tests/e2e/*` — ažurirati dropdown-zavisne testove; novi 07 spec.

**Novo:**
- `supabase/migrations/<ts>_temelj_firma_lokacija.sql` — `UNIQUE(lokacije.klijent_id, naziv)`, fix `klijenti_view` fanout, auto-cycle guard.
- `components/domain/IntervaliForm.tsx` — uređivanje intervala po vrsti.
- `scripts/preview-import.ts` — dump mapiranja (firme/lokacije/vrste/termini) za Task 3 gate.
- `tests/e2e/07-temelj.spec.ts` — firma/lokacija + interval + auto-cycle.

---

## Task 1: Parser rewrite (dva bloka + firma/lokacija + kanonizacija)

**Files:**
- Modify: `lib/excel/parser.ts`, `lib/excel/parser.types.ts`
- Test: `lib/excel/parser.test.ts`, `tests/fixtures/tehpro-mini.xlsx`
- Create: `scripts/preview-import.ts`

**Interfaces — Produces:**
- `type ParsedTermin = { firma_naziv: string; lokacija_naziv: string | null; vrsta_naziv: string; sheet_naziv: string; datum: string; izvor: "izvrseno" | "planirano" }`
- `type ParseResult = { firme: string[]; lokacije: { firma_naziv: string; lokacija_naziv: string }[]; vrste: string[]; termini: ParsedTermin[]; skipped: SkippedRow[] }`
- `parseTehproExcel(filePath: string): Promise<ParseResult>`
- `splitFirmaLokacija(naziv: string): { firma: string; lokacija: string | null }` (export za test)
- `canonicalizeNaziv(naziv: string): string` (export za test)
- `parseStringDate(s: string): string | null` (proširen za range)

**Konstante u parser.ts (verbatim — kanonizacijska osnova):**
```ts
// Poznate firme (whitelist prefix-match). Sortiraj po dužini DESC u kodu da duži
// prefiks pobijedi (npr. "MARKET AS" prije "AS"). NE oslanjaj se na redoslijed liste.
const POZNATE_FIRME = [
  "DOM ZDRAVLJA", "EKONOMSKI INSTITUT", "GRANT THORNTON", "NEW YORKER",
  "MARKET AS", "NTS NETWORK", "CLEAN TRADE", "MIKROELEKTRONIKA",
  "WAIKIKI", "TRANSFERA", "CARMEUSE", "VENETO", "DIORIT", "DEVTECH",
  "MINT", "YIMMOR", "AS",
] as const
const FIRME_SORTED = [...POZNATE_FIRME].sort((a, b) => b.length - a.length)

// Per-firma kanonizacija LOKACIJE (rješava TRANSFERA fragmentaciju: 6 varijanti → 3 lokacije).
// Ulaz je već canonicalizeNaziv-ovan ostatak (UPPERCASE). Vrati kanonsku lokaciju.
function canonLokacija(firma: string, lokRaw: string | null): string | null {
  if (lokRaw == null) return null
  const u = lokRaw.toUpperCase()
  if (firma === "TRANSFERA") {
    if (/SKLADI[SŠ]TE/.test(u)) return "FBiH - skladište"
    if (/KANCELARIJA/.test(u)) return "FBiH - kancelarija"
    if (u === "RS") return "RS"
    if (u === "FBIH") return "FBiH"   // gola "TRANSFERA FBIH" (samo u OBILASCI) — zadrži kao FBiH
  }
  return lokRaw // ostale firme: lokacija = ostatak kakav jeste (Title-case za prikaz po želji)
}
```
> Invarijanta (dodaj test): nijedan unos u POZNATE_FIRME nije `"<drugi> "` prefiks — first-match po `FIRME_SORTED` tada daje tačan rezultat.

- [ ] **Step 1: `canonicalizeNaziv` + `splitFirmaLokacija` + range-datum (TDD — test prvo)**

Napiši u `parser.test.ts` (relativni importi `./parser`):
```ts
import { describe, it, expect } from "vitest"
import { canonicalizeNaziv, splitFirmaLokacija, parseStringDate } from "./parser"

describe("canonicalizeNaziv", () => {
  it("uppercase, kolaps razmaka, skida završnu tačku", () => {
    expect(canonicalizeNaziv("  Ekonomski   institut. ")).toBe("EKONOMSKI INSTITUT")
  })
})

describe("splitFirmaLokacija", () => {
  it("WAIKIKI BANJA LUKA - DELTA → firma WAIKIKI, lok 'Banja Luka - Delta'", () => {
    const r = splitFirmaLokacija("WAIKIKI BANJA LUKA - DELTA")
    expect(r.firma).toBe("WAIKIKI")
    expect(r.lokacija?.toUpperCase()).toBe("BANJA LUKA - DELTA")
  })
  it("NEW YORKER - Doboj → firma 'NEW YORKER', lok 'Doboj'", () => {
    const r = splitFirmaLokacija("NEW YORKER - Doboj")
    expect(r.firma).toBe("NEW YORKER")
    expect(r.lokacija?.toUpperCase()).toBe("DOBOJ")
  })
  it("MARKET AS - PJ 20 → firma 'MARKET AS' (NE 'AS'), lok 'PJ 20'", () => {
    expect(splitFirmaLokacija("MARKET AS - PJ 20").firma).toBe("MARKET AS")
  })
  it("AS → firma AS, lok null", () => {
    expect(splitFirmaLokacija("AS")).toEqual({ firma: "AS", lokacija: null })
  })
  it("CARMEUSE → firma CARMEUSE, lok null", () => {
    expect(splitFirmaLokacija("CARMEUSE")).toEqual({ firma: "CARMEUSE", lokacija: null })
  })
  it("TRANSFERA varijante → jedna firma, 3 kanonske lokacije", () => {
    expect(splitFirmaLokacija("TRANSFERA RS")).toEqual({ firma: "TRANSFERA", lokacija: "RS" })
    // skladište: sa i bez crtice/case → ista lokacija
    expect(splitFirmaLokacija("TRANSFERA FBiH - skladište").lokacija).toBe("FBiH - skladište")
    expect(splitFirmaLokacija("TRANSFERA FBIH skladište").lokacija).toBe("FBiH - skladište")
    expect(splitFirmaLokacija("TRANSFERA FBIH SKLADIŠTE").lokacija).toBe("FBiH - skladište")
    // kancelarija: gola i FBIH varijanta → ista lokacija
    expect(splitFirmaLokacija("TRANSFERA FBiH - kancelarija").lokacija).toBe("FBiH - kancelarija")
    expect(splitFirmaLokacija("TRANSFERA kancelarija").lokacija).toBe("FBiH - kancelarija")
  })
  it("invarijanta: nijedan POZNATE_FIRME unos nije ' '-prefiks drugog", () => {
    for (const a of POZNATE_FIRME) for (const b of POZNATE_FIRME) {
      if (a !== b) expect(b.startsWith(a + " ")).toBe(false)
    }
  })
})

describe("parseStringDate (range)", () => {
  it("'21.-22.01.2026.' → početni 2026-01-21", () => {
    expect(parseStringDate("21.-22.01.2026.")).toBe("2026-01-21")
  })
  it("'21.01.-22.01.2026.' → 2026-01-21", () => {
    expect(parseStringDate("21.01.-22.01.2026.")).toBe("2026-01-21")
  })
  it("obična '20.01.2026.' i dalje radi", () => {
    expect(parseStringDate("20.01.2026.")).toBe("2026-01-20")
  })
})
```
Run: `pnpm test:unit -- lib/excel/parser.test.ts` → RED.

- [ ] **Step 2: Implementiraj helpere u `parser.ts`**

`canonicalizeNaziv`: `raw.replace(/\s+/g," ").trim().replace(/\.$/,"").replace(/\s*-\s*/g," - ").toUpperCase()`. (Dijakritika ostaje — Š/Ž isti u oba izvora.)

`splitFirmaLokacija(naziv)`: `const c = canonicalizeNaziv(naziv)`; iteriraj `FIRME_SORTED` (dužina DESC): ako `c === firma` → `{firma, lokacija: null}`; ako `c.startsWith(firma + " ")` → `const ostatak = c.slice(firma.length).replace(/^[\s-]+/,"").trim()` pa `{firma, lokacija: canonLokacija(firma, ostatak || null)}`. Ako nijedna firma ne matchuje → `{firma: c, lokacija: null}` (cijeli naziv = firma; dodaj u skipped-firme listu za T3 gate pregled). **Eksportuj `POZNATE_FIRME`, `canonicalizeNaziv`, `splitFirmaLokacija` (za test).**

`parseStringDate(s)`: prvo `s = s.trim()`. Probaj redom (vrati prvi match):
```ts
// 1) datum + tekst iza ("25.06.2026. servis", "10.04.2026. , 17.04.2026.") → vodeći datum
let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?(?:\s|,|$)/)
if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`
// 2) 'D.-D.M.YYYY.' (npr. 21.-22.01.2026.) → početni
m = s.match(/^(\d{1,2})\.-\d{1,2}\.(\d{1,2})\.(\d{4})\.?$/)
if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`
// 3) 'D.M.-D.M.YYYY.' → početni
m = s.match(/^(\d{1,2})\.(\d{1,2})\.-\d{1,2}\.\d{1,2}\.(\d{4})\.?$/)
if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`
// 4) 'D-D.M.YYYY.' (crtica bez tačke, npr. 03-04.04.2026.) → početni
m = s.match(/^(\d{1,2})-\d{1,2}\.(\d{1,2})\.(\d{4})\.?$/)
if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`
// 5) ISO
if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
return null
```
Preostali typo/tekst formati (`maj 2026.`, `25.0-26.02.2026.`, `21.05.2026-`) ostaju `null` → skipped (prikazuju se u T3 gate-u). Run Step-1 testove → GREEN.

> Napomena: `parseStringDate` se koristi unutar `extractDate(raw)` (već postoji) koji ranije hvata `Date`/serial ćelije; OBILASCI ćelije su uglavnom string pa idu kroz `parseStringDate`, ali OBAVEZNO koristi `extractDate` (ne direktno `parseStringDate`) pri parsiranju ćelija jer neke mogu biti `Date`/broj.

- [ ] **Step 3: Dvoblokovni parse — test (fixture) + implementacija**

**STVARNA OBILASCI struktura (verifikovano, svih 12 sheet-ova):** R26 colA = `OBILASCI`; **R27 = header sa labelama: col2 `Planirano`, col4 `Izvršeno`** (obrnut/drugačiji od Block1!). Za svaki OBILASCI red (R28+): colA = ime klijenta; date-ćelije su u **kolonama 2–3 (PLANIRANO par)** i **4–5 (IZVRŠENO par)** — NE u širokim Row2 klijent-kolonama. Svaka ne-prazna date-ćelija = zaseban `Obilazak` termin sa odgovarajućim izvorom.

Regeneriši `tests/fixtures/tehpro-mini.xlsx` (preko exceljs skripta): Row1 FIRME; Row2 klijenti u parovima (`WAIKIKI ZVORNIK` col2-3, `CARMEUSE` col4-5, + zadnji stub `po ugovoru`); Row3 (`Izvršeno:`/`Planirano:`); Block1 R4–5 (`Servis PP aparata`, `Ispitivanje hidranata`) sa datumom u col2 (WAIKIKI izvršeno); **R6 colA=`OBILASCI`; R7 header col2=`Planirano` col4=`Izvršeno`; R8 colA=`NEW YORKER - Doboj`, col2=`21.-22.01.2026.` (planirano), col4=`15.01.2026.` (izvršeno)**. Test:
```ts
import { parseTehproExcel } from "./parser"
it("razdvaja Block1 (vrste) i Block2 (OBILASCI: planirano 2-3, izvrseno 4-5), izbacuje 'po ugovoru'", async () => {
  const res = await parseTehproExcel("tests/fixtures/tehpro-mini.xlsx")
  expect(res.firme).toContain("WAIKIKI"); expect(res.firme).toContain("CARMEUSE")
  expect(res.firme).not.toContain("PO UGOVORU")
  expect(res.vrste).toContain("Obilazak")
  expect(res.vrste).toContain("Servis PP aparata")
  const obs = res.termini.filter(t => t.vrsta_naziv === "Obilazak")
  // NEW YORKER - Doboj obilazak: planirani (21.01) i izvršeni (15.01) → DVA termina, tačan izvor
  const plan = obs.find(t => t.izvor === "planirano")
  const izvr = obs.find(t => t.izvor === "izvrseno")
  expect(plan?.firma_naziv).toBe("NEW YORKER"); expect(plan?.datum).toBe("2026-01-21")
  expect(izvr?.datum).toBe("2026-01-15")
  expect(res.lokacije.some(l => l.firma_naziv === "WAIKIKI" && /ZVORNIK/i.test(l.lokacija_naziv ?? ""))).toBe(true)
})
```
Implementacija u `parseTehproExcel`, po sheet-u:
1. Nađi `obilasciRow` = prvi red gdje `canonicalizeNaziv(colA) === "OBILASCI"` (ne hardkoduj 26).
2. **Block1** = `4..obilasciRow-1`: postojeća logika — `vrsta = normalizeVrsta(colA)`, klijent-parovi iz Row2 (col `i` izvršeno, `i+1` planirano), **preskoči** kolonu gdje je `canonicalizeNaziv(row2)==="PO UGOVORU"` ili `row3` (col `i`) sadrži `PO PONUDI`. Datumi preko `extractDate`.
3. **Block2 (OBILASCI)** = od `obilasciRow+2..rowCount` (preskoči header `obilasciRow+1`). Iz header reda (`obilasciRow+1`) nađi kolonu sa `PLANIRANO` (→ `pCol`) i `IZVRŠENO`/`IZVRSENO` (→ `iCol`); date-slotovi: planirano = `[pCol, pCol+1]`, izvršeno = `[iCol, iCol+1]` (fallback ako header prazan: planirano `[2,3]`, izvršeno `[4,5]`). Za svaki red: `klijentNaziv = colA` (preskoči prazan); za svaki slot-kolonu sa `extractDate(cell) != null` → emit `{vrsta_naziv:"Obilazak", izvor, datum}`.
4. Za SVAKI termin (oba bloka): `const {firma, lokacija} = splitFirmaLokacija(klijentNaziv)` → `firma_naziv=firma, lokacija_naziv=lokacija`. Popuni `firme` (Set), `lokacije` (dedup `{firma_naziv, lokacija_naziv}` gdje `lokacija!=null`), `vrste` (kanonske vrste iz Block1 + `"Obilazak"`).

Run → GREEN.

- [ ] **Step 4: `scripts/preview-import.ts` (za Task 3 gate)**

```ts
import { parseTehproExcel } from "@/lib/excel/parser"
const PATH = "/Users/nmil/Desktop/Ai Forward/2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx"
async function main() {
  const r = await parseTehproExcel(PATH)
  console.log("FIRME ("+r.firme.length+"):", r.firme.sort().join(" | "))
  console.log("\nLOKACIJE ("+r.lokacije.length+"):")
  for (const f of r.firme.sort()) {
    const ls = r.lokacije.filter(l => l.firma_naziv === f).map(l => l.lokacija_naziv)
    if (ls.length) console.log("  "+f+": "+ls.join(", "))
  }
  console.log("\nVRSTE ("+r.vrste.length+"):", r.vrste.sort().join(" | "))
  console.log("\nTERMINI:", r.termini.length, "| skipped:", r.skipped.length)
  console.log("Obilazak termina:", r.termini.filter(t=>t.vrsta_naziv==="Obilazak").length)
  // skipped po sheet-u (da čovjek vidi koliko se gubi prije reseed-a)
  const bySheet: Record<string, number> = {}
  for (const s of r.skipped) bySheet[s.sheet] = (bySheet[s.sheet] ?? 0) + 1
  console.log("\nSKIPPED po sheet-u:", JSON.stringify(bySheet))
}
main().catch(e => { console.error(e); process.exit(1) })
```
Dodaj npm script `"preview:import": "tsx --env-file=.env.local scripts/preview-import.ts"`. Run: `pnpm preview:import` — vrste NE smiju sadržavati imena firmi; firme ~17; lokacije popunjene za lance.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `pnpm test:unit -- lib/excel/parser.test.ts && pnpm typecheck && pnpm lint`
```bash
git add lib/excel scripts/preview-import.ts package.json tests/fixtures
git commit -m "feat(temelj): dvoblokovni parser + firma/lokacija split + kanonizacija + range datumi"
```

---

## Task 2: Schema migracija (lokacije unique + klijenti_view fanout fix + auto-cycle guard)

**Files:** Create `supabase/migrations/<ts>_temelj_firma_lokacija.sql`; regen `db/types.ts`.

**Interfaces — Produces:** `UNIQUE(lokacije.klijent_id, naziv)`; `klijenti_view` bez fanout-a; `tg_termini_auto_cycle` preskače kad nema intervala.

- [ ] **Step 1: Migracija**
```sql
-- Temelj: idempotentne lokacije, klijenti_view fanout fix, auto-cycle guard

-- 1. idempotentan seed lokacija (firma + naziv jedinstveni)
create unique index if not exists uq_lokacije_klijent_naziv on lokacije (klijent_id, naziv);

-- 2. klijenti_view — ukloniti kartezijev fanout (count(tv.id) uz LEFT JOIN lokacije)
--    razdvojiti agregaciju lokacija od termina preko odvojenih subquery-ja
create or replace view klijenti_view as
select
  k.id, k.naziv, k.napomena, k.created_at, k.updated_at,
  coalesce(lok.broj_lokacija, 0)   as broj_lokacija,
  coalesce(t.broj_termina, 0)      as broj_termina,
  coalesce(t.broj_aktivnih, 0)     as broj_aktivnih,
  coalesce(t.broj_kasni, 0)        as broj_kasni,
  coalesce(t.broj_izvrseno, 0)     as broj_izvrseno
from klijenti k
left join (
  select klijent_id, count(*) as broj_lokacija from lokacije group by klijent_id
) lok on lok.klijent_id = k.id
left join (
  select klijent_id,
    count(*) as broj_termina,
    count(*) filter (where status_izvedeni in ('planirano','zakazano')) as broj_aktivnih, -- BEZ 'kasni' (isključivo sa broj_kasni; isto kao stara def)
    count(*) filter (where status_izvedeni = 'kasni') as broj_kasni,
    count(*) filter (where status = 'izvrseno') as broj_izvrseno
  from termini_view group by klijent_id
) t on t.klijent_id = k.id;
```
> **VAŽNO:** Gornji `filter` uslovi su usklađeni sa STAROM definicijom (`broj_aktivnih` = `planirano`/`zakazano` BEZ `kasni`; `broj_kasni` = `kasni`; `broj_izvrseno` = `status='izvrseno'`). Prije commit-a uporedi sa `docker exec ... psql -c "select pg_get_viewdef('klijenti_view', true);"` da bude 1:1 (samo bez fanout-a). Cilj: identičan rezultat za 0–1 lokaciju, tačan za >1.

```sql
-- 3. auto-cycle: ne praviti sljedeći termin ako nema intervala (inače rok = isti dan)
create or replace function tg_termini_auto_cycle() returns trigger
language plpgsql as $$
declare v_interval int;
begin
  if (OLD.datum_izvrsenja is null and NEW.datum_izvrsenja is not null
      and NEW.status = 'izvrseno' and OLD.status is distinct from 'izvrseno') then
    v_interval := coalesce(NEW.interval_mjeseci,
      (select podrazumevani_interval_mjeseci from vrste_provjera where id = NEW.vrsta_provjere_id));
    if v_interval is not null then
      insert into termini (klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
        datum_zadnjeg, rok_dospijeca, status)
      values (NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
        NEW.datum_izvrsenja, NEW.datum_izvrsenja, 'planirano');
    end if;
  end if;
  return NEW;
end;
$$;
```
> Pročitaj POSTOJEĆU `tg_termini_auto_cycle` (u `20260620201630_triggers.sql` + `20260620222606_auto_cycle_guard_izvrseno.sql`) i zadrži tačan INSERT spisak kolona; jedina izmjena je `if v_interval is not null then` omotač. Trigger binding (`tg_termini_auto_cycle_au`) ostaje.

- [ ] **Step 2: Primijeni + verifikuj + regen + commit**

`pnpm db:reset && pnpm seed` (još stari seed — proći će), pa:
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "\d lokacije" # uq index
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select * from klijenti_view limit 2;"
```
`pnpm db:types && pnpm typecheck`.
```bash
git add supabase/migrations db/types.ts
git commit -m "feat(temelj): lokacije unique + klijenti_view fanout fix + auto-cycle interval guard"
```

---

## Task 3: Seed rewrite + human-confirm gate

**Files:** Modify `scripts/seed-from-excel.ts`.

**Interfaces — Consumes:** `ParseResult` (T1). **Produces:** popunjene `klijenti`(firme) / `lokacije` / `termini`(klijent_id=firma, lokacija_id) / `vrste_provjera`(+Obilazak, interval NULL).

- [ ] **Step 1: Reseed redoslijed (idempotentan)**
```ts
// redoslijed zbog FK (termini ON DELETE RESTRICT):
// 1) delete termini  2) delete lokacije  3) upsert klijenti(firme) onConflict naziv
// 4) upsert vrste_provjera(+'Obilazak') onConflict naziv (interval NETAKNUT)
// 5) upsert lokacije onConflict (klijent_id,naziv) → mapa (firmaId|lokNaziv)->lokId
// 6) insert termini: klijent_id=firmaId, lokacija_id=lokId|null, vrsta_provjere_id, status
```
Implementiraj: parse → mape `firma->id`, `vrsta->id`, `(firmaId+lokNaziv)->lokId`. Termin status: `izvrseno` ako `izvor==="izvrseno"` (+ `datum_izvrsenja=datum`), inače `planirano` (+ `rok_dospijeca=datum`). Batch insert 500 (scripts/ izuzet od no-await-in-loop). NE postavljati interval (ostaje NULL → korisnik u /postavke).

- [ ] **Step 2: Run + HUMAN-CONFIRM GATE**

`pnpm db:reset && pnpm seed`. Onda dump za pregled:
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select naziv, (select count(*) from lokacije l where l.klijent_id=k.id) lok from klijenti k order by naziv;"
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select naziv from vrste_provjera order by naziv;" # SAMO vrste, bez imena firmi
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "select count(*) ukupno, count(lokacija_id) sa_lokacijom from termini;"
```
**GATE (KONTROLER izvršava — NIJE subagent-delegabilno; subagent ne može pauzirati i čekati ljudski unos):** Glavni agent pokrene `pnpm preview:import` (skipped count po sheet-u) + gornje psql dump-ove i prikaže korisniku: (1) spisak firmi (~17); (2) lokacije po firmi — **TRANSFERA mora imati TAČNO 3 lokacije** (RS, FBiH - skladište, FBiH - kancelarija); (3) spisak vrsta (mora biti BEZ imena firmi, + `Obilazak`); (4) broj termina / sa lokacijom / skipped. Napomena za korisnika: lokacije sa zarezom (`WAIKIKI - Zvornik, Brčko, Bijeljina`, `NEW YORKER - Kort, Delta`) ostaju jedna lokacija (MVP). **Sačekaj eksplicitnu potvrdu** prije Task 3 Step 3 i nizvodnih taskova (kanonizacija je lossy). Ako korisnik traži ispravke → vrati se na Task 1 (`POZNATE_FIRME` / `canonLokacija`) i ponovi preview.

- [ ] **Step 3: Commit**
```bash
git add scripts/seed-from-excel.ts
git commit -m "feat(temelj): seed firme→lokacije→termini(lokacija_id) + vrsta Obilazak"
```

---

## Task 4: Novi termin lokacija picker + termini filteri

**Files:** `components/domain/NoviTerminButton.tsx`, `app/(dashboard)/termini/actions.ts` (createTermin), `components/domain/TerminiFilters.tsx`, `app/(dashboard)/termini/page.tsx`.

**Interfaces — Produces:** create termin upisuje `lokacija_id`; opcioni `?lokacija=` filter.

- [ ] **Step 1: createTermin prima + VALIDIRA lokacija_id**

U `termini/actions.ts` createTermin: dodaj `lokacija_id: z.string().uuid().optional()` u schemu. **Integritet (obavezno):** ako je `lokacija_id` prisutan, prije INSERT-a provjeri da pripada izabranom klijentu (firmi):
```ts
if (parsed.data.lokacija_id) {
  const { data: lok } = await supabase
    .from("lokacije").select("id")
    .eq("id", parsed.data.lokacija_id).eq("klijent_id", parsed.data.klijent_id).maybeSingle()
  if (!lok) return { ok: false, message: "Lokacija ne pripada izabranom klijentu." }
}
```
INSERT doda `lokacija_id: parsed.data.lokacija_id ?? null`. (Pročitaj postojeći createTermin i uklopi po patternu.)

- [ ] **Step 2: NoviTerminButton — lokacija Select zavisan od firme**

Page (`termini/page.tsx`) prosljeđuje formi listu firmi + njihovih lokacija (`klijenti` + `lokacije` grupisano: `{ firmaId, lokacije: {id,naziv}[] }`). U formi: kad se izabere Klijent(firma), prikaži Select "Lokacija" sa lokacijama te firme (sakrij/disable ako firma nema lokacija). **Pri promjeni firme RESETUJ izabranu lokaciju na "" (state)** — inače stale `lokacija_id` druge firme ostane i server validacija (Step 1) ga odbije. Pošalji `lokacija_id` (prazno = ne šalji / null). Slijedi postojeći base-ui Select pattern (vidi Vrsta select). testid `novi-lokacija`.

- [ ] **Step 3: TerminiFilters + page lokacija filter**

`TerminiFilters`: "Svi klijenti" dropdown sada lista FIRME (manje opcija). Dodaj opcioni "Lokacija" dropdown (testid `filter-lokacija`) koji se puni lokacijama izabrane firme; URL `?lokacija=<id>`. **Pri promjeni firme (klijent param) OBAVEZNO obriši `lokacija` iz URL-a** (`next.delete("lokacija")`) — inače stale lokacija filtrira po lokaciji druge firme → prazna lista. `termini/page.tsx`: ako `?lokacija` → `listQuery.eq("lokacija_id", lokacija)`. `q` već hvata `lokacija_naziv`. (Lokacija dropdown sakrij/disable kad nema izabrane firme.)

- [ ] **Step 4: Build + verify + commit**

`pnpm build && pnpm typecheck && pnpm lint`. Ručno (dev server na :3000): /termini lista pokazuje lokaciju u koloni; Novi termin sa lokacijom upiše `lokacija_id` (provjeri psql). Commit `feat(temelj): novi termin lokacija picker + lokacija filter`.

---

## Task 5: /postavke — Intervali po vrsti

**Files:** `app/(dashboard)/postavke/page.tsx`, `app/(dashboard)/postavke/actions.ts`, `components/domain/IntervaliForm.tsx`.

**Interfaces — Produces:** `updateIntervali` action; UI edituje `vrste_provjera.podrazumevani_interval_mjeseci`.

- [ ] **Step 1: `updateIntervali` server action**

U `postavke/actions.ts`:
```ts
const intervalSchema = z.object({
  // forma šalje "interval_<uuid>" = "" | "1".."120"
}).passthrough()

export async function updateIntervali(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const entries = [...formData.entries()].filter(([k]) => k.startsWith("interval_"))
  const updates: { id: string; val: number | null }[] = []
  for (const [k, raw] of entries) {
    const id = k.slice("interval_".length)
    const s = String(raw).trim()
    if (s === "") { updates.push({ id, val: null }); continue }
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1 || n > 120) {
      return { ok: false, message: `Interval mora biti 1–120 (ili prazno). Greška: ${s}` }
    }
    updates.push({ id, val: n })
  }
  const supabase = await createServerSupabaseClient()
  // bez await-in-loop: Promise.all
  const results = await Promise.all(updates.map(u =>
    supabase.from("vrste_provjera").update({ podrazumevani_interval_mjeseci: u.val }).eq("id", u.id)
  ))
  const err = results.find(r => r.error)
  if (err?.error) return { ok: false, message: err.error.message }
  revalidatePath("/postavke")
  return { ok: true }
}
```
> Napomena: ovo je app kod (lib/app), `no-await-in-loop` vrijedi → `Promise.all`. `id` iz form-key je trusted-ish; Supabase `.eq` parametrizuje. Validiraj uuid format opciono.

- [ ] **Step 2: `IntervaliForm.tsx`** (po uzoru na ReminderForm — useActionState + router.refresh)

Prima `vrste: { id: string; naziv: string; interval: number | null }[]`. **Vlastiti `<form>` + vlastiti `useActionState(updateIntervali)`** (ODVOJEN od email `ReminderForm` — dvije nezavisne forme na /postavke; tako `interval_*` polja nikad ne dijele submit sa `dana_prije`). Render tabela: naziv + `<Input name={"interval_"+v.id} type="number" min={1} max={120} defaultValue={v.interval ?? ""} data-testid={"interval-"+v.id} />`. Dugme `interval-submit`. Nekontrolisani `defaultValue` + `key={v.id}`. **NE čitaj `ref.current` u render tijelu** (ESLint `react-hooks/refs`); postavi `submitted.current=true` samo unutar form `action` callback-a, čitaj u `useEffect` (kao postojeći `NoviTerminButton`/`ObrisiLokacijuButton` pattern — NE kao stari ReminderForm).

- [ ] **Step 3: /postavke page — dodaj sekciju**

Fetch `vrste_provjera` (`id, naziv, podrazumevani_interval_mjeseci`) WHERE `aktivna=true` ORDER BY `naziv`. Renderuj postojeću email sekciju + novu "Intervali po vrsti pregleda" sa `IntervaliForm`. Tekst objašnjenja: "Sistem koristi interval da po izvršenju automatski zakazuje sljedeći termin. Prazno = bez auto-zakazivanja."

- [ ] **Step 4: Build + verify (auto-cycle oživi) + commit**

`pnpm build && pnpm typecheck && pnpm lint`. **Verifikuj auto-cycle**: u /postavke postavi interval npr. 12 za jednu vrstu; psql: nađi termin te vrste, `update termini set datum_izvrsenja=current_date, status='izvrseno' where id=...`; provjeri da je kreiran NOVI termin sa `rok_dospijeca = current_date + 12 mjeseci` (ne isti dan). Vrati stanje (`pnpm db:reset && pnpm seed`). Commit `feat(temelj): /postavke intervali po vrsti (oživljen auto-cycle)`.

---

## Task 6: Lokacija prikaz na /prikaz, /plan, TerminSheet

**Files:** `components/domain/PrikazToolbar.tsx` + `app/(dashboard)/prikaz/page.tsx`; `app/(dashboard)/plan/page.tsx` + `components/domain/MonthCalendar.tsx` (+ sidebar); `components/domain/TerminSheet.tsx` (provjera).

- [ ] **Step 1: /prikaz — NEMA lokacija filtera (YAGNI, odgođeno)**

Matrica po FIRMI već agregira sve lokacije firme (MatrixGrid `+N` po ćeliji), pa lokacija-filter NIJE u obimu ove faze (izbjegava se i URL-reset složenost: promjena firme bi morala brisati stale `?lokacija`). `PrikazToolbar` i `prikaz/page.tsx` ostaju kako jesu (firma + godina; godina-default fix iz ranije se NE dira). Bez izmjene koda u ovom koraku — samo potvrdi da matrica radi sa firma-nivo `klijent_id` (svaki termin ima `klijent_id`=firma). Ako kasnije zatreba, lokacija-filter na /prikaz je zaseban dodatak.

- [ ] **Step 2: /plan firma · lokacija**

`plan/page.tsx` već ima `t.lokacija_naziv` u redu (termini_view). Proširi `DayTermin` tip + ćeliju/sidebar da prikažu `klijent_naziv` + (lokacija_naziv ? " · " + lokacija_naziv). MonthCalendar ćelija: ime → `firma · lokacija` (skraćeno). Sidebar (?dan) stavka: dodaj lokaciju ispod/pored.

- [ ] **Step 3: TerminSheet provjera**

`TerminSheet` već prikazuje `vrsta_naziv + (lokacija_naziv ? " · " + lokacija_naziv)`. Potvrdi da header jasno razdvaja firma (klijent_naziv) i lokaciju. Bez velike izmjene.

- [ ] **Step 4: Build + verify + commit**

`pnpm build && pnpm typecheck && pnpm lint`. Ručno: /prikaz izbor firme→matrica; izbor lokacije→suženo; /plan ćelije pokazuju firma·lokacija. Commit `feat(temelj): lokacija prikaz na prikaz/plan + opcioni lokacija filter`.

---

## Task 7: E2E ažuriranje + novi 07 spec + comprehensive + push

**Files:** ažuriraj `tests/e2e/03-…`/`04-…`/`05-…` gdje biraju klijent-dropdown (sada firme); create `tests/e2e/07-temelj.spec.ts`.

- [ ] **Step 1: Popravi postojeće E2E (KONKRETNI fajlovi/linije iz critique-a)**

Pokreni `pnpm test:e2e` da vidiš padove, pa popravi (NE slabiti asercije):
- **`tests/e2e/05-matrix-plan.spec.ts` (oko :41-49, :56-57, :120-121):** biraju `getByRole("option", { name: /WAIKIKI BANJA LUKA - DELTA/ })` koja NAKON kanonizacije više NIJE klijent (sad firma `WAIKIKI` + lokacija). Zamijeni izborom firme `name: /^WAIKIKI$/`. **UKLONI silent `if (await opt.count()) … else .first()` fallback** — zamijeni hard asercijom `await expect(opt).toBeVisible()` da test ne "prođe" lažno na praznoj firmi (npr. "AS" sa 0 termina → `matrix-cell-filled.first()` bi puklo). WAIKIKI (firma agregira sve lokacije) sigurno ima popunjenu ćeliju.
- **`tests/e2e/03-termini.spec.ts` (oko :150-173, "Novi termin"):** nakon T4 forma ima lokacija Select zavisan od firme. (a) Skopiraj `getByRole("option").first()` selekcije UNUTAR konkretnog dropdown kontejnera (npr. `page.getByTestId("novi-vrsta")` scope) da se izbjegne kolizija sa novim lokacija-opcijama; (b) dodaj izbor lokacije preko `novi-lokacija` (ili izaberi firmu bez lokacija da Select bude skriven) tako da create prođe.
- Provjeri i `04-klijenti`/`03` dropdown-e koji biraju klijenta po lokacija-imenu → firma ime.

- [ ] **Step 2: `tests/e2e/07-temelj.spec.ts`** (`mode: "serial"`)

Pokrij: (a) /klijenti lista pokazuje FIRME, `broj_lokacija > 0` za WAIKIKI; (b) klijent detalj → Lokacije tab NIJE prazan; (c) /termini tabela kolona Lokacija pokazuje stvarnu lokaciju (ne "—") za bar jedan red; (d) Novi termin sa izborom lokacije → upisan (provjera preko ?selected ili reload); (e) /postavke postavi interval za vrstu → reload → vrijednost ostaje; (f) bez console grešaka na /klijenti, /termini, /postavke. (Auto-cycle interval verifikacija je u Task 5 Step 4 ručno; opciono E2E ako stabilno.)

- [ ] **Step 3: Comprehensive verifikacija**

`pnpm db:reset && pnpm seed`, pa `pnpm test:unit` (parser + ostalo), `pnpm test:e2e` (svi 01–07), `pnpm typecheck && pnpm lint && pnpm build`. Sve zeleno.

- [ ] **Step 4: Commit + push**
```bash
git add tests/e2e
git commit -m "test(temelj): E2E firma/lokacija + intervali; ažurirani dropdown testovi"
git push origin main
```

---

## Gate (fresh agent)
- `pnpm db:reset && pnpm seed`; `pnpm build && pnpm lint && pnpm typecheck` (0 err); `pnpm test:unit` (parser testovi); `pnpm test:e2e` (01–07 svi).
- DB: `vrste_provjera` BEZ imena firmi (samo vrste + "Obilazak"); `lokacije` popunjene (WAIKIKI >1); `termini` sa `lokacija_id` popunjenim gdje firma ima lokacije; `klijenti_view` tačni brojevi (nema fanout naduvavanja); `uq_lokacije_klijent_naziv` postoji.
- Auto-cycle: postavi interval za vrstu → mark izvršeno → novi termin `rok = datum_izvrsenja + interval` (NE isti dan); bez intervala → NEMA novog termina.
- Inventory: `scripts/preview-import.ts`, `IntervaliForm.tsx`, migracija; nema `vrste_provjera.interval_mjeseci` (koristi se `podrazumevani_interval_mjeseci`); nema `vercel.json`; `.env.local` netrekiran.
- Git čisto, pushovano. Tag `v0.7.0`.

## Self-Review (autor)
- **Spec/cilj coverage:** parser dva-bloka (T1) ✓; firma→lokacija hijerarhija (T1 split + T3 seed) ✓; kanonizacija + drop po-ugovoru (T1) ✓; interval po vrsti UI (T5) + postojeća kolona/triggeri ✓; auto-cycle oživljen + guard (T2+T5) ✓; lokacija kroz ekrane (T4/T6) ✓; klijenti_view fanout fix (T2) ✓.
- **Judgment-tačke** (firma whitelist, TRANSFERA grupisanje, range=početni, dedup case-variant) → default + **human-confirm gate u T3** prije nego se zacementira.
- **Type consistency:** `ParsedTermin`/`ParseResult` (T1) korišteni u seed (T3); `lokacija_id` kroz createTermin (T4) + filteri (T4/T6); interval čita postojeću kolonu `podrazumevani_interval_mjeseci` (T5) koju triggeri već koriste (T2 guard).
- **Rizici adresirani:** reseed FK redoslijed (T3 Step1), lokacije idempotencija (T2 unique), klijenti_view fanout (T2), interval imenovanje (reuse, ne nova kolona), auto-cycle bez intervala (T2 guard).
