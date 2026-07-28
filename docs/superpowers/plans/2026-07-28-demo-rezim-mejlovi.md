# Demo režim za mejlove — plan izvedbe

> **Za agentske izvršioce:** OBAVEZNA POD-VJEŠTINA: koristi superpowers:subagent-driven-development
> (preporučeno) ili superpowers:executing-plans za izvedbu zadatak-po-zadatak.
> Koraci koriste checkbox (`- [ ]`) sintaksu za praćenje.

**Cilj:** Na DEMO instanci se ne šalje nijedan stvarni mejl; korisniku se objasni da je
to namjerno i vidi kako bi mejlovi izgledali. Produkcija ostaje netaknuta.

**Arhitektura:** Jedan `NEXT_PUBLIC_DEMO_MODE` prekidač (isti obrazac kao `lib/brand.ts`).
Blokada slanja sjedi u `sendEmail` — najnižoj tački kroz koju prolaze svi pozivni putevi.
Umjesto tišine, demo slanja se bilježe u `mejl_log` sa novim statusom `demo`, pa tab
izgleda živo. Bedž u TopBar-u čini pogrešnu konfiguraciju produkcije odmah vidljivom.

**Tehnologije:** Next.js 16 (App Router), TypeScript, Vitest, Playwright, Supabase/Postgres,
next-intl, Tailwind v4.

## Globalna ograničenja

- Projekat je **desktop-only**: eslint zabranjuje `sm:`/`md:` prefikse — koristi `lg:`/`xl:`/`2xl:` ili bez breakpointa.
- **Ništa hardkodirano** (naziv firme, host, adresa) — sve iz env prekidača ili baze.
- Paket menadžer je **pnpm**, ne npm.
- Sva korisnička kopija ide u `messages/{sr,en,de}.json` — nikad inline string u JSX.
- Migracije: DEMO **i** PROD (lockstep). Cloud apply pokreće korisnik, ne agent.
- Commit poruke na bosanskom, u stilu postojećih.
- `pnpm typecheck` i `pnpm lint` moraju biti čisti prije svakog commita.

## Struktura fajlova

| Fajl | Odgovornost |
|---|---|
| `lib/demo.ts` (novo) | Jedini izvor istine za `DEMO_MODE` |
| `lib/demo.test.ts` (novo) | Čuva da je default ISKLJUČEN |
| `lib/email/resend.ts` (izmjena) | Blokada slanja u demo režimu |
| `lib/email/resend.test.ts` (novo) | Dokaz da mreža nije dodirnuta ni sa ključem |
| `lib/email/posaljiIzabiljezi.ts` (izmjena) | Upis `status: "demo"` |
| `supabase/migrations/…_mejl_status_demo.sql` (novo) | Enum vrijednost `demo` |
| `db/types.ts` (izmjena) | Ručno dopunjen enum (codegen traži lokalni Supabase) |
| `lib/poslati-mejlovi.ts` (izmjena) | `STATUS_KEY.demo` + `jeGreska` ostaje netaknut |
| `components/domain/PoslatiMejloviTabela.tsx` (izmjena) | Bedž `demo` |
| `app/(dashboard)/poslati-mejlovi/page.tsx` (izmjena) | Objasnidbena traka |
| `components/shell/TopBar.tsx` (izmjena) | Globalni bedž `DEMO` |
| `messages/{sr,en,de}.json` (izmjena) | Kopija |
| `tests/e2e/36-demo-rezim.spec.ts` (novo) | Traka + bedž vidljivi kad je režim uključen |

---

### Zadatak 1: Prekidač `DEMO_MODE`

**Fajlovi:**
- Kreirati: `lib/demo.ts`
- Test: `lib/demo.test.ts`

**Interfejsi:**
- Konzumira: ništa
- Proizvodi: `export const DEMO_MODE: boolean`

- [ ] **Korak 1: Napiši test koji pada**

`lib/demo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

describe("DEMO_MODE", () => {
  const original = process.env.NEXT_PUBLIC_DEMO_MODE

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE
    else process.env.NEXT_PUBLIC_DEMO_MODE = original
  })

  it("je ISKLJUČEN kad varijabla nije postavljena — produkcija ne smije slučajno ući u demo", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    const { DEMO_MODE } = await import("./demo")
    expect(DEMO_MODE).toBe(false)
  })

  it("je uključen samo na tačnu vrijednost \"1\"", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "1"
    const { DEMO_MODE } = await import("./demo")
    expect(DEMO_MODE).toBe(true)
  })

  it("ignoriše vrijednosti koje liče na uključeno (\"true\", \"0\", prazno)", async () => {
    for (const v of ["true", "0", "", "yes"]) {
      vi.resetModules()
      process.env.NEXT_PUBLIC_DEMO_MODE = v
      const { DEMO_MODE } = await import("./demo")
      expect(DEMO_MODE, `vrijednost ${JSON.stringify(v)}`).toBe(false)
    }
  })
})
```

- [ ] **Korak 2: Pokreni test i potvrdi da pada**

Pokreni: `pnpm exec vitest run lib/demo.test.ts`
Očekivano: FAIL — `Cannot find module './demo'`

- [ ] **Korak 3: Minimalna implementacija**

`lib/demo.ts`:

```ts
// Demo režim: NIJEDAN mejl ne odlazi u mrežu; slanja se samo bilježe radi prikaza.
// Prekidač je po deployu (isti obrazac kao NEXT_PUBLIC_APP_NAME u lib/brand.ts) —
// pali se ISKLJUČIVO na DEMO Vercel projektu.
//
// Podrazumijevano ISKLJUČEN i namjerno strog na tačnu vrijednost "1": labava
// provjera (npr. truthy string) znači da bi tipfeler u produkcijskom env-u ugasio
// slanje mejlova bez ijedne poruke o grešci.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE?.trim() === "1"
```

- [ ] **Korak 4: Pokreni test i potvrdi da prolazi**

Pokreni: `pnpm exec vitest run lib/demo.test.ts`
Očekivano: PASS (3 testa)

- [ ] **Korak 5: Commit**

```bash
git add lib/demo.ts lib/demo.test.ts
git commit -m "feat(demo): prekidač DEMO_MODE, isključen po defaultu"
```

---

### Zadatak 2: Blokada slanja u `sendEmail`

**Fajlovi:**
- Izmijeniti: `lib/email/resend.ts`
- Test: `lib/email/resend.test.ts` (novo)

**Interfejsi:**
- Konzumira: `DEMO_MODE` iz `lib/demo.ts`
- Proizvodi: `SendResult` sa novim opcionim poljem `demo?: boolean`

- [ ] **Korak 1: Napiši test koji pada**

`lib/email/resend.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const posalji = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: posalji }
  },
}))

describe("sendEmail — demo režim", () => {
  const originalDemo = process.env.NEXT_PUBLIC_DEMO_MODE
  const originalKey = process.env.RESEND_API_KEY

  beforeEach(() => {
    vi.resetModules()
    posalji.mockReset()
    posalji.mockResolvedValue({ data: { id: "stvarni-id" }, error: null })
  })

  afterEach(() => {
    if (originalDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE
    else process.env.NEXT_PUBLIC_DEMO_MODE = originalDemo
    if (originalKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalKey
  })

  const args = { to: ["neko@example.org"], subject: "Test", html: "<p>x</p>" }

  it("NE dodiruje mrežu čak ni kad RESEND_API_KEY postoji", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "1"
    process.env.RESEND_API_KEY = "re_stvarni_kljuc"
    const { sendEmail } = await import("./resend")

    const res = await sendEmail(args)

    expect(posalji).not.toHaveBeenCalled()
    expect(res.demo).toBe(true)
    expect(res.dryRun).toBe(true)
  })

  it("bez demo režima šalje normalno", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    process.env.RESEND_API_KEY = "re_stvarni_kljuc"
    const { sendEmail } = await import("./resend")

    const res = await sendEmail(args)

    expect(posalji).toHaveBeenCalledTimes(1)
    expect(res.demo).toBeUndefined()
    expect(res.dryRun).toBe(false)
    expect(res.id).toBe("stvarni-id")
  })

  it("obični dry-run (nema ključa) NIJE demo — razlikuje se u dnevniku", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    delete process.env.RESEND_API_KEY
    const { sendEmail } = await import("./resend")

    const res = await sendEmail(args)

    expect(posalji).not.toHaveBeenCalled()
    expect(res.dryRun).toBe(true)
    expect(res.demo).toBeUndefined()
  })
})
```

- [ ] **Korak 2: Pokreni test i potvrdi da pada**

Pokreni: `pnpm exec vitest run lib/email/resend.test.ts`
Očekivano: FAIL — prvi test pada jer `res.demo` je `undefined` a mreža JE pozvana

- [ ] **Korak 3: Minimalna implementacija**

U `lib/email/resend.ts` dodaj import i polje, pa blokadu na vrh `sendEmail`:

```ts
import { DEMO_MODE } from "@/lib/demo"

export type SendResult = { id: string; dryRun: boolean; demo?: boolean }
```

```ts
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  // NAMJERNO ISPRED provjere ključa: u demo režimu ni važeći RESEND_API_KEY ne
  // smije poslati mejl. Blokada stoji ovdje, a ne u pojedinim enginima, jer SVI
  // putevi (podsjetnici, digest, post-due, zakazano-nakon-roka, test mejl iz
  // Postavki) prolaze kroz `sendEmail` — svaki budući pozivalac je pokriven.
  if (DEMO_MODE) return { id: "demo", dryRun: true, demo: true }

  const key = env.RESEND_API_KEY
  if (!key) return drySend(args)
  // … ostatak nepromijenjen
}
```

- [ ] **Korak 4: Pokreni test i potvrdi da prolazi**

Pokreni: `pnpm exec vitest run lib/email/resend.test.ts`
Očekivano: PASS (3 testa)

- [ ] **Korak 5: Regresija + commit**

```bash
pnpm test:unit
pnpm typecheck && pnpm lint
git add lib/email/resend.ts lib/email/resend.test.ts
git commit -m "feat(demo): sendEmail ne šalje u demo režimu ni sa važećim ključem"
```

---

### Zadatak 3: Migracija — status `demo`

**Fajlovi:**
- Kreirati: `supabase/migrations/20260728120000_mejl_status_demo.sql`
- Izmijeniti: `db/types.ts` (linije 1352 i 1503)

**Interfejsi:**
- Proizvodi: `mejl_status` enum dobija vrijednost `"demo"`; TS tip
  `Database["public"]["Enums"]["mejl_status"]` postaje `"poslato" | "greska_slanja" | "demo"`

- [ ] **Korak 1: Napiši migraciju**

`supabase/migrations/20260728120000_mejl_status_demo.sql`:

```sql
-- Demo režim: slanje se ne izvršava, ali se bilježi da bi tab „Poslati mejlovi"
-- pokazao kako bi mejlovi izgledali. Zaseban status (ne „poslato") da se demo i
-- stvarna slanja nikad ne pomiješaju u dnevniku.
--
-- Bezopasno na PROD-u: vrijednost samo postoji u enumu; upisuje je isključivo kod
-- koji radi kad je NEXT_PUBLIC_DEMO_MODE=1, a to na produkciji nikad nije postavljeno.
--
-- `add value` je unutar transakcije dozvoljen od PG12 dok se vrijednost ne KORISTI
-- u istoj transakciji — ovdje se ne koristi.
alter type mejl_status add value if not exists 'demo';
```

- [ ] **Korak 2: Dopuni generisane tipove ručno**

`pnpm db:types` traži lokalni Supabase stack (nije dostupan) — enum se dopunjava ručno,
na dva mjesta u `db/types.ts`:

Linija ~1352:
```ts
      mejl_status: "poslato" | "greska_slanja" | "demo"
```

Linija ~1503:
```ts
      mejl_status: ["poslato", "greska_slanja", "demo"],
```

- [ ] **Korak 3: Pokreni typecheck i potvrdi da PADA na očekivanom mjestu**

Pokreni: `pnpm typecheck`
Očekivano: FAIL u `lib/poslati-mejlovi.ts` — `STATUS_KEY` ima
`satisfies Record<MejlStatus, string>`, pa nedostatak ključa `demo` ruši build.

To je namjerna zaštita: enum i UI mapa ne mogu se razići.

- [ ] **Korak 4: Dopuni `STATUS_KEY`**

U `lib/poslati-mejlovi.ts`:

```ts
export const STATUS_KEY = {
  poslato: "poslato",
  greska_slanja: "greskaSlanja",
  demo: "demo",
} as const satisfies Record<MejlStatus, string>
```

`jeGreska` se NE dira — demo red nije greška i ne smije dobiti crvenu pozadinu
ni dugme „Označi pregledanim".

- [ ] **Korak 5: Typecheck prolazi + commit**

```bash
pnpm typecheck && pnpm lint
git add supabase/migrations/20260728120000_mejl_status_demo.sql db/types.ts lib/poslati-mejlovi.ts
git commit -m "feat(demo): mejl_status dobija vrijednost demo"
```

---

### Zadatak 4: Upis demo slanja u dnevnik

**Fajlovi:**
- Izmijeniti: `lib/email/posaljiIzabiljezi.ts`
- Test: `lib/email/posaljiIzabiljezi.test.ts` (postojeći — dopuniti)

**Interfejsi:**
- Konzumira: `SendResult.demo` iz Zadatka 2, status `"demo"` iz Zadatka 3
- Proizvodi: `posaljiIzabiljezi` upisuje red sa `p_status: "demo"` kad je `res.demo === true`

- [ ] **Korak 1: Pročitaj postojeći test da preuzmeš obrazac**

Pokreni: `sed -n '1,60p' lib/email/posaljiIzabiljezi.test.ts`

Preuzmi kako se pravi lažni `supabase` objekat sa `rpc` mockom — novi testovi moraju
koristiti isti obrazac, ne izmišljati svoj.

- [ ] **Korak 2: Napiši testove koji padaju**

Dodaj u `lib/email/posaljiIzabiljezi.test.ts` (prilagodi imena mockova postojećem obrascu iz Koraka 1):

```ts
it("demo slanje se BILJEŽI sa statusom demo", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null })
  const supabase = { rpc } as unknown as Parameters<typeof posaljiIzabiljezi>[0]
  const send = vi.fn().mockResolvedValue({ id: "demo", dryRun: true, demo: true })

  await posaljiIzabiljezi(
    supabase,
    { to: ["a@b.com"], subject: "S", html: "<p>x</p>", tip: "test" },
    send,
  )

  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_status: "demo", p_resend_id: "demo" })
})

it("obični dry-run se NE bilježi — inače bi unit testovi punili dnevnik", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null })
  const supabase = { rpc } as unknown as Parameters<typeof posaljiIzabiljezi>[0]
  const send = vi.fn().mockResolvedValue({ id: "dry-run", dryRun: true })

  await posaljiIzabiljezi(
    supabase,
    { to: ["a@b.com"], subject: "S", html: "<p>x</p>", tip: "test" },
    send,
  )

  expect(rpc).not.toHaveBeenCalled()
})
```

- [ ] **Korak 3: Pokreni testove i potvrdi da prvi pada**

Pokreni: `pnpm exec vitest run lib/email/posaljiIzabiljezi.test.ts`
Očekivano: prvi novi test FAIL (`rpc` nije pozvan — `if (!res.dryRun)` preskače upis),
drugi PASS.

- [ ] **Korak 4: Minimalna implementacija**

U `lib/email/posaljiIzabiljezi.ts` zamijeni uslov upisa:

```ts
    const res = await send(sendArgs)
    // Demo režim se BILJEŽI (tab treba da pokaže kako bi izgledalo), a obični
    // dry-run ostaje tih — inače bi svaki unit test pisao u dnevnik.
    if (!res.dryRun || res.demo) {
      await zabiljeziMejlLog(supabase, {
        tip, terminId, klijentId, primaoci, subject: sendArgs.subject,
        resendId: res.id, status: res.demo ? "demo" : "poslato", greska: null,
      })
    }
    return res
```

- [ ] **Korak 5: Pokreni testove i potvrdi da prolaze**

Pokreni: `pnpm exec vitest run lib/email/posaljiIzabiljezi.test.ts`
Očekivano: PASS (svi, uključujući postojeće)

- [ ] **Korak 6: Regresija + commit**

```bash
pnpm test:unit
pnpm typecheck && pnpm lint
git add lib/email/posaljiIzabiljezi.ts lib/email/posaljiIzabiljezi.test.ts
git commit -m "feat(demo): demo slanja se bilježe u dnevnik, obični dry-run ostaje tih"
```

---

### Zadatak 5: Kopija u sr/en/de

**Fajlovi:**
- Izmijeniti: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfejsi:**
- Proizvodi ključeve: `poslatiMejlovi.status.demo`, `poslatiMejlovi.demoTraka`,
  `shell.topBar.demoBedz`, `shell.topBar.demoBedzOpis`

- [ ] **Korak 1: Dodaj ključeve u sva tri jezika**

U `poslatiMejlovi.status` dodaj `demo`, a u `poslatiMejlovi` dodaj `demoTraka`.
U `shell.topBar` dodaj `demoBedz` i `demoBedzOpis`.

| ključ | sr | en | de |
|---|---|---|---|
| `poslatiMejlovi.status.demo` | `Demo (nije poslato)` | `Demo (not sent)` | `Demo (nicht gesendet)` |
| `poslatiMejlovi.demoTraka` | `Ovo je demo verzija — mejlovi se ne šalju nikome. Ispod je prikaz kako bi izgledali u stvarnom radu.` | `This is a demo — no emails are actually sent. Below is a preview of how they would look in real use.` | `Dies ist eine Demo — es werden keine E-Mails versendet. Unten sehen Sie, wie sie im echten Betrieb aussehen würden.` |
| `shell.topBar.demoBedz` | `DEMO` | `DEMO` | `DEMO` |
| `shell.topBar.demoBedzOpis` | `Demo verzija — mejlovi se ne šalju` | `Demo version — emails are not sent` | `Demo-Version — es werden keine E-Mails versendet` |

Ubaci ključeve na mjesto koje čuva postojeći redoslijed (npr. `status.demo` odmah iza
`status.greskaSlanja`) — ne preuređuj fajl.

- [ ] **Korak 2: Potvrdi da JSON nije preuređen**

Pokreni: `git diff --stat messages/ && git diff messages/sr.json`
Očekivano: samo dodane linije, bez pomjeranja postojećih.

- [ ] **Korak 3: Commit**

```bash
git add messages/sr.json messages/en.json messages/de.json
git commit -m "feat(demo): kopija za demo bedž i traku (sr/en/de)"
```

---

### Zadatak 6: Prikaz — traka, bedž reda, globalni bedž

**Fajlovi:**
- Izmijeniti: `app/(dashboard)/poslati-mejlovi/page.tsx`
- Izmijeniti: `components/domain/PoslatiMejloviTabela.tsx:67`
- Izmijeniti: `components/shell/TopBar.tsx:19`

**Interfejsi:**
- Konzumira: `DEMO_MODE` (Zadatak 1), `STATUS_KEY.demo` (Zadatak 3), ključevi (Zadatak 5)
- Proizvodi: `data-testid="demo-traka"`, `data-testid="demo-bedz"`

- [ ] **Korak 1: Traka na tabu**

U `app/(dashboard)/poslati-mejlovi/page.tsx`, uvezi `DEMO_MODE` i `Info` iz `lucide-react`,
pa ubaci odmah ispod bloka sa `<h1>`:

```tsx
      {DEMO_MODE && (
        <div
          data-testid="demo-traka"
          role="status"
          className="flex items-start gap-2 rounded-xl bg-brand-light px-4 py-3 text-sm text-foreground ring-1 ring-brand/20"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <p>{t("demoTraka")}</p>
        </div>
      )}
```

- [ ] **Korak 2: Bedž u koloni „Slanje"**

U `components/domain/PoslatiMejloviTabela.tsx` zamijeni sadržaj ćelije statusa (linija ~67):

```tsx
              <td className="px-3 py-2">
                {r.status === "demo" ? (
                  <Badge variant="secondary">{t("status.demo")}</Badge>
                ) : (
                  t(`status.${STATUS_KEY[r.status]}` as never)
                )}
                {r.greska && <span className="block text-xs text-destructive">{r.greska}</span>}
              </td>
```

- [ ] **Korak 3: Globalni bedž u TopBar-u**

U `components/shell/TopBar.tsx` uvezi `DEMO_MODE` iz `@/lib/demo`, pa dodaj odmah iza
`<span>{APP_TAGLINE}</span>`:

```tsx
        {DEMO_MODE && (
          <span
            data-testid="demo-bedz"
            title={t("demoBedzOpis")}
            className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-warning"
          >
            {t("demoBedz")}
          </span>
        )}
```

- [ ] **Korak 4: Provjeri da produkcijski put nije promijenjen**

Pokreni: `pnpm typecheck && pnpm lint && pnpm test:unit`
Očekivano: sve prolazi; bez `NEXT_PUBLIC_DEMO_MODE` nijedan novi element se ne renderuje.

- [ ] **Korak 5: Commit**

```bash
git add "app/(dashboard)/poslati-mejlovi/page.tsx" components/domain/PoslatiMejloviTabela.tsx components/shell/TopBar.tsx
git commit -m "feat(demo): objasnidbena traka, bedž reda i globalni DEMO bedž"
```

---

### Zadatak 7: E2E — režim uključen

**Fajlovi:**
- Kreirati: `tests/e2e/36-demo-rezim.spec.ts`

**Interfejsi:**
- Konzumira: `data-testid="demo-traka"`, `data-testid="demo-bedz"`

**Napomena o okruženju:** `NEXT_PUBLIC_*` se ugrađuje u build, pa se demo režim NE može
uključiti u toku rada. Playwright `webServer` u `playwright.config.ts` diže svoj dev
server sa `env: { ZAPISNIK_DRY_RUN: "1", CHAT_DRY_RUN: "1" }` — a demo režim mora
ostati ISKLJUČEN za sve ostale specove. Zato ovaj spec diže **vlastiti** dev server na
zasebnom portu, sa `NEXT_PUBLIC_DEMO_MODE=1`.

- [ ] **Korak 1: Napiši spec**

`tests/e2e/36-demo-rezim.spec.ts`:

```ts
import { test, expect } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"

/**
 * Demo režim se ugrađuje u build (`NEXT_PUBLIC_*`), pa se ne može upaliti u toku
 * rada — ovaj spec diže VLASTITI dev server sa uključenim režimom, na portu 3100,
 * da ostali specovi ostanu na isključenom.
 */
const PORT = 3100
const BASE = `http://localhost:${PORT}`
let server: ChildProcess

test.beforeAll(async () => {
  server = spawn("pnpm", ["exec", "next", "dev", "-p", String(PORT), "--webpack"], {
    env: { ...process.env, NEXT_PUBLIC_DEMO_MODE: "1", ZAPISNIK_DRY_RUN: "1" },
    stdio: "ignore",
  })
  const rok = Date.now() + 120_000
  for (;;) {
    try {
      const r = await fetch(`${BASE}/plan-aktivnosti`, { redirect: "manual" })
      if (r.status > 0) break
    } catch {
      // server se još diže
    }
    if (Date.now() > rok) throw new Error("demo dev server se nije podigao za 120s")
    await new Promise((r) => setTimeout(r, 1000))
  }
})

test.afterAll(() => {
  server?.kill("SIGTERM")
})

test.describe("Demo režim", () => {
  test("TopBar nosi DEMO bedž na svakom ekranu", async ({ page }) => {
    await page.goto(`${BASE}/pregled`)
    await expect(page.getByTestId("demo-bedz")).toBeVisible()
    await page.goto(`${BASE}/plan-aktivnosti`)
    await expect(page.getByTestId("demo-bedz")).toBeVisible()
  })

  test("tab Poslati mejlovi objašnjava da se mejlovi ne šalju", async ({ page }) => {
    await page.goto(`${BASE}/poslati-mejlovi`)
    const traka = page.getByTestId("demo-traka")
    await expect(traka).toBeVisible()
    await expect(traka).toContainText("mejlovi se ne šalju")
  })
})
```

- [ ] **Korak 2: Pokreni spec**

Pokreni: `pnpm exec playwright test tests/e2e/36-demo-rezim.spec.ts --project=chromium --workers=1 --reporter=list`
Očekivano: PASS (2 testa)

- [ ] **Korak 3: Potvrdi da ostali specovi NISU u demo režimu**

Pokreni: `pnpm exec playwright test tests/e2e/32-poslati-mejlovi.spec.ts --project=chromium --workers=1 --reporter=list`
Očekivano: PASS — traka i bedž se ne pojavljuju na podrazumijevanom serveru (port 3000).

- [ ] **Korak 4: Commit**

```bash
git add tests/e2e/36-demo-rezim.spec.ts
git commit -m "test(demo): e2e za DEMO bedž i objasnidbenu traku"
```

---

### Zadatak 8: Uputstvo za uključivanje

**Fajlovi:**
- Izmijeniti: `.env.local.example`

- [ ] **Korak 1: Dokumentuj prekidač**

Dodaj u `.env.local.example`, uz postojeće `NEXT_PUBLIC_` varijable:

```bash
# Demo režim — NIJEDAN mejl se ne šalje; slanja se samo bilježe da bi tab
# „Poslati mejlovi" pokazao kako bi izgledali. Postavlja se ISKLJUČIVO na DEMO
# deployu. NIKAD na produkciji — tamo bi tiho ugasio sve podsjetnike.
# Uključuje ga samo tačna vrijednost "1".
# NEXT_PUBLIC_DEMO_MODE=1
```

- [ ] **Korak 2: Commit**

```bash
git add .env.local.example
git commit -m "docs(demo): uputstvo za NEXT_PUBLIC_DEMO_MODE"
```

---

## Nakon izvedbe (radi korisnik, ne agent)

1. **Cloud apply migracije** na DEMO **i** PROD (lockstep).
2. **Vercel:** `NEXT_PUBLIC_DEMO_MODE=1` samo na DEMO projektu; provjeriti da na
   produkcijskom projektu **ne postoji**.
3. Opciono: obrisati 3 zatečena reda sa Resend greškom iz DEMO dnevnika.
4. Opciono: ispraviti `REMINDER_TO=tehpro-dev@example.com`.
