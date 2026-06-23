# Dizajn: Dedup termina

**Datum:** 2026-06-23
**Status:** Odobren dizajn → spreman za plan implementacije
**Pristup:** Parser dedup (trajno) + in-place čišćenje živih podataka

## Kontekst i cilj

Excel izvor (`2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx`) ima **12 mjesečnih sheetova (Januar…Decembar)**, a svaki **ponavlja istu godišnju matricu pregleda**. Parser (`lib/excel/parser.ts`) čita svih 12 sheetova i pravi **po jedan termin za svako pojavljivanje**, bez dedup-a termina (lokacije/firme/vrste se dedupe-uju preko Set-a, termini ne). Posljedica: ~285 redova su pravi duplikati (npr. "Akt o procjeni rizika - revizija" 12×, ostali 2×), pa svi tabovi pokazuju naduvane brojeve (uklj. "broj po gradu").

`ParsedTermin.izvor` je samo `"izvrseno" | "planirano"` (parser ne pravi zakazano/otkazano — ti statusi dolaze naknadno auto-cycle-om/ručno). Trenutno: **849 termina; samo 2 termina imaju zakačene dokumente (5 redova `dokumenti`).**

## Odluke (potvrđene s korisnikom)

- **Pravilo dedup-a:** za isti pregled na isti datum (isti klijent+vrsta+lokacija+rok) — zadrži **izvršeno** ako postoji; planirani/kasni duplikat za isti datum je suvišan.
- **Pristup:** in-place skripta za čišćenje (čuva dokumente/auto-cycle stanje), NE pun reseed.
- **Van opsega (zasad):** DB unique constraint na `(klijent+vrsta+lokacija+rok)` — komplikuje null-lokaciju i ručno kreiranje; zaseban kasniji zahvat.

## Global Constraints (verbatim)

- Grana: `fix/dedup-termini` (NE `main`). Već kreirana.
- Cloud Supabase — skripte i provjere protiv cloud-a (`.env.local`, `SUPABASE_SERVICE_ROLE_KEY`), bez lokalnog Dockera.
- `izvediGrad`-stil DRY: dedup logika je čista funkcija, dijeljena gdje ima smisla; bez duplirane logike.
- ESLint zabranjuje `no-await-in-loop` (skripte: scoped `// eslint-disable-next-line` na await u petlji, namjerno sekvencijalno) i `sm:`/`md:` (nije relevantno — bez UI-ja).
- AGENTS.md: NIJE standardni Next.js — ali ovo je plain TS u `lib/`/`scripts/`.

---

## Sekcija 1 — Parser dedup (trajno)

Nova čista funkcija u `lib/excel/parser.ts` (export, iznad `parseTehproExcel`):

```ts
/** Dedupe termina: jedan po (firma|vrsta|lokacija|datum); izvrseno ima prednost nad planirano. */
export function dedupeTermini(termini: ParsedTermin[]): ParsedTermin[] {
  const map = new Map<string, ParsedTermin>()
  for (const t of termini) {
    const key = `${t.firma_naziv}||${t.vrsta_naziv}||${t.lokacija_naziv ?? "∅"}||${t.datum}`
    const post = map.get(key)
    if (!post) { map.set(key, t); continue }
    // izvrseno pobjeđuje planirano; inače zadrži postojeći
    if (post.izvor !== "izvrseno" && t.izvor === "izvrseno") map.set(key, t)
  }
  return Array.from(map.values())
}
```

Integracija: u `parseTehproExcel`, prije `return { ... termini, skipped }` (oko linije 432), zamijeniti `termini` sa `dedupeTermini(termini)`:
```ts
  return {
    firme: Array.from(firmeSet),
    lokacije: lokacijeArr,
    vrste: Array.from(vrsteSet),
    termini: dedupeTermini(termini),
    skipped,
  }
```

Time svaki budući seed/import daje jedinstvene termine.

**Napomena:** postojeći parser test (`lib/excel/parser.test.ts`, ako postoji) koji broji termine ili tvrdi prisustvo duplikata treba ažurirati na deduplicirana očekivanja.

---

## Sekcija 2 — Čišćenje živih podataka (in-place)

Čista funkcija za izbor čuvara (testabilna) + skripta koja je primjenjuje na cloud.

**`lib/excel/parser.ts` ili novi `lib/dedup.ts`** — čista funkcija:
```ts
type TerminRed = {
  id: string
  klijent_id: string | null
  vrsta_provjere_id: string | null
  lokacija_id: string | null
  rok_dospijeca: string
  status: string // raw: planirano|zakazano|izvrseno|otkazano
}

const STATUS_PRIO: Record<string, number> = { izvrseno: 4, zakazano: 3, planirano: 2, otkazano: 1 }

/** Vrati {keep, drop[]} za grupu redova istog (klijent,vrsta,lokacija,rok). docIds = termini s dokumentima. */
export function odaberiCuvara(rows: TerminRed[], docIds: Set<string>): { keep: TerminRed; drop: TerminRed[] } {
  const sorted = [...rows].sort((a, b) => {
    const ad = docIds.has(a.id) ? 1 : 0, bd = docIds.has(b.id) ? 1 : 0
    if (ad !== bd) return bd - ad                          // 1) ima dokument
    const ap = STATUS_PRIO[a.status] ?? 0, bp = STATUS_PRIO[b.status] ?? 0
    if (ap !== bp) return bp - ap                          // 2) status prioritet
    return a.id.localeCompare(b.id)                        // 3) stabilno
  })
  return { keep: sorted[0]!, drop: sorted.slice(1) }
}
```

**`scripts/dedup-termini.ts`** (`tsx --env-file=.env.local`):
- `createAdminSupabaseClient`.
- Učitaj sve `termini` (`id, klijent_id, vrsta_provjere_id, lokacija_id, rok_dospijeca, status`).
- Učitaj `dokumenti` (`termin_id`) → `docIds = Set`.
- Grupiši po `${klijent_id}|${vrsta_provjere_id}|${lokacija_id}|${rok_dospijeca}`.
- Za svaku grupu s >1: `odaberiCuvara` → `delete` svih iz `drop` (`.in("id", dropIds)` u batch-evima; errori throw).
- Izvještaj: broj grupa, obrisano, finalni broj termina.
- npm script: `"dedup:termini": "tsx --env-file=.env.local scripts/dedup-termini.ts"`.

Pokrenuti `pnpm dedup:termini` na cloud-u.

---

## Verifikacija (gate)

`pnpm lint && pnpm typecheck && pnpm build` + unit (`dedupeTermini` + `odaberiCuvara`) + nakon čišćenja provjera u bazi:
- Nakon `pnpm dedup:termini`: nijedna `(klijent+vrsta+lokacija+rok)` grupa nema >1 reda; finalni broj ~560.
- Oba termina s dokumentima i dalje postoje (čuvar-prioritet ih je zadržao).
- Regresija: postojeći e2e (`12-obilasci`, `15-obilasci-dorada`, `05-matrix-plan`, `03-termini`, `10-pregled`) ostaju zeleni; brojevi po tabovima više nisu naduvani.

## Van opsega (YAGNI)

- DB unique constraint kao trajna brana (zaseban kasniji zahvat).
- Razrješavanje kontradiktornih statusa kao "domenska istina" (samo dedup po prioritetu).
- Pun reseed (in-place čuva demo dokumente/zapisnike i auto-cycle stanje).
