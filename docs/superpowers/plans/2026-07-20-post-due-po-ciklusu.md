# PR 1 — Post-due obavijest po ciklusu (implementacijski plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post-due podsjetnici prestaju biti dnevni; termin dobija tačno jednu obavijest po ciklusu i po kanalu, a firmin kanal dobija vlastiti šablon koji poziva na dogovor umjesto da opominje.

**Architecture:** Post-due put se izmješta iz `get_due_podsjetnici` u vlastiti RPC `get_post_due_termine()` i vlastiti ledger `post_due_obavijesti`, ključan po **ciklusu** = `coalesce(datum_zakazan, rok_dospijeca)`. Slanje ide claim-first: prvo atomski `claim_post_due()` (unique kao brava), pa slanje, pa označavanje ishoda. Pre-due put i tabela `podsjetnici` ostaju netaknuti.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), TypeScript, Supabase (Postgres + PostgREST preko `@supabase/supabase-js`), Resend, next-intl, Vitest (unit + `pg` integracija), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-07-19-digest-isteklih-podsjetnika-design.md` (revizija 5). Ovaj plan pokriva **samo PR 1**; digest je zaseban plan.

## Global Constraints

- Paket menadžer je **`pnpm`**, nikad `npm`/`yarn`.
- `pnpm dev` mora ići sa `--webpack` (putanja projekta sadrži razmak); ne dirati.
- Domenski jezik je bosanski/srpski (latinica) — tabele, kolone, identifikatori, UI stringovi.
- **Nikad service-role klijent u `app/` ili `components/` request putu.** `createAdminSupabaseClient()` samo u `scripts/`, cron handlerima, `lib/supabase/storage.ts`, `lib/cache.ts`.
- Sve env varijable idu kroz `lib/env.ts` (zod, baca na boot).
- `db/types.ts` je **auto-generisan** — nikad ručno mijenjati; `pnpm db:types` čita **lokalni** stack (`supabase gen types typescript --local`), pa migracije moraju prvo biti primijenjene lokalno.
- next-intl tipizira ključeve prema literalnoj uniji iz JSON-a: **svaki novi ključ mora biti dodat u sva tri kataloga** (`messages/sr.json`, `en.json`, `de.json`) u istoj promjeni koja ga koristi. **ICU kategorija `one` je zabranjena za `sr`.**
- Zabranjeni Tailwind breakpointi `sm:`/`md:` (eslint `no-restricted-syntax`); koristiti `lg:`/`xl:`/`2xl:`.
- `no-await-in-loop: error` svugdje osim u `scripts/`; namjerno sekvencijalne petlje traže `// eslint-disable-next-line no-await-in-loop` sa obrazloženjem, kao u `runReminders.ts:172`.
- **Cloud DB nije dostupan kroz Supabase MCP.** Migracije na cloud idu jedna po jedna: `pnpm db:apply-cloud <file>`.
- **DEMO i PROD u lockstep-u**: migracija na jedan ide odmah i na drugi. PROD = ref `fqtqkehjidkzeasiegnq` (`DATABASE_URL` u `.env.local`); DEMO = ref `mtwwotmwrasozmcgqwhc` (`DATABASE_URL_DEMO` u `.env.development.local`).
- Cloud primjena migracija i deploy su **korisnikova radnja**, ne agentova (Task 6).
- Rad ide na grani `fix/post-due-po-ciklusu`, ne na `main`. Merge u `main` = produkcijski deploy na tri Vercel projekta.

---

## Pregled fajlova

**Kreirati:**
- `supabase/migrations/20260720119000_mejl_tip_prosirenje.sql` — tri nove `mejl_tip` vrijednosti
- `supabase/migrations/20260720120000_post_due_obavijesti.sql` — ledger + supresioni backfill
- `supabase/migrations/20260720121000_get_due_bez_post_due.sql` — `get_due_podsjetnici` samo pre-due
- `supabase/migrations/20260720122000_get_post_due_termine.sql` — novi RPC
- `supabase/migrations/20260720123000_claim_post_due.sql` — atomski claim
- `lib/reminders/runPostDue.ts` — orkestracija post-due slanja
- `lib/reminders/runPostDue.test.ts` — unit testovi sa lažnim `send`
- `lib/reminders/postDueRpc.integration.test.ts` — integracija RPC-a i claim-a

**Mijenjati:**
- `lib/reminders/recipients.ts` — dodati `loadRecipientIndex()`
- `lib/reminders/runReminders.ts:41-97` — koristiti `loadRecipientIndex()`
- `lib/email/templates.ts` — `rokIstekaoFirmaSubject`, `rokIstekaoFirmaHtml`, `zakazanoZa` u `reminderHtml`
- `lib/email/templates.test.ts` — testovi za nove šablone
- `messages/{sr,en,de}.json` — `email.rokIstekaoFirma.*`, `email.podsjetnik.poljeZakazanoZa`, labele tipova u dnevniku
- `components/domain/PoslatiMejloviTabela.tsx:11-16` — `TIP_KEY` za tri nove vrijednosti
- `app/api/cron/reminders/route.ts` — poziv `runPostDue`, `maxDuration`, glasan pad bez ključa
- `scripts/send-reminders.ts` — okidanje post-due puta
- `scripts/preview-emails.ts` — primjeri novih šablona
- `lib/reminders/dueRpc.integration.test.ts:74-88` — brisanje post-due testa
- `db/types.ts` — regenerisan, ne ručno

---

### Task 1: SQL temelj — ledger, RPC-ovi, claim, i regenerisani tipovi

Sve migracije, njihova lokalna primjena, `pnpm db:types` i posljedične TS izmjene idu zajedno: bez regenerisanih tipova `TIP_KEY ... satisfies Record<MejlTip, string>` ne kompajlira, a bez lokalne primjene `db:types` ne vidi ništa novo. Deliverable je zelen `pnpm typecheck` + prolazni integracioni testovi.

**Files:**
- Create: `supabase/migrations/20260720119000_mejl_tip_prosirenje.sql`
- Create: `supabase/migrations/20260720120000_post_due_obavijesti.sql`
- Create: `supabase/migrations/20260720121000_get_due_bez_post_due.sql`
- Create: `supabase/migrations/20260720122000_get_post_due_termine.sql`
- Create: `supabase/migrations/20260720123000_claim_post_due.sql`
- Create: `lib/reminders/postDueRpc.integration.test.ts`
- Modify: `lib/reminders/dueRpc.integration.test.ts:74-88` (brisanje post-due testa)
- Modify: `components/domain/PoslatiMejloviTabela.tsx:11-16`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`
- Modify: `db/types.ts` (generisan)

**Interfaces:**
- Consumes: postojeće `termini`, `klijenti`, `vrste_provjera`, `lokacije`, `podsjetnici`, tip `mejl_tip`
- Produces:
  - tabela `post_due_obavijesti(id uuid, termin_id uuid, ciklus_rok date, kanal text, stanje text, razlog text, claimed_at timestamptz, poslat_at timestamptz, poslat_na text[], resend_id text)`
  - `get_post_due_termine()` → `(termin_id uuid, klijent_id uuid, klijent_naziv text, vrsta_naziv text, rok_dospijeca date, datum_zakazan date, ciklus_rok date, dana_do_ciklusa int, lokacija_naziv text, treba_interni boolean, treba_firma boolean)`
  - `claim_post_due(p_termin uuid, p_ciklus date, p_kanal text)` → `uuid` (null kad claim drži neko drugi)
  - `mejl_tip` vrijednosti `podsjetnik_rok_istekao_interni`, `podsjetnik_rok_istekao_firma`, `podsjetnik_digest`

- [ ] **Step 1: Napravi granu**

```bash
git checkout main
git pull
git checkout -b fix/post-due-po-ciklusu
```

- [ ] **Step 2: Migracija za enum vrijednosti**

Kreiraj `supabase/migrations/20260720119000_mejl_tip_prosirenje.sql`:

```sql
-- Tri nove vrste mejla u dnevniku. ZASEBNA migracija i namjerno NAJNIŽI broj u ovom
-- PR-u: alter type ... add value mora biti commit-ovan prije nego se vrijednost upotrijebi,
-- a scripts/apply-cloud-migration.ts šalje cijeli fajl kao jedan query (jedna transakcija).
alter type mejl_tip add value if not exists 'podsjetnik_rok_istekao_interni';
alter type mejl_tip add value if not exists 'podsjetnik_rok_istekao_firma';
alter type mejl_tip add value if not exists 'podsjetnik_digest';
```

- [ ] **Step 3: Migracija za ledger + supresioni backfill**

Kreiraj `supabase/migrations/20260720120000_post_due_obavijesti.sql`:

```sql
-- Ledger post-due obavijesti, ključan po CIKLUSU = coalesce(datum_zakazan, rok_dospijeca).
-- podsjetnici ostaje pre-due i istorijski ledger i ne dira se.
create table if not exists post_due_obavijesti (
  id          uuid        primary key default gen_random_uuid(),
  termin_id   uuid        not null references termini(id) on delete cascade,
  ciklus_rok  date        not null,
  kanal       text        not null check (kanal in ('interni','firma')),
  stanje      text        not null default 'u_toku'
                          check (stanje in ('u_toku','poslato','preskoceno')),
  razlog      text,
  claimed_at  timestamptz not null default now(),
  poslat_at   timestamptz,
  poslat_na   text[]      not null default '{}',
  resend_id   text,
  constraint uq_post_due unique (termin_id, ciklus_rok, kanal)
);

-- Bez zasebnog indeksa: uq_post_due (termin_id, ciklus_rok, kanal) ima prefiks
-- (termin_id, ciklus_rok) i pokriva svaki upit iz get_post_due_termine i claim_post_due.

-- RLS bez politika: piše i čita isključivo cron preko service-role klijenta (bypass RLS).
-- Supabase-ov alter default privileges ionako grantuje anon/authenticated, pa je RLS
-- bez politika jedino što tabelu drži zatvorenom kroz PostgREST.
alter table post_due_obavijesti enable row level security;

-- SUPRESIONI BACKFILL: termini koji su SADA u alarmu i koji se AKTIVNO spamuju
-- (post-due zapis u posljednjih 14 dana) dobijaju trag za TEKUĆI ciklus, po kanalu
-- koji je stvarno slao. Bez ovoga bi prvi run poslije deploya poslao mejlove.
-- Ne rekonstruiše se ništa iz dana_prije: ta aritmetika daje rok, a ciklus je
-- coalesce(datum_zakazan, rok_dospijeca) i za CARMEUSE se to razilazi.
insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, razlog, poslat_at)
select t.id,
       coalesce(t.datum_zakazan, t.rok_dospijeca),
       k.kanal,
       'poslato',
       'backfill_migracija',
       max(p.poslat_at)
from termini t
cross join (values ('interni'),('firma')) as k(kanal)
join podsjetnici p on p.termin_id = t.id and p.dana_prije < 0
where t.status in ('planirano','zakazano')
  and t.rok_dospijeca < current_date
  and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
  and p.kanal = k.kanal
  and p.poslat_at > now() - interval '14 days'
group by t.id, coalesce(t.datum_zakazan, t.rok_dospijeca), k.kanal
on conflict do nothing;
```

- [ ] **Step 4: Migracija koja uklanja post-due granu iz `get_due_podsjetnici`**

Kreiraj `supabase/migrations/20260720121000_get_due_bez_post_due.sql`. Pre-due grana je prekopirana **doslovno** iz `20260629120000_podsjetnici_catchup_postdue.sql`; jedina razlika je što `union all` i post-due grana nestaju, pa se `distinct on` podupit mora omotati da bi vanjski `order by` ostao isti:

```sql
-- Post-due grana se seli u get_post_due_termine() + post_due_obavijesti.
-- Ovdje ostaje ISKLJUČIVO pre-due grana, prekopirana doslovno iz 20260629120000.
-- Povratni tip je nepromijenjen → create or replace je dovoljan (bez drop).
create or replace function get_due_podsjetnici(dana_prije_arr int[])
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
  -- distinct on traži order by t.id prvo, pa se rezultat omotava radi vanjskog sortiranja.
  select * from (
    select distinct on (t.id)
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
      and not exists (
        select 1 from podsjetnici p
        where p.termin_id = t.id and p.dana_prije >= 0 and p.dana_prije <= d.d
      )
    order by t.id, d.d asc
  ) s
  order by s.rok_dospijeca, s.klijent_naziv;
$$;
```

- [ ] **Step 5: Migracija za `get_post_due_termine`**

Kreiraj `supabase/migrations/20260720122000_get_post_due_termine.sql`:

```sql
-- Termini u alarmu, sa naznakom koji kanal još nije obrađen za tekući ciklus.
-- ALARM traži OBA uslova: rok je prošao I efektivni datum je prošao. Bez prvog uslova
-- bi termin sa rokom u budućnosti i propuštenim datum_zakazan slao lažnu uzbunu.
create or replace function get_post_due_termine()
returns table (
  termin_id       uuid,
  klijent_id      uuid,
  klijent_naziv   text,
  vrsta_naziv     text,
  rok_dospijeca   date,
  datum_zakazan   date,
  ciklus_rok      date,
  dana_do_ciklusa int,
  lokacija_naziv  text,
  treba_interni   boolean,
  treba_firma     boolean
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
      and t.rok_dospijeca < current_date
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
  ),
  otvoren as (
    -- Kanal je "otvoren" ako nema reda, ILI je red zaglavljen u 'u_toku' duže od 15 min.
    -- Zaglavljeni claim MORA biti vidljiv ovdje, inače je oporavak nedostižan i smrt
    -- procesa između claim-a i slanja trajno guta jedinu obavijest za taj ciklus.
    select ef.id as tid, kan.kanal,
           not exists (
             select 1 from post_due_obavijesti o
             where o.termin_id = ef.id
               and o.ciklus_rok = ef.ciklus
               and o.kanal = kan.kanal
               and (o.stanje in ('poslato','preskoceno')
                    or (o.stanje = 'u_toku' and o.claimed_at >= now() - interval '15 minutes'))
           ) as treba
    from ef cross join (values ('interni'),('firma')) as kan(kanal)
  )
  select ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus,
         (ef.ciklus - current_date), l.naziv,
         bool_or(o.treba) filter (where o.kanal = 'interni'),
         bool_or(o.treba) filter (where o.kanal = 'firma')
  from ef
  join klijenti k        on k.id = ef.klijent_id
  join vrste_provjera vp on vp.id = ef.vrsta_provjere_id
  left join lokacije l   on l.id = ef.lokacija_id
  join otvoren o         on o.tid = ef.id
  group by ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus, l.naziv
  having bool_or(o.treba)
  order by ef.ciklus, k.naziv;
$$;

-- Supabase daje EXECUTE direktno roli authenticated kroz alter default privileges,
-- pa revoke from public, anon NIJE dovoljan.
revoke execute on function get_post_due_termine() from public, anon, authenticated;
grant  execute on function get_post_due_termine() to service_role;
```

- [ ] **Step 6: Migracija za `claim_post_due`**

Kreiraj `supabase/migrations/20260720123000_claim_post_due.sql`:

```sql
-- Atomski claim. Mora biti SQL funkcija: cron radi preko supabase-js/PostgREST, a
-- .upsert() ne može izraziti "on conflict do update ... where ... returning" —
-- ignoreDuplicates bi vratio prazno i za zaglavljeni claim, čime bi oporavak nestao.
-- Presedan u repou: 20260710120000_podsjetnik_email_atomic_rpc.sql.
create or replace function claim_post_due(p_termin uuid, p_ciklus date, p_kanal text)
returns uuid
language sql
volatile
security invoker
set search_path = public
as $$
  insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, claimed_at)
  values (p_termin, p_ciklus, p_kanal, 'u_toku', now())
  on conflict (termin_id, ciklus_rok, kanal) do update
    set claimed_at = now()
    where post_due_obavijesti.stanje = 'u_toku'
      and post_due_obavijesti.claimed_at < now() - interval '15 minutes'
  returning id;
$$;

revoke execute on function claim_post_due(uuid, date, text) from public, anon, authenticated;
grant  execute on function claim_post_due(uuid, date, text) to service_role;
```

- [ ] **Step 7: Primijeni migracije lokalno**

```bash
pnpm db:reset
```

Očekivano: sve migracije prolaze bez greške, posljednje ispisane su `20260720119000` … `20260720123000`.

- [ ] **Step 8: Napiši integracione testove za novi RPC i claim**

Kreiraj `lib/reminders/postDueRpc.integration.test.ts`. Obrazac (gate na `TEST_DATABASE_URL`, `pg` klijent, transakcija sa `rollback`) je prekopiran iz `dueRpc.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("get_post_due_termine + claim_post_due (integracija, lokalni DB)", () => {
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
      const k = await db.query("insert into klijenti (naziv) values ('ITEST klijent') returning id")
      const v = await db.query("insert into vrste_provjera (naziv) values ('ITEST vrsta') returning id")
      await fn({ klijent: k.rows[0].id as string, vrsta: v.rows[0].id as string })
    } finally {
      await db.query("rollback")
    }
  }

  // datum_zadnjeg ostaje null → tg_compute_rok NE prepisuje rok_dospijeca.
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

  type Row = {
    termin_id: string; ciklus_rok: string; dana_do_ciklusa: number
    treba_interni: boolean; treba_firma: boolean
  }
  async function postDue(terminId: string): Promise<Row[]> {
    const r = await db.query("select * from get_post_due_termine() where termin_id = $1", [terminId])
    return r.rows as Row[]
  }

  async function claim(terminId: string, ciklus: string, kanal: string): Promise<string | null> {
    const r = await db.query("select claim_post_due($1, $2::date, $3) as id", [terminId, ciklus, kanal])
    return (r.rows[0]?.id as string | null) ?? null
  }

  it("termin sa isteklim rokom je u alarmu; oba kanala otvorena, dana_do_ciklusa negativan", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const rows = await postDue(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dana_do_ciklusa).toBe(-5)
      expect(rows[0]!.treba_interni).toBe(true)
      expect(rows[0]!.treba_firma).toBe(true)
    })
  })

  it("termin sa rokom u budućnosti i propuštenim datum_zakazan NIJE u alarmu", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, 40, -3)
      expect(await postDue(t)).toHaveLength(0)
    })
  })

  it("termin sa isteklim rokom i zakazanim datumom u budućnosti NIJE u alarmu", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -20, 7)
      expect(await postDue(t)).toHaveLength(0)
    })
  })

  it("ciklus je datum_zakazan kad je i on prošao", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -20, -2)
      const rows = await postDue(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dana_do_ciklusa).toBe(-2)
    })
  })

  it("poslat trag zatvara samo svoj kanal", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      const id = await claim(t, ciklus, "interni")
      expect(id).not.toBeNull()
      await db.query("update post_due_obavijesti set stanje = 'poslato' where id = $1", [id])
      const rows = await postDue(t)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.treba_interni).toBe(false)
      expect(rows[0]!.treba_firma).toBe(true)
    })
  })

  it("kad su oba kanala zatvorena, termin izlazi iz RPC-a", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      for (const kanal of ["interni", "firma"]) {
        const id = await claim(t, ciklus, kanal)
        await db.query("update post_due_obavijesti set stanje = 'poslato' where id = $1", [id])
      }
      expect(await postDue(t)).toHaveLength(0)
    })
  })

  it("preskoceno zatvara kanal isto kao poslato", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      const id = await claim(t, ciklus, "firma")
      await db.query(
        "update post_due_obavijesti set stanje = 'preskoceno', razlog = 'nema_primalaca' where id = $1",
        [id],
      )
      expect((await postDue(t))[0]!.treba_firma).toBe(false)
    })
  })

  it("svjež u_toku claim drži kanal zatvorenim, a drugi claim vraća null", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      expect(await claim(t, ciklus, "interni")).not.toBeNull()
      expect((await postDue(t))[0]!.treba_interni).toBe(false)
      expect(await claim(t, ciklus, "interni")).toBeNull()
    })
  })

  it("zaglavljen u_toku claim stariji od 15 min ponovo otvara kanal i može se preuzeti", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus = (await postDue(t))[0]!.ciklus_rok
      const id = await claim(t, ciklus, "interni")
      await db.query(
        "update post_due_obavijesti set claimed_at = now() - interval '20 minutes' where id = $1",
        [id],
      )
      expect((await postDue(t))[0]!.treba_interni).toBe(true)
      expect(await claim(t, ciklus, "interni")).toBe(id)
    })
  })

  // REGRESIJA na kritičnu grešku revizije 2. Tamo je dedup ključ bio broj dana kašnjenja,
  // pa je termin sa pomjerenim rokom koji opet istekne sa ISTIM brojem dana kašnjenja
  // udarao u postojeći red, mejl je već bio otišao, a trag se gubio. Ovdje je ključ
  // ciklus (datum), pa isti broj dana kašnjenja ne znači isti ključ.
  it("pomjeranje roka otvara novi ciklus i kad je broj dana kašnjenja isti", async () => {
    await withSeed(async (ids) => {
      const t = await addTermin(ids, -5)
      const ciklus1 = (await postDue(t))[0]!.ciklus_rok
      for (const kanal of ["interni", "firma"]) {
        const id = await claim(t, ciklus1, kanal)
        await db.query("update post_due_obavijesti set stanje = 'poslato' where id = $1", [id])
      }
      expect(await postDue(t)).toHaveLength(0)

      // Rok pomjeren 10 dana naprijed; sada je kašnjenje opet 5 dana, ali je datum drugi.
      await db.query("update termini set rok_dospijeca = rok_dospijeca + 10 where id = $1", [t])
      await db.query("update termini set rok_dospijeca = current_date - 5 + 10 where id = $1", [t])
      await db.query("update termini set rok_dospijeca = current_date - 5 where id = $1", [t])
      const rows = await postDue(t)
      // Isti datum kao ciklus1 → i dalje zatvoreno. Ovo dokazuje da ključ NIJE broj dana.
      expect(rows).toHaveLength(0)

      // Stvarno novi datum → novi ciklus → oba kanala opet otvorena.
      await db.query("update termini set rok_dospijeca = current_date - 3 where id = $1", [t])
      const rows2 = await postDue(t)
      expect(rows2).toHaveLength(1)
      expect(rows2[0]!.ciklus_rok).not.toBe(ciklus1)
      expect(rows2[0]!.treba_interni).toBe(true)
      expect(rows2[0]!.treba_firma).toBe(true)
      expect(await claim(t, rows2[0]!.ciklus_rok, "interni")).not.toBeNull()
    })
  })
})
```

- [ ] **Step 9: Obriši post-due test iz `dueRpc.integration.test.ts`**

Obriši cijeli `it("post-due: termin -2 daje jedan red …")` blok (`:74-88`). Test „negativni post-due marker ne blokira pre-due prag" **ostaje** — pre-due grana je nepromijenjena i taj test to i dalje dokazuje.

- [ ] **Step 10: Pokreni integracione testove**

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm vitest run lib/reminders/postDueRpc.integration.test.ts lib/reminders/dueRpc.integration.test.ts
```

Očekivano: svi testovi PASS. Ako `postDueRpc` testovi padnu na „function get_post_due_termine does not exist", `pnpm db:reset` nije prošao — vrati se na Step 7.

- [ ] **Step 11: Regeneriši tipove**

```bash
pnpm db:types
git diff --stat db/types.ts
```

Očekivano: `db/types.ts` dobija `post_due_obavijesti`, `get_post_due_termine`, `claim_post_due` i tri nove `mejl_tip` vrijednosti.

- [ ] **Step 12: Pokreni typecheck da vidiš očekivani pad**

```bash
pnpm typecheck
```

Očekivano: **FAIL** u `components/domain/PoslatiMejloviTabela.tsx` — `TIP_KEY` ne pokriva nove `mejl_tip` vrijednosti (`satisfies Record<MejlTip, string>`).

- [ ] **Step 13: Dopuni `TIP_KEY`**

U `components/domain/PoslatiMejloviTabela.tsx:11-16`:

```ts
export const TIP_KEY = {
  podsjetnik_interni: "podsjetnikInterni",
  podsjetnik_firma: "podsjetnikFirma",
  podsjetnik_rok_istekao_interni: "podsjetnikRokIstekaoInterni",
  podsjetnik_rok_istekao_firma: "podsjetnikRokIstekaoFirma",
  podsjetnik_digest: "podsjetnikDigest",
  zakazano_nakon_roka: "zakazanoNakonRoka",
  test: "test",
} as const satisfies Record<MejlTip, string>
```

- [ ] **Step 14: Dodaj labele u sva tri kataloga**

Nađi objekat koji sadrži ključ `podsjetnikFirma` (isti nivo gdje živi i `zakazanoNakonRoka`) u `messages/sr.json` i dodaj tri ključa:

```json
"podsjetnikRokIstekaoInterni": "Rok istekao (interno)",
"podsjetnikRokIstekaoFirma": "Rok istekao (firmi)",
"podsjetnikDigest": "Sedmični pregled"
```

`messages/en.json`:

```json
"podsjetnikRokIstekaoInterni": "Deadline passed (internal)",
"podsjetnikRokIstekaoFirma": "Deadline passed (client)",
"podsjetnikDigest": "Weekly summary"
```

`messages/de.json` (čeka native review, kao i ostatak kataloga):

```json
"podsjetnikRokIstekaoInterni": "Frist abgelaufen (intern)",
"podsjetnikRokIstekaoFirma": "Frist abgelaufen (Kunde)",
"podsjetnikDigest": "Wöchentliche Übersicht"
```

- [ ] **Step 15: Typecheck i lint moraju proći**

```bash
pnpm typecheck && pnpm lint
```

Očekivano: oba bez greške.

- [ ] **Step 16: Commit**

```bash
git add supabase/migrations/2026072011*.sql supabase/migrations/2026072012*.sql \
        lib/reminders/postDueRpc.integration.test.ts lib/reminders/dueRpc.integration.test.ts \
        components/domain/PoslatiMejloviTabela.tsx messages/ db/types.ts
git commit -m "feat(podsjetnici): ledger post_due_obavijesti + RPC po ciklusu + atomski claim"
```

---

### Task 2: `loadRecipientIndex` — jedan izvor istine za primaoce

`runPostDue` treba isti indeks primalaca koji `runReminders` već gradi. Kopiranje tog bloka bi udvostručilo broj upita i otvorilo mogućnost da dva puta vide različit snapshot dodjela. Ovo je čist refaktor: ponašanje se ne mijenja, postojeći testovi moraju ostati zeleni bez izmjene.

**Files:**
- Modify: `lib/reminders/recipients.ts` (dodati na kraj)
- Modify: `lib/reminders/runReminders.ts:41-97`
- Test: `lib/reminders/runReminders.test.ts` (postojeći, bez izmjena — služi kao regresija)

**Interfaces:**
- Consumes: `buildRecipientIndex`, `parseEmailList` iz istog fajla; `env.REMINDER_TO`
- Produces: `loadRecipientIndex(supabase: SupabaseClient<Database>): Promise<{ index: RecipientIndex; base: string[]; danaPrije: number[] }>`

- [ ] **Step 1: Pokreni postojeće testove da potvrdiš zelenu polaznu tačku**

```bash
pnpm vitest run lib/reminders/runReminders.test.ts
```

Očekivano: PASS. Ovo je regresiona mreža za refaktor.

- [ ] **Step 2: Dodaj `loadRecipientIndex` u `lib/reminders/recipients.ts`**

Na vrh fajla dodaj uvoze:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
```

Na kraj fajla dodaj:

```ts
const DEFAULT_DANA = [60, 30, 15, 7]

/**
 * Jedan izvor istine za "ko prima šta": postavke + admini + dodjele + firmine adrese.
 * Zovu ga runReminders i runPostDue — kopiranje bi udvostručilo upite i otvorilo
 * mogućnost da dva puta u istom zahtjevu vide različit snapshot dodjela.
 *
 * saljiKlijentima dolazi iz postavke i MORA biti dio ovog čitanja: bez njega bi
 * buildRecipientIndex dobio false i firmin kanal bi tiho ostao ugašen.
 */
export async function loadRecipientIndex(
  supabase: SupabaseClient<Database>,
): Promise<{ index: RecipientIndex; base: string[]; danaPrije: number[] }> {
  const { data: post } = await supabase
    .from("postavke")
    .select("dana_prije, salji_klijentima")
    .eq("id", 1)
    .maybeSingle()
  const danaPrije = post?.dana_prije && post.dana_prije.length > 0 ? post.dana_prije : DEFAULT_DANA
  const saljiKlijentima = post?.salji_klijentima ?? false

  const base = parseEmailList(env.REMINDER_TO)
  const { data: korisnici, error: korErr } = await supabase
    .from("korisnici")
    .select("id, email, uloga, aktivan, prima_podsjetnike")
  if (korErr) throw new Error(`Greška pri čitanju primalaca (korisnici): ${korErr.message}`)
  // PostgREST implicitno limitira na ~1000 redova: sigurno na trenutnoj skali, ali ako dodjele narastu
  // dodaj eksplicitan .range()/count provjeru — tiha trunkacija bi inače ispustila nekog primaoca.
  const { data: dodjele, error: kkErr } = await supabase
    .from("korisnik_klijent")
    .select("korisnik_id, klijent_id")
  if (kkErr) throw new Error(`Greška pri čitanju dodjela (korisnik_klijent): ${kkErr.message}`)
  const { data: klijentiZaSlanje, error: klErr } = await supabase
    .from("klijenti")
    .select("id, salji_podsjetnik_klijentu, podsjetnik_emails")
  if (klErr) throw new Error(`Greška pri čitanju klijenata (Krug 2): ${klErr.message}`)
  const { data: kontaktiPrimaoci, error: kontErr } = await supabase
    .from("kontakt_osobe")
    .select("klijent_id, email, podsjetnik_primalac")
  if (kontErr) throw new Error(`Greška pri čitanju kontakata (Krug 2): ${kontErr.message}`)

  const index = buildRecipientIndex(
    korisnici ?? [],
    dodjele ?? [],
    klijentiZaSlanje ?? [],
    kontaktiPrimaoci ?? [],
    saljiKlijentima,
  )
  return { index, base, danaPrije }
}
```

- [ ] **Step 3: Prepiši taj blok u `runReminders.ts`**

Uvezi `loadRecipientIndex` iz `@/lib/reminders/recipients` (dodaj u postojeći import). Zamijeni linije od `const { data: post } = await supabase` do `)` koji zatvara `buildRecipientIndex(...)` sa:

```ts
  const { index: recipientIndex, base, danaPrije } = await loadRecipientIndex(supabase)
```

Obriši lokalni `const DEFAULT_DANA = [60, 30, 15, 7]` iz `runReminders.ts` (preselio se u `recipients.ts`). Ostatak funkcije — uključujući `console.warn` granu za „nema eligibilnih primalaca" i poziv `supabase.rpc("get_due_podsjetnici", { dana_prije_arr: danaPrije })` — ostaje netaknut.

- [ ] **Step 4: Testovi moraju proći bez izmjene**

```bash
pnpm vitest run lib/reminders/
```

Očekivano: PASS. Ako padne na `from(postavke)` u mock-u, znači da je redoslijed upita promijenjen — mock u `runReminders.test.ts:36` očekuje `select().eq().maybeSingle()` na `postavke`, što `loadRecipientIndex` zadržava.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add lib/reminders/recipients.ts lib/reminders/runReminders.ts
git commit -m "refactor(podsjetnici): izdvoji loadRecipientIndex kao jedini izvor istine za primaoce"
```

---

### Task 3: Šabloni — firmina obavijest i ciklus-svjestan interni mejl

**Files:**
- Modify: `lib/email/templates.ts`
- Modify: `lib/email/templates.test.ts`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`
- Modify: `scripts/preview-emails.ts`

**Interfaces:**
- Consumes: `layoutOmot`, `badge`, `poljeRed`, `escapeHtml`, `danaTekst`, `formatDatum`, `FirmBrand` (svi već postoje u `templates.ts`)
- Produces:
  - `rokIstekaoFirmaSubject(args: { vrsta: string; klijent: string }, locale?: Locale): string`
  - `rokIstekaoFirmaHtml(args: { klijent: string; vrsta: string; rok: string; zakazanoZa?: string | null; lokacija?: string | null; brand: FirmBrand }, locale?: Locale): string`
  - `reminderHtml` dobija opciono polje `zakazanoZa?: string | null`

- [ ] **Step 1: Dodaj i18n ključeve u sva tri kataloga**

`messages/sr.json`, unutar objekta `email`, pored `podsjetnik`:

```json
"rokIstekaoFirma": {
  "predmet": "Rok je istekao — {vrsta} · {klijent}",
  "headerLabel": "Obavijest",
  "znacka": "ROK ISTEKAO",
  "uvod": "Rok za izvršenje je istekao. Molimo javite se kako bismo dogovorili termin.",
  "poljeRok": "Rok dospijeća",
  "poljeZakazan": "Bilo zakazano za",
  "poljeVrsta": "Vrsta",
  "poljeKlijent": "Klijent",
  "poljeLokacija": "Lokacija"
}
```

U `email.podsjetnik` dodaj jedan ključ:

```json
"poljeZakazanoZa": "Zakazano za:"
```

`messages/en.json`, isti nivo:

```json
"rokIstekaoFirma": {
  "predmet": "Deadline passed — {vrsta} · {klijent}",
  "headerLabel": "Notice",
  "znacka": "DEADLINE PASSED",
  "uvod": "The deadline has passed. Please get in touch so we can arrange a visit.",
  "poljeRok": "Due date",
  "poljeZakazan": "Was scheduled for",
  "poljeVrsta": "Service",
  "poljeKlijent": "Client",
  "poljeLokacija": "Location"
}
```

i u `email.podsjetnik`: `"poljeZakazanoZa": "Scheduled for:"`

`messages/de.json`:

```json
"rokIstekaoFirma": {
  "predmet": "Frist abgelaufen — {vrsta} · {klijent}",
  "headerLabel": "Mitteilung",
  "znacka": "FRIST ABGELAUFEN",
  "uvod": "Die Frist ist abgelaufen. Bitte melden Sie sich, damit wir einen Termin vereinbaren können.",
  "poljeRok": "Fälligkeitsdatum",
  "poljeZakazan": "War geplant für",
  "poljeVrsta": "Leistung",
  "poljeKlijent": "Kunde",
  "poljeLokacija": "Standort"
}
```

i u `email.podsjetnik`: `"poljeZakazanoZa": "Geplant für:"`

- [ ] **Step 2: Napiši padajuće testove**

Dodaj u `lib/email/templates.test.ts`:

```ts
import { rokIstekaoFirmaSubject, rokIstekaoFirmaHtml } from "./templates"

describe("rokIstekaoFirma", () => {
  const brand = { name: "TEHPRO", tagline: "Zaštita na radu i zaštita od požara" }

  it("subject ne sadrži riječ o kašnjenju", () => {
    const s = rokIstekaoFirmaSubject({ vrsta: "Obilazak", klijent: "CARMEUSE" })
    expect(s).toContain("CARMEUSE")
    expect(s.toLowerCase()).not.toContain("kasni")
  })

  it("html nema interne linkove ni dugmad", () => {
    const html = rokIstekaoFirmaHtml({
      klijent: "CARMEUSE", vrsta: "Obilazak", rok: "2026-07-13", brand,
    })
    expect(html).not.toContain("/plan-aktivnosti")
    expect(html).not.toContain("/klijenti/")
    expect(html).toContain("TEHPRO")
  })

  it("prikazuje zakazani datum kad postoji", () => {
    const html = rokIstekaoFirmaHtml({
      klijent: "CARMEUSE", vrsta: "Obilazak", rok: "2026-07-13", zakazanoZa: "2026-07-15", brand,
    })
    expect(html).toContain("15.07.2026")
    expect(html).toContain("13.07.2026")
  })

  it("escapuje naziv klijenta", () => {
    const html = rokIstekaoFirmaHtml({
      klijent: "A & B <test>", vrsta: "Obilazak", rok: "2026-07-13", brand,
    })
    expect(html).toContain("A &amp; B &lt;test&gt;")
    expect(html).not.toContain("<test>")
  })
})

describe("reminderHtml sa zakazanoZa", () => {
  it("prikazuje i rok i zakazani datum, i računa kašnjenje od zakazanog", () => {
    const html = reminderHtml({
      klijent: "CARMEUSE", vrsta: "Obilazak", rok: "2026-07-13",
      danaDoRoka: -2, zakazanoZa: "2026-07-15",
    })
    expect(html).toContain("13.07.2026")
    expect(html).toContain("15.07.2026")
  })
})
```

- [ ] **Step 3: Pokreni testove da potvrdiš pad**

```bash
pnpm vitest run lib/email/templates.test.ts
```

Očekivano: FAIL — `rokIstekaoFirmaSubject is not a function`.

- [ ] **Step 4: Implementiraj `rokIstekaoFirmaSubject` i `rokIstekaoFirmaHtml`**

Dodaj u `lib/email/templates.ts`, poslije `reminderHtmlFirma`:

```ts
export function rokIstekaoFirmaSubject(
  args: { vrsta: string; klijent: string },
  locale: Locale = APP_LOCALE,
): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.rokIstekaoFirma" })
  return t("predmet", { vrsta: args.vrsta, klijent: args.klijent })
}

/**
 * Firmina obavijest da je rok istekao — poziv na dogovor, ne opomena.
 * Bez internih dugmadi i bez ICS priloga; brend iz FirmBrand.
 */
export function rokIstekaoFirmaHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  zakazanoZa?: string | null
  lokacija?: string | null
  brand: FirmBrand
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.rokIstekaoFirma" })
  const b = args.brand
  const boja = "#dc2626"
  const zakazanRed = args.zakazanoZa
    ? poljeRed(t("poljeZakazan"), formatDatum(args.zakazanoZa, locale))
    : ""
  const lokRed = args.lokacija ? poljeRed(t("poljeLokacija"), escapeHtml(args.lokacija)) : ""
  const kontakt = [b.email, b.phone, b.web].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")
  const potpis = `${escapeHtml(b.name)} — ${escapeHtml(b.tagline)}${kontakt ? `<br>${kontakt}` : ""}`

  const telo = `${badge(boja, t("znacka"))}
          <p style="margin:12px 0 0;font-size:15px">${t("uvod")}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-top:1px solid #e2e8f0;font-size:14px">
            ${poljeRed(t("poljeRok"), formatDatum(args.rok, locale), true)}
            ${zakazanRed}
            ${poljeRed(t("poljeVrsta"), escapeHtml(args.vrsta))}
            ${poljeRed(t("poljeKlijent"), escapeHtml(args.klijent))}
            ${lokRed}
          </table>`
  return layoutOmot({
    accent: boja,
    headerNaziv: escapeHtml(b.name),
    headerLabel: t("headerLabel"),
    telo,
    footer: potpis,
    locale,
  })
}
```

- [ ] **Step 5: Dodaj `zakazanoZa` u `reminderHtml`**

U potpisu `reminderHtml` (`templates.ts:122-131`) dodaj polje `zakazanoZa?: string | null`. Odmah poslije `const lokRed = ...` dodaj:

```ts
  // Kad ciklus dolazi iz datum_zakazan, mejl mora prikazati OBA datuma — rok ostaje rok.
  const zakazanoRed = args.zakazanoZa
    ? poljeRed(t("poljeZakazanoZa"), formatDatum(args.zakazanoZa, locale))
    : ""
```

U `telo`, ubaci `${zakazanoRed}` odmah poslije reda sa `poljeLokacija`:

```ts
            ${lokRed}
            ${zakazanoRed}
```

- [ ] **Step 6: Testovi moraju proći**

```bash
pnpm vitest run lib/email/templates.test.ts
```

Očekivano: PASS.

- [ ] **Step 7: Dodaj primjere u preview harness**

U `scripts/preview-emails.ts`:

1. Dodaj u postojeći import iz `@/lib/email/templates`: `rokIstekaoFirmaSubject`, `rokIstekaoFirmaHtml`.
2. U `const FX` dodaj dva polja iza `zakazanoZakazan`:

```ts
  // Rok istekao (post-due): ciklus dolazi iz zakazanog datuma koji je i sam prošao.
  istekaoRok: "2026-07-13",
  istekaoZakazan: "2026-07-15",
```

3. U `buildItems()`, u vraćeni niz, dodaj dvije stavke prije `6-test-email.html` i preimenuj taj fajl u `8-test-email.html` radi rednog broja:

```ts
    {
      file: "6-rok-istekao-firma.html",
      naziv: "Rok istekao (firma, poziv na dogovor, FirmBrand)",
      subject: rokIstekaoFirmaSubject({ vrsta, klijent }),
      html: rokIstekaoFirmaHtml({
        klijent, vrsta, rok: FX.istekaoRok, zakazanoZa: FX.istekaoZakazan, lokacija, brand,
      }),
    },
    {
      file: "7-podsjetnik-interni-zakazan-pa-propusten.html",
      naziv: "Podsjetnik (interni) — zakazano pa propušteno",
      subject: reminderSubject({ vrsta, klijent, danaDoRoka: DANA_KASNI }),
      html: reminderHtml({
        klijent, vrsta, rok: FX.istekaoRok, danaDoRoka: DANA_KASNI, lokacija,
        zakazanoZa: FX.istekaoZakazan, terminId, klijentId, baseUrl,
      }),
    },
```

4. U komentaru iznad `buildItems()` promijeni „6 fajlova" u „8 fajlova (interni×3, firma×3, zakazano, test)".

- [ ] **Step 8: Pogledaj HTML okom**

```bash
pnpm preview:emails
```

(`lib/env.ts` se učitava tranzitivno i zod-om validira Supabase varijable na importu, pa render mod ide kroz `--env-file=.env.local` — što `pnpm preview:emails` već radi.)

Otvori ispisane putanje u pregledaču. Provjeri: `6-rok-istekao-firma.html` nema nijedno dugme ni interni link, ima potpis firme i prikazuje oba datuma; `7-…` prikazuje „Rok dospijeća: 13.07.2026" **i** „Zakazano za: 15.07.2026".

- [ ] **Step 9: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run lib/email/
git add lib/email/templates.ts lib/email/templates.test.ts messages/ scripts/preview-emails.ts
git commit -m "feat(email): firmin šablon za istekao rok + ciklus-svjestan interni podsjetnik"
```

---

### Task 4: `runPostDue` — claim-first orkestracija

**Files:**
- Create: `lib/reminders/runPostDue.ts`
- Create: `lib/reminders/runPostDue.test.ts`

**Interfaces:**
- Consumes: `loadRecipientIndex` (Task 2), `rokIstekaoFirmaSubject`/`rokIstekaoFirmaHtml`/`reminderHtml` sa `zakazanoZa` (Task 3), `claim_post_due` i `get_post_due_termine` (Task 1), postojeći `posaljiIzabiljezi`, `buildTerminIcs`, `firmBrand`, `recipientsForKlijent`, `firmaRecipientsForKlijent`
- Produces: `runPostDue(supabase, deps?) => Promise<PostDueRunResult>` gdje je
  `PostDueRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }`,
  `SentItem = { terminId: string; kanal: "interni" | "firma"; to: string[]; resendId: string; dryRun: boolean }`,
  `SkipItem = { terminId: string; kanal: string; razlog: string }`,
  `ErrItem = { terminId: string; kanal: string; message: string }`

- [ ] **Step 1: Napiši padajuće testove**

Kreiraj `lib/reminders/runPostDue.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { runPostDue } from "./runPostDue"
import type { SendArgs, SendResult } from "@/lib/email/resend"

type PostDueRow = {
  termin_id: string; klijent_id: string; klijent_naziv: string; vrsta_naziv: string
  rok_dospijeca: string; datum_zakazan: string | null; ciklus_rok: string
  dana_do_ciklusa: number; lokacija_naziv: string | null
  treba_interni: boolean; treba_firma: boolean
}

const ROW: PostDueRow = {
  termin_id: "t1", klijent_id: "k1", klijent_naziv: "CARMEUSE", vrsta_naziv: "Obilazak",
  rok_dospijeca: "2026-07-13", datum_zakazan: null, ciklus_rok: "2026-07-13",
  dana_do_ciklusa: -6, lokacija_naziv: null, treba_interni: true, treba_firma: false,
}

function makeFake(opts: {
  rows?: PostDueRow[]
  claimIds?: (string | null)[]      // redom, po pozivu claim_post_due
  saljiKlijentima?: boolean
  korisnici?: { id: string; email: string; uloga: string; aktivan: boolean; prima_podsjetnike: boolean }[]
  kk?: { korisnik_id: string; klijent_id: string }[]
  klijenti?: { id: string; salji_podsjetnik_klijentu: boolean; podsjetnik_emails?: string[] }[]
  kontakti?: { klijent_id: string; email: string | null; podsjetnik_primalac: boolean }[]
  postavkeThrows?: boolean
}) {
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = []
  const claims = [...(opts.claimIds ?? ["c1", "c2", "c3", "c4"])]
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        if (opts.postavkeThrows) {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error("postavke nedostupne") } }) }) }
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { dana_prije: [30, 14, 7], salji_klijentima: opts.saljiKlijentima ?? false }, error: null }) }) }) }
      }
      if (table === "korisnici") return { select: async () => ({ data: opts.korisnici ?? [], error: null }) }
      if (table === "korisnik_klijent") return { select: async () => ({ data: opts.kk ?? [], error: null }) }
      if (table === "klijenti") return { select: async () => ({ data: opts.klijenti ?? [], error: null }) }
      if (table === "kontakt_osobe") return { select: async () => ({ data: opts.kontakti ?? [], error: null }) }
      if (table === "post_due_obavijesti") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: unknown) => { updates.push({ id, patch }); return { error: null } },
          }),
        }
      }
      throw new Error(`neočekivan from(${table})`)
    },
    async rpc(name: string) {
      if (name === "get_post_due_termine") return { data: opts.rows ?? [], error: null }
      if (name === "claim_post_due") return { data: claims.shift() ?? null, error: null }
      return { data: null, error: null }
    },
  }
  return { supabase: fake as unknown as SupabaseClient<Database>, updates }
}

const ADMIN = { id: "u1", email: "admin@x.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }
const okSend = async (_a: SendArgs): Promise<SendResult> => ({ id: "re_1", dryRun: false })

describe("runPostDue", () => {
  it("šalje interni mejl i označava red kao poslato", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [ADMIN] })
    const res = await runPostDue(supabase, { send: okSend, delayMs: 0 })
    expect(res.sent).toHaveLength(1)
    expect(res.sent[0]!.kanal).toBe("interni")
    expect(updates).toHaveLength(1)
    expect(updates[0]!.patch.stanje).toBe("poslato")
    expect(updates[0]!.patch.resend_id).toBe("re_1")
  })

  it("claim koji vrati null preskače kanal bez slanja", async () => {
    let poslato = 0
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [ADMIN], claimIds: [null] })
    const res = await runPostDue(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.sent).toHaveLength(0)
    expect(res.skipped).toHaveLength(1)
    expect(updates).toHaveLength(0)
  })

  it("kanal bez primalaca dobija preskoceno sa razlogom, bez slanja", async () => {
    let poslato = 0
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [] })
    const res = await runPostDue(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.skipped).toHaveLength(1)
    expect(updates[0]!.patch.stanje).toBe("preskoceno")
    expect(updates[0]!.patch.razlog).toBe("nema_primalaca")
  })

  it("pad slanja ostavlja red u u_toku i prijavljuje grešku", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [ADMIN] })
    const res = await runPostDue(supabase, {
      send: async () => { throw new Error("resend pao") },
      delayMs: 0,
    })
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.message).toContain("resend pao")
    expect(updates).toHaveLength(0)
  })

  it("greška na jednom kanalu ne sprječava drugi", async () => {
    const row = { ...ROW, treba_firma: true }
    const { supabase } = makeFake({
      rows: [row], korisnici: [ADMIN], saljiKlijentima: true,
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["firma@x.com"] }],
    })
    let poziv = 0
    const res = await runPostDue(supabase, {
      send: async () => { poziv++; if (poziv === 1) throw new Error("prvi pao"); return { id: "re_2", dryRun: false } },
      delayMs: 0,
    })
    expect(res.errors).toHaveLength(1)
    expect(res.sent).toHaveLength(1)
  })

  it("baca kad se postavke ne mogu pročitati, umjesto da upiše preskoceno", async () => {
    const { supabase } = makeFake({ rows: [ROW], postavkeThrows: true })
    await expect(runPostDue(supabase, { send: okSend, delayMs: 0 })).rejects.toThrow()
  })

  it("firmin mejl ide bez ICS priloga i sa BCC adresama", async () => {
    const row = { ...ROW, treba_interni: false, treba_firma: true }
    const { supabase } = makeFake({
      rows: [row], korisnici: [ADMIN], saljiKlijentima: true,
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["firma@x.com"] }],
    })
    let args: SendArgs | null = null
    await runPostDue(supabase, {
      send: async (a) => { args = a; return { id: "re_3", dryRun: false } },
      delayMs: 0,
    })
    expect(args!.attachments).toBeUndefined()
    expect(args!.bcc).toEqual(["firma@x.com"])
  })
})
```

- [ ] **Step 2: Pokreni testove da potvrdiš pad**

```bash
pnpm vitest run lib/reminders/runPostDue.test.ts
```

Očekivano: FAIL — modul `./runPostDue` ne postoji.

- [ ] **Step 3: Implementiraj `lib/reminders/runPostDue.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"
import { createTranslator } from "next-intl"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { posaljiIzabiljezi } from "@/lib/email/posaljiIzabiljezi"
import { buildTerminIcs } from "@/lib/email/ics"
import { reminderSubject, reminderHtml, rokIstekaoFirmaSubject, rokIstekaoFirmaHtml } from "@/lib/email/templates"
import { loadRecipientIndex, recipientsForKlijent, firmaRecipientsForKlijent } from "@/lib/reminders/recipients"
import { firmBrand } from "@/lib/email/firmBrand"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "email.podsjetnik" })

export type Kanal = "interni" | "firma"
export type SentItem = { terminId: string; kanal: Kanal; to: string[]; resendId: string; dryRun: boolean }
export type SkipItem = { terminId: string; kanal: Kanal; razlog: string }
export type ErrItem = { terminId: string; kanal: Kanal; message: string }
export type PostDueRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

/**
 * Post-due obavijesti: tačno jedna po ciklusu i kanalu.
 *
 * Redoslijed je claim-first (upiši → pošalji → označi ishod), jer postoje dva
 * schedulera (vercel.json crons i GH Actions na 0 * * * *) koji rutu pale skoro
 * istovremeno. Send-first bi značio da oba nađu prazan ledger i oba pošalju.
 * Pad slanja NE briše claim — red ostaje 'u_toku' i get_post_due_termine ga
 * ponovo otvori poslije 15 minuta.
 */
export async function runPostDue(
  supabase: SupabaseClient<Database>,
  deps: {
    send?: (a: SendArgs) => Promise<SendResult>
    batchSize?: number
    delayMs?: number
  } = {},
): Promise<PostDueRunResult> {
  const send = deps.send ?? sendEmail
  const brand = firmBrand()
  const fromAddr = env.EMAIL_FROM ?? "no-reply@tehpro"
  const batchSize = Math.max(1, deps.batchSize ?? (Number(env.REMINDER_BATCH_SIZE) || 2))
  const delayMs = deps.delayMs ?? (Number(env.REMINDER_BATCH_DELAY_MS) || 1100)

  const { data: due, error } = await supabase.rpc("get_post_due_termine")
  if (error) throw new Error(error.message)
  const rows = due ?? []
  if (rows.length === 0) return { sent: [], skipped: [], errors: [] }

  // Baca ako se postavke/primaoci ne mogu pročitati. Namjerno: tiho tretiranje
  // transientnog kvara kao "prekidač je isključen" trajno bi progutalo firmin kanal,
  // jer bi upisalo 'preskoceno' claim za tekući ciklus.
  const { index, base } = await loadRecipientIndex(supabase)

  const oznaci = async (claimId: string, patch: Record<string, unknown>): Promise<void> => {
    const { error: updErr } = await supabase.from("post_due_obavijesti").update(patch).eq("id", claimId)
    if (updErr) console.error("[post-due] označavanje ishoda nije uspjelo:", updErr.message)
  }

  const obradiKanal = async (r: (typeof rows)[number], kanal: Kanal): Promise<Outcome> => {
    const terminId = r.termin_id!
    const { data: claimId, error: claimErr } = await supabase.rpc("claim_post_due", {
      p_termin: terminId, p_ciklus: r.ciklus_rok!, p_kanal: kanal,
    })
    if (claimErr) return { kind: "err", terminId, kanal, message: claimErr.message }
    if (!claimId) return { kind: "skip", terminId, kanal, razlog: "claim drži neko drugi" }

    const primaoci = kanal === "interni"
      ? recipientsForKlijent(index, r.klijent_id!, base)
      : firmaRecipientsForKlijent(index, r.klijent_id!)
    if (primaoci.length === 0) {
      await oznaci(claimId, { stanje: "preskoceno", razlog: "nema_primalaca" })
      return { kind: "skip", terminId, kanal, razlog: "nema primalaca" }
    }

    // Ciklus dolazi iz datum_zakazan samo kad se razlikuje od roka; tada mejl mora
    // prikazati oba datuma, da se ne laže o roku.
    const zakazanoZa = r.datum_zakazan && r.datum_zakazan !== r.rok_dospijeca ? r.datum_zakazan : null

    const args: SendArgs = kanal === "interni"
      ? {
          to: primaoci,
          subject: reminderSubject({ vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv!, danaDoRoka: r.dana_do_ciklusa! }),
          html: reminderHtml({
            klijent: r.klijent_naziv!, vrsta: r.vrsta_naziv!, rok: r.rok_dospijeca!,
            danaDoRoka: r.dana_do_ciklusa!, lokacija: r.lokacija_naziv, zakazanoZa,
            terminId, klijentId: r.klijent_id!, baseUrl: env.NEXT_PUBLIC_APP_URL,
          }),
          attachments: [{
            filename: t("prilogNaziv"),
            content: Buffer.from(buildTerminIcs({
              vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv!, rok: r.rok_dospijeca!,
              terminId, lokacija: r.lokacija_naziv, baseUrl: env.NEXT_PUBLIC_APP_URL,
            }), "utf-8"),
          }],
        }
      : {
          to: [fromAddr],
          bcc: primaoci,
          subject: rokIstekaoFirmaSubject({ vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv! }),
          html: rokIstekaoFirmaHtml({
            klijent: r.klijent_naziv!, vrsta: r.vrsta_naziv!, rok: r.rok_dospijeca!,
            zakazanoZa, lokacija: r.lokacija_naziv, brand,
          }),
        }

    try {
      const res = await posaljiIzabiljezi(
        supabase,
        {
          ...args,
          tip: kanal === "interni" ? "podsjetnik_rok_istekao_interni" : "podsjetnik_rok_istekao_firma",
          terminId, klijentId: r.klijent_id,
        },
        send,
      )
      const svi = [...(args.to ?? []), ...(args.bcc ?? [])]
      if (!res.dryRun) {
        await oznaci(claimId, {
          stanje: "poslato", poslat_at: new Date().toISOString(), poslat_na: svi, resend_id: res.id,
        })
      }
      return { kind: "sent", terminId, kanal, to: svi, resendId: res.id, dryRun: res.dryRun }
    } catch (e) {
      // Claim se NE briše: red ostaje 'u_toku' i RPC ga otvori za 15 minuta.
      return { kind: "err", terminId, kanal, message: e instanceof Error ? e.message : String(e) }
    }
  }

  const zadaci: Array<() => Promise<Outcome>> = []
  for (const r of rows) {
    if (r.treba_interni) zadaci.push(() => obradiKanal(r, "interni"))
    if (r.treba_firma) zadaci.push(() => obradiKanal(r, "firma"))
  }

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
    if (o.kind === "sent") sent.push({ terminId: o.terminId, kanal: o.kanal, to: o.to, resendId: o.resendId, dryRun: o.dryRun })
    else if (o.kind === "skip") skipped.push({ terminId: o.terminId, kanal: o.kanal, razlog: o.razlog })
    else errors.push({ terminId: o.terminId, kanal: o.kanal, message: o.message })
  }
  return { sent, skipped, errors }
}
```

- [ ] **Step 4: Testovi moraju proći**

```bash
pnpm vitest run lib/reminders/runPostDue.test.ts
```

Očekivano: PASS, svih sedam.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add lib/reminders/runPostDue.ts lib/reminders/runPostDue.test.ts
git commit -m "feat(podsjetnici): runPostDue sa claim-first slanjem po ciklusu"
```

---

### Task 5: Uvezivanje — cron ruta, glasan pad bez ključa, ručno okidanje

**Files:**
- Modify: `app/api/cron/reminders/route.ts:12`, `:50-58`
- Modify: `scripts/send-reminders.ts`

**Interfaces:**
- Consumes: `runPostDue` (Task 4), postojeći `runReminders`, `drySend`, `env`
- Produces: cron odgovor dobija ključ `postDue` uz postojeći rezultat `runReminders`

- [ ] **Step 1: Podigni `maxDuration` i dodaj poziv `runPostDue`**

U `app/api/cron/reminders/route.ts` promijeni `:12`:

```ts
// Dvije throttlovane petlje (pre-due + post-due) dijele jedan zahtjev; 60s je bilo
// dimenzionisano samo za runReminders pri punom cap-u (~50s).
export const maxDuration = 120
```

Dodaj uvoz:

```ts
import { runPostDue } from "@/lib/reminders/runPostDue"
```

U `try` bloku zamijeni postojeći `const result = await runReminders(...)` i `return NextResponse.json(result)` sa:

```ts
    const posalji = dryRun ? { send: drySend } : {}
    const result = await runReminders(supabase, posalji)
    const postDue = await runPostDue(supabase, posalji)
    // Uspješan auto-run: obilježi da je danas (lokalni datum) slato → spriječi ponovni run istog dana.
    if (datumZaMarker) {
      await supabase.from("postavke").update({ zadnje_slanje_datum: datumZaMarker }).eq("id", 1)
    }
    return NextResponse.json({ ...result, postDue })
```

- [ ] **Step 2: Glasan pad kad nema Resend ključa u cron kontekstu**

U istoj ruti, odmah poslije provjere `isCronAuthorized`, dodaj:

```ts
  // Bez ključa sendEmail tiho pređe na drySend (resend.ts:25). U cron kontekstu to
  // znači da se tragovi ne upisuju, dedup prestane raditi, a po vraćanju ključa prvi
  // run pošalje sve odjednom. Bolje pasti glasno. Eksplicitni dryRun je izuzet.
  if (!dryRun && !env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY nije postavljen" }, { status: 500 })
  }
```

Ovo mora doći **poslije** parsiranja `dryRun` iz tijela zahtjeva.

- [ ] **Step 3: Dodaj post-due u ručnu skriptu**

Prepiši `scripts/send-reminders.ts`:

```ts
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { runPostDue } from "@/lib/reminders/runPostDue"
import { drySend } from "@/lib/email/resend"

const DRY = process.argv.includes("--dry")

async function main() {
  const supabase = createAdminSupabaseClient()
  const posalji = DRY ? { send: drySend } : {}
  const result = await runReminders(supabase, posalji)
  const postDue = await runPostDue(supabase, posalji)
  console.log(JSON.stringify({ preDue: result, postDue }, null, 2))
  console.log(
    `\n✅ Pre-due — poslato: ${result.sent.length} | preskočeno: ${result.skipped.length} | greške: ${result.errors.length}` +
    `\n✅ Post-due — poslato: ${postDue.sent.length} | preskočeno: ${postDue.skipped.length} | greške: ${postDue.errors.length}`,
  )
}

main().catch((err) => {
  console.error("❌ send-reminders:", err)
  process.exit(1)
})
```

- [ ] **Step 4: Provjeri ručno, u dry režimu, protiv lokalnog DB-a**

```bash
pnpm reminders -- --dry
```

Očekivano: JSON sa oba ključa, bez izuzetka. Na praznom lokalnom DB-u oba dijela su nule.

- [ ] **Step 5: Puni test suite**

```bash
pnpm typecheck && pnpm lint && pnpm test:unit
```

Očekivano: sve zeleno.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/reminders/route.ts scripts/send-reminders.ts
git commit -m "feat(podsjetnici): uveži runPostDue u cron rutu i ručnu skriptu"
```

---

### Task 6: Puštanje na cloud i verifikacija

Ovaj task **izvršava korisnik**, ne agent: primjena migracija na cloud i deploy su radnje sa produkcijskim posljedicama. Agent priprema komande i provjere.

**Files:**
- Nema izmjena koda; koriste se `scripts/apply-cloud-migration.ts` i Vercel deploy preko merge-a.

- [ ] **Step 1: E2E prije puštanja**

```bash
pnpm test:e2e
```

Očekivano: prolazi kao i prije ovog PR-a. E2E ide protiv cloud DEMO baze; ako padne test koji nije vezan za podsjetnike, uporedi sa stanjem na `main` prije nego ga pripišeš ovom PR-u.

- [ ] **Step 2: Primijeni migracije na DEMO, redom**

`DATABASE_URL_DEMO` iz `.env.development.local`, ref-guard je u skripti:

```bash
pnpm db:apply-cloud supabase/migrations/20260720119000_mejl_tip_prosirenje.sql
pnpm db:apply-cloud supabase/migrations/20260720120000_post_due_obavijesti.sql
pnpm db:apply-cloud supabase/migrations/20260720121000_get_due_bez_post_due.sql
pnpm db:apply-cloud supabase/migrations/20260720122000_get_post_due_termine.sql
pnpm db:apply-cloud supabase/migrations/20260720123000_claim_post_due.sql
```

Enum migracija ide **prva i sama** — nova vrijednost ne smije biti korištena u istoj transakciji u kojoj je dodata.

- [ ] **Step 3: Isto na PROD (lockstep)**

Isti redoslijed, protiv PROD ref-a `fqtqkehjidkzeasiegnq`. Prije svake komande provjeri da ciljaš pravi projekat.

- [ ] **Step 4: Provjeri backfill na PROD-u**

Read-only upit:

```sql
select termin_id, ciklus_rok, kanal, stanje, razlog from post_due_obavijesti order by ciklus_rok;
```

Očekivano: pet redova sa `razlog = 'backfill_migracija'` — CARMEUSE `ciklus_rok = 2026-07-15` (ne 07-13), WAIKIKI `2026-06-27`, NEW YORKER `2026-06-08`, po dva kanala osim NEW YORKER-a koji ima samo `interni`.

- [ ] **Step 5: Provjeri da RPC vraća samo NEW YORKER-ov firmin kanal**

```sql
select termin_id, ciklus_rok, treba_interni, treba_firma from get_post_due_termine();
```

Očekivano: jedan red — NEW YORKER, `treba_interni = false`, `treba_firma = true`. To je jedini otvoreni kanal, i on nema primalaca pa će prvi run upisati `preskoceno` bez slanja.

- [ ] **Step 6: Merge i deploy**

```bash
git push -u origin fix/post-due-po-ciklusu
gh pr create --title "fix(podsjetnici): post-due obavijest po ciklusu umjesto dnevne" --body "$(cat <<'EOF'
Post-due grana je slala jedan mejl po terminu DNEVNO, bez granice: dedup ključ
`dana_prije = rok - current_date` mijenja se svaki dan, pa unique indeks nikad ne
pogodi duplikat. Na PROD-u je to bilo pet mejlova dnevno za tri termina, uključujući
dnevnu opomenu kontaktu klijenta.

Post-due put se izmješta u vlastiti ledger `post_due_obavijesti` i RPC
`get_post_due_termine()`, ključan po CIKLUSU = `coalesce(datum_zakazan, rok_dospijeca)`.
Termin dobija tačno jednu obavijest po ciklusu i kanalu. Slanje ide claim-first
(`claim_post_due()` → slanje → označavanje ishoda), jer dva schedulera pale rutu
skoro istovremeno. Firmin kanal dobija vlastiti šablon koji poziva na dogovor.

Pre-due put i tabela `podsjetnici` su netaknuti.

Dizajn: docs/superpowers/specs/2026-07-19-digest-isteklih-podsjetnika-design.md
Plan: docs/superpowers/plans/2026-07-20-post-due-po-ciklusu.md
Digest je zaseban PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Merge u `main` automatski deploya na tri Vercel projekta.

- [ ] **Step 7: Verifikacija prvog run-a na PROD-u**

Sljedeći dan poslije 10:00 po Beču provjeri:

```sql
select tip, subject, created_at from mejl_log where created_at > current_date order by created_at desc;
select termin_id, kanal, stanje, razlog from post_due_obavijesti where razlog is not null;
```

Očekivano: **nijedan** post-due mejl u `mejl_log`; NEW YORKER-ov firmin red je prešao u `stanje = 'preskoceno'`, `razlog = 'nema_primalaca'`.

- [ ] **Step 8: Kontrolna provjera poslije prvog pomjeranja roka**

Kad se nekom zakašnjelom terminu pomjeri rok pa on opet istekne, provjeri da je stigla **tačno jedna** obavijest po kanalu i da u `post_due_obavijesti` postoji novi red sa novim `ciklus_rok`. Ovo je scenario koji je oborio dvije ranije verzije dizajna.

---

## Šta ovaj PR namjerno ne radi

- **Digest** — zaseban PR i zaseban plan (`digest_slanja`, `get_istekli_termini`, `claim_digest`, `runDigest`, ruta `/api/cron/digest`, drugi cron unos, dva koraka u GH workflow-u).
- **`termini_view`** ostaje nepromijenjen; skup termina u alarmu je namjerno podskup onoga što Plan aktivnosti pokazuje kao `KASNI`.
- **Retencija** za `post_due_obavijesti` — na trenutnoj skali nepotrebna.
- **`trebaSlatiSada`** ostaje read-then-write bez atomskog claim-a za pre-due put — postojeće ponašanje, izvan opsega.
