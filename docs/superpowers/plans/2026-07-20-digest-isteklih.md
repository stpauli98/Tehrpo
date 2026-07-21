# PR 2 — Sedmični digest isteklih termina (implementacijski plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umjesto da svaki istekli termin živi samo kroz jednu pojedinačnu obavijest, primalac dobija sedmični pregled svih svojih isteklih termina — ponedjeljkom, jedan mejl po osobi.

**Architecture:** Novi ledger `digest_slanja` (unique po primaocu i danu) sa atomskim `claim_digest()`, RPC `get_istekli_termini(p_danas)`, čiste funkcije za grupisanje i kadencu, i `runDigest` koji se poziva iz **postojeće** cron rute poslije `runPostDue`. Isti claim-first obrazac kao post-due put iz PR-a 1.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + PostgREST preko `@supabase/supabase-js`), Resend, next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-19-digest-isteklih-podsjetnika-design.md` (revizija 6). Ovaj plan pokriva **samo PR 2**; PR 1 je isporučen i verifikovan na produkciji 2026-07-20.

## Global Constraints

- Paket menadžer je **`pnpm`**, nikad `npm`/`yarn`.
- `pnpm dev` ide sa `--webpack` (razmak u putanji projekta); ne dirati.
- Domenski jezik je bosanski/srpski (latinica) — tabele, kolone, identifikatori, komentari, UI stringovi.
- **Nikad service-role klijent u `app/` ili `components/` request putu.** Izuzetak su cron handleri.
- Sve env varijable idu kroz `lib/env.ts`.
- `db/types.ts` je **auto-generisan**; `pnpm db:types` čita **lokalni** stack, pa migracije moraju prvo biti primijenjene lokalno (`pnpm db:reset`).
- next-intl tipizira ključeve prema literalnoj uniji iz JSON-a: svaki novi ključ ide u **sva tri** kataloga (`messages/{sr,en,de}.json`) u istoj promjeni. **ICU kategorija `one` je zabranjena za `sr`.**
- Zabranjeni Tailwind breakpointi `sm:`/`md:`.
- `no-await-in-loop: error` svugdje osim u `scripts/`; namjerne sekvencijalne petlje traže `eslint-disable-next-line` sa obrazloženjem.
- **Nova tabela bez RLS politike mora ići u `RLS_INTENTIONAL_POLICYLESS`** (`lib/rlsCoverage.ts`), inače `lib/rlsCoverage.integration.test.ts` pada. Taj test je gejtovan na `TEST_DATABASE_URL` pa `pnpm test:unit` bez baze prolazi zeleno — u PR-u 1 je zbog toga promakao svim recenzijama osim finalne.
- **Migracije na cloud idu eksplicitno:** `pnpm db:apply-cloud --demo <fajl>` odnosno `POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`. Bez zastavice skripta odbija da radi.
- **DEMO i PROD u lockstep-u.** Cloud primjena i deploy su korisnikova radnja (Task 6).
- E2E odbija da radi ako cilj nije DEMO (`tests/e2e/global-setup.ts`); `.env.development.local` mora postojati u radnom direktorijumu.
- Rad ide na grani `feat/digest-isteklih`. Merge u `main` = produkcijski deploy na tri Vercel projekta.

---

## Pregled fajlova

**Kreirati:**
- `supabase/migrations/20260721120000_digest_slanja.sql`
- `supabase/migrations/20260721121000_get_istekli_termini.sql`
- `supabase/migrations/20260721122000_claim_digest.sql`
- `lib/reminders/digestGroups.ts` + `.test.ts`
- `lib/reminders/digestCadence.ts` + `.test.ts`
- `lib/reminders/runDigest.ts` + `.test.ts`
- `lib/reminders/digestRpc.integration.test.ts`

**Mijenjati:**
- `lib/rlsCoverage.ts` — `digest_slanja` u allowlistu
- `lib/email/templates.ts` — `digestSubject`, `digestHtml`
- `lib/email/templates.test.ts`
- `messages/{sr,en,de}.json` — `email.digest.*`
- `app/api/cron/reminders/route.ts` — poziv `runDigest` poslije `runPostDue`
- `app/api/cron/reminders/route.test.ts` — scenariji za digest
- `scripts/send-reminders.ts` — digest u ručnom pokretanju
- `scripts/preview-emails.ts` — primjer digesta
- `db/types.ts` — regenerisan, ne ručno

**Ne dirati:** `lib/reminders/runPostDue.ts`, `runReminders.ts`, `recipients.ts`, `gating.ts` (osim ako task izričito kaže).

---

### Task 1: SQL temelj — ledger, RPC, claim, tipovi

**Files:**
- Create: `supabase/migrations/20260721120000_digest_slanja.sql`
- Create: `supabase/migrations/20260721121000_get_istekli_termini.sql`
- Create: `supabase/migrations/20260721122000_claim_digest.sql`
- Create: `lib/reminders/digestRpc.integration.test.ts`
- Modify: `lib/rlsCoverage.ts`
- Modify: `db/types.ts` (generisan)

**Interfaces:**
- Consumes: `termini`, `klijenti`, `vrste_provjera`, `lokacije`, `post_due_obavijesti` (iz PR-a 1)
- Produces:
  - `digest_slanja(id uuid, primalac_email text, datum date, stanje text, claimed_at timestamptz, poslat_at timestamptz, resend_id text, termin_ids uuid[])`
  - `get_istekli_termini(p_danas date)` → `(termin_id uuid, klijent_id uuid, klijent_naziv text, vrsta_naziv text, rok_dospijeca date, datum_zakazan date, ciklus_rok date, dana_do_ciklusa int, lokacija_naziv text)`
  - `claim_digest(p_email text, p_datum date)` → `uuid` (null kad claim drži neko drugi)

- [ ] **Step 1: Migracija za ledger**

Kreiraj `supabase/migrations/20260721120000_digest_slanja.sql`:

```sql
-- Ledger sedmičnog digesta. Ključ je (primalac, dan) — jedan digest po osobi po danu.
-- `datum` je LOKALNI BEČKI datum iz lokalniSatIDatum, ne current_date (UTC): isti izvor
-- koji koristi i trebaDigest. Da se razilaze, u kasnim večernjim satima bi ključ i odluka
-- pokazivali na različite dane.
create table if not exists digest_slanja (
  id             uuid        primary key default gen_random_uuid(),
  primalac_email text        not null,
  datum          date        not null,
  stanje         text        not null default 'u_toku'
                             check (stanje in ('u_toku','poslato')),
  claimed_at     timestamptz not null default now(),
  poslat_at      timestamptz,
  resend_id      text,
  -- Dokazni trag: mejl_log bilježi DA je digest poslat, ali ne i ŠTA je u njemu pisalo.
  termin_ids     uuid[]      not null default '{}',
  constraint uq_digest_slanja unique (primalac_email, datum)
);

create index if not exists idx_digest_slanja_datum on digest_slanja (datum desc);

-- RLS bez politika: piše i čita isključivo cron preko service-role klijenta (bypass RLS).
-- Supabase-ov alter default privileges ionako grantuje anon/authenticated, pa je RLS
-- bez politika jedino što tabelu drži zatvorenom kroz PostgREST.
alter table digest_slanja enable row level security;
```

- [ ] **Step 2: Migracija za `get_istekli_termini`**

Kreiraj `supabase/migrations/20260721121000_get_istekli_termini.sql`:

```sql
-- Svi termini u alarmu, za sedmični digest. Isti uslov alarma kao get_post_due_termine:
-- OBA datuma moraju biti prošla (rok i efektivni), inače bi termin sa rokom u budućnosti
-- i propuštenim datum_zakazan davao lažnu uzbunu.
--
-- p_danas je LOKALNI BEČKI datum (ne current_date, koji je UTC) — isti izvor koji je ključ
-- u digest_slanja.
create or replace function get_istekli_termini(p_danas date)
returns table (
  termin_id       uuid,
  klijent_id      uuid,
  klijent_naziv   text,
  vrsta_naziv     text,
  rok_dospijeca   date,
  datum_zakazan   date,
  ciklus_rok      date,
  dana_do_ciklusa int,
  lokacija_naziv  text
)
language sql
stable
security invoker
set search_path = public
as $$
  with ef as (
    select t.*, coalesce(t.datum_zakazan, t.rok_dospijeca) as ciklus
    from termini t
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca < p_danas
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < p_danas
  )
  select ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus,
         (ef.ciklus - p_danas), l.naziv
  from ef
  join klijenti k        on k.id = ef.klijent_id
  join vrste_provjera vp on vp.id = ef.vrsta_provjere_id
  left join lokacije l   on l.id = ef.lokacija_id
  -- Termin koji je DANAS dobio pojedinačnu obavijest ne ulazi u današnji digest.
  -- poslat_at je popunjen samo za stvarno poslate; 'preskoceno' redovi ga nemaju,
  -- pa termin koji je danas preskočen (nema primalaca) i dalje pripada digestu.
  -- Kastuje se u bečku zonu, ne sesijsku (UTC na Supabase-u), da se poredi sa istim
  -- danom kao i p_danas.
  where not exists (
    select 1 from post_due_obavijesti o
    where o.termin_id = ef.id and (o.poslat_at at time zone 'Europe/Vienna')::date = p_danas
  )
  order by ef.ciklus, k.naziv;
$$;

revoke execute on function get_istekli_termini(date) from public, anon, authenticated;
grant  execute on function get_istekli_termini(date) to service_role;
```

Napomena: `order by ef.ciklus` daje najstariji ciklus prvi, dakle **najveće kašnjenje prvo** — `dana_do_ciklusa` je negativan, pa je to traženo „silazno po kašnjenju". Svi datumski predikati i izračun idu iz `p_danas` (LOKALNI BEČKI datum), nikad iz `current_date` (UTC) — inače bi funkcija tiho ignorisala svoj parametar.

- [ ] **Step 3: Migracija za `claim_digest`**

Kreiraj `supabase/migrations/20260721122000_claim_digest.sql`:

```sql
-- Atomski claim, isti obrazac kao claim_post_due iz PR-a 1: PostgREST ne može izraziti
-- "on conflict do update ... where ... returning", pa claim mora biti SQL funkcija.
-- Prazan rezultat = claim drži neko drugi ili je posao završen → pozivalac preskače.
create or replace function claim_digest(p_email text, p_datum date)
returns uuid
language sql
volatile
security invoker
set search_path = public
as $$
  insert into digest_slanja (primalac_email, datum, stanje, claimed_at)
  values (p_email, p_datum, 'u_toku', now())
  on conflict (primalac_email, datum) do update
    set claimed_at = now()
    where digest_slanja.stanje = 'u_toku'
      and digest_slanja.claimed_at < now() - interval '15 minutes'
  returning id;
$$;

revoke execute on function claim_digest(text, date) from public, anon, authenticated;
grant  execute on function claim_digest(text, date) to service_role;
```

- [ ] **Step 4: Dopuni RLS allowlistu**

U `lib/rlsCoverage.ts` dodaj `digest_slanja` u `RLS_INTENTIONAL_POLICYLESS`, uz kratak komentar po postojećem obrascu (namjerno bez politika — piše i čita samo cron preko service-role klijenta).

Bez ovoga `lib/rlsCoverage.integration.test.ts` pada. U PR-u 1 je ista greška promakla svim recenzijama osim finalne, jer test bez `TEST_DATABASE_URL` ne radi.

- [ ] **Step 5: Primijeni migracije lokalno**

```bash
pnpm db:reset
```

Očekivano: sve migracije prolaze; posljednje ispisane su `20260721120000` … `20260721122000`.

- [ ] **Step 6: Napiši integracione testove**

Kreiraj `lib/reminders/digestRpc.integration.test.ts`, po obrascu iz `lib/reminders/postDueRpc.integration.test.ts` (gate na `TEST_DATABASE_URL`, `pg` klijent, transakcija sa `rollback`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("get_istekli_termini + claim_digest (integracija, lokalni DB)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  async function withSeed(fn: (ids: { klijent: string; vrsta: string }) => Promise<void>) {
    await db.query("begin")
    try {
      const k = await db.query("insert into klijenti (naziv) values ('ITEST digest klijent') returning id")
      const v = await db.query("insert into vrste_provjera (naziv) values ('ITEST digest vrsta') returning id")
      await fn({ klijent: k.rows[0].id as string, vrsta: v.rows[0].id as string })
    } finally {
      await db.query("rollback")
    }
  }

  async function addTermin(
    ids: { klijent: string; vrsta: string },
    rokOffset: number,
    zakazanOffset: number | null = null,
  ) {
    const r = await db.query(
      `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, datum_zakazan, status)
       values ($1, $2, current_date + $3::int,
               case when $4::int is null then null else current_date + $4::int end,
               'planirano')
       returning id`,
      [ids.klijent, ids.vrsta, rokOffset, zakazanOffset],
    )
    return r.rows[0].id as string
  }

  type Row = { termin_id: string; ciklus_rok: string; dana_do_ciklusa: number }
  async function istekli(terminId: string, danas = "current_date"): Promise<Row[]> {
    const r = danas === "current_date"
      ? await db.query("select * from get_istekli_termini(current_date) where termin_id = $1", [terminId])
      : await db.query("select * from get_istekli_termini($2::date) where termin_id = $1", [terminId, danas])
    return r.rows as Row[]
  }

  async function claim(email: string, datum: string): Promise<string | null> {
    const r = await db.query("select claim_digest($1, $2::date) as id", [email, datum])
    return (r.rows[0]?.id as string | null) ?? null
  }

  it("termin u alarmu je u listi, sa negativnim dana_do_ciklusa", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      const rows = await istekli(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dana_do_ciklusa).toBe(-9)
    })
  })

  it("termin sa rokom u budućnosti i propuštenim zakazanim datumom NIJE u listi", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 30, -4)
      expect(await istekli(t)).toHaveLength(0)
    })
  })

  it("termin sa isteklim rokom i zakazanim datumom u budućnosti NIJE u listi", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -30, 5)
      expect(await istekli(t)).toHaveLength(0)
    })
  })

  it("ciklus je datum_zakazan kad je i on prošao", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -30, -3)
      expect((await istekli(t))[0]!.dana_do_ciklusa).toBe(-3)
    })
  })

  it("termin koji je DANAS dobio pojedinačnu obavijest ispada iz digesta", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      await db.query(
        `insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, poslat_at)
         values ($1, current_date - 9, 'interni', 'poslato', now())`,
        [t],
      )
      expect(await istekli(t)).toHaveLength(0)
    })
  })

  it("termin koji je danas PRESKOČEN (nema primalaca) OSTAJE u digestu", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      await db.query(
        `insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, razlog)
         values ($1, current_date - 9, 'firma', 'preskoceno', 'nema_primalaca')`,
        [t],
      )
      expect(await istekli(t)).toHaveLength(1)
    })
  })

  it("obavijest poslata JUČE ne izbacuje termin iz današnjeg digesta", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -9)
      await db.query(
        `insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, poslat_at)
         values ($1, current_date - 9, 'interni', 'poslato', now() - interval '1 day')`,
        [t],
      )
      expect(await istekli(t)).toHaveLength(1)
    })
  })

  it("claim_digest: prvi poziv daje id, drugi null", async () => {
    await withSeed(async () => {
      const d = "2026-07-20"
      const id = await claim("a@x.com", d)
      expect(id).not.toBeNull()
      expect(await claim("a@x.com", d)).toBeNull()
    })
  })

  it("claim_digest: zaglavljen u_toku stariji od 15 min se preuzima, mlađi ne", async () => {
    await withSeed(async () => {
      const d = "2026-07-20"
      const id = await claim("b@x.com", d)
      expect(await claim("b@x.com", d)).toBeNull()
      await db.query("update digest_slanja set claimed_at = now() - interval '20 minutes' where id = $1", [id])
      expect(await claim("b@x.com", d)).toBe(id)
    })
  })

  it("claim_digest: 'poslato' se ne preuzima ni poslije 15 min", async () => {
    await withSeed(async () => {
      const d = "2026-07-20"
      const id = await claim("c@x.com", d)
      await db.query(
        "update digest_slanja set stanje = 'poslato', claimed_at = now() - interval '2 hours' where id = $1",
        [id],
      )
      expect(await claim("c@x.com", d)).toBeNull()
    })
  })

  it("claim_digest: različiti dani su nezavisni", async () => {
    await withSeed(async () => {
      expect(await claim("d@x.com", "2026-07-20")).not.toBeNull()
      expect(await claim("d@x.com", "2026-07-21")).not.toBeNull()
    })
  })
})
```

- [ ] **Step 7: Pokreni integracione testove**

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm vitest run lib/reminders/digestRpc.integration.test.ts lib/rlsCoverage.integration.test.ts
```

Očekivano: svi PASS, uključujući RLS coverage (koji bi bez Step 4 pao).

- [ ] **Step 8: Regeneriši tipove i provjeri**

```bash
pnpm db:types
pnpm typecheck && pnpm lint
```

Očekivano: `db/types.ts` dobija `digest_slanja`, `get_istekli_termini`, `claim_digest`; typecheck i lint bez grešaka.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/2026072112*.sql lib/reminders/digestRpc.integration.test.ts lib/rlsCoverage.ts db/types.ts
git commit -m "feat(digest): ledger digest_slanja + get_istekli_termini + atomski claim"
```

---

### Task 2: Čiste funkcije — kadenca i grupisanje

**Files:**
- Create: `lib/reminders/digestCadence.ts`, `lib/reminders/digestCadence.test.ts`
- Create: `lib/reminders/digestGroups.ts`, `lib/reminders/digestGroups.test.ts`

**Interfaces:**
- Consumes: `RecipientIndex` i `recipientsForKlijent` iz `lib/reminders/recipients.ts`
- Produces:
  - `jePonedjeljak(beckiDatum: string): boolean`
  - `trebaDigest(args: { danas: string; zadnjiPoslat: string | null; danasnji: { stanje: string; claimedAt: string } | null; now: Date }): boolean`
  - `IstekliRed` tip i `digestGroups(termini: IstekliRed[], index: RecipientIndex, base: string[]): Map<string, IstekliRed[]>`

- [ ] **Step 1: Napiši padajuće testove za kadencu**

Kreiraj `lib/reminders/digestCadence.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { jePonedjeljak, trebaDigest } from "./digestCadence"

const PON = "2026-07-20" // ponedjeljak
const UTO = "2026-07-21"
const NED = "2026-07-26"

describe("jePonedjeljak", () => {
  it("prepoznaje ponedjeljak", () => {
    expect(jePonedjeljak(PON)).toBe(true)
  })

  it("odbija ostale dane, uključujući nedjelju", () => {
    for (const d of ["2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", NED]) {
      expect(jePonedjeljak(d)).toBe(false)
    }
  })

  it("ne oslanja se na lokalnu zonu procesa — radi nad ISO datumom", () => {
    // Bečki datum je već izračunat prije poziva; funkcija ga samo tumači.
    expect(jePonedjeljak("2026-01-05")).toBe(true) // ponedjeljak, zimi
    expect(jePonedjeljak("2026-01-04")).toBe(false)
  })
})

describe("trebaDigest", () => {
  const now = new Date("2026-07-20T08:00:00Z")

  it("ponedjeljak, nikad slato → šalje", () => {
    expect(trebaDigest({ danas: PON, zadnjiPoslat: null, danasnji: null, now })).toBe(true)
  })

  it("utorak, nikad slato → NE šalje (čeka ponedjeljak)", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: null, danasnji: null, now })).toBe(false)
  })

  it("utorak, zadnji digest bio juče → NE šalje", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: PON, danasnji: null, now })).toBe(false)
  })

  it("utorak, zadnji digest stariji od 7 dana → šalje (oporavak)", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: "2026-07-13", danasnji: null, now })).toBe(true)
  })

  it("granica: tačno 7 dana → šalje", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: "2026-07-14", danasnji: null, now })).toBe(true)
  })

  it("granica: 6 dana → NE šalje", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: "2026-07-15", danasnji: null, now })).toBe(false)
  })

  it("ponedjeljak, ali danas već poslato → NE šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: "2026-07-13",
      danasnji: { stanje: "poslato", claimedAt: "2026-07-20T07:00:00Z" }, now,
    })).toBe(false)
  })

  it("ponedjeljak, danas svjež u_toku (mlađi od 15 min) → NE šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: null,
      danasnji: { stanje: "u_toku", claimedAt: "2026-07-20T07:50:00Z" }, now,
    })).toBe(false)
  })

  it("ponedjeljak, danas ZAGLAVLJEN u_toku (stariji od 15 min) → šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: null,
      danasnji: { stanje: "u_toku", claimedAt: "2026-07-20T07:30:00Z" }, now,
    })).toBe(true)
  })
})
```

- [ ] **Step 2: Pokreni testove da potvrdiš pad**

```bash
pnpm vitest run lib/reminders/digestCadence.test.ts
```

Očekivano: FAIL — modul `./digestCadence` ne postoji.

- [ ] **Step 3: Implementiraj `lib/reminders/digestCadence.ts`**

```ts
/**
 * Kadenca sedmičnog digesta.
 *
 * Ulaz je uvijek LOKALNI BEČKI datum kao ISO string ("2026-07-20"), izračunat
 * u lokalniSatIDatum. Dan u sedmici se izvodi aritmetikom nad tim datumom, bez
 * Intl-a i bez oslanjanja na zonu procesa: Intl sa weekday daje lokalizovane
 * stringove i zavisi od locale-a, što je očekivano mjesto za bug.
 */

const PRAG_ZAGLAVLJENOG_MS = 15 * 60 * 1000

/** Je li dati bečki ISO datum ponedjeljak. */
export function jePonedjeljak(beckiDatum: string): boolean {
  return new Date(`${beckiDatum}T00:00:00Z`).getUTCDay() === 1
}

function danaIzmedju(od: string, do_: string): number {
  const a = Date.parse(`${od}T00:00:00Z`)
  const b = Date.parse(`${do_}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * Treba li ovom primaocu poslati digest danas.
 *
 * Dvije nezavisne provjere:
 *  1. je li danas već obrađen — 'poslato' zatvara dan, a 'u_toku' zatvara samo
 *     dok je svjež; zaglavljen claim stariji od 15 min mora biti dostižan, inače
 *     bi pad slanja progutao digest do sljedeće sedmice,
 *  2. kadenca — ponedjeljak, ili oporavak kad je posljednji stariji od 7 dana.
 *     Primalac koji nikad nije dobio digest čeka ponedjeljak.
 */
export function trebaDigest(args: {
  danas: string
  zadnjiPoslat: string | null
  danasnji: { stanje: string; claimedAt: string } | null
  now: Date
}): boolean {
  const { danas, zadnjiPoslat, danasnji, now } = args

  if (danasnji) {
    if (danasnji.stanje === "poslato") return false
    if (danasnji.stanje === "u_toku") {
      const star = now.getTime() - Date.parse(danasnji.claimedAt)
      if (star < PRAG_ZAGLAVLJENOG_MS) return false
    }
  }

  if (jePonedjeljak(danas)) return true
  if (!zadnjiPoslat) return false
  return danaIzmedju(zadnjiPoslat, danas) >= 7
}
```

- [ ] **Step 4: Testovi kadence moraju proći**

```bash
pnpm vitest run lib/reminders/digestCadence.test.ts
```

Očekivano: PASS, svih jedanaest.

- [ ] **Step 5: Napiši padajuće testove za grupisanje**

Kreiraj `lib/reminders/digestGroups.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildRecipientIndex } from "./recipients"
import { digestGroups, type IstekliRed } from "./digestGroups"

const red = (terminId: string, klijentId: string, danaDoCiklusa: number): IstekliRed => ({
  terminId, klijentId, klijentNaziv: `K-${klijentId}`, vrstaNaziv: "Obilazak",
  rokDospijeca: "2026-06-01", datumZakazan: null, ciklusRok: "2026-06-01",
  danaDoCiklusa, lokacijaNaziv: null,
})

const ADMIN = { id: "u-admin", email: "admin@x.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }
const RADNIK = { id: "u-radnik", email: "radnik@x.com", uloga: "operater", aktivan: true, prima_podsjetnike: true }
const NEAKTIVAN = { id: "u-off", email: "off@x.com", uloga: "operater", aktivan: false, prima_podsjetnike: true }
const BEZ_PODSJETNIKA = { id: "u-np", email: "np@x.com", uloga: "operater", aktivan: true, prima_podsjetnike: false }

function indeks(korisnici = [ADMIN, RADNIK], dodjele = [{ korisnik_id: "u-radnik", klijent_id: "k1" }]) {
  return buildRecipientIndex(korisnici, dodjele, [], [], false)
}

describe("digestGroups", () => {
  it("admin dobija sve termine, radnik samo svoje klijente", () => {
    const m = digestGroups([red("t1", "k1", -5), red("t2", "k2", -9)], indeks(), [])
    expect(m.get("admin@x.com")!.map((r) => r.terminId).sort()).toEqual(["t1", "t2"])
    expect(m.get("radnik@x.com")!.map((r) => r.terminId)).toEqual(["t1"])
  })

  it("REMINDER_TO base se ponaša kao admin — dobija sve", () => {
    const m = digestGroups([red("t1", "k1", -5), red("t2", "k2", -9)], indeks(), ["base@x.com"])
    expect(m.get("base@x.com")!.map((r) => r.terminId).sort()).toEqual(["t1", "t2"])
  })

  it("neaktivan korisnik i onaj bez prima_podsjetnike ne postoje u mapi", () => {
    const m = digestGroups(
      [red("t1", "k1", -5)],
      indeks([ADMIN, NEAKTIVAN, BEZ_PODSJETNIKA], [
        { korisnik_id: "u-off", klijent_id: "k1" },
        { korisnik_id: "u-np", klijent_id: "k1" },
      ]),
      [],
    )
    expect(m.has("off@x.com")).toBe(false)
    expect(m.has("np@x.com")).toBe(false)
  })

  it("primalac bez ijednog isteklog termina ne postoji u mapi", () => {
    const m = digestGroups([red("t2", "k2", -9)], indeks(), [])
    expect(m.has("radnik@x.com")).toBe(false)
    expect(m.has("admin@x.com")).toBe(true)
  })

  it("prazan ulaz daje praznu mapu", () => {
    expect(digestGroups([], indeks(), []).size).toBe(0)
  })

  it("ne duplira termin kad je primalac i admin i dodijeljen", () => {
    const m = digestGroups([red("t1", "k1", -5)], indeks([ADMIN], [{ korisnik_id: "u-admin", klijent_id: "k1" }]), [])
    expect(m.get("admin@x.com")).toHaveLength(1)
  })

  it("čuva redoslijed iz ulaza (RPC već sortira po kašnjenju)", () => {
    const m = digestGroups([red("t1", "k1", -30), red("t2", "k1", -2)], indeks(), [])
    expect(m.get("radnik@x.com")!.map((r) => r.terminId)).toEqual(["t1", "t2"])
  })
})
```

- [ ] **Step 6: Pokreni da potvrdiš pad**

```bash
pnpm vitest run lib/reminders/digestGroups.test.ts
```

Očekivano: FAIL — modul ne postoji.

- [ ] **Step 7: Implementiraj `lib/reminders/digestGroups.ts`**

```ts
import { recipientsForKlijent, type RecipientIndex } from "./recipients"

export type IstekliRed = {
  terminId: string
  klijentId: string
  klijentNaziv: string
  vrstaNaziv: string
  rokDospijeca: string
  datumZakazan: string | null
  ciklusRok: string
  danaDoCiklusa: number
  lokacijaNaziv: string | null
}

/**
 * Grupiše istekle termine po primaocu, koristeći ISTA pravila opsega kao pojedinačni
 * interni podsjetnik — `recipientsForKlijent`. Namjerno nema vlastite logike o tome
 * ko šta smije vidjeti: da je ima, postojala bi dva izvora istine za pravilo koje se
 * mijenja (admini, dodjele, aktivan, prima_podsjetnike, REMINDER_TO).
 *
 * Čista funkcija: nula I/O, pa se sva pravila opsega testiraju bez baze.
 * Redoslijed unutar liste prati ulaz — RPC već sortira po kašnjenju.
 */
export function digestGroups(
  termini: IstekliRed[],
  index: RecipientIndex,
  base: string[],
): Map<string, IstekliRed[]> {
  const mapa = new Map<string, IstekliRed[]>()
  for (const red of termini) {
    for (const email of recipientsForKlijent(index, red.klijentId, base)) {
      const lista = mapa.get(email)
      if (lista) lista.push(red)
      else mapa.set(email, [red])
    }
  }
  return mapa
}
```

- [ ] **Step 8: Svi testovi ovog taska moraju proći**

```bash
pnpm vitest run lib/reminders/digestCadence.test.ts lib/reminders/digestGroups.test.ts
pnpm typecheck && pnpm lint
```

- [ ] **Step 9: Commit**

```bash
git add lib/reminders/digestCadence.ts lib/reminders/digestCadence.test.ts \
        lib/reminders/digestGroups.ts lib/reminders/digestGroups.test.ts
git commit -m "feat(digest): čiste funkcije za kadencu i grupisanje po primaocu"
```

---

### Task 3: Šablon digesta

**Files:**
- Modify: `lib/email/templates.ts`, `lib/email/templates.test.ts`
- Modify: `messages/{sr,en,de}.json`
- Modify: `scripts/preview-emails.ts`

**Interfaces:**
- Consumes: `layoutOmot`, `badge`, `escapeHtml`, `danaTekst`, `formatDatum`, `APP_NAME`, `APP_TAGLINE`, `localizeHref` (svi postoje)
- Produces:
  - `digestSubject(args: { broj: number }, locale?: Locale): string`
  - `digestHtml(args: { stavke: DigestStavka[]; baseUrl?: string }, locale?: Locale): string`
  - `export type DigestStavka = { klijent: string; vrsta: string; rok: string; zakazanoZa?: string | null; lokacija?: string | null; danaDoCiklusa: number }`

- [ ] **Step 1: Dodaj i18n ključeve u sva tri kataloga**

`messages/sr.json`, unutar `email`:

```json
"digest": {
  "predmet": "Sedmični pregled: {broj} isteklih termina",
  "headerLabel": "Sedmični pregled",
  "znacka": "ISTEKLI ROKOVI",
  "uvod": "Ovi termini su i dalje otvoreni nakon isteka roka:",
  "kolonaKlijent": "Klijent",
  "kolonaVrsta": "Vrsta",
  "kolonaRok": "Rok",
  "kolonaKasni": "Kašnjenje",
  "zakazanoZa": "zakazano za {datum}",
  "dugmePlan": "Otvori plan aktivnosti"
}
```

`messages/en.json`:

```json
"digest": {
  "predmet": "Weekly summary: {broj} overdue items",
  "headerLabel": "Weekly summary",
  "znacka": "OVERDUE",
  "uvod": "These items are still open past their due date:",
  "kolonaKlijent": "Client",
  "kolonaVrsta": "Service",
  "kolonaRok": "Due",
  "kolonaKasni": "Overdue by",
  "zakazanoZa": "scheduled for {datum}",
  "dugmePlan": "Open activity plan"
}
```

`messages/de.json` (čeka native review, kao i ostatak kataloga):

```json
"digest": {
  "predmet": "Wochenübersicht: {broj} überfällige Termine",
  "headerLabel": "Wochenübersicht",
  "znacka": "ÜBERFÄLLIG",
  "uvod": "Diese Termine sind nach Fristablauf weiterhin offen:",
  "kolonaKlijent": "Kunde",
  "kolonaVrsta": "Leistung",
  "kolonaRok": "Frist",
  "kolonaKasni": "Überfällig seit",
  "zakazanoZa": "geplant für {datum}",
  "dugmePlan": "Aktivitätsplan öffnen"
}
```

**Ne koristi ICU plural za `broj`** — `sr` zabranjuje kategoriju `one`, a prosta interpolacija broja je dovoljna.

- [ ] **Step 2: Napiši padajuće testove**

Dodaj u `lib/email/templates.test.ts`:

```ts
import { digestSubject, digestHtml } from "./templates"

const stavka = (klijent: string, danaDoCiklusa: number, extra: Record<string, unknown> = {}) => ({
  klijent, vrsta: "Obilazak", rok: "2026-06-08", danaDoCiklusa, ...extra,
})

describe("digest", () => {
  it("subject nosi broj stavki", () => {
    expect(digestSubject({ broj: 3 })).toContain("3")
  })

  it("html sadrži svaku stavku", () => {
    const html = digestHtml({ stavke: [stavka("CARMEUSE", -6), stavka("WAIKIKI", -22)] })
    expect(html).toContain("CARMEUSE")
    expect(html).toContain("WAIKIKI")
  })

  it("escapuje nazive", () => {
    const html = digestHtml({ stavke: [stavka("A & B <x>", -6)] })
    expect(html).toContain("A &amp; B &lt;x&gt;")
    expect(html).not.toContain("<x>")
  })

  it("prikazuje zakazani datum kad se razlikuje od roka", () => {
    const html = digestHtml({ stavke: [stavka("CARMEUSE", -6, { zakazanoZa: "2026-07-15" })] })
    expect(html).toContain("15.07.2026")
  })

  it("dugme ka planu postoji samo uz baseUrl", () => {
    const bez = digestHtml({ stavke: [stavka("CARMEUSE", -6)] })
    expect(bez).not.toContain("plan-aktivnosti")
    const sa = digestHtml({ stavke: [stavka("CARMEUSE", -6)], baseUrl: "https://app.example.com" })
    expect(sa).toContain("plan-aktivnosti")
  })

  it("prazna lista ne baca", () => {
    expect(() => digestHtml({ stavke: [] })).not.toThrow()
  })
})
```

- [ ] **Step 3: Potvrdi pad**

```bash
pnpm vitest run lib/email/templates.test.ts
```

Očekivano: FAIL — `digestSubject is not a function`.

- [ ] **Step 4: Implementiraj šablon**

Dodaj u `lib/email/templates.ts`, poslije `rokIstekaoFirmaHtml`:

```ts
export type DigestStavka = {
  klijent: string
  vrsta: string
  rok: string
  zakazanoZa?: string | null
  lokacija?: string | null
  danaDoCiklusa: number
}

export function digestSubject(args: { broj: number }, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.digest" })
  return t("predmet", { broj: args.broj })
}

/**
 * Sedmični pregled isteklih termina — gola lista, bez sekcija i bez gornje granice.
 * Redoslijed dolazi iz RPC-a (najveće kašnjenje prvo) i ovdje se ne dira.
 */
export function digestHtml(args: {
  stavke: DigestStavka[]
  baseUrl?: string
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.digest" })
  const boja = "#dc2626"

  const redovi = args.stavke.map((s) => {
    const zakazano = s.zakazanoZa && s.zakazanoZa !== s.rok
      ? `<br><span style="color:#64748b;font-size:12px">${t("zakazanoZa", { datum: formatDatum(s.zakazanoZa, locale) })}</span>`
      : ""
    const lok = s.lokacija ? `<br><span style="color:#64748b;font-size:12px">${escapeHtml(s.lokacija)}</span>` : ""
    return `<tr>
      <td style="padding:8px 0;border-top:1px solid #e2e8f0">${escapeHtml(s.klijent)}${lok}</td>
      <td style="padding:8px 0;border-top:1px solid #e2e8f0">${escapeHtml(s.vrsta)}</td>
      <td style="padding:8px 0;border-top:1px solid #e2e8f0;white-space:nowrap">${formatDatum(s.rok, locale)}${zakazano}</td>
      <td style="padding:8px 0;border-top:1px solid #e2e8f0;text-align:right;white-space:nowrap;color:${boja}">${danaTekst(s.danaDoCiklusa, locale)}</td>
    </tr>`
  }).join("")

  const base = args.baseUrl ? args.baseUrl.replace(/\/$/, "") : ""
  const dugme = base
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px auto 0"><tr><td style="border-radius:6px;background:${boja}">
         <a href="${base}${localizeHref("/plan-aktivnosti", locale)}" style="display:inline-block;padding:10px 18px;font-size:14px;color:#ffffff;text-decoration:none">${t("dugmePlan")}</a>
       </td></tr></table>`
    : ""

  const telo = `${badge(boja, t("znacka"))}
          <p style="margin:12px 0 0;font-size:15px">${t("uvod")}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;font-size:14px">
            <tr style="color:#64748b;font-size:12px;text-align:left">
              <th style="padding:0 0 4px">${t("kolonaKlijent")}</th>
              <th style="padding:0 0 4px">${t("kolonaVrsta")}</th>
              <th style="padding:0 0 4px">${t("kolonaRok")}</th>
              <th style="padding:0 0 4px;text-align:right">${t("kolonaKasni")}</th>
            </tr>
            ${redovi}
          </table>
          ${dugme}`

  return layoutOmot({
    accent: boja,
    headerNaziv: escapeHtml(APP_NAME),
    headerLabel: t("headerLabel"),
    telo,
    footer: `${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}`,
    locale,
  })
}
```

- [ ] **Step 5: Testovi moraju proći**

```bash
pnpm vitest run lib/email/templates.test.ts
```

- [ ] **Step 6: Dodaj primjer u preview harness**

U `scripts/preview-emails.ts`: dodaj `digestSubject`, `digestHtml` u import iz `@/lib/email/templates`, i u `buildItems()` novu stavku prije test-mejla:

```ts
    {
      file: "8-digest-sedmicni.html",
      naziv: "Sedmični digest isteklih termina",
      subject: digestSubject({ broj: 3 }),
      html: digestHtml({
        stavke: [
          { klijent: "NEW YORKER", vrsta: "Obilazak", rok: "2026-06-08", danaDoCiklusa: -42, lokacija: "ISTOČNO SARAJEVO" },
          { klijent: "WAIKIKI", vrsta: "Ispitivanje hidranata", rok: "2026-06-27", danaDoCiklusa: -23 },
          { klijent: "CARMEUSE", vrsta: "Obilazak", rok: "2026-07-13", zakazanoZa: "2026-07-15", danaDoCiklusa: -5 },
        ],
        baseUrl: FX.baseUrl,
      }),
    },
```

Preimenuj postojeći test-mejl u `9-test-email.html` i ažuriraj brojku u komentaru iznad `buildItems()`.

- [ ] **Step 7: Pogledaj HTML okom**

```bash
pnpm preview:emails
```

Otvori `8-digest-sedmicni.html`. Provjeri: tri reda, najveće kašnjenje prvo, CARMEUSE ima i rok i „zakazano za", dugme vodi na plan aktivnosti.

- [ ] **Step 8: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run lib/email/
git add lib/email/templates.ts lib/email/templates.test.ts messages/ scripts/preview-emails.ts
git commit -m "feat(email): šablon sedmičnog digesta isteklih termina"
```

---

### Task 4: `runDigest` — claim-first orkestracija

**Files:**
- Create: `lib/reminders/runDigest.ts`, `lib/reminders/runDigest.test.ts`

**Interfaces:**
- Consumes: `get_istekli_termini` i `claim_digest` (Task 1), `trebaDigest` i `digestGroups` (Task 2), `digestSubject`/`digestHtml` (Task 3), `loadRecipientIndex`, `posaljiIzabiljezi`, `lokalniSatIDatum`
- Produces: `runDigest(supabase, deps?) => Promise<DigestRunResult>` gdje je
  `DigestRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }`,
  `SentItem = { email: string; brojStavki: number; resendId: string; dryRun: boolean }`,
  `SkipItem = { email: string; razlog: string }`,
  `ErrItem = { email: string; message: string }`

- [ ] **Step 1: Napiši padajuće testove**

Kreiraj `lib/reminders/runDigest.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { runDigest } from "./runDigest"
import type { SendArgs, SendResult } from "@/lib/email/resend"

type IstekliRow = {
  termin_id: string; klijent_id: string; klijent_naziv: string; vrsta_naziv: string
  rok_dospijeca: string; datum_zakazan: string | null; ciklus_rok: string
  dana_do_ciklusa: number; lokacija_naziv: string | null
}

const ROW: IstekliRow = {
  termin_id: "t1", klijent_id: "k1", klijent_naziv: "CARMEUSE", vrsta_naziv: "Obilazak",
  rok_dospijeca: "2026-06-08", datum_zakazan: null, ciklus_rok: "2026-06-08",
  dana_do_ciklusa: -42, lokacija_naziv: null,
}

const ADMIN = { id: "u1", email: "admin@x.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }
const PONEDJELJAK = new Date("2026-07-20T08:00:00Z")

function makeFake(opts: {
  rows?: IstekliRow[]
  claimIds?: (string | null)[]
  postojeciZapisi?: { primalac_email: string; datum: string; stanje: string; claimed_at: string }[]
  korisnici?: typeof ADMIN[]
  claimError?: string
}) {
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = []
  const claims = [...(opts.claimIds ?? ["c1", "c2", "c3"])]
  const rpcPozivi: string[] = []
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { dana_prije: [30, 14, 7], salji_klijentima: false }, error: null }) }) }) }
      }
      if (table === "korisnici") return { select: async () => ({ data: opts.korisnici ?? [ADMIN], error: null }) }
      if (table === "korisnik_klijent") return { select: async () => ({ data: [], error: null }) }
      if (table === "klijenti") return { select: async () => ({ data: [], error: null }) }
      if (table === "kontakt_osobe") return { select: async () => ({ data: [], error: null }) }
      if (table === "digest_slanja") {
        return {
          select: () => ({ gte: async () => ({ data: opts.postojeciZapisi ?? [], error: null }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: unknown) => { updates.push({ id, patch }); return { error: null } },
          }),
        }
      }
      throw new Error(`neočekivan from(${table})`)
    },
    async rpc(name: string) {
      rpcPozivi.push(name)
      if (name === "get_istekli_termini") return { data: opts.rows ?? [], error: null }
      if (name === "claim_digest") {
        if (opts.claimError) return { data: null, error: { message: opts.claimError } }
        return { data: claims.shift() ?? null, error: null }
      }
      return { data: null, error: null }
    },
  }
  return { supabase: fake as unknown as SupabaseClient<Database>, updates, rpcPozivi }
}

const okSend = async (_a: SendArgs): Promise<SendResult> => ({ id: "re_1", dryRun: false })

describe("runDigest", () => {
  it("ponedjeljkom šalje jedan mejl po primaocu i označava red", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW] })
    const res = await runDigest(supabase, { send: okSend, now: PONEDJELJAK, delayMs: 0 })
    expect(res.sent).toHaveLength(1)
    expect(res.sent[0]!.email).toBe("admin@x.com")
    expect(res.sent[0]!.brojStavki).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0]!.patch.stanje).toBe("poslato")
    expect(updates[0]!.patch.termin_ids).toEqual(["t1"])
  })

  it("utorkom bez starijeg digesta ne šalje ništa", async () => {
    let poslato = 0
    const { supabase } = makeFake({ rows: [ROW] })
    const res = await runDigest(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      now: new Date("2026-07-21T08:00:00Z"), delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.sent).toHaveLength(0)
  })

  it("prazan digest se ne šalje i ne upisuje", async () => {
    const { supabase, updates, rpcPozivi } = makeFake({ rows: [] })
    const res = await runDigest(supabase, { send: okSend, now: PONEDJELJAK, delayMs: 0 })
    expect(res.sent).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(rpcPozivi).not.toContain("claim_digest")
  })

  it("claim koji vrati null preskače primaoca bez slanja", async () => {
    let poslato = 0
    const { supabase, updates } = makeFake({ rows: [ROW], claimIds: [null] })
    const res = await runDigest(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      now: PONEDJELJAK, delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.skipped).toHaveLength(1)
    expect(updates).toHaveLength(0)
  })

  it("pad slanja ostavlja red u u_toku i prijavljuje grešku", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW] })
    const res = await runDigest(supabase, {
      send: async () => { throw new Error("resend pao") },
      now: PONEDJELJAK, delayMs: 0,
    })
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.message).toContain("resend pao")
    expect(updates).toHaveLength(0)
  })

  it("dry run ne uzima claim i ne dira ledger", async () => {
    const { supabase, updates, rpcPozivi } = makeFake({ rows: [ROW] })
    const res = await runDigest(supabase, {
      send: async () => ({ id: "dry-run", dryRun: true }),
      now: PONEDJELJAK, delayMs: 0, dryRun: true,
    })
    expect(rpcPozivi).not.toContain("claim_digest")
    expect(updates).toHaveLength(0)
    expect(res.sent[0]!.dryRun).toBe(true)
  })

  it("primalac koji je danas već dobio digest se preskače", async () => {
    let poslato = 0
    const { supabase } = makeFake({
      rows: [ROW],
      postojeciZapisi: [{ primalac_email: "admin@x.com", datum: "2026-07-20", stanje: "poslato", claimed_at: "2026-07-20T07:00:00Z" }],
    })
    const res = await runDigest(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      now: PONEDJELJAK, delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.skipped).toHaveLength(1)
  })

  it("greška iz claim_digest se prijavljuje i ništa se ne šalje", async () => {
    let poslato = 0
    const { supabase } = makeFake({ rows: [ROW], claimError: "claim pukao" })
    const res = await runDigest(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      now: PONEDJELJAK, delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.errors).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Potvrdi pad**

```bash
pnpm vitest run lib/reminders/runDigest.test.ts
```

Očekivano: FAIL — modul `./runDigest` ne postoji.

- [ ] **Step 3: Implementiraj `lib/reminders/runDigest.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { posaljiIzabiljezi } from "@/lib/email/posaljiIzabiljezi"
import { digestSubject, digestHtml, type DigestStavka } from "@/lib/email/templates"
import { loadRecipientIndex } from "@/lib/reminders/recipients"
import { digestGroups, type IstekliRed } from "@/lib/reminders/digestGroups"
import { trebaDigest } from "@/lib/reminders/digestCadence"
import { lokalniSatIDatum } from "@/lib/reminders/gating"

export type SentItem = { email: string; brojStavki: number; resendId: string; dryRun: boolean }
export type SkipItem = { email: string; razlog: string }
export type ErrItem = { email: string; message: string }
export type DigestRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

/** Koliko dana unazad gledamo ledger da bismo znali kad je primalac zadnji put dobio digest. */
const PROZOR_DANA = 8

/**
 * Sedmični digest isteklih termina — jedan mejl po primaocu, ponedjeljkom.
 *
 * Isti claim-first obrazac kao post-due put: upiši claim → pošalji → označi ishod.
 * Pad slanja NE briše claim; red ostaje 'u_toku' i postaje ponovo dostupan poslije
 * 15 minuta, što je jedini razlog zašto oporavak uopšte postoji.
 *
 * Dry run ne uzima claim i ne dira ledger — inače bi test-pokretanje zaključalo
 * primaocu digest za taj dan.
 *
 * Datum je uvijek LOKALNI BEČKI: isti izvor i za ključ u ledgeru i za odluku o
 * kadenci. Da se razilaze, u kasnim satima bi ključ i odluka gledali različite dane.
 */
export async function runDigest(
  supabase: SupabaseClient<Database>,
  deps: {
    send?: (a: SendArgs) => Promise<SendResult>
    now?: Date
    batchSize?: number
    delayMs?: number
    dryRun?: boolean
  } = {},
): Promise<DigestRunResult> {
  const send = deps.send ?? sendEmail
  const now = deps.now ?? new Date()
  const isDryRun = deps.dryRun === true
  const batchSize = Math.max(1, deps.batchSize ?? (Number(env.REMINDER_BATCH_SIZE) || 2))
  const delayMs = deps.delayMs ?? (Number(env.REMINDER_BATCH_DELAY_MS) || 1100)

  const { datum: danas } = lokalniSatIDatum(now)

  const { data: istekli, error } = await supabase.rpc("get_istekli_termini", { p_danas: danas })
  if (error) throw new Error(error.message)
  const rows = istekli ?? []
  if (rows.length === 0) return { sent: [], skipped: [], errors: [] }

  const { index, base } = await loadRecipientIndex(supabase)

  const stavke: IstekliRed[] = rows.map((r) => ({
    terminId: r.termin_id!, klijentId: r.klijent_id!, klijentNaziv: r.klijent_naziv!,
    vrstaNaziv: r.vrsta_naziv!, rokDospijeca: r.rok_dospijeca!, datumZakazan: r.datum_zakazan,
    ciklusRok: r.ciklus_rok!, danaDoCiklusa: r.dana_do_ciklusa!, lokacijaNaziv: r.lokacija_naziv,
  }))
  const grupe = digestGroups(stavke, index, base)
  if (grupe.size === 0) return { sent: [], skipped: [], errors: [] }

  // Jedan upit za cijeli prozor umjesto po primaocu — na desetak primalaca to je
  // razlika između jednog i deset round-tripova.
  const odDatum = new Date(Date.parse(`${danas}T00:00:00Z`) - PROZOR_DANA * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const { data: zapisi, error: zapErr } = await supabase
    .from("digest_slanja")
    .select("primalac_email, datum, stanje, claimed_at")
    .gte("datum", odDatum)
  if (zapErr) throw new Error(`Greška pri čitanju digest_slanja: ${zapErr.message}`)

  const zadnjiPoslatPo = new Map<string, string>()
  const danasnjiPo = new Map<string, { stanje: string; claimedAt: string }>()
  for (const z of zapisi ?? []) {
    if (z.datum === danas) {
      danasnjiPo.set(z.primalac_email, { stanje: z.stanje, claimedAt: z.claimed_at })
    }
    if (z.stanje === "poslato") {
      const prethodni = zadnjiPoslatPo.get(z.primalac_email)
      if (!prethodni || z.datum > prethodni) zadnjiPoslatPo.set(z.primalac_email, z.datum)
    }
  }

  const obradiPrimaoca = async (email: string, lista: IstekliRed[]): Promise<Outcome> => {
    const treba = trebaDigest({
      danas,
      zadnjiPoslat: zadnjiPoslatPo.get(email) ?? null,
      danasnji: danasnjiPo.get(email) ?? null,
      now,
    })
    if (!treba) return { kind: "skip", email, razlog: "van kadence ili već obrađen danas" }

    let claimId: string | null = null
    if (!isDryRun) {
      const { data, error: claimErr } = await supabase.rpc("claim_digest", {
        p_email: email, p_datum: danas,
      })
      if (claimErr) return { kind: "err", email, message: claimErr.message }
      claimId = (data as string | null) ?? null
      if (!claimId) return { kind: "skip", email, razlog: "claim drži neko drugi" }
    }

    const stavkeZaMejl: DigestStavka[] = lista.map((r) => ({
      klijent: r.klijentNaziv, vrsta: r.vrstaNaziv, rok: r.rokDospijeca,
      zakazanoZa: r.datumZakazan && r.datumZakazan !== r.rokDospijeca ? r.datumZakazan : null,
      lokacija: r.lokacijaNaziv, danaDoCiklusa: r.danaDoCiklusa,
    }))

    try {
      const res = await posaljiIzabiljezi(
        supabase,
        {
          to: [email],
          subject: digestSubject({ broj: lista.length }),
          html: digestHtml({ stavke: stavkeZaMejl, baseUrl: env.NEXT_PUBLIC_APP_URL }),
          // Digest pokriva više klijenata, pa nema jednog termina ni klijenta.
          // Posljedica: u dnevniku mejlova ga po RLS-u vide samo admini.
          tip: "podsjetnik_digest",
          terminId: null,
          klijentId: null,
        },
        send,
      )
      if (claimId && !res.dryRun) {
        const { error: updErr } = await supabase
          .from("digest_slanja")
          .update({
            stanje: "poslato",
            poslat_at: new Date().toISOString(),
            resend_id: res.id,
            termin_ids: lista.map((r) => r.terminId),
          })
          .eq("id", claimId)
        if (updErr) {
          // Mejl je otišao, trag nije upisan → red ostaje 'u_toku' i za 15 minuta
          // postaje ponovo dostupan, što znači mogući drugi digest. Mora biti vidljivo.
          return {
            kind: "err", email,
            message: `mejl poslat (resend_id=${res.id}) ali upis nije uspio: ${updErr.message}`,
          }
        }
      }
      return { kind: "sent", email, brojStavki: lista.length, resendId: res.id, dryRun: res.dryRun }
    } catch (e) {
      // Claim se NE briše: red ostaje 'u_toku' i oporavlja se poslije 15 minuta.
      return { kind: "err", email, message: e instanceof Error ? e.message : String(e) }
    }
  }

  const zadaci = [...grupe.entries()].map(([email, lista]) => () => obradiPrimaoca(email, lista))
  const outcomes: Outcome[] = []
  for (let i = 0; i < zadaci.length; i += batchSize) {
    const grupa = zadaci.slice(i, i + batchSize)
    // eslint-disable-next-line no-await-in-loop -- throttling: namjerno sekvencijalne grupe radi Resend rate-limita
    outcomes.push(...(await Promise.all(grupa.map((f) => f()))))
    if (delayMs > 0 && i + batchSize < zadaci.length) {
      // eslint-disable-next-line no-await-in-loop -- pauza između grupa (rate-limit)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  const sent: SentItem[] = []
  const skipped: SkipItem[] = []
  const errors: ErrItem[] = []
  for (const o of outcomes) {
    if (o.kind === "sent") sent.push({ email: o.email, brojStavki: o.brojStavki, resendId: o.resendId, dryRun: o.dryRun })
    else if (o.kind === "skip") skipped.push({ email: o.email, razlog: o.razlog })
    else errors.push({ email: o.email, message: o.message })
  }
  return { sent, skipped, errors }
}
```

- [ ] **Step 4: Testovi moraju proći**

```bash
pnpm vitest run lib/reminders/runDigest.test.ts
pnpm typecheck && pnpm lint
```

Očekivano: svih osam PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/runDigest.ts lib/reminders/runDigest.test.ts
git commit -m "feat(digest): runDigest sa claim-first slanjem po primaocu"
```

---

### Task 5: Uvezivanje u cron rutu i ručnu skriptu

**Files:**
- Modify: `app/api/cron/reminders/route.ts`
- Modify: `app/api/cron/reminders/route.test.ts`
- Modify: `scripts/send-reminders.ts`

**Interfaces:**
- Consumes: `runDigest` (Task 4)
- Produces: odgovor cron rute dobija treći ključ `digest` uz `preDue` i `postDue`

- [ ] **Step 1: Dodaj poziv u rutu**

U `app/api/cron/reminders/route.ts`:

1. Uvezi `runDigest` iz `@/lib/reminders/runDigest`.
2. U `try` bloku, **poslije** `const postDue = await runPostDue(supabase, posalji)`, dodaj:

```ts
    // Digest ide POSLIJE post-due puta, u istom zahtjevu. Redoslijed nije kozmetika:
    // get_istekli_termini izostavlja termin koji je danas dobio pojedinačnu obavijest,
    // pa post-due mora prvo upisati svoje tragove. U ranijem dizajnu je digest bio
    // zasebna cron ruta i taj redoslijed nije bio zagarantovan.
    const digest = await runDigest(supabase, posalji)
    return NextResponse.json({ preDue, postDue, digest })
```

3. Ažuriraj komentar iznad `maxDuration` da spominje tri petlje umjesto dvije.

- [ ] **Step 2: Dodaj scenarije u test rute**

U `app/api/cron/reminders/route.test.ts`:

1. U `vi.hoisted(...)` objekat dodaj `runDigestMock: vi.fn()`.
2. Uz postojeće `vi.mock` pozive dodaj:

```ts
vi.mock("@/lib/reminders/runDigest", () => ({
  runDigest: (...args: unknown[]) => runDigestMock(...args),
}))
```

3. Gdje god `beforeEach` postavlja podrazumijevane povratne vrijednosti mockova, dodaj i:

```ts
  runDigestMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })
```

4. Dodaj tri testa:

```ts
  it("odgovor sadrži sva tri kruga: preDue, postDue i digest", async () => {
    const { supabase } = makeSupabase({ postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: null } })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z")) // 11:00 Beč → sat >= 8

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveProperty("preDue")
    expect(body).toHaveProperty("postDue")
    expect(body).toHaveProperty("digest")
    expect(runDigestMock).toHaveBeenCalledTimes(1)
  })

  it("digest se poziva POSLIJE post-due puta", async () => {
    const redoslijed: string[] = []
    const { supabase } = makeSupabase({ postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: null } })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    runPostDueMock.mockImplementation(async () => { redoslijed.push("postDue"); return { sent: [], skipped: [], errors: [] } })
    runDigestMock.mockImplementation(async () => { redoslijed.push("digest"); return { sent: [], skipped: [], errors: [] } })
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z"))

    await GET(req("GET"))

    // Redoslijed nije kozmetika: get_istekli_termini izostavlja termin koji je danas
    // dobio pojedinačnu obavijest, pa post-due mora prvo upisati svoje tragove.
    expect(redoslijed).toEqual(["postDue", "digest"])
  })

  it("GET sa današnjim markerom preskače pre-due, ali i dalje pokreće post-due i digest", async () => {
    const { supabase } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-20" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z")) // bečki datum = 2026-07-20

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(body.preDue.preskocen).toBe("vec_slato_danas")
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
    expect(runDigestMock).toHaveBeenCalledTimes(1)
  })
```

Ako se imena helpera (`makeSupabase`, `req`, nazivi mockova) u fajlu razlikuju od gornjih, prilagodi pozive — obrazac je već uspostavljen u tom fajlu i njega prati.

- [ ] **Step 2b: Dokaži da novi testovi hvataju regresiju**

Privremeno pokvari rutu na dva načina i potvrdi da tačno očekivani test pada, pa vrati kod (`git checkout -- app/api/cron/reminders/route.ts`) i provjeri da je radno stablo čisto:

| Mutacija | Očekivani pad |
|---|---|
| pozovi `runDigest` **prije** `runPostDue` | test redoslijeda |
| ne zovi `runDigest` kad je pre-due preskočen | treći test |

U izvještaj upiši tabelu sa stvarnim ishodom.

- [ ] **Step 3: Dodaj digest u ručnu skriptu**

U `scripts/send-reminders.ts`: uvezi `runDigest`, pozovi ga poslije `runPostDue` sa istim `posalji` objektom, i dodaj treći red u sažetak:

```ts
  const digest = await runDigest(supabase, posalji)
  console.log(JSON.stringify({ preDue: result, postDue, digest }, null, 2))
```

uz odgovarajuću liniju u tekstualnom sažetku.

- [ ] **Step 4: Verifikacija**

```bash
pnpm typecheck && pnpm lint && pnpm test:unit
pnpm reminders -- --dry
```

Za `pnpm reminders`: lokalna baza je prazna, pa se očekuju nule na sva tri puta i nikakav izuzetak.

- [ ] **Step 5: E2E — guard mora propustiti, suita mora proći**

```bash
pnpm exec playwright test tests/e2e/06-podsjetnici.spec.ts tests/e2e/23-podsjetnici-v2.spec.ts --workers=1 --project=chromium
```

Očekivano: guard ispiše da je cilj DEMO, i svi testovi prođu. Ako neki test čita oblik odgovora cron rute, prilagodi ga trećem ključu.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/reminders/route.ts app/api/cron/reminders/route.test.ts scripts/send-reminders.ts
git commit -m "feat(digest): uveži runDigest u cron rutu poslije post-due puta"
```

---

### Task 6: Puštanje na cloud i verifikacija

**Izvršava korisnik**, ne agent.

- [ ] **Step 1: Migracije na DEMO**

```bash
pnpm db:apply-cloud --demo supabase/migrations/20260721120000_digest_slanja.sql
pnpm db:apply-cloud --demo supabase/migrations/20260721121000_get_istekli_termini.sql
pnpm db:apply-cloud --demo supabase/migrations/20260721122000_claim_digest.sql
```

- [ ] **Step 2: Provjera na DEMO-u**

```sql
select count(*) from get_istekli_termini(current_date);
select relrowsecurity from pg_class where relname = 'digest_slanja';
```

Očekivano: RPC vraća termine u alarmu; RLS uključen.

- [ ] **Step 3: Iste migracije na PROD**

```bash
POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/20260721120000_digest_slanja.sql
POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/20260721121000_get_istekli_termini.sql
POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/20260721122000_claim_digest.sql
```

- [ ] **Step 4: `pnpm db:types` uz lokalno primijenjene migracije, pa merge**

Migracije **prije** merge-a, jer Vercel auto-deployuje `main`.

- [ ] **Step 5: Verifikacija u prvi ponedjeljak**

```sql
select primalac_email, datum, stanje, array_length(termin_ids, 1) as stavki, resend_id
from digest_slanja order by datum desc;
```

Očekivano: po jedan red po primaocu sa `stanje = 'poslato'`, popunjenim `resend_id` i `termin_ids`.

---

## Šta ovaj PR namjerno ne radi

- **Sekcije „novo / traje duže" i gornja granica stavki** — odbačeno u specu kao ceremonija na trenutnoj skali.
- **Eskalacija adminu** poslije N ponavljanja.
- **Zasebna cron ruta** — plan dopušta samo dva cron posla po projektu, oba su zauzeta (§5.5 speca, revizija 6).
- **Retencija** za `digest_slanja`.
