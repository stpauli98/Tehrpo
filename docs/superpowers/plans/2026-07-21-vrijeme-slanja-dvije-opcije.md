# Vrijeme slanja: dvije opcije umjesto 24 sata (implementacijski plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Podešavanje „Vrijeme slanja" u Postavkama prestaje nuditi 24 sata od kojih 8 tiho gasi sve podsjetnike, i svodi se na dvije opcije koje stvarno postoje — ujutro i poslijepodne.

**Architecture:** Nova čista funkcija `rasporedSlanja.ts` drži vezu između cron rasporeda i podešavanja na jednom mjestu. Kolona `vrijeme_slanja_sat` i gate `sat >= vrijeme_slanja_sat` ostaju nepromijenjeni; forma piše 8 ili 13. Migracija normalizuje zatečene vrijednosti pa dodaje `check` na dostižan opseg.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + PostgREST), next-intl, Base UI Select, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-21-vrijeme-slanja-dvije-opcije-design.md`

## Global Constraints

- Paket menadžer je **`pnpm`**, nikad `npm`/`yarn`.
- `pnpm dev` ide sa `--webpack` (razmak u putanji projekta); ne dirati.
- Domenski jezik je bosanski/srpski (latinica) — identifikatori, komentari, UI stringovi.
- next-intl tipizira ključeve prema literalnoj uniji iz JSON-a: svaki novi ključ ide u **sva tri** kataloga (`messages/{sr,en,de}.json`) u istoj promjeni, uz paritet. **ICU kategorija `one` je zabranjena za `sr`.**
- **Nikad service-role klijent u `app/` ili `components/` request putu.**
- Sve env varijable idu kroz `lib/env.ts`.
- `db/types.ts` je auto-generisan; `pnpm db:types` čita **lokalni** stack, pa migracije moraju prvo biti primijenjene lokalno.
- Zabranjeni Tailwind breakpointi `sm:`/`md:`.
- `no-await-in-loop: error` osim u `scripts/`.
- **Migracije na cloud idu eksplicitno:** `pnpm db:apply-cloud --demo <fajl>` odnosno `POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`.
- **DEMO i PROD u lockstep-u.** Cloud primjena i deploy su korisnikova radnja (Task 4).
- E2E odbija rad ako cilj nije DEMO (`tests/e2e/global-setup.ts`); `.env.development.local` mora postojati u radnom direktorijumu.
- **Ne dirati** `lib/reminders/gating.ts`, `app/api/cron/reminders/route.ts`, niti ijedan od tri puta slanja (pre-due, post-due, digest).
- Grana: `fix/vrijeme-slanja-dvije-opcije`. Merge u `main` = produkcijski deploy na tri Vercel projekta.

---

## Pregled fajlova

**Kreirati:**
- `lib/reminders/rasporedSlanja.ts` — konstante i preslikavanje termin ↔ sat
- `lib/reminders/rasporedSlanja.test.ts` — unit, uključujući čuvara veze sa cron rasporedom
- `supabase/migrations/20260721130000_vrijeme_slanja_dostizan_opseg.sql`
- `lib/postavke/vrijemeSlanja.integration.test.ts` — `check` ograničenje protiv lokalne baze

**Mijenjati:**
- `components/domain/VrijemeSlanjaForm.tsx` — dvije opcije umjesto 24 sata
- `app/(dashboard)/postavke/actions.ts` — `updateVrijemeSlanja` prima termin, ne sat
- `messages/{sr,en,de}.json` — labele opcija + ispravljen opis
- `tests/e2e/23-podsjetnici-v2.spec.ts` — dva mjesta (vidi Task 2 Step 5 i Task 3 Step 7)
- `db/types.ts` — regenerisan, ne ručno

**Ne dirati:** `lib/reminders/gating.ts`, `app/api/cron/reminders/route.ts`, `runReminders.ts`, `runPostDue.ts`, `runDigest.ts`.

---

### Task 1: `rasporedSlanja` — jedno mjesto koje zna raspored

**Files:**
- Create: `lib/reminders/rasporedSlanja.ts`
- Create: `lib/reminders/rasporedSlanja.test.ts`

**Interfaces:**
- Consumes: ništa (čista funkcija, bez zavisnosti)
- Produces:
  - `NAJKASNIJI_DOSTIZAN_SAT: 14`
  - `SAT_UJUTRO: 8`, `SAT_POSLIJEPODNE: 13`
  - `type TerminSlanja = "ujutro" | "poslijepodne"`
  - `terminIzSata(sat: number): TerminSlanja`
  - `satIzTermina(termin: TerminSlanja): number`

- [ ] **Step 1: Napiši padajuće testove**

Kreiraj `lib/reminders/rasporedSlanja.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  NAJKASNIJI_DOSTIZAN_SAT, SAT_UJUTRO, SAT_POSLIJEPODNE,
  terminIzSata, satIzTermina, type TerminSlanja,
} from "./rasporedSlanja"

// Cron iz vercel.json: "0 9 * * *" i "0 13 * * *" (UTC).
// Po Beču: 10:00 i 14:00 zimi (CET, UTC+1), 11:00 i 15:00 ljeti (CEST, UTC+2).
const JUTARNJI_CRON_BEC = [10, 11]
const POPODNEVNI_CRON_BEC = [14, 15]

// Gate u cron ruti je `sat >= vrijeme_slanja_sat`.
const prolazi = (cronSat: number, postavka: number) => cronSat >= postavka

describe("preslikavanje termin ↔ sat", () => {
  it("satIzTermina daje očekivane vrijednosti", () => {
    expect(satIzTermina("ujutro")).toBe(SAT_UJUTRO)
    expect(satIzTermina("poslijepodne")).toBe(SAT_POSLIJEPODNE)
  })

  it("terminIzSata: sve do 11 je ujutro", () => {
    for (const s of [0, 1, 8, 10, 11]) expect(terminIzSata(s)).toBe("ujutro")
  })

  it("terminIzSata: 12 do 14 je poslijepodne", () => {
    for (const s of [12, 13, 14]) expect(terminIzSata(s)).toBe("poslijepodne")
  })

  it("terminIzSata: granica je između 11 i 12", () => {
    expect(terminIzSata(11)).toBe("ujutro")
    expect(terminIzSata(12)).toBe("poslijepodne")
  })

  it("zatečena nedostižna vrijednost se ne gubi u prikazu", () => {
    // Migracija ih normalizuje, ali forma mora nešto prikazati i za red
    // koji je upisan prije nje ili direktno u bazu.
    for (const s of [15, 20, 23]) expect(terminIzSata(s)).toBe("poslijepodne")
  })

  it("povratak kroz oba smjera je stabilan", () => {
    for (const t of ["ujutro", "poslijepodne"] as TerminSlanja[]) {
      expect(terminIzSata(satIzTermina(t))).toBe(t)
    }
  })
})

// Ovi testovi su jedini automatizovani čuvar veze između vercel.json i konstanti.
// Ako neko promijeni cron raspored a zaboravi konstante, ovdje puca.
describe("veza sa cron rasporedom", () => {
  it("SAT_UJUTRO prolazi gate na jutarnjem runu u obje sezone", () => {
    for (const cron of JUTARNJI_CRON_BEC) expect(prolazi(cron, SAT_UJUTRO)).toBe(true)
  })

  it("SAT_POSLIJEPODNE NE prolazi jutarnji run ni u jednoj sezoni", () => {
    for (const cron of JUTARNJI_CRON_BEC) expect(prolazi(cron, SAT_POSLIJEPODNE)).toBe(false)
  })

  it("SAT_POSLIJEPODNE prolazi popodnevni run u obje sezone", () => {
    for (const cron of POPODNEVNI_CRON_BEC) expect(prolazi(cron, SAT_POSLIJEPODNE)).toBe(true)
  })

  it("NAJKASNIJI_DOSTIZAN_SAT je najraniji popodnevni cron sat", () => {
    expect(NAJKASNIJI_DOSTIZAN_SAT).toBe(Math.min(...POPODNEVNI_CRON_BEC))
  })

  it("svaka vrijednost do NAJKASNIJI_DOSTIZAN_SAT je dostižna u obje sezone", () => {
    for (let s = 0; s <= NAJKASNIJI_DOSTIZAN_SAT; s++) {
      const dostizna = [...JUTARNJI_CRON_BEC, ...POPODNEVNI_CRON_BEC].some((c) => prolazi(c, s))
      expect(dostizna, `sat ${s} mora biti dostižan`).toBe(true)
    }
  })

  it("prva vrijednost iznad praga nije dostižna zimi", () => {
    const s = NAJKASNIJI_DOSTIZAN_SAT + 1
    expect(prolazi(JUTARNJI_CRON_BEC[0]!, s)).toBe(false)
    expect(prolazi(POPODNEVNI_CRON_BEC[0]!, s)).toBe(false)
  })
})
```

- [ ] **Step 2: Pokreni testove da potvrdiš pad**

```bash
pnpm vitest run lib/reminders/rasporedSlanja.test.ts
```

Očekivano: FAIL — modul `./rasporedSlanja` ne postoji.

- [ ] **Step 3: Implementiraj `lib/reminders/rasporedSlanja.ts`**

```ts
/**
 * Veza između cron rasporeda i podešavanja „Vrijeme slanja".
 *
 * Raspored je u vercel.json: "0 9 * * *" i "0 13 * * *" (UTC), dakle po Beču
 * 10:00 i 14:00 zimi (CET), 11:00 i 15:00 ljeti (CEST). Gate u cron ruti je
 * `sat >= vrijeme_slanja_sat`, pa je najkasnija vrijednost koja radi CIJELE
 * godine jednaka najranijem popodnevnom cron satu — 14.
 *
 * Sve iznad toga tiho ne šalje ništa: ruta uredno vrati `izvan_sata` i 200.
 * Zato forma nudi samo dvije opcije, a baza ima `check` na ovaj opseg.
 *
 * Vercel raspored se ne može pročitati u runtime-u, pa je ova veza konvencija
 * koju čuva `rasporedSlanja.test.ts` — ako se cron promijeni a konstante ne,
 * ti testovi pucaju.
 */

/** Najkasniji sat koji cron raspored pouzdano dostiže u obje sezone. */
export const NAJKASNIJI_DOSTIZAN_SAT = 14

/** Prolazi na prvom dnevnom runu (10:00 zimi, 11:00 ljeti). */
export const SAT_UJUTRO = 8

/** Preskače prvi run, prolazi na drugom (14:00 zimi, 15:00 ljeti). */
export const SAT_POSLIJEPODNE = 13

export type TerminSlanja = "ujutro" | "poslijepodne"

/**
 * Najveći sat koji se još smatra jutarnjim. 11 je sat prvog LJETNOG run-a:
 * vrijednost 12 je najmanja koja ga pouzdano preskače u obje sezone.
 */
const GORNJA_GRANICA_JUTRA = 11

/** U koju opciju spada zatečena brojčana vrijednost iz baze. */
export function terminIzSata(sat: number): TerminSlanja {
  return sat <= GORNJA_GRANICA_JUTRA ? "ujutro" : "poslijepodne"
}

/** Koja se brojčana vrijednost upisuje za izabranu opciju. */
export function satIzTermina(termin: TerminSlanja): number {
  return termin === "ujutro" ? SAT_UJUTRO : SAT_POSLIJEPODNE
}
```

- [ ] **Step 4: Testovi moraju proći**

```bash
pnpm vitest run lib/reminders/rasporedSlanja.test.ts
pnpm typecheck && pnpm lint
```

Očekivano: svih dvanaest PASS, typecheck i lint čisti.

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/rasporedSlanja.ts lib/reminders/rasporedSlanja.test.ts
git commit -m "feat(postavke): rasporedSlanja — jedno mjesto koje zna vezu cron ↔ vrijeme slanja"
```

---

### Task 2: Migracija — normalizacija pa ograničenje

**Files:**
- Create: `supabase/migrations/20260721130000_vrijeme_slanja_dostizan_opseg.sql`
- Create: `lib/postavke/vrijemeSlanja.integration.test.ts`
- Modify: `tests/e2e/23-podsjetnici-v2.spec.ts` (oko linije 194)
- Modify: `db/types.ts` (generisan)

**Interfaces:**
- Consumes: `NAJKASNIJI_DOSTIZAN_SAT` iz Taska 1 (samo u testu, radi dosljednosti)
- Produces: `postavke.vrijeme_slanja_sat` sa ograničenjem `between 0 and 14`

- [ ] **Step 1: Napiši migraciju**

Kreiraj `supabase/migrations/20260721130000_vrijeme_slanja_dostizan_opseg.sql`:

```sql
-- Vrijeme slanja mora biti u opsegu koji cron raspored stvarno dostiže.
--
-- Raspored (vercel.json): "0 9 * * *" i "0 13 * * *" UTC → po Beču 10/14 zimi,
-- 11/15 ljeti. Gate je `sat >= vrijeme_slanja_sat`, pa sve iznad 14 nikad ne
-- prođe zimi, a iznad 15 ni ljeti — ruta uredno vrati `izvan_sata` i 200, bez
-- greške i bez traga. DEMO je zatečen na 23, dakle u tom tihom kvaru.
--
-- Dosad je jedina brana bila validacija u server akciji, koja štiti samo put
-- kroz UI; ovo pokriva i direktan upis u bazu.

-- 1. Normalizuj zatečene vrijednosti PRIJE ograničenja — inače bi `add constraint`
--    odbio postojeći red i migracija bi pukla.
--    Granica 11 je sat prvog LJETNOG run-a: 12 je najmanja vrijednost koja ga
--    pouzdano preskače u obje sezone.
update postavke
set vrijeme_slanja_sat = case when vrijeme_slanja_sat <= 11 then 8 else 13 end
where vrijeme_slanja_sat is distinct from (case when vrijeme_slanja_sat <= 11 then 8 else 13 end);

-- 2. Tek sada ograničenje.
alter table postavke drop constraint if exists chk_postavke_vrijeme_slanja_sat;
alter table postavke add constraint chk_postavke_vrijeme_slanja_sat
  check (vrijeme_slanja_sat between 0 and 14);
```

- [ ] **Step 2: Primijeni lokalno**

```bash
pnpm db:reset
```

Očekivano: sve migracije prolaze, posljednja je `20260721130000`.

- [ ] **Step 3: Napiši integracioni test**

Kreiraj `lib/postavke/vrijemeSlanja.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { NAJKASNIJI_DOSTIZAN_SAT, SAT_UJUTRO, SAT_POSLIJEPODNE } from "@/lib/reminders/rasporedSlanja"

const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("postavke.vrijeme_slanja_sat — dostižan opseg (integracija)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  // Sve u transakciji koja se rollback-uje — postavke su singleton red id=1.
  async function uTransakciji(fn: () => Promise<void>) {
    await db.query("begin")
    try {
      await fn()
    } finally {
      await db.query("rollback")
    }
  }

  const postavi = (sat: number) =>
    db.query("update postavke set vrijeme_slanja_sat = $1 where id = 1", [sat])

  it("prima obje vrijednosti koje forma upisuje", async () => {
    await uTransakciji(async () => {
      await expect(postavi(SAT_UJUTRO)).resolves.toBeDefined()
      await expect(postavi(SAT_POSLIJEPODNE)).resolves.toBeDefined()
    })
  })

  it("prima granicu dostižnog opsega", async () => {
    await uTransakciji(async () => {
      await expect(postavi(0)).resolves.toBeDefined()
      await expect(postavi(NAJKASNIJI_DOSTIZAN_SAT)).resolves.toBeDefined()
    })
  })

  it("odbija prvu vrijednost iznad granice", async () => {
    await uTransakciji(async () => {
      await expect(postavi(NAJKASNIJI_DOSTIZAN_SAT + 1)).rejects.toThrow(/chk_postavke_vrijeme_slanja_sat/)
    })
  })

  it("odbija vrijednost koja je zatečena na DEMO-u prije migracije", async () => {
    await uTransakciji(async () => {
      await expect(postavi(23)).rejects.toThrow(/chk_postavke_vrijeme_slanja_sat/)
    })
  })

  it("odbija negativnu vrijednost", async () => {
    await uTransakciji(async () => {
      await expect(postavi(-1)).rejects.toThrow(/chk_postavke_vrijeme_slanja_sat/)
    })
  })

  it("poslije migracije nijedan red nije izvan opsega", async () => {
    const r = await db.query(
      "select count(*)::int as n from postavke where vrijeme_slanja_sat not between 0 and $1",
      [NAJKASNIJI_DOSTIZAN_SAT],
    )
    expect(r.rows[0].n).toBe(0)
  })
})
```

- [ ] **Step 4: Pokreni integracione testove**

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm vitest run lib/postavke/
```

Očekivano: svih šest PASS.

- [ ] **Step 5: Popravi E2E test koji upisuje nedostižnu vrijednost**

`tests/e2e/23-podsjetnici-v2.spec.ts` oko linije 194 postavlja `vrijeme_slanja_sat: 23` u testu „regresija: POST /api/cron/reminders zaobilazi sat/dnevni gate (dry)". **Novo ograničenje bi taj upis odbio i test bi pao.**

Taj test u istom pozivu postavlja i `zadnje_slanje_datum: danas`, pa dnevni marker već sam po sebi blokira pre-due. Vrijednost `23` je bila dodatni pojas.

Popravka: ukloni `vrijeme_slanja_sat: 23` iz tog poziva i zadrži `zadnje_slanje_datum: danas`. Preimenuj test u „regresija: POST /api/cron/reminders zaobilazi dnevni gate (dry)" i dodaj komentar:

```ts
    // Sat-gate se ovdje više ne postavlja: `check` na postavke.vrijeme_slanja_sat
    // dopušta samo dostižne vrijednosti (0..14), pa se nedostižan sat ne može ni
    // upisati. Zaobilaženje SAT-gejta za POST pokriva unit test rute
    // (app/api/cron/reminders/route.test.ts), koji ga može mockovati bez baze.
```

Provjeri da `route.test.ts` stvarno ima scenario koji dokazuje da POST ne poštuje sat-gate; ako nema, dodaj ga tamo — to je pravo mjesto za tu tvrdnju.

Ako se u istom fajlu (linija ~212) `vrijeme_slanja_sat` vraća na prethodnu vrijednost u `finally` bloku, ostavi to — ta vrijednost dolazi iz baze i biće unutar opsega.

- [ ] **Step 6: Regeneriši tipove i provjeri**

```bash
pnpm db:types
pnpm typecheck && pnpm lint && pnpm test:unit
```

`check` ograničenje ne mijenja TypeScript tipove, pa je `db/types.ts` vjerovatno nepromijenjen — ako jeste, ne commit-uj ga.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260721130000_vrijeme_slanja_dostizan_opseg.sql \
        lib/postavke/vrijemeSlanja.integration.test.ts tests/e2e/23-podsjetnici-v2.spec.ts
git commit -m "feat(postavke): check na dostižan opseg vremena slanja + normalizacija zatečenih"
```

---

### Task 3: Forma i server akcija

**Files:**
- Modify: `components/domain/VrijemeSlanjaForm.tsx`
- Modify: `app/(dashboard)/postavke/actions.ts` (funkcija `updateVrijemeSlanja`)
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`
- Modify: `tests/e2e/23-podsjetnici-v2.spec.ts` (test „vrijeme slanja se sačuva i prikaže", oko linije 44)

**Interfaces:**
- Consumes: `terminIzSata`, `satIzTermina`, `type TerminSlanja` iz Taska 1
- Produces: forma šalje polje `vrijeme_slanja_sat` sa vrijednošću `"ujutro"` ili `"poslijepodne"`

- [ ] **Step 1: Dodaj i18n ključeve u sva tri kataloga**

U `messages/sr.json`, objekat `postavke.vrijemeSlanja` — zamijeni `opis` i dodaj dvije labele:

```json
"vrijemeSlanja": {
  "naslov": "Vrijeme slanja",
  "opis": "Podsjetnici se šalju jednom dnevno, na jednom od dva termina.",
  "zona": "po lokalnom vremenu (Beč)",
  "ujutro": "Ujutro (oko 10–11h)",
  "poslijepodne": "Poslijepodne (oko 14–15h)"
}
```

`messages/en.json`:

```json
"vrijemeSlanja": {
  "naslov": "Sending time",
  "opis": "Reminders are sent once a day, at one of two slots.",
  "zona": "local time (Vienna)",
  "ujutro": "Morning (around 10–11)",
  "poslijepodne": "Afternoon (around 14–15)"
}
```

`messages/de.json` (čeka native review, kao i ostatak kataloga):

```json
"vrijemeSlanja": {
  "naslov": "Versandzeit",
  "opis": "Erinnerungen werden einmal täglich zu einem von zwei Zeitpunkten versendet.",
  "zona": "Ortszeit (Wien)",
  "ujutro": "Vormittags (ca. 10–11 Uhr)",
  "poslijepodne": "Nachmittags (ca. 14–15 Uhr)"
}
```

Zadrži postojeće vrijednosti `naslov` i `zona` iz svakog kataloga ako se razlikuju od gornjih — mijenjaju se samo `opis` i dodaju dvije nove labele.

- [ ] **Step 2: Prepiši formu**

Zamijeni sadržaj `components/domain/VrijemeSlanjaForm.tsx`:

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { updateVrijemeSlanja, type ActionResult } from "@/app/(dashboard)/postavke/actions"
import { useAkcijaToast } from "@/components/akcija-toast"
import { terminIzSata, type TerminSlanja } from "@/lib/reminders/rasporedSlanja"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

const initial: ActionResult = { ok: true }
const TERMINI: TerminSlanja[] = ["ujutro", "poslijepodne"]

export function VrijemeSlanjaForm({ vrijemeSat }: { vrijemeSat: number }) {
  const t = useTranslations("postavke.vrijemeSlanja")
  const tc = useTranslations("common")
  const router = useRouter()
  const [state, action, pending] = useActionState(updateVrijemeSlanja, initial)
  useAkcijaToast(state, { uspjeh: tc("sacuvano"), greska: tc("greska") })
  const prev = useRef<ActionResult>(initial)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!pending && state !== prev.current) {
      prev.current = state
      if (state.ok) router.refresh()
    }
  }, [state, pending, router])

  // Base UI Select.Value renders the raw stored value dok se popup barem jednom ne
  // otvori, OSIM ako Select.Root dobije `items` mapu — tada zna prikazati labelu i
  // prije prve interakcije (npr. odmah nakon reload-a).
  const items: Record<string, string> = { ujutro: t("ujutro"), poslijepodne: t("poslijepodne") }

  return (
    <form ref={formRef} action={action} className="max-w-xl space-y-2" data-testid="vrijeme-slanja-form">
      <label htmlFor="vrijeme_slanja_sat" className="text-sm font-medium">{t("naslov")}</label>
      <p className="text-sm text-muted-foreground">{t("opis")}</p>
      <div className="flex items-center gap-2">
        <Select
          id="vrijeme_slanja_sat"
          name="vrijeme_slanja_sat"
          items={items}
          defaultValue={terminIzSata(vrijemeSat)}
          disabled={pending}
          // Base UI's Select.Root calls onValueChange BEFORE it commits the new value to its
          // internal (React-controlled) hidden input — requestSubmit() called synchronously here
          // would submit the STALE value (confirmed empirically). Defer to a macrotask so React
          // flushes the state update first.
          onValueChange={() => setTimeout(() => formRef.current?.requestSubmit(), 0)}
        >
          <SelectTrigger data-testid="vrijeme-slanja-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TERMINI.map((termin) => (
              <SelectItem key={termin} value={termin}>
                {t(termin)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{t("zona")}</span>
      </div>
      {state.ok === false && state.message && (
        <p className="text-sm text-destructive" role="alert">{state.message}</p>
      )}
    </form>
  )
}
```

Polje i dalje nosi ime `vrijeme_slanja_sat` i `data-testid` ostaju isti — tako E2E selektori i dalje rade.

- [ ] **Step 3: Prepiši server akciju**

U `app/(dashboard)/postavke/actions.ts`, funkcija `updateVrijemeSlanja`:

```ts
export async function updateVrijemeSlanja(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const raw = String(formData.get("vrijeme_slanja_sat") ?? "")
  // Forma šalje termin, ne sat: dopuštene su tačno dvije vrijednosti, pa nedostižan
  // sat ne može ni nastati kroz UI. `check` u bazi pokriva direktan upis.
  if (raw !== "ujutro" && raw !== "poslijepodne") {
    return { ok: false, message: t("vrijemeSatNeispravan") }
  }
  const sat = satIzTermina(raw)
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("postavke").update({ vrijeme_slanja_sat: sat }).eq("id", 1)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}
```

Dodaj `satIzTermina` u postojeći import iz `@/lib/reminders/rasporedSlanja`.

- [ ] **Step 4: Provjeri da nema drugih pozivalaca forme**

```bash
grep -rn "VrijemeSlanjaForm\|updateVrijemeSlanja" app components lib --include=*.ts --include=*.tsx
```

Očekivano: samo `app/(dashboard)/postavke/page.tsx` (renderuje formu), sama forma i akcija. Ako se pojavi još neko mjesto, prilagodi ga.

- [ ] **Step 5: Typecheck i lint**

```bash
pnpm typecheck && pnpm lint && pnpm test:unit
```

- [ ] **Step 6: Vizuelna provjera u aplikaciji**

```bash
pnpm dev
```

Otvori `/postavke`, sekcija „Vrijeme slanja". Provjeri: padajući izbor nudi **dvije** opcije; zatečena vrijednost je prikazana kao labela odmah nakon učitavanja (ne kao sirov broj); izbor se sam snima i toast se pojavi; poslije reload-a izbor je zadržan.

- [ ] **Step 7: Prilagodi E2E test izbora**

U `tests/e2e/23-podsjetnici-v2.spec.ts` zamijeni cijeli test „vrijeme slanja se sačuva i prikaže" (oko linije 44) ovim:

```ts
  test("vrijeme slanja se sačuva i prikaže", async ({ page }) => {
    const prije = (await getPostavkeV2()).vrijeme_slanja_sat
    // Labela iz messages/sr.json → postavke.vrijemeSlanja.poslijepodne.
    // Test bira suprotno od podrazumijevanog "ujutro" da promjena bude stvarna.
    const LABELA = "Poslijepodne (oko 14–15h)"
    try {
      await page.goto("/postavke")
      await otvoriPodsjetnike(page)
      // Base UI Select (isti obrazac kao 07-temelj.spec.ts:30-33 i 14-plan-dorada.spec.ts:31-32):
      // testid je na SelectTrigger (button), ne na native <select> — otvori preko klika i
      // izaberi opciju preko role=option; provjera vrijednosti ide preko prikazanog teksta
      // (SelectValue), ne preko toHaveValue() koji radi samo na native <select>.
      const trigger = page.getByTestId("vrijeme-slanja-select")
      await expect(trigger).toBeVisible()

      await trigger.click()
      await page.getByRole("option", { name: LABELA, exact: true }).click()
      // Select se disable-uje dok je server akcija pending (isti obrazac kao ostali
      // testovi u ovoj datoteci) — sačekaj da se vrati enabled prije reload-a.
      await expect(trigger).toBeEnabled()

      await page.reload()
      await otvoriPodsjetnike(page)
      await expect(page.getByTestId("vrijeme-slanja-select")).toContainText(LABELA)

      // Forma šalje termin, a u bazu ide broj — provjeri da se preslikavanje stvarno desilo.
      expect((await getPostavkeV2()).vrijeme_slanja_sat).toBe(13)
    } finally {
      // Restore direktno u DB (pouzdanije od ponovnog UI round-trip-a ako je gornji
      // blok pukao na pola) — vrati na vrijednost pročitanu PRIJE mutacije.
      await setPostavkeV2({ vrijeme_slanja_sat: prije })
    }
  })
```

Ako se labela u `messages/sr.json` razlikuje od gornje (npr. zbog drugog crtice-znaka), uskladi konstantu `LABELA` sa stvarnim tekstom iz kataloga — mora se poklapati znak za znak jer `exact: true`.

- [ ] **Step 8: Pokreni E2E**

```bash
pnpm exec playwright test tests/e2e/23-podsjetnici-v2.spec.ts --workers=1 --project=chromium
```

Očekivano: guard ispiše da je cilj DEMO, svi testovi prođu.

- [ ] **Step 9: Commit**

```bash
git add components/domain/VrijemeSlanjaForm.tsx "app/(dashboard)/postavke/actions.ts" \
        messages/ tests/e2e/23-podsjetnici-v2.spec.ts
git commit -m "feat(postavke): vrijeme slanja kao dvije opcije umjesto 24 sata"
```

---

### Task 4: Puštanje

**Izvršava korisnik**, ne agent.

- [ ] **Step 1: Migracija na DEMO**

```bash
pnpm db:apply-cloud --demo supabase/migrations/20260721130000_vrijeme_slanja_dostizan_opseg.sql
```

- [ ] **Step 2: Provjera na DEMO-u**

```sql
select vrijeme_slanja_sat from postavke where id = 1;
```

Očekivano: `13` — DEMO je bio na `23`, migracija ga normalizuje u „poslijepodne".

- [ ] **Step 3: E2E protiv migriranog DEMO-a**

```bash
pnpm exec playwright test tests/e2e/23-podsjetnici-v2.spec.ts tests/e2e/06-podsjetnici.spec.ts --workers=1 --project=chromium
```

- [ ] **Step 4: Migracija na PROD**

```bash
POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/20260721130000_vrijeme_slanja_dostizan_opseg.sql
```

Očekivano poslije: `vrijeme_slanja_sat = 8` (PROD je bio na `10`, dakle „ujutro"). **Ponašanje slanja ostaje identično** — i `10` i `8` prolaze na prvom dnevnom runu.

- [ ] **Step 5: Merge**

Migracije **prije** merge-a, jer Vercel auto-deployuje `main`. Stari kod uz novu shemu radi: `10 → 8` je i dalje validna vrijednost za staru formu.

---

## Šta ovaj PR namjerno ne radi

- **Ne ukida podešavanje** u korist cron izraza. Odgođeno do razdvajanja projekata, kad svaka instalacija dobija vlastiti `vercel.json` — vidi §7 speca.
- **Ne uvodi treći termin ni proizvoljan sat.** Traži scheduler koji Vercel plan ne dopušta (cron jednom dnevno, dva posla po projektu).
- **Ne dira gating ni cron rutu.** Gate `sat >= vrijeme_slanja_sat` ostaje nepromijenjen.
