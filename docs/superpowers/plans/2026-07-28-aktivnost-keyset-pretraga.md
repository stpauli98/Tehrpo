# Aktivnost: keyset listanje + indeksirana pretraga — plan implementacije

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/aktivnost` se učitava za desetine milisekundi umjesto da pukne na `statement_timeout`, uz punu istoriju, listanje „Učitaj još" i pretragu koja koristi indeks.

**Architecture:** Keyset paginacija po `(vrijeme desc, id desc)` umjesto `offset` + `count(*) over ()`. Pretraga ide kroz GIN trigram indeks nad generisanom kolonom `audit_log.pretraga_tekst`. Join na `korisnici`/`klijenti` se radi tek nad dohvaćenom porcijom od 50 redova, a ne nad cijelim logom. RPC je `SECURITY DEFINER` s `je_admin()` guardom, jer RLS sprečava planer da uopšte upotrijebi trigram indeks.

**Tech Stack:** PostgreSQL 15 (Supabase), `pg_trgm`, plpgsql + dinamički SQL, Next.js 16 App Router (webpack), TypeScript, next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-28-aktivnost-keyset-pretraga-design.md`

## Global Constraints

- Paket menadžer je **`pnpm`**, nikad `npm`/`yarn`.
- `next dev` MORA ići s `--webpack` (`pnpm dev` to već radi). Turbopack puca zbog razmaka u putanji projekta.
- Domenski jezik je bosanski/srpski (latinica): imena tabela, kolona, ruta, identifikatora i UI stringova.
- Zabranjeni Tailwind breakpointi `sm:` i `md:` (eslint `no-restricted-syntax`). Koristi `lg:`/`xl:`/`2xl:` ili bez breakpointa.
- `no-await-in-loop: error` svuda osim u `scripts/`.
- next-intl tipizira namespace/ključ prema literal uniji iz JSON-a: **svaki novi ključ mora ući u sva tri kataloga** `messages/{sr,en,de}.json` u istoj izmjeni koja ga koristi, inače je `tsc` greška. Za `sr` ne koristiti ICU plural kategoriju `one`.
- Nikad `createAdminSupabaseClient()` u `app/` ili `components/` putanji — samo `createServerSupabaseClient()`.
- `db/types.ts` je auto-generisan; nikad ručno mijenjati.
- Cloud migracije pušta **korisnik**, ne agent. Migracije idu jedna po jedna: `pnpm db:apply-cloud --demo <fajl>`, pa `POTVRDI_PROD=da pnpm db:apply-cloud --prod <fajl>`.
- DEMO ref je `mtwwotmwrasozmcgqwhc`, PROD ref je `fqtqkehjidkzeasiegnq`. Lokalni razvoj i E2E idu na **DEMO**.
- `pg_trgm` opclass je u šemi `public` → `public.gin_trgm_ops`. **Ne** `extensions.gin_trgm_ops` — to obara migraciju.
- Definer higijena obavezna: `set search_path = public`, pa `revoke execute … from public`, pa `grant execute … to authenticated`.
- Radna grana: `perf/aktivnost-keyset-pretraga`, worktree `.claude/worktrees/aktivnost-perf`.

## Struktura fajlova

| Fajl | Odgovornost |
|---|---|
| `supabase/migrations/20260728120000_audit_pretraga_kolone.sql` | *nov* — generisane kolone `pretraga_tekst` i `klijent_ref` + tri indeksa |
| `supabase/migrations/20260728121000_get_aktivnost_strana.sql` | *nov* — nova RPC, brisanje stare RPC i `aktivnost_view` |
| `scripts/provjeri-migraciju.ts` | *nov* — pusti navedene migracije u transakciji na DEMO, izmjeri, pa `rollback`; dokazuje ispravnost bez trajne izmjene |
| `lib/aktivnost/kursor.ts` | *nov* — čiste funkcije za kursor (gradnja + parsiranje). Bez ijednog importa iz `lib/supabase` |
| `lib/aktivnost/kursor.test.ts` | *nov* — unit testovi za kursor |
| `lib/aktivnost/filteri.ts` | *nov* — **jedan** parser filtera koji koriste i stranica i API ruta (sprečava drift koji CLAUDE.md već navodi kao problem kod `plan-aktivnosti`) |
| `lib/aktivnost/filteri.test.ts` | *nov* — unit testovi za parser |
| `lib/queries/aktivnost.ts` | *prepravka* — `dohvatiAktivnostStranu` s kursorom i `imaJos`; bez `ukupno` |
| `app/api/aktivnost/route.ts` | *nov* — GET za „Učitaj još"; admin gate |
| `app/(dashboard)/aktivnost/page.tsx` | *prepravka* — SSR prve porcije, bez `Pagination`, prosljeđuje listu i korisnike |
| `components/domain/AktivnostLista.tsx` | *nova* client komponenta — akumulira porcije, dugme „Učitaj još" |
| `components/domain/AktivnostTabela.tsx` | *prepravka* — server → client komponenta (`useTranslations`) |
| `components/domain/AktivnostFilteri.tsx` | *prepravka* — dodaje se select „Korisnik" |
| `messages/{sr,en,de}.json` | *prepravka* — novi ključevi, briše se `aktivnost.ukupno` |
| `tests/e2e/30-aktivnost.spec.ts` | *prepravka* — testovi listanja, pretrage, filtera i sigurnosnog guarda |

`components/domain/Pagination.tsx` se **ne** dira — koriste je drugi ekrani.

---

## Task 1: Migracija 1 — generisane kolone i indeksi

**Files:**
- Create: `supabase/migrations/20260728120000_audit_pretraga_kolone.sql`
- Create: `scripts/provjeri-migraciju.ts`

**Interfaces:**
- Consumes: ništa
- Produces: kolone `audit_log.pretraga_tekst text` i `audit_log.klijent_ref uuid`; indeksi `idx_audit_pretraga`, `idx_audit_klijent_ref`, `idx_audit_vrijeme_id`. Task 2 čita sve troje.

- [ ] **Step 1: Napiši skriptu za provjeru migracija**

Skripta pušta navedene `.sql` fajlove u jednoj transakciji na DEMO i **uvijek** radi `rollback` — baza ostaje netaknuta. Postoji da bi se migracija dokazala prije nego je korisnik pusti na cloud.

Create `scripts/provjeri-migraciju.ts`:

```ts
// Pusti navedene migracije u JEDNOJ transakciji na cloud DEMO, pa uvijek rollback.
// Baza ostaje netaknuta — ovo je provjera sintakse i ponašanja, ne apply.
// Upotreba: pnpm exec tsx --env-file=.env.development.local scripts/provjeri-migraciju.ts <fajl.sql> [...]
import { readFileSync } from "node:fs"
import { Client } from "pg"

const DEMO_REF = "mtwwotmwrasozmcgqwhc"

async function main() {
  const fajlovi = process.argv.slice(2)
  if (fajlovi.length === 0) {
    throw new Error("Navedi bar jednu .sql migraciju")
  }
  const url = process.env.DATABASE_URL_DEMO
  if (!url) throw new Error("DATABASE_URL_DEMO nije postavljen")
  if (!url.includes(DEMO_REF)) throw new Error(`Connection string nije DEMO (${DEMO_REF}) — prekid`)

  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    await c.query("begin")
    for (const f of fajlovi) {
      const sql = readFileSync(f, "utf8")
      const t = Date.now()
      await c.query(sql)
      console.log(`OK  ${f}  (${Date.now() - t} ms)`)
    }
    console.log("\nSve migracije prošle. Radim rollback — baza je netaknuta.")
  } finally {
    await c.query("rollback").catch(() => {})
    await c.end()
  }
}

main().catch((e) => {
  console.error("PAD:", e.message)
  process.exit(1)
})
```

- [ ] **Step 2: Pokreni skriptu bez migracije da potvrdiš da radi**

Run:
```bash
cd .claude/worktrees/aktivnost-perf
pnpm exec tsx --env-file=.env.development.local scripts/provjeri-migraciju.ts
```
Expected: `PAD: Navedi bar jednu .sql migraciju`, izlazni kod 1.

- [ ] **Step 3: Napiši migraciju**

Create `supabase/migrations/20260728120000_audit_pretraga_kolone.sql`:

```sql
-- Aktivnost je pucala na statement_timeout (9,5 s > 8 s). Uz keyset paginaciju
-- (20260728121000), ovo je drugi dio popravke: pretraga po tekstu dobija indeks.
--
-- ZAŠTO GENERISANE KOLONE, a ne izraz u indeksu:
-- `pretraga_tekst` se čita i u SELECT-u nove RPC, ne samo u WHERE — stored kolona
-- se izračuna jednom pri upisu umjesto pri svakom čitanju. `klijent_ref` uz to
-- zamjenjuje `tekst_u_uuid(case …)` izraz iz obrisanog aktivnost_view-a, pa join
-- na `klijenti` ide preko običnog uuid = uuid uslova i može koristiti btree.
--
-- OPCLASS ŠEMA: pg_trgm je instaliran u `public` (ne `extensions`) i na DEMO i na
-- PROD. `extensions.gin_trgm_ops` NE postoji i obara migraciju.
--
-- LOCK: dodavanje STORED generisane kolone prepisuje tabelu uz ACCESS EXCLUSIVE.
-- Na ~5.500 redova / 2,5 MB to je ispod sekunde. Provjeriti trajanje na DEMO-u
-- prije PROD apply-a.

create extension if not exists pg_trgm;

alter table audit_log
  add column if not exists pretraga_tekst text
  generated always as (
    coalesce(entitet, '')      || ' ' ||
    coalesce(entitet_id, '')   || ' ' ||
    coalesce(akcija, '')       || ' ' ||
    coalesce(staro::text, '')  || ' ' ||
    coalesce(novo::text, '')   || ' ' ||
    coalesce(detalji::text, '')
  ) stored;

alter table audit_log
  add column if not exists klijent_ref uuid
  generated always as (
    tekst_u_uuid(
      case when entitet = 'klijenti'
           then coalesce(novo ->> 'id', staro ->> 'id', entitet_id)
           else coalesce(novo ->> 'klijent_id', staro ->> 'klijent_id')
      end)
  ) stored;

create index if not exists idx_audit_pretraga
  on audit_log using gin (pretraga_tekst public.gin_trgm_ops);

create index if not exists idx_audit_klijent_ref
  on audit_log (klijent_ref);

-- Keyset listanje: (vrijeme desc, id desc). Postojeći idx_audit_vrijeme ostaje —
-- koristi ga Plan aktivnosti; ovaj samo dodaje tie-break po id.
create index if not exists idx_audit_vrijeme_id
  on audit_log (vrijeme desc, id desc);

analyze audit_log;
```

- [ ] **Step 4: Provjeri migraciju na DEMO-u (transakcija + rollback)**

Run:
```bash
cd .claude/worktrees/aktivnost-perf
pnpm exec tsx --env-file=.env.development.local scripts/provjeri-migraciju.ts \
  supabase/migrations/20260728120000_audit_pretraga_kolone.sql
```
Expected: `OK  supabase/migrations/20260728120000_audit_pretraga_kolone.sql  (<vrijeme> ms)` pa `Sve migracije prošle. Radim rollback — baza je netaknuta.` Ako se pojavi `operator class "extensions.gin_trgm_ops" does not exist`, opclass šema je pogrešna — ispravi na `public.gin_trgm_ops`.

Zabilježi prijavljeno trajanje — to je procjena ACCESS EXCLUSIVE locka za PROD.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728120000_audit_pretraga_kolone.sql scripts/provjeri-migraciju.ts
git commit -m "feat(db): pretraga_tekst i klijent_ref kolone + trigram indeks nad audit_log"
```

---

## Task 2: Migracija 2 — RPC `get_aktivnost_strana`

**Files:**
- Create: `supabase/migrations/20260728121000_get_aktivnost_strana.sql`

**Interfaces:**
- Consumes: kolone i indeksi iz Taska 1.
- Produces: `get_aktivnost_strana(p_od timestamptz, p_do timestamptz, p_korisnik uuid, p_akcija text, p_entitet text, p_pretraga text, p_prije_vrijeme timestamptz, p_prije_id bigint, p_limit int)` koja vraća `(id bigint, vrijeme timestamptz, korisnik_id uuid, korisnik_ime text, korisnik_email text, akcija text, entitet text, entitet_id text, staro jsonb, novo jsonb, detalji jsonb, cilj_ime text, cilj_klijent text)`. **Nema kolone `ukupno`.** Task 4 je zove.

- [ ] **Step 1: Napiši migraciju**

Create `supabase/migrations/20260728121000_get_aktivnost_strana.sql`:

```sql
-- Zamjena za get_aktivnost. Tri promjene, svaka rješava jedan uzrok timeouta:
--
-- 1) plpgsql + dinamički SQL s literalima (%L). Stara funkcija je bila `language sql`,
--    pa je planer njeno tijelo planirao samo po TIPOVIMA parametara. Pet uslova
--    oblika (p_x is null or kolona = p_x) srušili su procjenu na rows=1, planer je
--    izabrao Nested Loop i skenirao korisnici/klijenti 5.440 puta uz ~70.000 poziva
--    ima_pristup_klijentu(). 9.434 ms. S literalima planer vidi stvarne vrijednosti.
--    %L radi ispravno kvotovanje i NULL renderuje kao golo NULL — nema injekcije.
--
-- 2) Keyset umjesto offset + count(*) over (). count(*) over () je prolazio kroz
--    CIJELI filtrirani skup pri svakoj stranici — O(n) zauvijek. Sada se dohvata
--    samo porcija, a join na korisnici/klijenti se radi TEK nad njom.
--
-- 3) SECURITY DEFINER s eksplicitnim je_admin() guardom. Pod RLS-om Postgres mora
--    izvršiti sigurnosni predikat prije korisničkih uslova, a ILIKE (~~*) nije
--    leakproof — pa ga ne smije spustiti u indeksni uslov i GIN trigram indeks se
--    UOPŠTE ne koristi (113 ms Seq Scan vs 0,07 ms Bitmap Index Scan, izmjereno).
--    RLS na audit_log ostaje uključen, policy audit_sel = je_admin() ostaje, pa
--    direktan select iz PostgREST-a i dalje ne prolazi za ne-admina. Garancija se
--    ne uklanja nego premješta: iz predikata koji se izvrši 5.440 puta u jednu
--    provjeru na ulazu. Definer higijena (search_path + revoke) po presedanu
--    get_aktivni_korisnici (20260726122000).

create or replace function get_aktivnost_strana(
  p_od            timestamptz default null,
  p_do            timestamptz default null,
  p_korisnik      uuid        default null,
  p_akcija        text        default null,
  p_entitet       text        default null,
  p_pretraga      text        default null,
  p_prije_vrijeme timestamptz default null,
  p_prije_id      bigint      default null,
  p_limit         int         default 50
)
returns table (
  id             bigint,
  vrijeme        timestamptz,
  korisnik_id    uuid,
  korisnik_ime   text,
  korisnik_email text,
  akcija         text,
  entitet        text,
  entitet_id     text,
  staro          jsonb,
  novo           jsonb,
  detalji        jsonb,
  cilj_ime       text,
  cilj_klijent   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Gornja granica je zaštita: pozivalac ne smije natjerati funkciju na neograničen skup.
  v_limit  int    := least(greatest(coalesce(p_limit, 50), 1), 200);
  -- Prazna pretraga = nema filtera (UI šalje "" kad korisnik obriše polje).
  v_q      text   := nullif(btrim(coalesce(p_pretraga, '')), '');
  -- Kursor bez id-a bi dao (vrijeme, NULL) → NULL poređenje → nula redova.
  -- Najveći bigint znači „od tog trenutka, svi id-evi".
  v_kursor bigint := coalesce(p_prije_id, 9223372036854775807);
begin
  if not je_admin() then
    raise exception 'nije dozvoljeno' using errcode = '42501';
  end if;

  return query execute format($f$
    with porcija as (
      select a.*
      from audit_log a
      where (%1$L::timestamptz is null or a.vrijeme >= %1$L::timestamptz)
        and (%2$L::timestamptz is null or a.vrijeme <  %2$L::timestamptz)
        and (%3$L::uuid is null or a.korisnik_id = %3$L::uuid)
        and (%4$L::text is null or a.akcija  = %4$L::text)
        and (%5$L::text is null or a.entitet = %5$L::text)
        and (%6$L::text is null or (
                 a.pretraga_tekst ilike '%%' || %6$L::text || '%%'
              or a.korisnik_id in (select k.id from korisnici k
                                   where k.ime   ilike '%%' || %6$L::text || '%%'
                                      or k.email ilike '%%' || %6$L::text || '%%')
              or a.klijent_ref in (select kl.id from klijenti kl
                                   where kl.naziv ilike '%%' || %6$L::text || '%%')))
        and (%7$L::timestamptz is null
             or (a.vrijeme, a.id) < (%7$L::timestamptz, %8$L::bigint))
      order by a.vrijeme desc, a.id desc
      limit %9$s
    )
    select p.id, p.vrijeme, p.korisnik_id, k.ime, k.email,
           p.akcija, p.entitet, p.entitet_id, p.staro, p.novo, p.detalji,
           coalesce(p.novo ->> 'naziv', p.staro ->> 'naziv',
                    p.novo ->> 'ime',   p.staro ->> 'ime') as cilj_ime,
           kl.naziv as cilj_klijent
    from porcija p
    left join korisnici k  on k.id  = p.korisnik_id
    left join klijenti  kl on kl.id = p.klijent_ref
    order by p.vrijeme desc, p.id desc
  $f$, p_od, p_do, p_korisnik, p_akcija, p_entitet, v_q, p_prije_vrijeme, v_kursor, v_limit);
end;
$$;

-- Definer funkcija koja probija RLS → nikad anon; samo prijavljeni korisnici.
revoke execute on function get_aktivnost_strana(
  timestamptz, timestamptz, uuid, text, text, text, timestamptz, bigint, int) from public;
grant execute on function get_aktivnost_strana(
  timestamptz, timestamptz, uuid, text, text, text, timestamptz, bigint, int) to authenticated;

-- Stara funkcija i view koji joj je služio više nemaju pozivaoca (provjereno:
-- nema pojave u lib/, app/, components/, tests/, scripts/). Funkcija ide prva —
-- zavisi od view-a.
drop function if exists get_aktivnost(timestamptz, timestamptz, uuid, text, text, text, int, int);
drop view if exists aktivnost_view;
```

- [ ] **Step 2: Provjeri obje migracije zajedno na DEMO-u**

Run:
```bash
cd .claude/worktrees/aktivnost-perf
pnpm exec tsx --env-file=.env.development.local scripts/provjeri-migraciju.ts \
  supabase/migrations/20260728120000_audit_pretraga_kolone.sql \
  supabase/migrations/20260728121000_get_aktivnost_strana.sql
```
Expected: obje linije `OK`, pa `Sve migracije prošle. Radim rollback — baza je netaknuta.`

- [ ] **Step 3: Napiši mjerenje ponašanja nove RPC**

Create `scripts/mjeri-aktivnost.ts`:

```ts
// Pusti obje migracije u transakciji na DEMO, izmjeri novu RPC kao pravi admin
// (role=authenticated + JWT claims, isti put kao aplikacija), pa rollback.
// Dokazuje i brzinu i sigurnosni guard prije nego što išta ode na cloud.
import { readFileSync } from "node:fs"
import { Client } from "pg"

const DEMO_REF = "mtwwotmwrasozmcgqwhc"
const MIGRACIJE = [
  "supabase/migrations/20260728120000_audit_pretraga_kolone.sql",
  "supabase/migrations/20260728121000_get_aktivnost_strana.sql",
]

async function main() {
  const url = process.env.DATABASE_URL_DEMO
  if (!url) throw new Error("DATABASE_URL_DEMO nije postavljen")
  if (!url.includes(DEMO_REF)) throw new Error(`Nije DEMO (${DEMO_REF}) — prekid`)

  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    await c.query("begin")
    for (const f of MIGRACIJE) await c.query(readFileSync(f, "utf8"))
    console.log("migracije primijenjene (u transakciji)")

    const admin = await c.query(`select id from korisnici where uloga = 'admin' and aktivan limit 1`)
    const operater = await c.query(`select id from korisnici where uloga = 'operater' and aktivan limit 1`)

    const kaoKorisnik = async (uid: string) => {
      await c.query(`set local role authenticated`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: "authenticated" })])
      await c.query(`set local statement_timeout = '30s'`)
    }
    const kaoPostgres = async () => { await c.query(`reset role`) }

    await kaoKorisnik(admin.rows[0].id)

    // MJERI SERVERSKO VRIJEME, NE WALL-CLOCK. Baza je u eu-west-1, a mrežni
    // round-trip s ove mašine je 70–175 ms sam po sebi (izmjereno golim `select 1`),
    // pa bi wall-clock mjerio internet vezu umjesto upita. `Execution Time` iz
    // EXPLAIN ANALYZE je serverski i nezavisan od mreže — to je jedini brojač
    // koji ovdje išta znači.
    const mjeri = async (naziv: string, sql: string, params: unknown[] = []) => {
      const wall = Date.now()
      const plan = await c.query(`explain (analyze, buffers) ${sql}`, params)
      const tekst = plan.rows.map((x) => x["QUERY PLAN"]).join("\n")
      const ms = Number(tekst.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? NaN)
      if (Number.isNaN(ms)) throw new Error(`Ne mogu pročitati Execution Time za: ${naziv}`)
      console.log(`${naziv.padEnd(34)} server=${ms.toFixed(1).padStart(8)} ms  (wall=${Date.now() - wall} ms)`)
      return { ms, r: await c.query(sql, params) }
    }

    const PRAG_MS = 50
    const mjerenja: { naziv: string; ms: number }[] = []

    const prva = await mjeri("prva porcija",
      `select * from get_aktivnost_strana(null,null,null,null,null,null,null,null,51)`)
    mjerenja.push({ naziv: "prva porcija", ms: prva.ms })
    const zadnji = prva.r.rows[prva.r.rows.length - 1]

    const druga = await mjeri("druga porcija (keyset)",
      `select * from get_aktivnost_strana(null,null,null,null,null,null,$1,$2,51)`,
      [zadnji.vrijeme, zadnji.id])
    mjerenja.push({ naziv: "druga porcija (keyset)", ms: druga.ms })

    const pretraga = await mjeri("pretraga 'termin'",
      `select * from get_aktivnost_strana(null,null,null,null,null,'termin',null,null,51)`)
    mjerenja.push({ naziv: "pretraga 'termin'", ms: pretraga.ms })

    const filter = await mjeri("filter akcija=UPDATE",
      `select * from get_aktivnost_strana(null,null,null,'UPDATE',null,null,null,null,51)`)
    mjerenja.push({ naziv: "filter akcija=UPDATE", ms: filter.ms })

    const preko = mjerenja.filter((m) => m.ms > PRAG_MS)
    if (preko.length > 0) {
      console.log(`\nPRAG PROBIJEN (${PRAG_MS} ms serverski): ` +
        preko.map((m) => `${m.naziv}=${m.ms.toFixed(1)} ms`).join(", "))
      process.exitCode = 1
    } else {
      console.log(`\nSva mjerenja ispod ${PRAG_MS} ms serverski. Stara get_aktivnost je na istoj bazi trajala 9.434 ms.`)
    }

    // Guard: operater ne smije dobiti nijedan red.
    await kaoPostgres()
    await c.query("savepoint s_op")
    await kaoKorisnik(operater.rows[0].id)
    try {
      await c.query(`select * from get_aktivnost_strana(null,null,null,null,null,null,null,null,51)`)
      console.log("GUARD PAO: operater je dobio redove!")
      process.exitCode = 1
    } catch (e) {
      const err = e as { code?: string; message: string }
      console.log(`guard OK: operater odbijen (${err.code ?? "?"}) ${err.message}`)
    }
    await c.query("rollback to savepoint s_op")
  } finally {
    await c.query("rollback").catch(() => {})
    await c.end()
  }
}

main().catch((e) => { console.error("PAD:", e.message); process.exit(1) })
```

- [ ] **Step 4: Pokreni mjerenje**

Run:
```bash
cd .claude/worktrees/aktivnost-perf
pnpm exec tsx --env-file=.env.development.local scripts/mjeri-aktivnost.ts
```
Expected:
- sve četiri linije `server=… ms` **ispod 50 ms** — to je serversko `Execution Time` iz `EXPLAIN ANALYZE`, ne wall-clock
- `Sva mjerenja ispod 50 ms serverski.`
- `guard OK: operater odbijen (42501) nije dozvoljeno`
- izlazni kod 0

**Wall-clock se NE gleda i nije prag.** Baza je u eu-west-1; goli `select 1` s ove mašine traje 70–175 ms, pa wall-clock mjeri internet vezu, ne upit. Očekuj `wall=` vrijednosti od 100–300 ms uz `server=` od nekoliko milisekundi — to je normalno, nije problem.

Ako neko serversko mjerenje pređe 50 ms, skripta izađe s kodom 1 — ne nastavljaj, vrati se na SQL. Poređenja radi, stara `get_aktivnost` je na istoj bazi imala `Execution Time: 9434 ms`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728121000_get_aktivnost_strana.sql scripts/mjeri-aktivnost.ts
git commit -m "feat(db): get_aktivnost_strana — keyset porcija, indeksirana pretraga, admin guard"
```

---

## KONTROLNA TAČKA A — korisnik pušta migracije na DEMO

**Agent ovo NE radi. Zaustavi se i traži od korisnika da pokrene:**

```bash
cd "/Users/nmil/Desktop/Ai Forward/TEHPRO-Dokumenit/tehpro-mvp/.claude/worktrees/aktivnost-perf"
pnpm db:apply-cloud --demo supabase/migrations/20260728120000_audit_pretraga_kolone.sql
pnpm db:apply-cloud --demo supabase/migrations/20260728121000_get_aktivnost_strana.sql
```

Bez ovoga E2E ne može proći — E2E ide na DEMO, a nova RPC tamo još ne postoji.

Poslije apply-a treba regenerisati `db/types.ts`. `pnpm db:types` čita **lokalni** stack, ne cloud, pa ide:

```bash
supabase start && pnpm db:reset && pnpm db:types
```

`db/types.ts` je auto-generisan i nikad se ne mijenja ručno. Ako lokalni stack nije dostupan, ostavi tipove kakvi jesu i zabilježi u PR opisu da `db/types.ts` čeka regeneraciju — `rpc("get_aktivnost_strana")` će do tada biti `tsc` greška, što je vidljivo i namjerno, za razliku od tihog ručnog krpljenja generisanog fajla.

PROD apply ide tek na KONTROLNOJ TAČKI B.

---

## Task 3: Čiste funkcije — kursor i parser filtera

**Files:**
- Create: `lib/aktivnost/kursor.ts`
- Create: `lib/aktivnost/kursor.test.ts`
- Create: `lib/aktivnost/filteri.ts`
- Create: `lib/aktivnost/filteri.test.ts`

**Interfaces:**
- Consumes: `isoDatum` logika iz postojećeg `page.tsx` (seli se ovdje), `utcGranicaSarajevskogDana` i `dodajDan` iz `lib/date`.
- Produces:
  - `type AktivnostKursor = { vrijeme: string; id: number }`
  - `kursorOd(redovi: { vrijeme: string; id: number }[]): AktivnostKursor | null`
  - `parsirajKursor(vrijeme: string | undefined, id: string | undefined): AktivnostKursor | null`
  - `type AktivnostFilteriUlaz = { od?: string; do?: string; korisnik?: string; akcija?: string; pretraga?: string; kursor: AktivnostKursor | null }`
  - `parsirajAktivnostFiltere(uzmi: (k: string) => string | undefined): AktivnostFilteriUlaz`
  - `kljucFiltera(f: AktivnostFilteriUlaz): string`
  - `upitFiltera(f: AktivnostFilteriUlaz): string`

  Taskovi 4, 5, 6 i 7 koriste sve navedeno.

- [ ] **Step 1: Napiši padajuće testove za kursor**

Create `lib/aktivnost/kursor.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { kursorOd, parsirajKursor } from "./kursor"

describe("kursorOd", () => {
  it("vraća null za praznu listu", () => {
    expect(kursorOd([])).toBeNull()
  })

  it("uzima posljednji red, ne prvi", () => {
    expect(kursorOd([
      { vrijeme: "2026-07-28T10:00:00Z", id: 900 },
      { vrijeme: "2026-07-28T09:00:00Z", id: 800 },
    ])).toEqual({ vrijeme: "2026-07-28T09:00:00Z", id: 800 })
  })
})

describe("parsirajKursor", () => {
  it("vraća null kad nedostaje bilo koji dio", () => {
    expect(parsirajKursor(undefined, "5")).toBeNull()
    expect(parsirajKursor("2026-07-28T09:00:00Z", undefined)).toBeNull()
  })

  it("vraća null za neispravan id", () => {
    expect(parsirajKursor("2026-07-28T09:00:00Z", "abc")).toBeNull()
    expect(parsirajKursor("2026-07-28T09:00:00Z", "1.5")).toBeNull()
  })

  it("vraća null za neispravan datum", () => {
    expect(parsirajKursor("juce", "5")).toBeNull()
  })

  it("parsira ispravan kursor", () => {
    expect(parsirajKursor("2026-07-28T09:00:00Z", "800"))
      .toEqual({ vrijeme: "2026-07-28T09:00:00Z", id: 800 })
  })
})
```

- [ ] **Step 2: Pokreni test i potvrdi da pada**

Run: `cd .claude/worktrees/aktivnost-perf && pnpm vitest run lib/aktivnost/kursor.test.ts`
Expected: FAIL — `Failed to resolve import "./kursor"`.

- [ ] **Step 3: Implementiraj kursor**

Create `lib/aktivnost/kursor.ts`:

```ts
// Keyset kursor za Aktivnost: (vrijeme, id) posljednjeg prikazanog reda.
// Namjerno bez ijednog importa iz lib/supabase — ovaj modul mora biti čist,
// da ga vitest (node env) može testirati bez podizanja klijenta.

export type AktivnostKursor = { vrijeme: string; id: number }

/** Kursor za sljedeću porciju = posljednji red trenutne porcije. */
export function kursorOd(redovi: { vrijeme: string; id: number }[]): AktivnostKursor | null {
  const zadnji = redovi[redovi.length - 1]
  return zadnji ? { vrijeme: zadnji.vrijeme, id: zadnji.id } : null
}

/**
 * Kursor iz query stringa. Pokvaren kursor NIJE greška — vraća null, što znači
 * „prva porcija". Isti princip kao sanitacija datuma: ručno pokvaren URL ne smije
 * srušiti stranicu.
 */
export function parsirajKursor(
  vrijeme: string | undefined,
  id: string | undefined,
): AktivnostKursor | null {
  if (!vrijeme || !id) return null
  if (!/^-?\d+$/.test(id)) return null
  const broj = Number(id)
  if (!Number.isSafeInteger(broj)) return null
  if (Number.isNaN(new Date(vrijeme).getTime())) return null
  return { vrijeme, id: broj }
}
```

- [ ] **Step 4: Pokreni test i potvrdi da prolazi**

Run: `pnpm vitest run lib/aktivnost/kursor.test.ts`
Expected: PASS, 6 testova.

- [ ] **Step 5: Napiši padajuće testove za parser filtera**

Create `lib/aktivnost/filteri.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { parsirajAktivnostFiltere, kljucFiltera, upitFiltera } from "./filteri"

const izMape = (m: Record<string, string>) => (k: string) => m[k]

describe("parsirajAktivnostFiltere", () => {
  it("prazan ulaz daje prazne filtere i nema kursora", () => {
    expect(parsirajAktivnostFiltere(izMape({}))).toEqual({ kursor: null })
  })

  it("ignoriše neispravan datum umjesto da baci", () => {
    expect(parsirajAktivnostFiltere(izMape({ od: "xyz" }))).toEqual({ kursor: null })
  })

  it("pretvara `do` u ekskluzivnu granicu sljedećeg dana", () => {
    const f = parsirajAktivnostFiltere(izMape({ od: "2026-07-01", do: "2026-07-31" }))
    expect(f.od).toBe("2026-06-30T22:00:00.000Z")
    expect(f.do).toBe("2026-07-31T22:00:00.000Z")
  })

  it("prenosi akciju, korisnika i pretragu", () => {
    const f = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE", korisnik: "u-1", q: "diorit" }))
    expect(f.akcija).toBe("UPDATE")
    expect(f.korisnik).toBe("u-1")
    expect(f.pretraga).toBe("diorit")
  })

  it("čita kursor iz prijeVrijeme/prijeId", () => {
    const f = parsirajAktivnostFiltere(izMape({ prijeVrijeme: "2026-07-28T09:00:00Z", prijeId: "800" }))
    expect(f.kursor).toEqual({ vrijeme: "2026-07-28T09:00:00Z", id: 800 })
  })
})

describe("kljucFiltera", () => {
  it("ne zavisi od kursora — kursor ne smije resetovati listu", () => {
    const a = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE" }))
    const b = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE", prijeId: "800", prijeVrijeme: "2026-07-28T09:00:00Z" }))
    expect(kljucFiltera(a)).toBe(kljucFiltera(b))
  })

  it("mijenja se kad se filter promijeni", () => {
    const a = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE" }))
    const b = parsirajAktivnostFiltere(izMape({ akcija: "INSERT" }))
    expect(kljucFiltera(a)).not.toBe(kljucFiltera(b))
  })
})

describe("upitFiltera", () => {
  it("ne uključuje kursor — njega dodaje pozivalac", () => {
    const f = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE", q: "a b", prijeId: "800", prijeVrijeme: "2026-07-28T09:00:00Z" }))
    const qs = upitFiltera(f)
    expect(qs).toContain("akcija=UPDATE")
    expect(qs).toContain("q=a+b")
    expect(qs).not.toContain("prijeId")
  })

  it("izostavlja prazne filtere", () => {
    expect(upitFiltera(parsirajAktivnostFiltere(izMape({})))).toBe("")
  })
})
```

- [ ] **Step 6: Pokreni test i potvrdi da pada**

Run: `pnpm vitest run lib/aktivnost/filteri.test.ts`
Expected: FAIL — `Failed to resolve import "./filteri"`.

- [ ] **Step 7: Implementiraj parser filtera**

Create `lib/aktivnost/filteri.ts`:

```ts
// JEDAN parser filtera za Aktivnost — koriste ga i server komponenta i API ruta.
// CLAUDE.md već navodi drift između te dvije putanje kao problem kod plan-aktivnosti
// ("route's filter logic deliberately mirrors the server-component query"); ovdje
// se on izbjegava time što izvor postoji samo na jednom mjestu.
import { dodajDan, utcGranicaSarajevskogDana } from "@/lib/date"
import { parsirajKursor, type AktivnostKursor } from "./kursor"

export type AktivnostFilteriUlaz = {
  od?: string
  do?: string
  korisnik?: string
  akcija?: string
  pretraga?: string
  kursor: AktivnostKursor | null
}

// utcGranicaSarajevskogDana baca RangeError na neispravnom datumu, pa se sanitacija
// radi PRIJE poziva: ručno pokvaren URL (?od=xyz) ignoriše filter umjesto da sruši stranicu.
const isoDatum = (v: string | undefined) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined

export function parsirajAktivnostFiltere(
  uzmi: (k: string) => string | undefined,
): AktivnostFilteriUlaz {
  const od = isoDatum(uzmi("od"))
  const doDatum = isoDatum(uzmi("do"))
  const f: AktivnostFilteriUlaz = {
    kursor: parsirajKursor(uzmi("prijeVrijeme"), uzmi("prijeId")),
  }
  if (od) f.od = utcGranicaSarajevskogDana(od)
  // `do` je ekskluzivna granica SLJEDEĆEG dana (RPC poredi vrijeme < p_do),
  // pa zadnja sekunda odabranog dana ne ispada.
  if (doDatum) f.do = utcGranicaSarajevskogDana(dodajDan(doDatum))
  const akcija = uzmi("akcija")
  if (akcija) f.akcija = akcija
  const korisnik = uzmi("korisnik")
  if (korisnik) f.korisnik = korisnik
  const q = uzmi("q")?.trim()
  if (q) f.pretraga = q
  return f
}

/** Stabilan ključ filtera bez kursora — React `key` koji resetuje listu na promjenu filtera. */
export function kljucFiltera(f: AktivnostFilteriUlaz): string {
  return [f.od ?? "", f.do ?? "", f.akcija ?? "", f.korisnik ?? "", f.pretraga ?? ""].join("|")
}

/** Query string filtera bez kursora — klijent mu dopisuje prijeVrijeme/prijeId. */
export function upitFiltera(f: AktivnostFilteriUlaz): string {
  const p = new URLSearchParams()
  if (f.od) p.set("odIso", f.od)
  if (f.do) p.set("doIso", f.do)
  if (f.akcija) p.set("akcija", f.akcija)
  if (f.korisnik) p.set("korisnik", f.korisnik)
  if (f.pretraga) p.set("q", f.pretraga)
  return p.toString()
}
```

> **Napomena o `upitFiltera`:** izlaz nosi `odIso`/`doIso` (već pretvorene UTC granice), a **ne** `od`/`do` (kalendarski dani iz URL-a stranice). API ruta zato mora prihvatiti oba oblika — vidi Task 4.

- [ ] **Step 8: Pokreni test i potvrdi da prolazi**

Run: `pnpm vitest run lib/aktivnost/filteri.test.ts`
Expected: PASS, 8 testova.

Vrijednosti `2026-06-30T22:00:00.000Z` i `2026-07-31T22:00:00.000Z` su **provjerene** pozivom `utcGranicaSarajevskogDana` prije pisanja plana (juli je CEST, UTC+2). Ako taj test padne, greška je u implementaciji ili u `lib/date` — **ne** prepravljaj očekivanje da bi test prošao.

- [ ] **Step 9: Commit**

```bash
git add lib/aktivnost/kursor.ts lib/aktivnost/kursor.test.ts lib/aktivnost/filteri.ts lib/aktivnost/filteri.test.ts
git commit -m "feat(aktivnost): kursor i dijeljeni parser filtera"
```

---

## Task 4: Sloj upita — `dohvatiAktivnostStranu`

**Files:**
- Modify: `lib/queries/aktivnost.ts` (potpuna zamjena sadržaja)

**Interfaces:**
- Consumes: `AktivnostFilteriUlaz` iz Taska 3; RPC `get_aktivnost_strana` iz Taska 2.
- Produces:
  - `PO_PORCIJI = 50`
  - `interface AktivnostRed` — **bez** polja `ukupno`
  - `type AktivnostRezultat = { ok: true; redovi: AktivnostRed[]; imaJos: boolean } | { ok: false }`
  - `dohvatiAktivnostStranu(f: AktivnostFilteriUlaz): Promise<AktivnostRezultat>`

  Taskovi 5 i 6 koriste sve navedeno. `AktivnostRed` uvozi i `AktivnostTabela`.

- [ ] **Step 1: Zamijeni sadržaj fajla**

Replace `lib/queries/aktivnost.ts` u cijelosti:

```ts
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { AktivnostFilteriUlaz } from "@/lib/aktivnost/filteri"

/** Koliko redova stane u jednu porciju „Učitaj još". */
export const PO_PORCIJI = 50

export interface AktivnostRed {
  id: number
  vrijeme: string
  korisnik_id: string | null
  korisnik_ime: string | null
  korisnik_email: string | null
  akcija: string
  entitet: string | null
  entitet_id: string | null
  staro: unknown
  novo: unknown
  detalji: unknown
  cilj_ime: string | null
  cilj_klijent: string | null
}

/**
 * Diskriminisani rezultat čitanja (S1): pozivalac mora razlikovati „upit je uspio
 * i vratio 0 redova" (empty state) od „upit je pao" (GreskaUcitavanja). Poruka
 * greške se NE prosljeđuje u UI — sirovi `PostgrestError` je zabranjen po S1;
 * detalj ostaje u server logu.
 */
export type AktivnostRezultat =
  | { ok: true; redovi: AktivnostRed[]; imaJos: boolean }
  | { ok: false }

/**
 * Jedna porcija aktivnosti, keyset paginacija.
 *
 * Traži se PO_PORCIJI + 1 red: ako ih stigne toliko, znači da ima još, a 51. se
 * odbacuje. Time nema `count(*) over ()` — on je prolazio kroz cijeli filtrirani
 * skup pri svakoj stranici i bio je jedan od uzroka statement_timeouta.
 */
export async function dohvatiAktivnostStranu(
  f: AktivnostFilteriUlaz,
): Promise<AktivnostRezultat> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_aktivnost_strana", {
    p_od: f.od ?? undefined,
    p_do: f.do ?? undefined,
    p_korisnik: f.korisnik ?? undefined,
    p_akcija: f.akcija ?? undefined,
    p_entitet: undefined,
    p_pretraga: f.pretraga ?? undefined,
    p_prije_vrijeme: f.kursor?.vrijeme ?? undefined,
    p_prije_id: f.kursor?.id ?? undefined,
    p_limit: PO_PORCIJI + 1,
  })
  if (error) {
    console.error("get_aktivnost_strana:", error.message)
    return { ok: false }
  }
  const svi = (data ?? []) as AktivnostRed[]
  const imaJos = svi.length > PO_PORCIJI
  return { ok: true, redovi: imaJos ? svi.slice(0, PO_PORCIJI) : svi, imaJos }
}
```

- [ ] **Step 2: Provjeri tipove**

Run: `cd .claude/worktrees/aktivnost-perf && pnpm typecheck`
Expected: greške SAMO u `app/(dashboard)/aktivnost/page.tsx` (još koristi obrisani `dohvatiAktivnost`, `ukupno` i `Pagination`) i eventualno na `rpc("get_aktivnost_strana")` ako `db/types.ts` još nije regenerisan. Sve ostalo mora biti čisto. Te greške zatvara Task 5.

- [ ] **Step 3: Commit**

```bash
git add lib/queries/aktivnost.ts
git commit -m "feat(aktivnost): dohvatiAktivnostStranu — keyset porcija umjesto offset+ukupno"
```

---

## Task 5: API ruta, stranica i lista

**Files:**
- Create: `app/api/aktivnost/route.ts`
- Create: `components/domain/AktivnostLista.tsx`
- Modify: `components/domain/AktivnostTabela.tsx` (server → client)
- Modify: `app/(dashboard)/aktivnost/page.tsx`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `dohvatiAktivnostStranu`, `PO_PORCIJI`, `AktivnostRed` (Task 4); `parsirajAktivnostFiltere`, `kljucFiltera`, `upitFiltera` (Task 3); `kursorOd` (Task 3).
- Produces: `AktivnostLista` komponenta s propovima `{ pocetna: AktivnostRed[]; imaJosPocetna: boolean; upit: string }`. Task 6 dodaje select u `AktivnostFilteri`, ne dira listu.

- [ ] **Step 1: Dodaj i18n ključeve u sva tri kataloga**

U `messages/sr.json`, unutar `aktivnost`: **obriši** `"ukupno"` i dodaj:

```json
"ucitajJos": "Učitaj još",
"ucitavanje": "Učitavam…",
"greskaPorcije": "Nije uspjelo učitavanje sljedeće porcije.",
"krajListe": "To je sve.",
"prikazanoRedova": "Prikazano redova: {count}"
```

U `messages/en.json`, unutar `aktivnost`: obriši `"ukupno"`, dodaj:

```json
"ucitajJos": "Load more",
"ucitavanje": "Loading…",
"greskaPorcije": "Could not load the next batch.",
"krajListe": "That's everything.",
"prikazanoRedova": "Rows shown: {count}"
```

U `messages/de.json`, unutar `aktivnost`: obriši `"ukupno"`, dodaj:

```json
"ucitajJos": "Mehr laden",
"ucitavanje": "Wird geladen…",
"greskaPorcije": "Der nächste Abschnitt konnte nicht geladen werden.",
"krajListe": "Das ist alles.",
"prikazanoRedova": "Angezeigte Zeilen: {count}"
```

`prikazanoRedova` je **obična interpolacija, ne ICU plural** — namjerno, jer je za `sr` kategorija `one` zabranjena. Ostali ključevi nemaju argumenata.

- [ ] **Step 2: Pretvori `AktivnostTabela` u client komponentu**

U `components/domain/AktivnostTabela.tsx` napravi tačno ove izmjene, ništa drugo:

1. Dodaj `"use client"` kao prvu liniju fajla.
2. Zamijeni import:
   ```ts
   // bilo:
   import { getTranslations } from "next-intl/server"
   // sada:
   import { useTranslations } from "next-intl"
   ```
3. Zamijeni tip `T`:
   ```ts
   // bilo:
   type T = Awaited<ReturnType<typeof getTranslations<"aktivnost">>>
   // sada:
   type T = ReturnType<typeof useTranslations<"aktivnost">>
   ```
4. Skini `async` i `await` s komponente:
   ```ts
   // bilo:
   export async function AktivnostTabela({ redovi }: { redovi: AktivnostRed[] }) {
     const t = await getTranslations("aktivnost")
   // sada:
   export function AktivnostTabela({ redovi }: { redovi: AktivnostRed[] }) {
     const t = useTranslations("aktivnost")
   ```

Namespace `aktivnost` je već u `CLIENT_NAMESPACES` (`i18n/client-namespaces.ts`), pa se katalog već šalje klijentu — nema novog bundle troška. `formatDatum`/`formatDatumVrijeme` (`lib/date`) i `delokalizujSegment` (`i18n/routes`) su čisti i rade na klijentu.

- [ ] **Step 3: Napiši `AktivnostLista`**

Create `components/domain/AktivnostLista.tsx`:

```tsx
"use client"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AktivnostTabela } from "@/components/domain/AktivnostTabela"
import { kursorOd } from "@/lib/aktivnost/kursor"
import type { AktivnostRed } from "@/lib/queries/aktivnost"

export function AktivnostLista({
  pocetna,
  imaJosPocetna,
  upit,
}: {
  pocetna: AktivnostRed[]
  imaJosPocetna: boolean
  upit: string
}) {
  const t = useTranslations("aktivnost")
  const [redovi, setRedovi] = useState<AktivnostRed[]>(pocetna)
  const [imaJos, setImaJos] = useState(imaJosPocetna)
  const [ucitavanje, setUcitavanje] = useState(false)
  const [greska, setGreska] = useState(false)

  async function ucitajJos() {
    const kursor = kursorOd(redovi)
    if (!kursor || ucitavanje) return
    setUcitavanje(true)
    setGreska(false)
    try {
      const p = new URLSearchParams(upit)
      p.set("prijeVrijeme", kursor.vrijeme)
      p.set("prijeId", String(kursor.id))
      const res = await fetch(`/api/aktivnost?${p.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      const podaci = (await res.json()) as { redovi: AktivnostRed[]; imaJos: boolean }
      // Dedup se računa unutar updatera, nad `prosli`, a NE nad `redovi` iz closure-a —
      // inače bi dva brza klika radila s ustajalim skupom i propustila duplikat.
      setRedovi((prosli) => {
        const poznati = new Set(prosli.map((r) => r.id))
        return [...prosli, ...podaci.redovi.filter((r) => !poznati.has(r.id))]
      })
      setImaJos(podaci.imaJos)
    } catch {
      // Već učitano se NE gubi — samo se ponudi ponovni pokušaj.
      setGreska(true)
    } finally {
      setUcitavanje(false)
    }
  }

  return (
    <div className="space-y-4">
      <AktivnostTabela redovi={redovi} />
      {/* Čitač ekrana mora saznati da je lista narasla; tabela sama to ne najavljuje.
          Gola cifra se čita besmisleno, pa ide kroz prevedenu rečenicu. */}
      <p className="sr-only" aria-live="polite">
        {t("prikazanoRedova", { count: redovi.length })}
      </p>
      {greska && (
        <p className="text-sm text-destructive" role="alert">
          {t("greskaPorcije")}
        </p>
      )}
      {imaJos ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={ucitajJos}
            disabled={ucitavanje}
            data-testid="aktivnost-ucitaj-jos"
          >
            {ucitavanje && (
              <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            {ucitavanje ? t("ucitavanje") : t("ucitajJos")}
          </Button>
        </div>
      ) : (
        redovi.length > 0 && (
          <p className="text-center text-sm text-muted-foreground" data-testid="aktivnost-kraj">
            {t("krajListe")}
          </p>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 4: Napiši API rutu**

Create `app/api/aktivnost/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { dohvatiAktivnostStranu } from "@/lib/queries/aktivnost"
import { parsirajAktivnostFiltere } from "@/lib/aktivnost/filteri"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

// S1: ruta nikad ne vraća sirovi PostgrestError — samo `{ error: <i18n string> }`.
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

export async function GET(req: NextRequest) {
  // Aktivnost je admin-only i na stranici (notFound) i u bazi (je_admin guard u RPC).
  // Ruta ponavlja provjeru da ne-admin dobije 404, a ne 400 iz baze.
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 404 })
  }

  const sp = req.nextUrl.searchParams
  // `upitFiltera` šalje već pretvorene UTC granice kao odIso/doIso; ručno sastavljen
  // URL može poslati kalendarske od/do. Podržana su oba: odIso/doIso imaju prednost.
  const f = parsirajAktivnostFiltere((k) => sp.get(k) ?? undefined)
  const odIso = sp.get("odIso")
  const doIso = sp.get("doIso")
  if (odIso) f.od = odIso
  if (doIso) f.do = doIso

  const rezultat = await dohvatiAktivnostStranu(f)
  if (!rezultat.ok) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }
  return NextResponse.json({ redovi: rezultat.redovi, imaJos: rezultat.imaJos })
}
```

- [ ] **Step 5: Prepravi stranicu**

Replace `app/(dashboard)/aktivnost/page.tsx` u cijelosti:

```tsx
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { dohvatiAktivnostStranu } from "@/lib/queries/aktivnost"
import { parsirajAktivnostFiltere, kljucFiltera, upitFiltera } from "@/lib/aktivnost/filteri"
import { AktivnostFilteri } from "@/components/domain/AktivnostFilteri"
import { AktivnostSearch } from "@/components/domain/AktivnostSearch"
import { AktivnostLista } from "@/components/domain/AktivnostLista"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"

export default async function AktivnostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") notFound()

  const t = await getTranslations("aktivnost")
  const sp = await searchParams
  const jedan = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  // Stranica uvijek renderuje PRVU porciju — kursor se ne čita iz URL-a stranice,
  // nego ga „Učitaj još" drži u stanju klijenta. Time je URL uvijek dijeljiv.
  const f = parsirajAktivnostFiltere((k) => jedan(sp[k]))
  f.kursor = null

  const rezultat = await dohvatiAktivnostStranu(f)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <AktivnostSearch />
        <AktivnostFilteri key={kljucFiltera(f)} />
      </div>
      {/* S1: greška čitanja NIJE prazan rezultat — lista se ne renderuje,
          ali naslov i filteri ostaju (promjena filtera = novi pokušaj). */}
      {rezultat.ok ? (
        // `key` na ključu filtera: promjena filtera remontira listu i briše
        // akumulirane porcije, umjesto da se nove nakalemе na stare.
        <AktivnostLista
          key={kljucFiltera(f)}
          pocetna={rezultat.redovi}
          imaJosPocetna={rezultat.imaJos}
          upit={upitFiltera(f)}
        />
      ) : (
        <GreskaUcitavanja />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Provjeri tipove i lint**

Run: `cd .claude/worktrees/aktivnost-perf && pnpm typecheck && pnpm lint`
Expected: oboje čisto. Ako `tsc` prijavi `Property 'ukupno' does not exist`, negdje je ostao stari prikaz ukupnog broja — ukloni ga. Ako prijavi nepoznat i18n ključ, ključ nedostaje u nekom od tri kataloga.

- [ ] **Step 7: Ručna provjera u aplikaciji**

Run: `cd .claude/worktrees/aktivnost-perf && pnpm dev`

Otvori `http://localhost:3000/aktivnost` i potvrdi:
- stranica se učita brzo, prikazuje 50 redova
- dugme „Učitaj još" dodaje sljedećih 50 i lista naraste na 100
- pretraga po nazivu firme suzi listu i resetuje je na prvu porciju
- kad redova više nema, dugme nestaje i pojavi se „To je sve."

- [ ] **Step 8: Commit**

```bash
git add app/api/aktivnost/route.ts components/domain/AktivnostLista.tsx \
        components/domain/AktivnostTabela.tsx "app/(dashboard)/aktivnost/page.tsx" \
        messages/sr.json messages/en.json messages/de.json
git commit -m "feat(aktivnost): Ucitaj jos umjesto paginacije, API ruta za porcije"
```

---

## Task 6: Filter „Korisnik"

**Files:**
- Modify: `components/domain/AktivnostFilteri.tsx`
- Modify: `app/(dashboard)/aktivnost/page.tsx`
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: postojeći RPC `get_aktivni_korisnici()` (`20260726122000`), koji vraća `{ id: string; ime: string }[]`; `parsirajAktivnostFiltere` već čita `korisnik` iz URL-a (Task 3).
- Produces: `AktivnostFilteri` dobija prop `korisnici: { id: string; ime: string }[]`.

- [ ] **Step 1: Dodaj i18n ključeve**

U `aktivnost.filteri` sva tri kataloga:

`messages/sr.json`: `"korisnik": "Korisnik"`, `"sviKorisnici": "Svi korisnici"`
`messages/en.json`: `"korisnik": "User"`, `"sviKorisnici": "All users"`
`messages/de.json`: `"korisnik": "Benutzer"`, `"sviKorisnici": "Alle Benutzer"`

- [ ] **Step 2: Dodaj select u `AktivnostFilteri`**

U `components/domain/AktivnostFilteri.tsx`:

1. Promijeni potpis:
   ```ts
   export function AktivnostFilteri({ korisnici }: { korisnici: { id: string; ime: string }[] }) {
   ```
2. Dodaj `const korisnikLabelId = useId()` pored postojećeg `akcijaLabelId`.
3. Dodaj mapu stavki pored `akcijaItems`:
   ```ts
   const korisnikItems: Record<string, string> = {
     [SVI]: t("filteri.sviKorisnici"),
     ...Object.fromEntries(korisnici.map((k) => [k.id, k.ime])),
   }
   ```
4. Odmah poslije bloka s „Tip akcije" selectom, prije „Od" polja, ubaci:
   ```tsx
   <div className="flex flex-col gap-1 text-xs">
     <span id={korisnikLabelId}>{t("filteri.korisnik")}</span>
     <Select
       items={korisnikItems}
       value={sp.get("korisnik") ?? SVI}
       onValueChange={(v) => postavi("korisnik", !v || v === SVI ? "" : v)}
     >
       <SelectTrigger className="w-52" disabled={isPending} aria-labelledby={korisnikLabelId}>
         <SelectValue placeholder={t("filteri.sviKorisnici")} />
       </SelectTrigger>
       <SelectContent>
         <SelectItem value={SVI}>{t("filteri.sviKorisnici")}</SelectItem>
         {korisnici.map((k) => (
           <SelectItem key={k.id} value={k.id}>{k.ime}</SelectItem>
         ))}
       </SelectContent>
     </Select>
   </div>
   ```

`postavi()` već briše `strana` iz URL-a; taj parametar više ne postoji, ali brisanje nepostojećeg ključa je bezopasno — ostavi kako jeste.

- [ ] **Step 3: Dovuci korisnike u stranici**

U `app/(dashboard)/aktivnost/page.tsx`:

1. Dodaj import:
   ```ts
   import { createServerSupabaseClient } from "@/lib/supabase/server"
   ```
2. Zamijeni jedan `await dohvatiAktivnostStranu(f)` paralelnim dohvatom:
   ```ts
   const supabase = await createServerSupabaseClient()
   const [rezultat, korisniciRes] = await Promise.all([
     dohvatiAktivnostStranu(f),
     supabase.rpc("get_aktivni_korisnici"),
   ])
   const korisnici = (korisniciRes.data ?? []) as { id: string; ime: string }[]
   ```
   Pad dohvata korisnika NE ruši stranicu — filter tad ima samo „Svi korisnici", a lista radi.
3. Proslijedi prop:
   ```tsx
   <AktivnostFilteri key={kljucFiltera(f)} korisnici={korisnici} />
   ```

- [ ] **Step 4: Provjeri tipove i lint**

Run: `pnpm typecheck && pnpm lint`
Expected: oboje čisto.

- [ ] **Step 5: Ručna provjera**

Uz pokrenut `pnpm dev`, otvori `/aktivnost`, izaberi korisnika u novom selectu i potvrdi da se lista suzi na njegove zapise i da se URL promijeni u `?korisnik=<uuid>`.

- [ ] **Step 6: Commit**

```bash
git add components/domain/AktivnostFilteri.tsx "app/(dashboard)/aktivnost/page.tsx" \
        messages/sr.json messages/en.json messages/de.json
git commit -m "feat(aktivnost): filter po korisniku"
```

---

## Task 7: E2E testovi

**Files:**
- Modify: `tests/e2e/30-aktivnost.spec.ts`

**Interfaces:**
- Consumes: sve iz Taskova 1–6; postojeće helpere `injectSessionFor` (`tests/e2e/session-helper.ts`) i `ensureOperater` (`tests/e2e/db.ts`).
- Produces: ništa (terminalni task).

- [ ] **Step 1: Dopiši testove**

U `tests/e2e/30-aktivnost.spec.ts` **zadrži oba postojeća testa** i dodaj sljedeće. Ne diraj `test.beforeAll` ni konstante na vrhu.

```ts
test("prva porcija ima 50 redova i dugme Učitaj još", async ({ page }) => {
  await page.goto("/aktivnost")
  await expect(page.getByRole("heading", { name: "Aktivnost" })).toBeVisible({ timeout: 30_000 })
  const redovi = page.locator("table tbody tr")
  await expect(redovi).toHaveCount(50, { timeout: 30_000 })
  await expect(page.getByTestId("aktivnost-ucitaj-jos")).toBeVisible()
})

test("Učitaj još dodaje porciju bez duplikata", async ({ page }) => {
  await page.goto("/aktivnost")
  const redovi = page.locator("table tbody tr")
  await expect(redovi).toHaveCount(50, { timeout: 30_000 })

  const prvaPorcija = await redovi.evaluateAll((tr) =>
    tr.map((r) => r.textContent?.trim() ?? ""))

  await page.getByTestId("aktivnost-ucitaj-jos").click()
  await expect(redovi).toHaveCount(100, { timeout: 30_000 })

  const sve = await redovi.evaluateAll((tr) => tr.map((r) => r.textContent?.trim() ?? ""))
  // Prvih 50 su nepromijenjeni, drugih 50 su novi.
  expect(sve.slice(0, 50)).toEqual(prvaPorcija)
  expect(new Set(sve).size).toBe(sve.length)
})

test("pretraga sužava listu i resetuje je na prvu porciju", async ({ page }) => {
  await page.goto("/aktivnost")
  const redovi = page.locator("table tbody tr")
  await expect(redovi).toHaveCount(50, { timeout: 30_000 })

  // Prvo učitaj drugu porciju, pa pretraži — lista se mora vratiti na jednu porciju.
  await page.getByTestId("aktivnost-ucitaj-jos").click()
  await expect(redovi).toHaveCount(100, { timeout: 30_000 })

  await page.getByTestId("aktivnost-search").fill("klijenti")
  await expect(page).toHaveURL(/q=klijenti/, { timeout: 30_000 })
  await expect(redovi).not.toHaveCount(100, { timeout: 30_000 })
  const broj = await redovi.count()
  expect(broj).toBeGreaterThan(0)
  expect(broj).toBeLessThanOrEqual(50)
})

test("filter po korisniku sužava listu", async ({ page }) => {
  await page.goto("/aktivnost")
  // NE traži tekst „Korisnik" — tako se zove i kolona u tabeli, pa bi getByText
  // pao na strict-mode višestrukom pogotku. Broj combobox-a je jednoznačan:
  // prvi je „Tip akcije", drugi je novi „Korisnik".
  const selecti = page.getByRole("combobox")
  await expect(selecti).toHaveCount(2, { timeout: 30_000 })
  await selecti.nth(1).click()
  // Prva stavka poslije „Svi korisnici" je konkretan korisnik.
  await page.getByRole("option").nth(1).click()
  await expect(page).toHaveURL(/korisnik=/, { timeout: 30_000 })
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 })
})

test("operater ne može pozvati get_aktivnost_strana", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const opPage = await ctx.newPage()
    await injectSessionFor(ctx, OP_EMAIL, OP_LOZINKA)
    // Dokaži prvo da sesija radi — inače bi 404 na API ruti bio false-pass.
    await opPage.goto("/pregled")
    await expect(opPage.getByRole("heading", { name: "Pregled" })).toBeVisible({ timeout: 30_000 })

    // API ruta mora vratiti 404 (admin gate), a ne redove.
    const res = await opPage.request.get("/api/aktivnost")
    expect(res.status()).toBe(404)
    const tijelo = await res.json()
    expect(tijelo.redovi).toBeUndefined()
  } finally {
    await ctx.close()
  }
})
```

- [ ] **Step 2: Pokreni spec**

Run:
```bash
cd .claude/worktrees/aktivnost-perf
pnpm exec playwright test tests/e2e/30-aktivnost.spec.ts --project=chromium; echo "exit=$?"
```
Expected: svih 7 testova prolazi (2 postojeća + 5 novih). **Provjeri `exit=0` eksplicitno** — `playwright | tail` maskira izlazni kod, pa je to već jednom sakrilo pad.

Ako „prva porcija ima 50 redova" padne s manjim brojem, DEMO nema dovoljno audit zapisa — nije regresija; smanji očekivanje na `toHaveCount(await redovi.count())` samo ako si potvrdio da baza zaista ima manje od 100 redova.

- [ ] **Step 3: Pokreni cijeli chromium paket i uporedi sa zatečenim padovima**

Run:
```bash
cd .claude/worktrees/aktivnost-perf
pnpm exec playwright test --project=chromium --workers=1; echo "exit=$?"
```
Expected: nema NOVIH padova u odnosu na zatečeni spisak (9 poznatih padova od 2026-07-27). Poredi sa spiskom prije nego optužiš ovu izmjenu.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/30-aktivnost.spec.ts
git commit -m "test(aktivnost): keyset listanje, pretraga, filter po korisniku, guard za operatera"
```

---

## KONTROLNA TAČKA B — korisnik pušta PROD i mergeuje

**Agent ovo NE radi.** Redoslijed je obavezan — obrnut redoslijed obara produkciju, jer bi deployana aplikacija zvala nepostojeću funkciju:

1. Migracije `…120000` i `…121000` na PROD (expand pola — dodaju novo, ništa ne brišu):
   ```bash
   POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/20260728120000_audit_pretraga_kolone.sql
   POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/20260728121000_get_aktivnost_strana.sql
   ```
2. Tek onda merge u `main` (merge = deploy na tri Vercel projekta odjednom) — sačekati da je nova verzija aplikacije zaista live.
3. Tek nakon što je deploy potvrđen: `…122000` na PROD (contract pola — briše staru `get_aktivnost`/`aktivnost_view`, koje dotad samo neiskorišteno sjede):
   ```bash
   POTVRDI_PROD=da pnpm db:apply-cloud --prod supabase/migrations/20260728122000_drop_get_aktivnost.sql
   ```

Prije PROD apply-a provjeri trajanje prve migracije zabilježeno u Tasku 1 — ona uzima `ACCESS EXCLUSIVE` lock na `audit_log`, pa u tom trenutku nijedan upis u log ne prolazi.

Nikad ne deploy-ovati aplikaciju prije koraka 1 (migracije moraju prethoditi), i nikad ne primjenjivati korak 3 prije koraka 2 (stara verzija aplikacije bi se slomila da drop stigne prerano).

---

## Provjera pokrivenosti specifikacije

| Zahtjev iz spec-a | Task |
|---|---|
| §3.1 generisane kolone + tri indeksa, `public.gin_trgm_ops` | 1 |
| §3.2 plpgsql + `%L`, keyset, bez `count(*) over ()`, join nad porcijom, pretraga kroz male tabele | 2 |
| §3.3 SECURITY DEFINER + `je_admin()` guard + definer higijena | 2 |
| §3.4 tok podataka: SSR prva porcija, API za sljedeće, kursor `(vrijeme, id)`, reset na promjenu filtera | 3, 4, 5 |
| §4.1 / §4.2 dvije migracije, redoslijed, `drop` stare RPC i view-a | 1, 2, KT A, KT B |
| §5 svi fajlovi iz tabele modula | 3, 4, 5, 6 |
| §6 E2E 1–8 (listanje, porcije, dugme, pretrage, filter, reset) | 7 |
| §6 E2E 9 (sigurnosni guard) | 2 (na nivou baze), 7 (na nivou rute) |
| §6 ručna provjera performansi ispod 50 ms | 2, korak 4 |
| §7 rubni slučajevi: nevažeći kursor, prazna pretraga, pad RPC-a, pad porcije | 3 (`parsirajKursor`), 2 (`v_q`), 4 (`{ok:false}`), 5 (`greska` stanje) |
