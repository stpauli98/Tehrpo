# Integracioni gate — plan implementacije

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Napraviti dvoslojnu kapiju između worktree grana i produkcije — CI koji mehanički blokira PR, i skriptu koja hvata kvarove što daju čist merge a pokvaren sistem.

**Architecture:** Čiste funkcije provjere žive u `lib/integracija/` sa co-lociranim vitest testovima; `scripts/provjeri-integraciju.ts` je tanka ljuska koja čita disk i poziva ih; `.github/workflows/gate.yml` pušta cijeli lanac na svakom PR-u; `.claude/commands/integracija.md` opisuje ručnu proceduru integracionog worktree-a.

**Tech Stack:** TypeScript, vitest (node env), tsx, GitHub Actions, pnpm 10.15.0, Node 24.

**Spec:** `docs/superpowers/specs/2026-07-28-integracioni-gate-design.md`

## Global Constraints

- Jezik identifikatora i poruka je **bosanski/srpski (latinica)** — `nalaz`, `provjeri`, `sudar`, ne `finding`/`check`.
- `vitest.config.ts` `include` je `["lib/**/*.test.ts", "i18n/**/*.test.ts", "app/**/*.test.ts"]` — **test van tih putanja se nikad ne izvršava.** Sav testabilan kod ide u `lib/integracija/`.
- ESLint `no-await-in-loop: error` svuda **osim** u `scripts/`. Kod u `lib/integracija/` je sinhron — nema `await` uopšte.
- Zabranjeni Tailwind breakpointi `sm:` / `md:` (`no-restricted-syntax`) — nije relevantno za ovaj plan, ali `pnpm lint` ionako pada na njima.
- Nijedan fajl u `lib/integracija/` ne smije čitati disk, mrežu ni `process.env`. Ulaz su obični podaci.
- Postojeći PROD/DEMO ref-ovi se **ne prepisuju** — uvozi se `PROD_REF` iz `lib/supabase/refs.ts`.
- Commit poruke prate zatečeni stil repoa: `feat(...)`, `fix(...)`, `docs(...)`, `test(...)` sa opisom na domenskom jeziku.
- Radna grana za cijeli plan: `feat/integracioni-gate` (već postoji, spec je na njoj).

## Struktura fajlova

| Fajl | Odgovornost |
|---|---|
| `lib/integracija/migracije.ts` | Sudar timestampova i neispravna imena migracija |
| `lib/integracija/migracije.test.ts` | Testovi za gornje |
| `lib/integracija/prijevodi.ts` | Paritet ključeva `sr`/`en`/`de`, zabrana ICU `one` u `sr` |
| `lib/integracija/prijevodi.test.ts` | Testovi za gornje |
| `lib/integracija/pravila.ts` | Tekstualna pravila nad izvorom: admin klijent, `VIEW` bez `security_invoker`, tabela bez politike, PROD ref u `tests/` |
| `lib/integracija/pravila.test.ts` | Testovi za gornje |
| `scripts/provjeri-integraciju.ts` | Ljuska: čita disk, poziva čiste funkcije, ispisuje nalaze, izlazni kod |
| `.github/workflows/gate.yml` | CI: typecheck → lint → test:unit → build → provjeri-integraciju |
| `.claude/commands/integracija.md` | Procedura integracionog worktree-a, poziva se sa `/integracija` |
| `package.json` | Nova skripta `provjeri:integraciju` |

---

### Task 1: Provjera migracija

**Files:**
- Create: `lib/integracija/migracije.ts`
- Test: `lib/integracija/migracije.test.ts`

**Interfaces:**
- Consumes: ništa
- Produces:
  - `type SudarMigracija = { prefiks: string; fajlovi: string[] }`
  - `izdvojiPrefiks(imeFajla: string): string | null`
  - `nadjiSudarenePrefikse(imenaFajlova: string[]): SudarMigracija[]`
  - `nadjiNeispravnaImena(imenaFajlova: string[]): string[]`

- [ ] **Step 1: Napiši test koji pada**

Kreiraj `lib/integracija/migracije.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  izdvojiPrefiks,
  nadjiSudarenePrefikse,
  nadjiNeispravnaImena,
} from "./migracije"

// Stvarni sudar zatečen 2026-07-28: dvije grane, isti timestamp, različita imena.
// Git ih spaja bez konflikta jer se imena fajlova razlikuju.
const STVARNI_SUDAR = [
  "20260728120000_audit_pretraga_kolone.sql",
  "20260728120000_mejl_status_demo.sql",
]

describe("izdvojiPrefiks", () => {
  it("vraća 14-cifreni timestamp", () => {
    expect(izdvojiPrefiks("20260726120000_get_termini_godine_rpc.sql")).toBe("20260726120000")
  })

  it("vraća null kad prefiksa nema", () => {
    expect(izdvojiPrefiks("dodaj_kolonu.sql")).toBeNull()
  })

  it("vraća null za kraći broj — 13 cifara nije timestamp", () => {
    expect(izdvojiPrefiks("2026072612000_nesto.sql")).toBeNull()
  })
})

describe("nadjiSudarenePrefikse", () => {
  it("prijavljuje stvarni sudar iz dvije grane", () => {
    const nalazi = nadjiSudarenePrefikse(STVARNI_SUDAR)
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0].prefiks).toBe("20260728120000")
    expect(nalazi[0].fajlovi).toEqual([
      "20260728120000_audit_pretraga_kolone.sql",
      "20260728120000_mejl_status_demo.sql",
    ])
  })

  it("ne prijavlja ništa kad su svi prefiksi različiti", () => {
    expect(
      nadjiSudarenePrefikse([
        "20260726120000_a.sql",
        "20260726121000_b.sql",
        "20260728120000_c.sql",
      ]),
    ).toEqual([])
  })

  it("prijavlja i sudar troje", () => {
    const nalazi = nadjiSudarenePrefikse([
      "20260728120000_a.sql",
      "20260728120000_b.sql",
      "20260728120000_c.sql",
    ])
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0].fajlovi).toHaveLength(3)
  })

  it("prijavlja više nezavisnih sudara, sortirano po prefiksu", () => {
    const nalazi = nadjiSudarenePrefikse([
      "20260729130000_x.sql",
      "20260729130000_y.sql",
      "20260728120000_a.sql",
      "20260728120000_b.sql",
    ])
    expect(nalazi.map((n) => n.prefiks)).toEqual(["20260728120000", "20260729130000"])
  })

  it("fajlovi u nalazu su sortirani bez obzira na redoslijed ulaza", () => {
    const nalazi = nadjiSudarenePrefikse([
      "20260728120000_mejl_status_demo.sql",
      "20260728120000_audit_pretraga_kolone.sql",
    ])
    expect(nalazi[0].fajlovi[0]).toBe("20260728120000_audit_pretraga_kolone.sql")
  })

  it("prazan ulaz daje prazan rezultat", () => {
    expect(nadjiSudarenePrefikse([])).toEqual([])
  })

  it("ignoriše fajlove bez prefiksa umjesto da ih grupiše zajedno", () => {
    expect(nadjiSudarenePrefikse(["README.md", "biljeska.sql"])).toEqual([])
  })
})

describe("nadjiNeispravnaImena", () => {
  it("prijavlja .sql bez timestamp prefiksa", () => {
    expect(nadjiNeispravnaImena(["20260728120000_ok.sql", "bez_prefiksa.sql"])).toEqual([
      "bez_prefiksa.sql",
    ])
  })

  it("ne dira fajlove koji nisu .sql", () => {
    expect(nadjiNeispravnaImena(["README.md", "20260728120000_ok.sql"])).toEqual([])
  })
})
```

- [ ] **Step 2: Pusti test i potvrdi da pada**

Run: `pnpm vitest run lib/integracija/migracije.test.ts`
Expected: FAIL — `Failed to resolve import "./migracije"`

- [ ] **Step 3: Napiši implementaciju**

Kreiraj `lib/integracija/migracije.ts`:

```ts
/**
 * Provjere nad imenima fajlova u supabase/migrations.
 *
 * Postoji zato što dvije grane mogu nezavisno napraviti migraciju s istim
 * timestamp prefiksom. Imena fajlova se razlikuju, pa git spaja bez konflikta
 * i oba PR-a prolaze — a redoslijed primjene postaje nedefinisan. Na cloud se
 * migracije primjenjuju ručno, jedna po jedna, pa ništa ne garantuje da su
 * obje stigle prije koda koji ih očekuje.
 *
 * Čisto nad podacima: bez dodira s diskom, mrežom i process.env.
 */

export type SudarMigracija = {
  prefiks: string
  fajlovi: string[]
}

const PREFIKS = /^(\d{14})_/

/** 14-cifreni timestamp s početka imena, ili null ako ga nema. */
export function izdvojiPrefiks(imeFajla: string): string | null {
  return PREFIKS.exec(imeFajla)?.[1] ?? null
}

/** Prefiksi koje dijeli više od jednog fajla. Sortirano, stabilno. */
export function nadjiSudarenePrefikse(imenaFajlova: string[]): SudarMigracija[] {
  const poPrefiksu = new Map<string, string[]>()

  for (const ime of imenaFajlova) {
    const prefiks = izdvojiPrefiks(ime)
    if (prefiks === null) continue
    poPrefiksu.set(prefiks, [...(poPrefiksu.get(prefiks) ?? []), ime])
  }

  return [...poPrefiksu.entries()]
    .filter(([, fajlovi]) => fajlovi.length > 1)
    .map(([prefiks, fajlovi]) => ({ prefiks, fajlovi: [...fajlovi].sort() }))
    .sort((a, b) => a.prefiks.localeCompare(b.prefiks))
}

/** .sql fajlovi bez ispravnog timestamp prefiksa — redoslijed im je nedefinisan. */
export function nadjiNeispravnaImena(imenaFajlova: string[]): string[] {
  return imenaFajlova
    .filter((ime) => ime.endsWith(".sql") && izdvojiPrefiks(ime) === null)
    .sort()
}
```

- [ ] **Step 4: Pusti test i potvrdi da prolazi**

Run: `pnpm vitest run lib/integracija/migracije.test.ts`
Expected: PASS — 12 testova

- [ ] **Step 5: Commit**

```bash
git add lib/integracija/migracije.ts lib/integracija/migracije.test.ts
git commit -m "feat(integracija): otkrivanje sudara timestampova migracija"
```

---

### Task 2: Paritet prevoda

**Files:**
- Create: `lib/integracija/prijevodi.ts`
- Test: `lib/integracija/prijevodi.test.ts`

**Interfaces:**
- Consumes: ništa
- Produces:
  - `type Katalog = Record<string, unknown>`
  - `type NalazPariteta = { kljuc: string; nedostajeU: string[] }`
  - `parovi(katalog: Katalog, prefiks?: string): Array<[string, string]>`
  - `spljosti(katalog: Katalog): string[]`
  - `nadjiNeparitet(katalozi: Record<string, Katalog>): NalazPariteta[]`
  - `nadjiIcuOne(katalog: Katalog): string[]`

- [ ] **Step 1: Napiši test koji pada**

Kreiraj `lib/integracija/prijevodi.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { parovi, spljosti, nadjiNeparitet, nadjiIcuOne } from "./prijevodi"

// messages/*.json su ugniježđeni do 5 nivoa; ključ koji next-intl vidi je
// putanja spojena tačkama.
const SR = {
  common: { sacuvaj: "Sačuvaj", otkazi: "Otkaži" },
  klijenti: { lista: { naslov: "Klijenti" } },
}

describe("parovi", () => {
  it("spljoštava ugniježđeni katalog u putanje s tačkom", () => {
    expect(parovi(SR)).toEqual([
      ["common.otkazi", "Otkaži"],
      ["common.sacuvaj", "Sačuvaj"],
      ["klijenti.lista.naslov", "Klijenti"],
    ])
  })

  it("ide do pete dubine", () => {
    const duboko = { a: { b: { c: { d: { e: "kraj" } } } } }
    expect(parovi(duboko)).toEqual([["a.b.c.d.e", "kraj"]])
  })

  it("niz tretira kao list, ne kao nivo", () => {
    expect(parovi({ a: ["x", "y"] })).toEqual([["a", "x,y"]])
  })

  it("prazan katalog daje prazan niz", () => {
    expect(parovi({})).toEqual([])
  })
})

describe("spljosti", () => {
  it("vraća samo ključeve", () => {
    expect(spljosti(SR)).toEqual([
      "common.otkazi",
      "common.sacuvaj",
      "klijenti.lista.naslov",
    ])
  })
})

describe("nadjiNeparitet", () => {
  it("ne prijavlja ništa kad su sva tri kataloga usklađena", () => {
    expect(nadjiNeparitet({ sr: SR, en: SR, de: SR })).toEqual([])
  })

  it("prijavlja ključ koji postoji samo u sr", () => {
    const nalazi = nadjiNeparitet({
      sr: { common: { sacuvaj: "Sačuvaj", novo: "Novo" } },
      en: { common: { sacuvaj: "Save" } },
      de: { common: { sacuvaj: "Speichern" } },
    })
    expect(nalazi).toEqual([{ kljuc: "common.novo", nedostajeU: ["de", "en"] }])
  })

  it("prijavlja ključ koji nedostaje samo u jednom jeziku", () => {
    const nalazi = nadjiNeparitet({
      sr: { a: "1", b: "2" },
      en: { a: "1", b: "2" },
      de: { a: "1" },
    })
    expect(nalazi).toEqual([{ kljuc: "b", nedostajeU: ["de"] }])
  })

  it("prijavlja i kad se razlikuje dubina, ne samo ime", () => {
    const nalazi = nadjiNeparitet({
      sr: { a: { b: "x" } },
      en: { a: "x" },
    })
    expect(nalazi.map((n) => n.kljuc).sort()).toEqual(["a", "a.b"])
  })

  it("nalazi su sortirani po ključu", () => {
    const nalazi = nadjiNeparitet({
      sr: { z: "1", a: "2" },
      en: {},
    })
    expect(nalazi.map((n) => n.kljuc)).toEqual(["a", "z"])
  })
})

describe("nadjiIcuOne", () => {
  it("prijavlja ICU kategoriju one — u srpskom je zabranjena", () => {
    const kat = {
      termini: { broj: "{n, plural, one {# termin} other {# termina}}" },
    }
    expect(nadjiIcuOne(kat)).toEqual(["termini.broj"])
  })

  it("ne prijavlja poruku koja koristi samo few i other", () => {
    const kat = {
      termini: { broj: "{n, plural, few {# termina} other {# termina}}" },
    }
    expect(nadjiIcuOne(kat)).toEqual([])
  })

  it("ne prijavlja riječ 'one' u običnom tekstu", () => {
    expect(nadjiIcuOne({ a: "Telefone i adrese" })).toEqual([])
  })

  it("ne prijavlja 'one' kao dio duže riječi ispred vitičaste", () => {
    expect(nadjiIcuOne({ a: "{n, plural, none {x} other {y}}" })).toEqual([])
  })
})
```

- [ ] **Step 2: Pusti test i potvrdi da pada**

Run: `pnpm vitest run lib/integracija/prijevodi.test.ts`
Expected: FAIL — `Failed to resolve import "./prijevodi"`

- [ ] **Step 3: Napiši implementaciju**

Kreiraj `lib/integracija/prijevodi.ts`:

```ts
/**
 * Provjere nad messages/{sr,en,de}.json.
 *
 * next-intl tipizira namespace i ključ prema literalnoj uniji iz JSON-a, pa je
 * neusklađen paritet tvrda tsc greška, ne upozorenje. Više grana paralelno
 * dodaje ključeve u ista tri fajla — svaka sama prolazi, spoj ne mora.
 *
 * ICU kategorija `one` se u srpskom ne koristi (1, 21, 31… idu u `one` po CLDR-u
 * ali katalog je pisan bez nje) — prijavljuje se da ne uđe nezapaženo.
 *
 * Čisto nad podacima: bez dodira s diskom, mrežom i process.env.
 */

export type Katalog = Record<string, unknown>

export type NalazPariteta = {
  kljuc: string
  /** Jezici u kojima ključ nedostaje, sortirano. */
  nedostajeU: string[]
}

/** Ugniježđeni katalog → sortirani parovi [putanja.s.tackama, vrijednost]. */
export function parovi(katalog: Katalog, prefiks = ""): Array<[string, string]> {
  const rezultat: Array<[string, string]> = []

  for (const [kljuc, vrijednost] of Object.entries(katalog)) {
    const puna = prefiks ? `${prefiks}.${kljuc}` : kljuc
    const jeNivo =
      vrijednost !== null && typeof vrijednost === "object" && !Array.isArray(vrijednost)

    if (jeNivo) rezultat.push(...parovi(vrijednost as Katalog, puna))
    else rezultat.push([puna, String(vrijednost)])
  }

  return rezultat.sort((a, b) => a[0].localeCompare(b[0]))
}

/** Samo ključevi, sortirano. */
export function spljosti(katalog: Katalog): string[] {
  return parovi(katalog).map(([kljuc]) => kljuc)
}

/** Ključevi koji ne postoje u svakom od datih kataloga. */
export function nadjiNeparitet(katalozi: Record<string, Katalog>): NalazPariteta[] {
  const jezici = Object.keys(katalozi).sort()
  const poJeziku = new Map(jezici.map((j) => [j, new Set(spljosti(katalozi[j]))]))

  const svi = new Set<string>()
  for (const skup of poJeziku.values()) for (const kljuc of skup) svi.add(kljuc)

  return [...svi]
    .sort((a, b) => a.localeCompare(b))
    .map((kljuc) => ({
      kljuc,
      nedostajeU: jezici.filter((j) => !poJeziku.get(j)!.has(kljuc)),
    }))
    .filter((nalaz) => nalaz.nedostajeU.length > 0)
}

// `one` kao ICU kategorija: riječ na granici, pa razmaci, pa vitičasta.
const ICU_ONE = /(?:^|[\s,]) *one\s*\{/

/** Ključevi čija poruka koristi ICU kategoriju `one`. */
export function nadjiIcuOne(katalog: Katalog): string[] {
  return parovi(katalog)
    .filter(([, vrijednost]) => ICU_ONE.test(vrijednost))
    .map(([kljuc]) => kljuc)
}
```

- [ ] **Step 4: Pusti test i potvrdi da prolazi**

Run: `pnpm vitest run lib/integracija/prijevodi.test.ts`
Expected: PASS — 14 testova

- [ ] **Step 5: Commit**

```bash
git add lib/integracija/prijevodi.ts lib/integracija/prijevodi.test.ts
git commit -m "feat(integracija): paritet ključeva sr/en/de i zabrana ICU one"
```

---

### Task 3: Tekstualna pravila nad izvorom

**Files:**
- Create: `lib/integracija/pravila.ts`
- Test: `lib/integracija/pravila.test.ts`

**Interfaces:**
- Consumes: `PROD_REF` iz `lib/supabase/refs.ts` (postojeći modul, izvozi `export const PROD_REF = "fqtqkehjidkzeasiegnq"`)
- Produces:
  - `type Izvor = { putanja: string; sadrzaj: string }`
  - `type Nalaz = { putanja: string; linija: number; pravilo: string; poruka: string }`
  - `provjeriTs(izvor: Izvor): Nalaz[]`
  - `provjeriSql(izvor: Izvor): Nalaz[]`
  - `provjeriIzvore(izvori: Izvor[]): Nalaz[]`

- [ ] **Step 1: Napiši test koji pada**

Kreiraj `lib/integracija/pravila.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { provjeriTs, provjeriSql, provjeriIzvore } from "./pravila"
import { PROD_REF } from "@/lib/supabase/refs"

describe("provjeriTs — admin klijent u zahtjevnoj putanji", () => {
  it("prijavlja createAdminSupabaseClient u app/", () => {
    const nalazi = provjeriTs({
      putanja: "app/(dashboard)/klijenti/page.tsx",
      sadrzaj: 'import { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0].pravilo).toBe("admin-klijent")
    expect(nalazi[0].linija).toBe(1)
  })

  it("prijavlja i u components/", () => {
    expect(
      provjeriTs({
        putanja: "components/domain/Tabela.tsx",
        sadrzaj: '\n\nimport { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
      }),
    ).toHaveLength(1)
  })

  it("prijavlja tačan broj linije", () => {
    const nalazi = provjeriTs({
      putanja: "app/x.ts",
      sadrzaj: 'const a = 1\nconst b = 2\nimport "@/lib/supabase/admin"\n',
    })
    expect(nalazi[0].linija).toBe(3)
  })

  it("NE prijavlja u scripts/ — tamo je admin klijent ispravan", () => {
    expect(
      provjeriTs({
        putanja: "scripts/seed-admin.ts",
        sadrzaj: 'import { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
      }),
    ).toEqual([])
  })

  it("NE prijavlja app/api/cron — cron rute smiju admin klijent", () => {
    expect(
      provjeriTs({
        putanja: "app/api/cron/reminders/route.ts",
        sadrzaj: 'import { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
      }),
    ).toEqual([])
  })

  it("NE prijavlja sam lib/supabase/admin.ts", () => {
    expect(
      provjeriTs({ putanja: "lib/supabase/admin.ts", sadrzaj: "createAdminSupabaseClient" }),
    ).toEqual([])
  })
})

describe("provjeriTs — PROD ref u testovima", () => {
  it("prijavlja PROD ref pod tests/", () => {
    const nalazi = provjeriTs({
      putanja: "tests/e2e/db.ts",
      sadrzaj: `const url = "https://${PROD_REF}.supabase.co"\n`,
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0].pravilo).toBe("prod-ref-u-testovima")
  })

  it("NE prijavlja PROD ref u lib/supabase/refs.ts — tamo mu je mjesto", () => {
    expect(
      provjeriTs({ putanja: "lib/supabase/refs.ts", sadrzaj: `export const PROD_REF = "${PROD_REF}"` }),
    ).toEqual([])
  })

  it("NE prijavlja čist tests/ fajl", () => {
    expect(provjeriTs({ putanja: "tests/e2e/db.ts", sadrzaj: "const url = process.env.X\n" })).toEqual([])
  })
})

describe("provjeriSql — VIEW bez security_invoker", () => {
  it("prijavlja CREATE VIEW bez security_invoker", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj: "CREATE VIEW klijenti_view AS SELECT * FROM klijenti;\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0].pravilo).toBe("view-bez-invokera")
    expect(nalazi[0].poruka).toContain("klijenti_view")
  })

  it("NE prijavlja kad je security_invoker postavljen", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj:
          "CREATE VIEW klijenti_view WITH (security_invoker=on) AS SELECT * FROM klijenti;\n",
      }),
    ).toEqual([])
  })

  it("hvata i CREATE OR REPLACE VIEW", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj: "CREATE OR REPLACE VIEW t_view AS SELECT 1;\n",
      }),
    ).toHaveLength(1)
  })

  it("ne miješa dvije naredbe — druga ima invoker, prva nema", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj:
        "CREATE VIEW a_view AS SELECT 1;\nCREATE VIEW b_view WITH (security_invoker=on) AS SELECT 2;\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0].poruka).toContain("a_view")
  })
})

describe("provjeriSql — nova tabela bez politike", () => {
  it("prijavlja CREATE TABLE bez ijedne CREATE POLICY", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj: "CREATE TABLE public.gradovi (id serial primary key);\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0].pravilo).toBe("tabela-bez-politike")
  })

  it("NE prijavlja kad politika postoji u istom fajlu", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj:
          "CREATE TABLE public.gradovi (id serial primary key);\n" +
          'CREATE POLICY "citanje" ON public.gradovi FOR SELECT USING (true);\n',
      }),
    ).toEqual([])
  })

  it("NE prijavlja CREATE TABLE IF NOT EXISTS kad politika postoji", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj:
          "CREATE TABLE IF NOT EXISTS public.gradovi (id int);\n" +
          'CREATE POLICY "p" ON gradovi FOR SELECT USING (true);\n',
      }),
    ).toEqual([])
  })
})

describe("provjeriIzvore", () => {
  it("bira provjeru prema ekstenziji i spaja nalaze", () => {
    const nalazi = provjeriIzvore([
      { putanja: "app/x.ts", sadrzaj: 'import "@/lib/supabase/admin"\n' },
      { putanja: "supabase/migrations/20260728120000_x.sql", sadrzaj: "CREATE VIEW v AS SELECT 1;\n" },
      { putanja: "README.md", sadrzaj: "createAdminSupabaseClient" },
    ])
    expect(nalazi.map((n) => n.pravilo).sort()).toEqual(["admin-klijent", "view-bez-invokera"])
  })

  it("nalazi su sortirani po putanji pa po liniji", () => {
    const nalazi = provjeriIzvore([
      { putanja: "app/z.ts", sadrzaj: 'import "@/lib/supabase/admin"\n' },
      { putanja: "app/a.ts", sadrzaj: '\nimport "@/lib/supabase/admin"\n' },
    ])
    expect(nalazi.map((n) => n.putanja)).toEqual(["app/a.ts", "app/z.ts"])
  })

  it("prazan ulaz daje prazan rezultat", () => {
    expect(provjeriIzvore([])).toEqual([])
  })
})
```

- [ ] **Step 2: Pusti test i potvrdi da pada**

Run: `pnpm vitest run lib/integracija/pravila.test.ts`
Expected: FAIL — `Failed to resolve import "./pravila"`

- [ ] **Step 3: Napiši implementaciju**

Kreiraj `lib/integracija/pravila.ts`:

```ts
/**
 * Tekstualna pravila nad izvornim fajlovima — klase kvarova koje daju
 * čist merge i pokvaren sistem:
 *
 *  - admin (service-role) klijent u zahtjevnoj putanji zaobilazi RLS
 *  - SQL VIEW bez security_invoker=on zaobilazi RLS
 *  - nova tabela bez politike tiho vraća nula redova (cloud event trigger
 *    automatski uključi RLS na svaku novu public tabelu)
 *  - PROD ref u tests/ znači da E2E prolaz piše u produkciju
 *
 * Namjerno tekstualno, ne AST — cilj je jeftina i predvidiva mreža, ne
 * potpuna analiza. Lažno pozitivan nalaz se rješava tačkom u IZUZECI.
 *
 * Čisto nad podacima: bez dodira s diskom, mrežom i process.env.
 */
import { PROD_REF } from "@/lib/supabase/refs"

export type Izvor = {
  /** Putanja relativna na korijen repozitorija, s kosom crtom naprijed. */
  putanja: string
  sadrzaj: string
}

export type Nalaz = {
  putanja: string
  /** 1-indeksirano. */
  linija: number
  pravilo: string
  poruka: string
}

/** Putanje u kojima admin klijent NIJE greška. */
const IZUZECI_ADMIN = [
  "scripts/",
  "app/api/cron/",
  "lib/supabase/admin.ts",
  "lib/supabase/storage.ts",
  "lib/cache.ts",
]

const ADMIN = /createAdminSupabaseClient|@\/lib\/supabase\/admin/
const VIEW = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([A-Za-z0-9_."]+)/i
const TABELA = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi
const POLITIKA = /CREATE\s+POLICY/i
const SECURITY_INVOKER = /security_invoker\s*=\s*on/i

function brojLinije(sadrzaj: string, indeks: number): number {
  let linija = 1
  for (let i = 0; i < indeks && i < sadrzaj.length; i++) {
    if (sadrzaj[i] === "\n") linija++
  }
  return linija
}

/** Kratko ime tabele bez šeme i navodnika — za poređenje s politikom. */
function kratkoIme(ime: string): string {
  return ime.replace(/"/g, "").split(".").pop() ?? ime
}

export function provjeriTs(izvor: Izvor): Nalaz[] {
  const { putanja, sadrzaj } = izvor
  const nalazi: Nalaz[] = []

  const uZahtjevnoj = putanja.startsWith("app/") || putanja.startsWith("components/")
  const izuzet = IZUZECI_ADMIN.some((p) => putanja.startsWith(p))

  if (uZahtjevnoj && !izuzet) {
    sadrzaj.split("\n").forEach((linija, i) => {
      if (ADMIN.test(linija)) {
        nalazi.push({
          putanja,
          linija: i + 1,
          pravilo: "admin-klijent",
          poruka:
            "service-role klijent u zahtjevnoj putanji zaobilazi RLS — koristi createServerSupabaseClient",
        })
      }
    })
  }

  if (putanja.startsWith("tests/")) {
    sadrzaj.split("\n").forEach((linija, i) => {
      if (linija.includes(PROD_REF)) {
        nalazi.push({
          putanja,
          linija: i + 1,
          pravilo: "prod-ref-u-testovima",
          poruka: "PROD ref u testu — E2E prolaz bi pisao u produkciju; cilj mora biti DEMO",
        })
      }
    })
  }

  return nalazi
}

export function provjeriSql(izvor: Izvor): Nalaz[] {
  const { putanja, sadrzaj } = izvor
  const nalazi: Nalaz[] = []

  // VIEW: gleda se svaka naredba zasebno, da invoker iz jedne ne pokrije drugu.
  let pomak = 0
  for (const naredba of sadrzaj.split(";")) {
    const pogodak = VIEW.exec(naredba)
    if (pogodak && !SECURITY_INVOKER.test(naredba)) {
      nalazi.push({
        putanja,
        linija: brojLinije(sadrzaj, pomak + pogodak.index),
        pravilo: "view-bez-invokera",
        poruka: `VIEW ${kratkoIme(pogodak[1])} bez security_invoker=on — zaobilazi RLS`,
      })
    }
    pomak += naredba.length + 1
  }

  // Tabela bez ijedne politike u istom fajlu.
  const imaPolitiku = POLITIKA.test(sadrzaj)
  for (const pogodak of sadrzaj.matchAll(TABELA)) {
    const ime = kratkoIme(pogodak[1])
    const politikaZaOvu = new RegExp(`CREATE\\s+POLICY[\\s\\S]*?ON\\s+[A-Za-z0-9_."]*\\b${ime}\\b`, "i")
    if (imaPolitiku && politikaZaOvu.test(sadrzaj)) continue
    nalazi.push({
      putanja,
      linija: brojLinije(sadrzaj, pogodak.index),
      pravilo: "tabela-bez-politike",
      poruka: `tabela ${ime} nema RLS politiku — cloud trigger uključi RLS, pa upit tiho vraća nula redova`,
    })
  }

  return nalazi
}

export function provjeriIzvore(izvori: Izvor[]): Nalaz[] {
  return izvori
    .flatMap((izvor) => {
      if (izvor.putanja.endsWith(".sql")) return provjeriSql(izvor)
      if (/\.tsx?$/.test(izvor.putanja)) return provjeriTs(izvor)
      return []
    })
    .sort((a, b) => a.putanja.localeCompare(b.putanja) || a.linija - b.linija)
}
```

- [ ] **Step 4: Pusti test i potvrdi da prolazi**

Run: `pnpm vitest run lib/integracija/pravila.test.ts`
Expected: PASS — 19 testova

- [ ] **Step 5: Pusti lint i typecheck nad novim fajlovima**

Run: `pnpm lint && pnpm typecheck`
Expected: bez grešaka

- [ ] **Step 6: Commit**

```bash
git add lib/integracija/pravila.ts lib/integracija/pravila.test.ts
git commit -m "feat(integracija): pravila za RLS, admin klijenta i PROD ref u testovima"
```

---

### Task 4: Ljuska — `scripts/provjeri-integraciju.ts`

**Files:**
- Create: `scripts/provjeri-integraciju.ts`
- Modify: `package.json` (dodaj skriptu `provjeri:integraciju`)

**Interfaces:**
- Consumes: `nadjiSudarenePrefikse`, `nadjiNeispravnaImena` (Task 1); `nadjiNeparitet`, `nadjiIcuOne` (Task 2); `provjeriIzvore`, `type Nalaz` (Task 3)
- Produces: izvršna skripta; izlazni kod `0` (čisto) ili `1` (ima nalaza)

- [ ] **Step 1: Napiši skriptu**

Kreiraj `scripts/provjeri-integraciju.ts`:

```ts
/**
 * Statičke provjere integracije. Tanka ljuska — sva logika je u lib/integracija/,
 * gdje je pokrivena vitest testovima (vitest.config.ts ne obuhvata scripts/).
 *
 * Izlazni kod: 0 čisto, 1 ima nalaza.
 *
 * Pokretanje: pnpm provjeri:integraciju
 */
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { nadjiSudarenePrefikse, nadjiNeispravnaImena } from "../lib/integracija/migracije"
import { nadjiNeparitet, nadjiIcuOne, type Katalog } from "../lib/integracija/prijevodi"
import { provjeriIzvore, type Izvor, type Nalaz } from "../lib/integracija/pravila"

const KORIJEN = process.cwd()
const JEZICI = ["sr", "en", "de"] as const
const OBUHVAT = ["app", "components", "lib", "tests", "supabase/migrations"]
const EKSTENZIJE = /\.(ts|tsx|sql)$/

async function skupiFajlove(pocetak: string): Promise<string[]> {
  const stavke = await readdir(pocetak, { withFileTypes: true, recursive: true })
  return stavke
    .filter((s) => s.isFile() && EKSTENZIJE.test(s.name))
    .map((s) => join(s.parentPath, s.name))
}

async function ucitajIzvore(): Promise<Izvor[]> {
  const grane = await Promise.all(
    OBUHVAT.map((dir) => skupiFajlove(join(KORIJEN, dir)).catch(() => [])),
  )
  const putanje = grane.flat()
  const sadrzaji = await Promise.all(putanje.map((p) => readFile(p, "utf8")))
  return putanje.map((p, i) => ({
    putanja: relative(KORIJEN, p).split("\\").join("/"),
    sadrzaj: sadrzaji[i],
  }))
}

async function main(): Promise<void> {
  const nalazi: Nalaz[] = []

  // 1 + 2 — migracije
  const imenaMigracija = (
    await readdir(join(KORIJEN, "supabase/migrations")).catch(() => [] as string[])
  ).sort()

  for (const sudar of nadjiSudarenePrefikse(imenaMigracija)) {
    nalazi.push({
      putanja: `supabase/migrations/${sudar.fajlovi[0]}`,
      linija: 1,
      pravilo: "sudar-migracija",
      poruka: `prefiks ${sudar.prefiks} dijeli ${sudar.fajlovi.length} fajla: ${sudar.fajlovi.join(", ")} — redoslijed primjene je nedefinisan`,
    })
  }

  for (const ime of nadjiNeispravnaImena(imenaMigracija)) {
    nalazi.push({
      putanja: `supabase/migrations/${ime}`,
      linija: 1,
      pravilo: "ime-migracije",
      poruka: "nedostaje 14-cifreni timestamp prefiks",
    })
  }

  // 3 — prevodi
  const katalozi = Object.fromEntries(
    await Promise.all(
      JEZICI.map(async (j) => [
        j,
        JSON.parse(await readFile(join(KORIJEN, `messages/${j}.json`), "utf8")) as Katalog,
      ]),
    ),
  ) as Record<string, Katalog>

  for (const nalaz of nadjiNeparitet(katalozi)) {
    nalazi.push({
      putanja: "messages/",
      linija: 1,
      pravilo: "paritet-prevoda",
      poruka: `ključ ${nalaz.kljuc} nedostaje u: ${nalaz.nedostajeU.join(", ")}`,
    })
  }

  for (const kljuc of nadjiIcuOne(katalozi.sr)) {
    nalazi.push({
      putanja: "messages/sr.json",
      linija: 1,
      pravilo: "icu-one-u-srpskom",
      poruka: `ključ ${kljuc} koristi ICU kategoriju one`,
    })
  }

  // 4 — tekstualna pravila
  nalazi.push(...provjeriIzvore(await ucitajIzvore()))

  if (nalazi.length === 0) {
    console.log("✓ provjera integracije: čisto")
    return
  }

  console.error(`✗ provjera integracije: ${nalazi.length} nalaz(a)\n`)
  for (const n of nalazi) {
    console.error(`  ${n.putanja}:${n.linija} — [${n.pravilo}] ${n.poruka}`)
  }
  process.exitCode = 1
}

main().catch((greska) => {
  console.error("provjera integracije je pukla:", greska)
  process.exitCode = 1
})
```

- [ ] **Step 2: Dodaj pnpm skriptu**

U `package.json`, u `"scripts"`, dodaj:

```json
"provjeri:integraciju": "tsx scripts/provjeri-integraciju.ts"
```

- [ ] **Step 3: Pusti nad zatečenim `main`-om**

Run: `pnpm provjeri:integraciju`
Expected: izlazni kod `0`, ispis `✓ provjera integracije: čisto`

Ako prijavi nalaze na netaknutom `main`-u, to je **lažno pozitivan** — nijedan od uslova iz §1.1 spec-a ne postoji na `main`-u. Suzi pravilo ili dodaj putanju u `IZUZECI_ADMIN`; ne gasi provjeru.

- [ ] **Step 4: Dokaži da stvarno hvata sudar**

Napravi privremeni fajl s istim prefiksom kao postojeća migracija, pusti provjeru, pa ga obriši:

```bash
cp supabase/migrations/20260726120000_get_termini_godine_rpc.sql \
   supabase/migrations/20260726120000_probni_sudar.sql
pnpm provjeri:integraciju; echo "izlazni kod: $?"
rm supabase/migrations/20260726120000_probni_sudar.sql
```

Expected: izlazni kod `1`, u ispisu `[sudar-migracija] prefiks 20260726120000 dijeli 2 fajla`

- [ ] **Step 5: Potvrdi da je radno stablo čisto**

Run: `git status --short supabase/migrations`
Expected: prazno — probni fajl je obrisan

- [ ] **Step 6: Commit**

```bash
git add scripts/provjeri-integraciju.ts package.json
git commit -m "feat(integracija): skripta provjeri:integraciju"
```

---

### Task 5: CI workflow

**Files:**
- Create: `.github/workflows/gate.yml`

**Interfaces:**
- Consumes: `pnpm provjeri:integraciju` (Task 4)
- Produces: obavezna provjera na PR-u prema `main`

**Kontekst koji izvođač mora znati:**

- `package.json` nema ni `engines` ni `packageManager` — verzije se pišu eksplicitno u workflow. Lokalno: Node 24, pnpm 10.15.0, `pnpm-lock.yaml` je `lockfileVersion: '9.0'`.
- `pnpm build` uvozi `lib/env.ts`, koji zod-validira env i **baca na boot**. Strogo obavezna su samo dva: `NEXT_PUBLIC_SUPABASE_URL` (mora biti ispravan URL) i `NEXT_PUBLIC_SUPABASE_ANON_KEY` (min 1 znak). Sve ostalo je opciono ili ima default.
- Vrijednosti dolaze iz GitHub secrets i moraju biti **DEMO**, nikad PROD.
- E2E se **ne pušta u CI-ju** — ide na cloud DEMO sa `--workers=1` jer specovi dijele singleton `postavke` id=1, pa bi dva paralelna PR-a gazila podatke.

- [ ] **Step 1: Napiši workflow**

Kreiraj `.github/workflows/gate.yml`:

```yaml
name: gate

on:
  pull_request:
    branches: [main]
  push:
    branches: ["integracija/**"]

concurrency:
  group: gate-${{ github.ref }}
  cancel-in-progress: true

jobs:
  provjera:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    env:
      # DEMO vrijednosti. PROD ključevi ne smiju postojati u ovom workflow-u.
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.DEMO_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.DEMO_SUPABASE_ANON_KEY }}
      ZAPISNIK_DRY_RUN: "1"
      CHAT_DRY_RUN: "1"

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.15.0

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: typecheck
        run: pnpm typecheck

      - name: lint
        run: pnpm lint

      - name: unit testovi
        run: pnpm test:unit

      - name: build
        run: pnpm build

      - name: statičke provjere integracije
        run: pnpm provjeri:integraciju
```

- [ ] **Step 2: Provjeri da je YAML ispravan**

Run: `node -e "const {parse}=require('yaml');parse(require('fs').readFileSync('.github/workflows/gate.yml','utf8'));console.log('YAML ok')"`
Expected: `YAML ok`

Ako paket `yaml` nije dostupan, preskoči — GitHub prijavi sintaksnu grešku pri prvom pushu.

- [ ] **Step 3: Pusti isti lanac lokalno**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm provjeri:integraciju`
Expected: sve prolazi

`pnpm build` se lokalno preskače jer traje dugo; CI ga pušta.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/gate.yml
git commit -m "ci: gate na PR prema main — typecheck, lint, unit, build, provjere"
```

- [ ] **Step 5: Zabilježi ručni korak za vlasnika**

CI ne može raditi dok secrets ne postoje. Prijavi vlasniku da u GitHub → Settings → Secrets → Actions treba dodati:

- `DEMO_SUPABASE_URL` — DEMO projekat, ref `mtwwotmwrasozmcgqwhc`
- `DEMO_SUPABASE_ANON_KEY` — anon ključ istog projekta

I da nakon prvog uspješnog prolaza `gate / provjera` treba označiti kao **required status check** za `main` (Settings → Branches → Branch protection). Bez toga workflow prijavljuje, ali ne blokira merge.

---

### Task 6: Procedura kao slash komanda

**Files:**
- Create: `.claude/commands/integracija.md`

**Interfaces:**
- Consumes: `pnpm provjeri:integraciju` (Task 4), `.github/workflows/gate.yml` (Task 5)
- Produces: `/integracija` — poziva proceduru iz spec-a §4

- [ ] **Step 1: Napiši komandu**

Kreiraj `.claude/commands/integracija.md`:

```markdown
---
description: Integracioni gate — spoji spremne grane, provjeri sklop, izvijesti GO/NE-GO
---

Sprovedi integracioni gate po `docs/superpowers/specs/2026-07-28-integracioni-gate-design.md`.

Argument (opciono): spisak grana. Bez argumenta — sam sastavi spisak.

## Faza 0 — Prijem

- `git fetch origin --prune`
- `gh pr list --state open` i `git branch --format='%(refname:short)'`
- Za svaku granu: `git rev-list --left-right --count origin/main...<grana>`
- Ispiši predloženu seriju i **sačekaj potvrdu vlasnika**. Ne nastavljaj bez nje.

## Faza 1 — Sklapanje

- `git worktree add .claude/worktrees/integracija -b integracija/$(date +%F) origin/main`
- U tom worktree-u: `pnpm install --frozen-lockfile`
- Spajaj grane **serijski, po rastućem broju PR-a**: `git merge --no-ff <grana>`
- Konflikt zabilježi i **stani** — ne rješavaj napamet. Prijavi vlasniku čije su grane u sudaru.

## Faza 2 — Statičke provjere

- `pnpm provjeri:integraciju`
- Svaki nalaz nosi grana koja ga je uvela — utvrdi koja preko `git log -S`.

## Faza 3 — Kvalitet

- `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`
- `pnpm test:e2e` — **samo ovdje**, nikad paralelno iz više worktree-ova (singleton `postavke` id=1 na cloud DEMO)
- `pnpm cleanup:test-data` poslije E2E, bez izuzetka

## Faza 4 — Migracije

Ako serija donosi nove `supabase/migrations/*.sql`:

- `pnpm db:apply-cloud --demo <fajl>` — jedan po jedan, redom po prefiksu
- Regeneracija tipova (`db:types` čita **lokalnu** bazu, ne cloud):
  `supabase start` → `pnpm db:reset` → `pnpm db:types`
- `db:reset` mora proći čisto — ako padne, serija je NE-GO
- `git diff db/types.ts` mora biti prazan; razlika znači da je neka grana ručno dirala auto-generisani fajl
- Ponovi fazu 3

## Faza 5 — Recenzija

Pet pitanja iz spec-a §6: uklapanje u arhitekturu, semantički sudar među granama, mapa uticaja, dupliran rad, obim naspram najave.

Nalaz piši kao `fajl:linija — šta se lomi — čija je grana`.

## Faza 6 — Preview

- `git push -u origin integracija/$(date +%F)`
- Sačekaj Vercel Preview i provjeri deployanu aplikaciju

## Faza 7 — Merge

- Izvijesti **GO / NE-GO po grani** i sačekaj odobrenje vlasnika
- Ako serija nosi migracije: PROD migracija ide **prije** merge-a, uz izričitu potvrdu, kroz `POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`
- Mergaj PR-ove provjerenim redom
- **Invarijanta:** `git fetch origin && git diff integracija/<datum> origin/main` mora biti prazan. Ako nije — stani i javi; deployano stanje nije ono koje je provjereno.

## Faza 8 — Čišćenje

- `git worktree remove .claude/worktrees/integracija`
- `git push origin --delete integracija/<datum>` i `git branch -D integracija/<datum>`

## Ovlaštenja

**Popravljaš sam** (mehaničko): rebase na main, paritet u `messages/*.json`, preimenovanje sudarenih timestampova, regeneracija `db/types.ts`.

**Vraćaš vlasniku** (suštinsko): logički sudar dvije grane, sporna poslovna pravila, sporan dizajn.

Svaka ispravka ide **u izvornu granu**, pa se grana ponovo spaja. Integraciona grana je uvijek izvedena, nikad izvor — briše se u fazi 8, pa bi ispravka commitovana samo u nju nestala s njom.
```

- [ ] **Step 2: Provjeri da se komanda vidi**

Run: `ls -la .claude/commands/`
Expected: `integracija.md` postoji

Komanda se pojavljuje kao `/integracija` u novoj sesiji.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/integracija.md
git commit -m "docs(integracija): procedura gate-a kao /integracija komanda"
```

---

### Task 7: Prvi stvarni prolaz

**Files:** nijedan — ovo je validacija cijelog lanca nad živim zaostatkom.

**Interfaces:**
- Consumes: sve prethodno

**Kontekst:** Na dan pisanja u letu je 8 grana bez PR-a. Dvije od njih (`perf/aktivnost-keyset-pretraga` i `feat/kontakt-lokacija-podsjetnici`) nose migracije s **istim prefiksom `20260728120000`**. Ovaj prolaz mora tu kolizu prijaviti — to je dokaz da gate radi ono zbog čega postoji.

- [ ] **Step 1: Napravi probni integracioni worktree**

```bash
git fetch origin --prune
git worktree add .claude/worktrees/integracija-proba -b proba/gate origin/main
```

- [ ] **Step 2: Spoji dvije grane koje se sudaraju**

```bash
cd .claude/worktrees/integracija-proba
git merge --no-ff perf/aktivnost-keyset-pretraga
git merge --no-ff feat/kontakt-lokacija-podsjetnici
```

Expected: oba merge-a prolaze **bez konflikta** — to je upravo poenta; git ne vidi problem.

- [ ] **Step 3: Pusti provjeru i potvrdi da sudar biva prijavljen**

```bash
pnpm install --frozen-lockfile
pnpm provjeri:integraciju; echo "izlazni kod: $?"
```

Expected: izlazni kod `1`, u ispisu red koji sadrži `[sudar-migracija] prefiks 20260728120000` i oba imena fajla.

Ako ne prijavi — pravilo iz Taska 1 ne radi nad stvarnim podacima. Vrati se na Task 1, dopuni test stvarnim slučajem, popravi.

- [ ] **Step 4: Zapiši nalaz**

Zabilježi u odgovoru vlasniku: koje su grane u sudaru, koji prefiks, i prijedlog novog timestampa za mlađu migraciju (npr. `20260728123000`). **Ne mijenjaj grane** — to je suštinska odluka i ide vlasniku.

- [ ] **Step 5: Očisti probu**

```bash
cd "$(git rev-parse --show-toplevel)"
git worktree remove --force .claude/worktrees/integracija-proba
git branch -D proba/gate
```

- [ ] **Step 6: Potvrdi da nije ostalo smeća**

Run: `git worktree list && git status --short`
Expected: `integracija-proba` više nije na spisku; radno stablo bez novih fajlova

---

## Šta ovaj plan ne pokriva

Svjesno odgođeno u spec-u §9, ne implementira se ovdje:

- automatsko okidanje gate-a hookom
- provjera stvarne PROD šeme prije merge-a
- više integracionih serija u letu istovremeno
