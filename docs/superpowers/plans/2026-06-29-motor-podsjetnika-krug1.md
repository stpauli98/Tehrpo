# Motor podsjetnika — Krug 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vratiti motor podsjetnika u ispravan rad: automatsko pokretanje (cron), nadoknada propuštenih dana (catch-up), dnevna eskalacija nakon isteka (post-due), tačni rokovi 60/30/15/7, i interni primaoci (nikad klijent).

**Architecture:** Email-only motor: Vercel Cron (GET, Bearer `CRON_SECRET`) → `app/api/cron/reminders/route.ts` → `runReminders()` → RPC `get_due_podsjetnici` (pre-due „najmanji neposlat prag čiji je prozor ušao" + post-due „jedan red dnevno") → slanje adminima + `REMINDER_TO` preko Resend (ili `drySend`) → idempotentan upis u `podsjetnici`.

**Tech Stack:** Next.js 16 (App Router; `proxy.ts`, ne middleware), Supabase (Postgres/RLS/Auth), `@supabase/supabase-js`, Resend, Vitest, `pg` (integracioni test), Vercel Cron.

## Global Constraints

- Package manager: **pnpm**. Pokretanje dev servera mora koristiti `--webpack` (Turbopack puca na razmak u putanji „Ai Forward").
- Domenski jezik je bosanski/srpski (latinica) — nazivi, poruke, komentari prate postojeći stil.
- **Klijent se NIKAD ne kontaktira** email-podsjetnikom (brief §5.5/§11). Pri praznoj internoj listi → preskoči slanje + log; nema fallback-a na klijentske adrese.
- Idempotencija podsjetnika preko unique `uq_podsjetnici_termin_dana (termin_id, dana_prije)`; ne uvoditi drugi mehanizam.
- Service-role (`createAdminSupabaseClient`) samo van request-patha — ovdje: cron handler + `scripts/`. `runReminders` prima `supabase` kao parametar.
- SQL migracije: izvor istine je `supabase/migrations/*.sql`; `db/types.ts` je auto-generisan (`supabase gen types ... --local`), ne edituje se ručno.
- Validacija nad lokalnim Supabase (Docker): `supabase start` → `pnpm db:reset`. Cloud se primjenjuje kasnije preko `pnpm db:apply-cloud <fajl>` (ručno, korisnik).
- Grana: `fix/motor-podsjetnika-krug1`. Lint pravila: `no-await-in-loop` (koristi `Promise.all`), bez `sm:`/`md:` (nebitno ovdje — nema UI).

---

### Task 1: Interni primaoci (admini + REMINDER_TO, bez klijenta)

**Files:**
- Modify: `lib/reminders/recipients.ts`
- Test: `lib/reminders/recipients.test.ts`

**Interfaces:**
- Consumes: ništa (čista funkcija).
- Produces:
  - `parseEmailList(raw: string | null | undefined): string[]` (nepromijenjen)
  - `assembleRecipients(args: { base: string[]; adminEmails: string[] }): string[]` — spaja, validira, dedupe (lowercase). **Uklonjeni** `klijentEmails`/`lokacijaEmail`.

- [ ] **Step 1: Zamijeni test sadržaj** (`lib/reminders/recipients.test.ts`)

```ts
import { describe, it, expect } from "vitest"
import { parseEmailList, assembleRecipients } from "./recipients"

describe("parseEmailList", () => {
  it("razdvaja po zarezu i trim-uje", () => {
    expect(parseEmailList(" a@x.com , b@y.com ")).toEqual(["a@x.com", "b@y.com"])
  })
  it("prazno/undefined → []", () => {
    expect(parseEmailList("")).toEqual([])
    expect(parseEmailList(undefined)).toEqual([])
  })
})

describe("assembleRecipients", () => {
  it("spaja REMINDER_TO bazu + admine, dedupe (case-insensitive), filtrira nevalidne", () => {
    const out = assembleRecipients({
      base: ["tehpro@x.com"],
      adminEmails: ["TEHPRO@x.com", "admin@tehpro.com", "nevalidno"],
    })
    expect(out).toEqual(["tehpro@x.com", "admin@tehpro.com"])
  })
  it("prazno kad nema validnih primalaca", () => {
    expect(assembleRecipients({ base: [], adminEmails: [] })).toEqual([])
    expect(assembleRecipients({ base: [], adminEmails: ["x"] })).toEqual([])
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: FAIL (stari `assembleRecipients` traži `klijentEmails`/`lokacijaEmail`; TS/poziv ne odgovara).

- [ ] **Step 3: Zamijeni `assembleRecipients`** (`lib/reminders/recipients.ts`)

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Interni primaoci podsjetnika (Krug 1): REMINDER_TO baza + admini. Klijent se NIKAD ne dodaje. */
export function assembleRecipients(args: { base: string[]; adminEmails: string[] }): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...args.base, ...args.adminEmails]) {
    const e = raw.trim()
    if (!EMAIL_RE.test(e)) continue
    const key = e.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: PASS (5 testova).

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/recipients.ts lib/reminders/recipients.test.ts
git commit -m "feat(reminders): interni primaoci (admini+REMINDER_TO), bez klijentskih adresa"
```

---

### Task 2: Email tekst za pre-due i post-due (kašnjenje)

**Files:**
- Modify: `lib/email/templates.ts`
- Test: `lib/email/templates.test.ts`

**Interfaces:**
- Consumes: `formatDatum` iz `../date` (postoji).
- Produces (parametar preimenovan `danaPrije` → `danaDoRoka`; negativan = kašnjenje):
  - `reminderSubject(args: { vrsta: string; klijent: string; danaDoRoka: number }): string`
  - `reminderHtml(args: { klijent: string; vrsta: string; rok: string; danaDoRoka: number; lokacija?: string | null }): string`
  - `escapeHtml(s: string): string` (nepromijenjen)

- [ ] **Step 1: Zamijeni test sadržaj** (`lib/email/templates.test.ts`)

```ts
import { describe, it, expect } from "vitest"
import { reminderSubject, reminderHtml, escapeHtml } from "./templates"

describe("escapeHtml", () => {
  it("escape-uje HTML meta znakove", () => {
    expect(escapeHtml('<b>"&\'')).toBe("&lt;b&gt;&quot;&amp;&#39;")
  })
})

describe("reminderSubject", () => {
  it("jednina za 1 dan", () => {
    expect(reminderSubject({ vrsta: "Servis PP aparata", klijent: "AS", danaDoRoka: 1 }))
      .toBe("Podsjetnik: Servis PP aparata — AS (rok za 1 dan)")
  })
  it("množina za 7 dana", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: 7 })).toContain("za 7 dana")
  })
  it("danas za 0", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: 0 })).toContain("rok danas")
  })
  it("kašnjenje (množina) za -3", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: -3 }))
      .toBe("Podsjetnik: Hidranti — AS (kasni 3 dana)")
  })
  it("kašnjenje (jednina) za -1", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: -1 })).toContain("kasni 1 dan")
  })
})

describe("reminderHtml", () => {
  it("sadrži klijenta, vrstu i formatiran rok; escape-uje vrijednosti", () => {
    const html = reminderHtml({ klijent: "AS & co", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null })
    expect(html).toContain("AS &amp; co")
    expect(html).toContain("Hidranti")
    expect(html).toContain("15.09.2026.")
  })
  it("izostavlja lokaciju kad je null", () => {
    const html = reminderHtml({ klijent: "AS", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null })
    expect(html).not.toContain("Lokacija:")
  })
  it("kašnjenje: naslov i tekst za istekao rok", () => {
    const html = reminderHtml({ klijent: "AS", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: -3, lokacija: null })
    expect(html).toContain("kašnjenju")
    expect(html).toContain("kasni 3 dana")
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/email/templates.test.ts`
Expected: FAIL (param je još `danaPrije`; nema grane za negativ).

- [ ] **Step 3: Zamijeni `templates.ts`**

```ts
import { formatDatum } from "../date"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Tekst za broj dana do roka: negativan = kašnjenje, 0 = danas, pozitivan = za N dana. */
function danaTekst(d: number): string {
  if (d === 0) return "danas"
  if (d < 0) {
    const n = -d
    return `kasni ${n} ${n === 1 ? "dan" : "dana"}`
  }
  return `za ${d} ${d === 1 ? "dan" : "dana"}`
}

export function reminderSubject(args: { vrsta: string; klijent: string; danaDoRoka: number }): string {
  const stanje = args.danaDoRoka < 0 ? danaTekst(args.danaDoRoka) : `rok ${danaTekst(args.danaDoRoka)}`
  return `Podsjetnik: ${args.vrsta} — ${args.klijent} (${stanje})`
}

export function reminderHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  danaDoRoka: number
  lokacija?: string | null
}): string {
  const rok = formatDatum(args.rok)
  const kasni = args.danaDoRoka < 0
  const naslov = kasni ? "Termin u kašnjenju" : "Podsjetnik o roku"
  const uvod = kasni
    ? `Termin <strong>${danaTekst(args.danaDoRoka)}</strong> (rok je bio ${rok}).`
    : `Termin dospijeva <strong>${danaTekst(args.danaDoRoka)}</strong> (${rok}).`
  const boja = kasni ? "#dc2626" : "#2563eb"
  const lokRed = args.lokacija
    ? `<p style="margin:4px 0"><strong>Lokacija:</strong> ${escapeHtml(args.lokacija)}</p>`
    : ""
  return `<!doctype html>
<html lang="bs"><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h2 style="color:${boja};margin:0 0 12px">${naslov}</h2>
    <p style="margin:0 0 12px">${uvod}</p>
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px">
      <p style="margin:4px 0"><strong>Klijent:</strong> ${escapeHtml(args.klijent)}</p>
      <p style="margin:4px 0"><strong>Vrsta:</strong> ${escapeHtml(args.vrsta)}</p>
      ${lokRed}
      <p style="margin:4px 0"><strong>Rok dospijeća:</strong> ${rok}</p>
    </div>
    <p style="margin:16px 0 0;color:#64748b;font-size:12px">Tehpro — Sistem za termine i provjere</p>
  </div>
</body></html>`
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/email/templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts lib/email/templates.test.ts
git commit -m "feat(reminders): email tekst za pre-due i post-due (kašnjenje)"
```

---

### Task 3: Migracija — catch-up + post-due RPC, rokovi 60/30/15/7, olabavljen constraint

**Files:**
- Create: `supabase/migrations/20260629120000_podsjetnici_catchup_postdue.sql`
- Create: `lib/reminders/dueRpc.integration.test.ts`
- Modify (generisano): `db/types.ts` (preko `supabase gen types`)

**Interfaces:**
- Produces RPC `get_due_podsjetnici(dana_prije_arr int[])` koji vraća redove:
  `{ termin_id: uuid, dana_prije: int, dana_do_roka: int, klijent_id: uuid, klijent_naziv: text, vrsta_naziv: text, rok_dospijeca: date, lokacija_naziv: text }`.
  - `dana_prije` = idempotencijski ključ (pre-due = prag ≥ 0, post-due = `rok - danas` < 0).
  - `dana_do_roka` = stvarni dani do roka (za tekst email-a; negativan = kašnjenje).

**Preduvjet:** lokalni Supabase radi (`supabase start`), migracije primijenjene (`pnpm db:reset`), i `TEST_DATABASE_URL` pokazuje na lokalni DB (npr. `postgresql://postgres:postgres@127.0.0.1:54322/postgres` — provjeri tačan port preko `supabase status`).

- [ ] **Step 1: Napiši integracioni test** (`lib/reminders/dueRpc.integration.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// Gate-uje se na TEST_DATABASE_URL da `pnpm test:unit` bez lokalnog DB i dalje prolazi.
describe.skipIf(!URL)("get_due_podsjetnici (integracija, lokalni DB)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  // Svaki slučaj radi u transakciji koja se ROLLBACK-uje → ne prlja DB.
  async function withSeed(fn: (ids: { klijent: string; vrsta: string }) => Promise<void>) {
    await db.query("begin")
    try {
      const k = await db.query("insert into klijenti (naziv) values ('ITEST klijent') returning id")
      const v = await db.query("insert into vrste_provjera (naziv) values ('ITEST vrsta') returning id")
      await fn({ klijent: k.rows[0].id as string, vrsta: v.rows[0].id as string })
    } finally {
      await db.query("rollback")
    }
  }

  // datum_zadnjeg ostaje null → tg_compute_rok NE prepisuje rok_dospijeca.
  async function addTermin(ids: { klijent: string; vrsta: string }, offsetDana: number) {
    const r = await db.query(
      `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status)
       values ($1, $2, current_date + $3::int, 'planirano') returning id`,
      [ids.klijent, ids.vrsta, offsetDana],
    )
    return r.rows[0].id as string
  }

  type Row = { termin_id: string; dana_prije: number; dana_do_roka: number }
  async function due(dana: number[]): Promise<Row[]> {
    const r = await db.query("select * from get_due_podsjetnici($1::int[])", [dana])
    return r.rows as Row[]
  }

  it("pre-due: termin +30 dobije prag 30; +61 ništa (prozor 60 nije ušao)", async () => {
    await withSeed(async (ids) => {
      const t30 = await addTermin(ids, 30)
      const t61 = await addTermin(ids, 61)
      const rows = await due([60, 30, 15, 7])
      expect(rows.filter((x) => x.termin_id === t30).map((x) => x.dana_prije)).toEqual([30])
      expect(rows.filter((x) => x.termin_id === t61)).toHaveLength(0)
    })
  })

  it("catch-up: termin +50 (propušten 60-dan) dobije SAMO prag 60", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 50)
      const rows = (await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)
      expect(rows).toHaveLength(1)
      expect(rows[0].dana_prije).toBe(60)
    })
  })

  it("idempotencija: kad postoji podsjetnik za prag, prag se ne vraća", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 7)
      await db.query("insert into podsjetnici (termin_id, dana_prije, poslat_na) values ($1, 7, '{a@x.com}')", [t])
      const rows = (await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)
      expect(rows).toHaveLength(0)
    })
  })

  it("post-due: termin -2 daje jedan red (dana_prije=-2, dana_do_roka=-2); idempotentno isti dan", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -2)
      const r1 = (await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)
      expect(r1).toHaveLength(1)
      expect(r1[0].dana_prije).toBe(-2)
      expect(r1[0].dana_do_roka).toBe(-2)
      await db.query("insert into podsjetnici (termin_id, dana_prije, poslat_na) values ($1, -2, '{a@x.com}')", [t])
      const r2 = (await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)
      expect(r2).toHaveLength(0)
    })
  })

  it("izvršen termin se ignoriše (ni pre-due ni post-due)", async () => {
    await withSeed(async (ids) => {
      const r = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status, datum_izvrsenja)
         values ($1,$2, current_date - 1, 'izvrseno', current_date - 1) returning id`,
        [ids.klijent, ids.vrsta],
      )
      const t = r.rows[0].id as string
      expect((await due([60, 30, 15, 7])).filter((x) => x.termin_id === t)).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti** (sa lokalnim DB + starim RPC-om)

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/reminders/dueRpc.integration.test.ts`
Expected: FAIL (stari RPC nema `dana_do_roka` i ne radi catch-up/post-due). Ako su svi testovi SKIP — `TEST_DATABASE_URL` nije postavljen ili lokalni stack ne radi; ispravi pa ponovi.

- [ ] **Step 3: Napiši migraciju** (`supabase/migrations/20260629120000_podsjetnici_catchup_postdue.sql`)

```sql
-- Krug 1: catch-up + post-due podsjetnici, rokovi 60/30/15/7
-- Mijenja get_due_podsjetnici (prozor umjesto tačne jednakosti + post-due grana),
-- olabavljuje chk_podsjetnici_dana_prije (dozvoljava negativni post-due marker),
-- i postavlja default pragova na {60,30,15,7}.

-- 1. Dozvoli negativni dana_prije (post-due marker = rok - current_date)
alter table podsjetnici drop constraint chk_podsjetnici_dana_prije;
alter table podsjetnici add constraint chk_podsjetnici_dana_prije
  check (dana_prije between -3650 and 365);

-- 2. Default pragova 60/30/15/7 (postojeći red mijenja SAMO ako je još na starom defaultu)
alter table postavke alter column dana_prije set default '{60,30,15,7}';
update postavke set dana_prije = '{60,30,15,7}'
  where id = 1 and dana_prije = '{30,14,7,1}';

-- 3. Novi RPC: pre-due (catch-up) + post-due (dnevno)
--    Mijenja se povratni tip → DROP pa CREATE (replace ne može promijeniti RETURNS TABLE).
drop function if exists get_due_podsjetnici(int[]);
create function get_due_podsjetnici(dana_prije_arr int[])
returns table (
  termin_id      uuid,
  dana_prije     int,
  dana_do_roka   int,
  klijent_id     uuid,
  klijent_naziv  text,
  vrsta_naziv    text,
  rok_dospijeca  date,
  lokacija_naziv text
)
language sql
stable
as $$
  -- PRE-DUE: najmanji JOŠ-neposlat prag čiji je prozor ušao, po terminu.
  -- Aliasi su OBAVEZNI: završni `order by ... klijent_naziv` referencira izlazne
  -- kolone UNION-a (imena iz prvog SELECT-a), pa bez aliasa pukne.
  ( select distinct on (t.id)
      t.id                             as termin_id,
      d.d                              as dana_prije,
      (t.rok_dospijeca - current_date) as dana_do_roka,
      k.id                             as klijent_id,
      k.naziv                          as klijent_naziv,
      vp.naziv                         as vrsta_naziv,
      t.rok_dospijeca,
      l.naziv                          as lokacija_naziv
    from termini t
    join klijenti k        on k.id = t.klijent_id
    join vrste_provjera vp on vp.id = t.vrsta_provjere_id
    left join lokacije l   on l.id = t.lokacija_id
    cross join unnest(dana_prije_arr) as d(d)
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca >= current_date
      and d.d >= (t.rok_dospijeca - current_date)
      -- `<=` (ne `=`): poslat tješnji (manji-d) prag gasi sve labavije (veći-d) za taj
      -- termin → bez spama (inače bi se dan nakon slanja 7-praga poslao i 15-prag).
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id and p.dana_prije <= d.d
      )
    order by t.id, d.d asc )
  union all
  -- POST-DUE: jedan red dnevno dok status nije izvrseno/otkazano
  ( select
      t.id,
      (t.rok_dospijeca - current_date),
      (t.rok_dospijeca - current_date),
      k.id,
      k.naziv,
      vp.naziv,
      t.rok_dospijeca,
      l.naziv
    from termini t
    join klijenti k        on k.id = t.klijent_id
    join vrste_provjera vp on vp.id = t.vrsta_provjere_id
    left join lokacije l   on l.id = t.lokacija_id
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca < current_date
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id
          and p.dana_prije = (t.rok_dospijeca - current_date)
      ) )
  order by rok_dospijeca, klijent_naziv;
$$;
```

- [ ] **Step 4: Primijeni migraciju lokalno**

Run: `pnpm db:reset`
Expected: sve migracije prolaze bez greške (uključujući novu).

- [ ] **Step 5: Pokreni integracioni test — mora proći**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm vitest run lib/reminders/dueRpc.integration.test.ts`
Expected: PASS (5 testova).

- [ ] **Step 6: Regeneriši tipove**

Run: `supabase gen types typescript --local > db/types.ts`
Expected: `db/types.ts` ažuriran; `get_due_podsjetnici` Returns sadrži `dana_do_roka` i `klijent_id`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260629120000_podsjetnici_catchup_postdue.sql lib/reminders/dueRpc.integration.test.ts db/types.ts
git commit -m "feat(reminders): catch-up + post-due RPC, rokovi 60/30/15/7, olabavljen constraint"
```

---

### Task 4: `runReminders` — interni primaoci + nove RPC kolone

**Files:**
- Modify: `lib/reminders/runReminders.ts`
- Create: `lib/reminders/runReminders.test.ts`
- Create: `vitest.setup.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `assembleRecipients`/`parseEmailList` (Task 1), `reminderSubject`/`reminderHtml` (Task 2, parametar `danaDoRoka`), RPC kolone `dana_do_roka`/`klijent_id` (Task 3), `korisnici(email, uloga, aktivan)`.
- Produces: `runReminders(supabase, deps?) : Promise<ReminderRunResult>` (potpis nepromijenjen).

- [ ] **Step 1: Dodaj vitest setup** (`vitest.setup.ts`) — env za module koji importuju `lib/env.ts`

```ts
// Dummy Supabase env da `lib/env.ts` (zod) ne baci pri importu test modula koji povlače runReminders.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key"
```

- [ ] **Step 2: Uveži setup u vitest config** (`vitest.config.ts`)

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["lib/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
})
```

- [ ] **Step 3: Napiši test** (`lib/reminders/runReminders.test.ts`)

```ts
import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { runReminders } from "./runReminders"
import type { SendArgs, SendResult } from "@/lib/email/resend"

type DueRow = {
  termin_id: string
  dana_prije: number
  dana_do_roka: number
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  rok_dospijeca: string
  lokacija_naziv: string | null
}

function makeFake(opts: { danaPrije?: number[]; admins?: { email: string }[]; dueRows?: DueRow[] }) {
  const inserts: Array<Record<string, unknown>> = []
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { dana_prije: opts.danaPrije ?? [60, 30, 15, 7] }, error: null }),
            }),
          }),
        }
      }
      if (table === "korisnici") {
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: opts.admins ?? [], error: null }) }) }) }
      }
      if (table === "podsjetnici") {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`neočekivan from(${table})`)
    },
    rpc: async () => ({ data: opts.dueRows ?? [], error: null }),
  }
  return { supabase: fake as unknown as SupabaseClient<Database>, inserts }
}

const baseRow: DueRow = {
  termin_id: "t1",
  dana_prije: 60,
  dana_do_roka: 50,
  klijent_id: "k1",
  klijent_naziv: "AS",
  vrsta_naziv: "Hidranti",
  rok_dospijeca: "2026-08-18",
  lokacija_naziv: null,
}

describe("runReminders", () => {
  it("šalje adminima (dedupe, bez klijenta); tekst koristi dana_do_roka; audit po pragu", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => {
      sends.push(a)
      return { id: "r1", dryRun: true }
    }
    const { supabase, inserts } = makeFake({
      admins: [{ email: "admin1@tehpro.com" }, { email: "ADMIN1@tehpro.com" }, { email: "admin2@tehpro.com" }],
      dueRows: [baseRow],
    })
    const res = await runReminders(supabase, { send })
    expect(res.sent).toHaveLength(1)
    expect(sends).toHaveLength(1)
    expect(sends[0].to).toEqual(["admin1@tehpro.com", "admin2@tehpro.com"])
    expect(sends[0].subject).toContain("za 50 dana") // dana_do_roka, ne prag 60
    expect(inserts[0]).toMatchObject({ termin_id: "t1", dana_prije: 60 }) // idempotencija po pragu
  })

  it("post-due red: subject kaže kašnjenje, audit dana_prije negativan", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => {
      sends.push(a)
      return { id: "r2", dryRun: true }
    }
    const { supabase, inserts } = makeFake({
      admins: [{ email: "admin@tehpro.com" }],
      dueRows: [{ ...baseRow, termin_id: "t2", dana_prije: -3, dana_do_roka: -3, rok_dospijeca: "2026-06-26" }],
    })
    await runReminders(supabase, { send })
    expect(sends[0].subject).toContain("kasni 3 dana")
    expect(inserts[0]).toMatchObject({ termin_id: "t2", dana_prije: -3 })
  })

  it("nema internih primalaca → preskoči, ništa se ne šalje", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => {
      sends.push(a)
      return { id: "x", dryRun: true }
    }
    const { supabase, inserts } = makeFake({ admins: [], dueRows: [baseRow] })
    const res = await runReminders(supabase, { send })
    expect(sends).toHaveLength(0)
    expect(inserts).toHaveLength(0)
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0].razlog).toBe("nema primalaca")
  })
})
```

- [ ] **Step 4: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: FAIL (stari `runReminders` čita `r.podsjetnik_emails`/`r.lokacija_kontakt_email`, ne dohvaća admine, šalje `danaPrije`).

- [ ] **Step 5: Zamijeni `runReminders.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { reminderSubject, reminderHtml } from "@/lib/email/templates"
import { assembleRecipients, parseEmailList } from "@/lib/reminders/recipients"

export type SentItem = { terminId: string; danaPrije: number; to: string[]; resendId: string; dryRun: boolean }
export type SkipItem = { terminId: string; danaPrije: number; razlog: string }
export type ErrItem = { terminId: string; danaPrije: number; message: string }
export type ReminderRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

const DEFAULT_DANA = [60, 30, 15, 7]

/** Interni primaoci (Krug 1): svi aktivni admini + REMINDER_TO. Klijent se nikad ne kontaktira. */
async function internalRecipients(supabase: SupabaseClient<Database>): Promise<string[]> {
  const base = parseEmailList(env.REMINDER_TO)
  const { data: admins } = await supabase
    .from("korisnici")
    .select("email")
    .eq("uloga", "admin")
    .eq("aktivan", true)
  const adminEmails = (admins ?? []).map((a) => a.email)
  return assembleRecipients({ base, adminEmails })
}

export async function runReminders(
  supabase: SupabaseClient<Database>,
  deps: { send?: (a: SendArgs) => Promise<SendResult> } = {},
): Promise<ReminderRunResult> {
  const send = deps.send ?? sendEmail

  const { data: post } = await supabase
    .from("postavke")
    .select("dana_prije")
    .eq("id", 1)
    .maybeSingle()
  const danaPrije = post?.dana_prije && post.dana_prije.length > 0 ? post.dana_prije : DEFAULT_DANA

  const { data: due, error } = await supabase.rpc("get_due_podsjetnici", { dana_prije_arr: danaPrije })
  if (error) throw new Error(error.message)
  const rows = due ?? []

  // Primaoci se računaju JEDNOM po pokretanju (Krug 1: isti za sve termine).
  const to = await internalRecipients(supabase)
  if (to.length === 0 && rows.length > 0) {
    console.warn("[reminders] nema internih primalaca (admini/REMINDER_TO) — preskačem sva slanja")
  }

  // Sva slanja konkurentno (no-await-in-loop): Promise.all nad async map.
  const outcomes: Outcome[] = await Promise.all(
    rows.map(async (r): Promise<Outcome> => {
      if (
        r.termin_id == null ||
        r.dana_prije == null ||
        r.dana_do_roka == null ||
        r.rok_dospijeca == null ||
        r.klijent_naziv == null ||
        r.vrsta_naziv == null
      ) {
        return { kind: "skip", terminId: r.termin_id ?? "", danaPrije: r.dana_prije ?? -9999, razlog: "nepotpun red" }
      }
      if (to.length === 0) {
        return { kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "nema primalaca" }
      }
      try {
        const res = await send({
          to,
          subject: reminderSubject({ vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, danaDoRoka: r.dana_do_roka }),
          html: reminderHtml({
            klijent: r.klijent_naziv,
            vrsta: r.vrsta_naziv,
            rok: r.rok_dospijeca,
            danaDoRoka: r.dana_do_roka,
            lokacija: r.lokacija_naziv,
          }),
        })
        // Audit se upisuje i za dry-run (idempotencija testabilna); u produkciji nema force-dry.
        const { error: insErr } = await supabase.from("podsjetnici").insert({
          termin_id: r.termin_id,
          dana_prije: r.dana_prije,
          poslat_na: to,
          resend_id: res.id,
        })
        if (insErr) {
          if (/duplicate|unique/i.test(insErr.message)) {
            return { kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "vec poslat" }
          }
          // send je uspio ali audit nije → at-least-once (moguć duplikat u sljedećem run-u).
          return { kind: "err", terminId: r.termin_id, danaPrije: r.dana_prije, message: insErr.message }
        }
        return { kind: "sent", terminId: r.termin_id, danaPrije: r.dana_prije, to, resendId: res.id, dryRun: res.dryRun }
      } catch (e) {
        return {
          kind: "err",
          terminId: r.termin_id,
          danaPrije: r.dana_prije,
          message: e instanceof Error ? e.message : String(e),
        }
      }
    }),
  )

  const sent: SentItem[] = []
  const skipped: SkipItem[] = []
  const errors: ErrItem[] = []
  for (const o of outcomes) {
    if (o.kind === "sent") sent.push({ terminId: o.terminId, danaPrije: o.danaPrije, to: o.to, resendId: o.resendId, dryRun: o.dryRun })
    else if (o.kind === "skip") skipped.push({ terminId: o.terminId, danaPrije: o.danaPrije, razlog: o.razlog })
    else errors.push({ terminId: o.terminId, danaPrije: o.danaPrije, message: o.message })
  }
  return { sent, skipped, errors }
}
```

- [ ] **Step 6: Pokreni test — mora proći**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: PASS (3 testa).

- [ ] **Step 7: Commit**

```bash
git add lib/reminders/runReminders.ts lib/reminders/runReminders.test.ts vitest.setup.ts vitest.config.ts
git commit -m "feat(reminders): runReminders šalje internim primaocima, koristi nove RPC kolone"
```

---

### Task 5: Cron — GET handler + Vercel raspored

**Files:**
- Create: `lib/reminders/cronAuth.ts`
- Create: `lib/reminders/cronAuth.test.ts`
- Modify: `app/api/cron/reminders/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `runReminders` (Task 4), `env.CRON_SECRET`.
- Produces: `isCronAuthorized(authHeader, secret): boolean`; ruta izvozi `GET` i `POST` (oba → `handle`).

- [ ] **Step 1: Napiši test** (`lib/reminders/cronAuth.test.ts`)

```ts
import { describe, it, expect } from "vitest"
import { isCronAuthorized } from "./cronAuth"

describe("isCronAuthorized", () => {
  it("true za tačan Bearer token", () => {
    expect(isCronAuthorized("Bearer tajna", "tajna")).toBe(true)
  })
  it("false za pogrešan token", () => {
    expect(isCronAuthorized("Bearer drugo", "tajna")).toBe(false)
  })
  it("false kad nedostaje header", () => {
    expect(isCronAuthorized(null, "tajna")).toBe(false)
  })
  it("fail-closed kad secret nije postavljen", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false)
    expect(isCronAuthorized(null, undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/reminders/cronAuth.test.ts`
Expected: FAIL ("Cannot find module './cronAuth'").

- [ ] **Step 3: Napiši `cronAuth.ts`** (`lib/reminders/cronAuth.ts`)

```ts
/** Vercel Cron šalje `Authorization: Bearer $CRON_SECRET`. Fail-closed ako secret nije postavljen. */
export function isCronAuthorized(
  authHeader: string | null,
  secret: string | undefined | null,
): boolean {
  if (!secret) return false
  return authHeader === `Bearer ${secret}`
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/reminders/cronAuth.test.ts`
Expected: PASS (4 testa).

- [ ] **Step 5: Zamijeni rutu** (`app/api/cron/reminders/route.ts`) — GET + POST dijele `handle`

```ts
import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { drySend } from "@/lib/email/resend"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let dryRun = false
  try {
    const body = (await req.json()) as { dryRun?: boolean } | null
    dryRun = body?.dryRun === true
  } catch {
    // prazno telo (Vercel Cron šalje GET bez tijela) je OK → dryRun = false
  }

  try {
    const supabase = createAdminSupabaseClient()
    const result = await runReminders(supabase, dryRun ? { send: drySend } : {})
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Greška"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel Cron poziva GET (uz Authorization: Bearer $CRON_SECRET); POST ostaje za ručno/test.
export const GET = handle
export const POST = handle
```

- [ ] **Step 6: Dodaj raspored** (`vercel.json`)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["dub1"],
  "crons": [{ "path": "/api/cron/reminders", "schedule": "0 6 * * *" }]
}
```

- [ ] **Step 7: Provjeri lint + typecheck (ruta nije pokrivena vitest include-om)**

Run: `pnpm lint && pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 8: Commit**

```bash
git add lib/reminders/cronAuth.ts lib/reminders/cronAuth.test.ts app/api/cron/reminders/route.ts vercel.json
git commit -m "feat(reminders): Vercel cron raspored + GET handler (fail-closed auth)"
```

---

### Task 6: Završna verifikacija

**Files:** (bez izmjena koda — verifikacija + ručna provjera)

- [ ] **Step 1: Cijeli unit set (bez DB)**

Run: `pnpm test:unit`
Expected: PASS; integracioni `dueRpc` SKIP (nema `TEST_DATABASE_URL`).

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 3: Unit + integracija sa lokalnim DB**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:unit`
Expected: svi PASS, uključujući 5 `dueRpc` integracionih.

- [ ] **Step 4: End-to-end provjera RPC-a nad lokalnim DB (bez cloud-a)**

⚠️ `pnpm seed` i `pnpm reminders` čitaju `.env.local`, koje u ovom okruženju pokazuje na **CLOUD** (`*.supabase.co` / `aws-0-eu-west-1.pooler.supabase.com`). NE pokretati ih za lokalnu provjeru — pisali bi/čitali iz produkcijskog cloud-a (koji još nema ovu migraciju). Live dry-run pripada **cloud rollout-u** (korisnik, vidi dolje).

Lokalna provjera (sigurna, preko lokalnog DB na `127.0.0.1:54322`):
```bash
docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -tAc \
  "select array_to_string(dana_prije,',') from postavke where id=1;"   # → 60,30,15,7
```
Ponašanje motora (catch-up, post-due, idempotencija) je pokriveno integracionim testom `lib/reminders/dueRpc.integration.test.ts` (5/5 nad lokalnim Postgresom) i unit testom `runReminders.test.ts` (primaoci=admini, dana_do_roka tekst, idempotencija, skip-bez-admina). Live proces (`pnpm reminders`) protiv cloud-a radi korisnik nakon `db:apply-cloud`.

- [ ] **Step 5: Označi kriterijume prihvatanja u specu**

Otvori `docs/superpowers/specs/2026-06-29-motor-podsjetnika-krug1-design.md`, sekcija „Kriterijumi prihvatanja", i ručno verifikuj svaki red prema gornjim koracima.

- [ ] **Step 6: Commit (ako je bilo izmjena) + sažetak**

```bash
git add -A && git commit -m "test(reminders): završna verifikacija Krug 1" || echo "nema izmjena"
```

---

## Napomene za cloud rollout (van automatske primjene)

Nakon merge-a, **korisnik** primjenjuje migraciju na cloud: `pnpm db:apply-cloud supabase/migrations/20260629120000_podsjetnici_catchup_postdue.sql`, postavlja `CRON_SECRET` u Vercel env, i potvrđuje da je `REMINDER_TO` postavljen ili da postoji bar jedan aktivan admin u `korisnici` (inače nema primalaca). Vercel Cron se aktivira deploy-em `vercel.json` rasporeda.

## Van obima (Krug 2 / zasebni nalazi)

- Usmjeravanje po vlasniku: `klijenti.zaduzeni_tehpro_id` → samo svoji termini; admin svi.
- Nepovezani nalazi reviewa: `createProfilProvjere` swallowed error; RLS na `chat_poruke` i `storage.objects`.
