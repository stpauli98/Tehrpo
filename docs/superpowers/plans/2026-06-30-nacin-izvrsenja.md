# Način izvršenja (TEHPRO izvršava / Samo praćenje) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodati polje „način izvršenja" (`izvrsava`/`pracenje`) na profil usluge i aktivnost, s unosom, vizuelnom oznakom i filterom u centralnom planu te kolonom u izvozu.

**Architecture:** Enum kolona `nacin_izvrsenja` na `klijent_provjere` i `termini` (default `izvrsava`), propagirana kroz `tg_termini_auto_cycle`; izložena kroz (rekreirani) `termini_view`. Plan rute (`lista`/`izvoz`) dobijaju dijeljeni filter `nacin` preko `lib/plan-filteri.ts`; UI dobija dropdown „Način" + badge „Samo praćenje" u tabeli; izvoz dobija kolonu „Način". Podsjetnici se ne diraju.

**Tech Stack:** Next.js 16 (App Router, `--webpack`), Supabase/Postgres (migracije + RLS off na ovim tabelama), pnpm, Vitest (unit + `pg` integracija gated na `TEST_DATABASE_URL`), exceljs, pdf-lib.

## Global Constraints

- Package manager **pnpm**; `next dev` uvijek s `--webpack` (razmak u putanji lomi Turbopack).
- Domenski jezik **bosanski/srpski (latinica)** — tabele, kolone, UI stringovi.
- `db/types.ts` je **auto-generisan** (`pnpm db:types`) — nikad ručno editovati; regenerisati nakon migracije.
- Cloud DB **nije** dostupna kroz Supabase MCP — migracije na cloud ide `pnpm db:apply-cloud <file>`, jedan fajl.
- **Migracija se primjenjuje na cloud PRIJE merge-a** (kod čita novu kolonu; pravilo I1).
- Service-role klijent nikad u `app/`/`components/` request-pathu — plan rute koriste SSR (`createServerSupabaseClient`).
- ESLint: `no-await-in-loop` (osim `scripts/`); bez `sm:`/`md:` Tailwind breakpointa.
- Enum: `nacin_izvrsenja_tip` s vrijednostima točno `'izvrsava'` i `'pracenje'`; default `'izvrsava'`.

---

### Task 1: DB migracija — kolona, auto_cycle propagacija, rekreiran view

**Files:**
- Create: `supabase/migrations/20260630120000_nacin_izvrsenja.sql`
- Create: `lib/termini/nacinIzvrsenja.integration.test.ts`
- Regenerate: `db/types.ts` (via `pnpm db:types`)

**Interfaces:**
- Produces: kolona `termini.nacin_izvrsenja` i `klijent_provjere.nacin_izvrsenja` tipa `nacin_izvrsenja_tip` (`'izvrsava'|'pracenje'`, NOT NULL default `'izvrsava'`); `termini_view` izlaže `nacin_izvrsenja`; `tg_termini_auto_cycle` kopira `nacin_izvrsenja` na sljedeći termin. `Database["public"]["Views"]["termini_view"]["Row"]` dobija `nacin_izvrsenja`.

- [ ] **Step 1: Write the failing integration test**

Create `lib/termini/nacinIzvrsenja.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"

const URL = process.env.TEST_DATABASE_URL

// Gate na TEST_DATABASE_URL → `pnpm test:unit` bez lokalnog DB i dalje prolazi.
describe.skipIf(!URL)("nacin_izvrsenja (integracija, lokalni DB)", () => {
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
      const k = await db.query("insert into klijenti (naziv) values ('ITEST nacin') returning id")
      const v = await db.query("insert into vrste_provjera (naziv) values ('ITEST nacin v') returning id")
      await fn({ klijent: k.rows[0].id as string, vrsta: v.rows[0].id as string })
    } finally {
      await db.query("rollback")
    }
  }

  it("termini_view izlaže nacin_izvrsenja; default je 'izvrsava'", async () => {
    await withSeed(async (ids) => {
      const t = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, rok_dospijeca, status)
         values ($1, $2, current_date + 30, 'planirano') returning id`,
        [ids.klijent, ids.vrsta],
      )
      const r = await db.query("select nacin_izvrsenja from termini_view where id = $1", [t.rows[0].id])
      expect(r.rows[0].nacin_izvrsenja).toBe("izvrsava")
    })
  })

  it("auto_cycle kopira nacin_izvrsenja='pracenje' na sljedeći termin", async () => {
    await withSeed(async (ids) => {
      const ins = await db.query(
        `insert into termini (klijent_id, vrsta_provjere_id, interval_mjeseci, rok_dospijeca, status, nacin_izvrsenja)
         values ($1, $2, 12, current_date + 10, 'planirano', 'pracenje') returning id`,
        [ids.klijent, ids.vrsta],
      )
      const id = ins.rows[0].id as string
      // izvršenje termina → trigger umeće sljedeći
      await db.query(
        `update termini set status = 'izvrseno', datum_izvrsenja = current_date where id = $1`,
        [id],
      )
      const next = await db.query(
        `select nacin_izvrsenja from termini
         where klijent_id = $1 and vrsta_provjere_id = $2 and id <> $3`,
        [ids.klijent, ids.vrsta, id],
      )
      expect(next.rows).toHaveLength(1)
      expect(next.rows[0].nacin_izvrsenja).toBe("pracenje")
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm vitest run lib/termini/nacinIzvrsenja.integration.test.ts`
Expected: FAIL — `column "nacin_izvrsenja" does not exist` (kolona još ne postoji). (Ako lokalni Supabase nije pokrenut, prvo `pnpm supabase start`.)

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260630120000_nacin_izvrsenja.sql`:

```sql
-- §4.1 Način izvršenja: 'izvrsava' (TEHPRO izvršava) | 'pracenje' (samo praćenje roka).
-- Re-run sigurno (review-loop / cloud re-apply): create type nije idempotentan → guard.
do $$ begin
  create type nacin_izvrsenja_tip as enum ('izvrsava', 'pracenje');
exception when duplicate_object then null;
end $$;

alter table klijent_provjere
  add column if not exists nacin_izvrsenja nacin_izvrsenja_tip not null default 'izvrsava';
alter table termini
  add column if not exists nacin_izvrsenja nacin_izvrsenja_tip not null default 'izvrsava';

-- auto_cycle mora kopirati nacin_izvrsenja na sljedeći termin u ciklusu.
create or replace function tg_termini_auto_cycle() returns trigger as $$
begin
  if OLD.datum_izvrsenja is null
     and NEW.datum_izvrsenja is not null
     and NEW.status = 'izvrseno' then
    insert into termini (
      klijent_id, lokacija_id, vrsta_provjere_id, interval_mjeseci,
      datum_zadnjeg, rok_dospijeca, status, nacin_izvrsenja
    )
    values (
      NEW.klijent_id, NEW.lokacija_id, NEW.vrsta_provjere_id, NEW.interval_mjeseci,
      NEW.datum_izvrsenja, NEW.datum_izvrsenja, 'planirano', NEW.nacin_izvrsenja
    );
  end if;
  return NEW;
end;
$$ language plpgsql;

-- termini_view: t.* je POZICIJSKI razvijen → nova kolona se ne pojavi bez rekreiranja.
-- Rekreira se OBOGAĆENA verzija (join nazivi) iz 20260620214413_termini_read_model.sql.
drop view if exists termini_view;
create view termini_view as
select
  t.*,
  case
    when t.status = 'izvrseno' then 'izvrseno'
    when t.status = 'otkazano' then 'otkazano'
    when t.rok_dospijeca < current_date then 'kasni'
    else t.status::text
  end as status_izvedeni,
  k.naziv as klijent_naziv,
  l.naziv as lokacija_naziv,
  l.grad  as lokacija_grad,
  v.naziv as vrsta_naziv
from termini t
left join klijenti k       on k.id = t.klijent_id
left join lokacije l       on l.id = t.lokacija_id
left join vrste_provjera v on v.id = t.vrsta_provjere_id;
```

- [ ] **Step 4: Apply locally and regenerate types**

Run: `pnpm db:reset` (reapply svih migracija lokalno) → zatim `pnpm db:types`
Expected: `db:reset` prolazi bez greške; `git diff db/types.ts` pokazuje `nacin_izvrsenja: "izvrsava" | "pracenje"` u `termini` i `klijent_provjere` Row/Insert/Update + `nacin_izvrsenja` u `termini_view` Row, i `nacin_izvrsenja_tip` u `Enums`.

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm vitest run lib/termini/nacinIzvrsenja.integration.test.ts`
Expected: PASS (2 testa).

- [ ] **Step 6: Verify the full unit suite still passes**

Run: `pnpm test:unit && pnpm typecheck`
Expected: zeleno (integracija se skip-uje bez `TEST_DATABASE_URL`).

- [ ] **Step 7: Apply migration to CLOUD (prije bilo kakvog merge-a)**

Run: `pnpm db:apply-cloud supabase/migrations/20260630120000_nacin_izvrsenja.sql`
Expected: izlaz potvrđuje uspješan apply (idempotentne naredbe — bez greške i pri ponovnom pokretanju).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260630120000_nacin_izvrsenja.sql lib/termini/nacinIzvrsenja.integration.test.ts db/types.ts
git commit -m "feat(db): nacin_izvrsenja kolona + auto_cycle propagacija + view"
```

---

### Task 2: Filter `nacin` u plan rutama (backend)

**Files:**
- Modify: `lib/plan-filteri.ts`
- Modify: `lib/plan-filteri.test.ts`
- Modify: `app/api/plan-aktivnosti/lista/route.ts:29-31`
- Modify: `app/api/plan-aktivnosti/izvoz/route.ts:43-45`

**Interfaces:**
- Consumes: `Database` tipovi iz Task 1 (kolona `nacin_izvrsenja` na `termini_view`).
- Produces: `PlanFilteri` dobija polje `nacin: string` (`"svi" | "izvrsava" | "pracenje"`, default `"svi"`); `parsePlanFilteri` ga čita iz `sp.get("nacin")`; obje rute filtriraju `termini_view` po `nacin_izvrsenja` kad `nacin !== "svi"`.

- [ ] **Step 1: Write the failing unit test**

Add to `lib/plan-filteri.test.ts` (unutar `describe("parsePlanFilteri", ...)`):

```ts
  it("nacin: default 'svi'; čita 'pracenje'; nepoznato → 'svi'", () => {
    expect(parsePlanFilteri(new URLSearchParams()).nacin).toBe("svi")
    expect(parsePlanFilteri(new URLSearchParams("nacin=pracenje")).nacin).toBe("pracenje")
    expect(parsePlanFilteri(new URLSearchParams("nacin=izvrsava")).nacin).toBe("izvrsava")
    expect(parsePlanFilteri(new URLSearchParams("nacin=xyz")).nacin).toBe("svi")
  })
```

Also update the `mjesecRange` test `base` helper (line ~20) to include `nacin` so it satisfies the new `PlanFilteri` type:

```ts
  const base = (mjesec: string, godina = 2026) => ({ status: "svi", q: "", klijentId: "", lokacijaId: "", vrstaId: "", mjesec, godina, nacin: "svi" })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/plan-filteri.test.ts`
Expected: FAIL — `nacin` ne postoji na rezultatu / TS greška jer `PlanFilteri` nema `nacin`.

- [ ] **Step 3: Add `nacin` to `PlanFilteri` and `parsePlanFilteri`**

In `lib/plan-filteri.ts`, add to the `PlanFilteri` type (after `godina: number`):

```ts
  nacin: string // "svi" (default) | "izvrsava" | "pracenje"
```

And in `parsePlanFilteri`, add before the closing `}` of the returned object:

```ts
    nacin: (() => {
      const n = sp.get("nacin")
      return n === "izvrsava" || n === "pracenje" ? n : "svi"
    })(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/plan-filteri.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply the filter in the `lista` route**

In `app/api/plan-aktivnosti/lista/route.ts`, after line 29 (`if (f.vrstaId) listQuery = listQuery.eq("vrsta_provjere_id", f.vrstaId)`), add:

```ts
  if (f.nacin !== "svi") listQuery = listQuery.eq("nacin_izvrsenja", f.nacin)
```

- [ ] **Step 6: Apply the filter in the `izvoz` route**

In `app/api/plan-aktivnosti/izvoz/route.ts`, after line 43 (`if (f.vrstaId) q = q.eq("vrsta_provjere_id", f.vrstaId)`), add:

```ts
  if (f.nacin !== "svi") q = q.eq("nacin_izvrsenja", f.nacin)
```

- [ ] **Step 7: Typecheck + suite**

Run: `pnpm typecheck && pnpm test:unit`
Expected: zeleno.

- [ ] **Step 8: Commit**

```bash
git add lib/plan-filteri.ts lib/plan-filteri.test.ts "app/api/plan-aktivnosti/lista/route.ts" "app/api/plan-aktivnosti/izvoz/route.ts"
git commit -m "feat(plan): nacin filter u lista i izvoz rutama"
```

---

### Task 3: Kolona „Način" u izvozu (Excel + PDF)

**Files:**
- Modify: `lib/plan-izvoz/types.ts`
- Modify: `lib/plan-izvoz/xlsx.ts`
- Modify: `lib/plan-izvoz/pdf.ts`
- Modify: `lib/plan-izvoz/xlsx.test.ts`
- Modify: `app/api/plan-aktivnosti/izvoz/route.ts:50-58`

**Interfaces:**
- Consumes: `PlanFilteri.nacin` (Task 2), `nacin_izvrsenja` red iz `termini_view` (Task 1).
- Produces: `PlanRed` dobija `nacin: string` (labela „Izvršava"/„Praćenje"); `PLAN_KOLONE` dobija `"Način"`; builderi renderuju kolonu.

- [ ] **Step 1: Update the xlsx test (failing)**

In `lib/plan-izvoz/xlsx.test.ts`: add `nacin: "Praćenje"` to the `ROW` fixture object, and after the existing assertions add:

```ts
    expect(ws.getCell("H4").value).toBe("Način")
    expect(ws.getCell("H5").value).toBe("Praćenje")
```

(`H` = 8. kolona — nova „Način" iza „Odgovorna osoba".)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/plan-izvoz/xlsx.test.ts`
Expected: FAIL — `PlanRed` nema `nacin` (TS) / ćelija H4 nije „Način".

- [ ] **Step 3: Extend the `PlanRed` type and columns**

In `lib/plan-izvoz/types.ts`, add `nacin: string` to `PlanRed` (after `odgovorna: string`), and append `"Način"` to `PLAN_KOLONE`:

```ts
export type PlanRed = {
  klijent: string
  lokacija: string
  usluga: string
  rok: string
  status: string
  periodikaMj: number | null
  odgovorna: string
  nacin: string
}

export type IzvozMeta = { naslov: string; period: string }

export const PLAN_KOLONE = ["Klijent", "Lokacija", "Usluga", "Rok", "Status", "Periodika (mj)", "Odgovorna osoba", "Način"] as const
```

- [ ] **Step 4: Render the column in xlsx**

In `lib/plan-izvoz/xlsx.ts`, update the row push and widths:

```ts
  for (const r of rows) {
    ws.addRow([r.klijent, r.lokacija, r.usluga, r.rok, r.status, r.periodikaMj ?? "", r.odgovorna, r.nacin])
  }
  const sirine = [28, 20, 24, 14, 16, 14, 22, 14]
  sirine.forEach((w, i) => { ws.getColumn(i + 1).width = w })
```

- [ ] **Step 5: Run xlsx test to verify it passes**

Run: `pnpm vitest run lib/plan-izvoz/xlsx.test.ts`
Expected: PASS.

- [ ] **Step 6: Render the column in pdf**

In `lib/plan-izvoz/pdf.ts`, replace the `KOLONE` array with re-balanced widths (zbir = 782; isti raspoloživi prostor: W=842 − 2·margin 30) and add the value:

```ts
const KOLONE = [
  { label: "Klijent", w: 138 },
  { label: "Lokacija", w: 100 },
  { label: "Usluga", w: 128 },
  { label: "Rok", w: 66 },
  { label: "Status", w: 84 },
  { label: "Periodika", w: 62 },
  { label: "Odgovorna", w: 130 },
  { label: "Način", w: 74 },
] as const
```

And in the row loop, extend `vals` with the new value:

```ts
    const vals = [r.klijent, r.lokacija, r.usluga, r.rok, r.status, r.periodikaMj == null ? "-" : String(r.periodikaMj), r.odgovorna, r.nacin]
```

- [ ] **Step 7: Run pdf test to verify it still passes**

Run: `pnpm vitest run lib/plan-izvoz/pdf.test.ts`
Expected: PASS (postojeći testovi: `%PDF-`, prazni redovi, egzotični znakovi — `nacin` na `ROW` fixture-u nije postavljen pa je `undefined`; `skratiti(String(v ?? "-"), ...)` to već sigurno hendla → render „-"). Da test ostane realan, dodaj `nacin: "Izvršava"` na `ROW` fixture u `lib/plan-izvoz/pdf.test.ts`.

- [ ] **Step 8: Map `nacin` in the izvoz route**

In `app/api/plan-aktivnosti/izvoz/route.ts`, extend the `PlanRed` mapping (lines 50-58) by adding the `nacin` field:

```ts
  const rows: PlanRed[] = (data ?? []).map((t) => ({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? "—",
    usluga: t.vrsta_naziv ?? "—",
    rok: formatDatum(t.rok_dospijeca),
    status: STATUS_LABEL[toDerivedStatus(t.status_izvedeni)],
    periodikaMj: t.interval_mjeseci ?? null,
    odgovorna: t.zaduzeni ?? "—",
    nacin: t.nacin_izvrsenja === "pracenje" ? "Praćenje" : "Izvršava",
  }))
```

- [ ] **Step 9: Typecheck + full suite + build**

Run: `pnpm typecheck && pnpm test:unit && pnpm build`
Expected: zeleno; build prolazi (rute koriste novu kolonu).

- [ ] **Step 10: Commit**

```bash
git add lib/plan-izvoz/types.ts lib/plan-izvoz/xlsx.ts lib/plan-izvoz/pdf.ts lib/plan-izvoz/xlsx.test.ts lib/plan-izvoz/pdf.test.ts "app/api/plan-aktivnosti/izvoz/route.ts"
git commit -m "feat(izvoz): kolona Način u Excel i PDF"
```

---

### Task 4: Unos „načina izvršenja" (server action + forma)

**Files:**
- Modify: `app/(dashboard)/klijenti/actions.ts:212-269` (`createProfilProvjere`)
- Modify: `components/domain/DodajProvjeruButton.tsx`

**Interfaces:**
- Consumes: kolona `nacin_izvrsenja` na `klijent_provjere` i `termini` (Task 1).
- Produces: forma šalje `nacin_izvrsenja` (`"izvrsava"` default | `"pracenje"`); action ga upisuje u oba inserta.

- [ ] **Step 1: Read `nacin_izvrsenja` in the action**

In `app/(dashboard)/klijenti/actions.ts`, inside `createProfilProvjere`, after the existing `const zadnji_datum = ...` line (≈ line 222), add:

```ts
  const nacinRaw = String(formData.get("nacin_izvrsenja") ?? "izvrsava")
  const nacin_izvrsenja = nacinRaw === "pracenje" ? "pracenje" : "izvrsava"
```

- [ ] **Step 2: Write `nacin_izvrsenja` into the profil insert**

Update the `klijent_provjere` insert (≈ lines 245-248) to include the field:

```ts
  const { error: insErr } = await supabase.from("klijent_provjere").insert({
    klijent_id, vrsta_provjere_id, lokacija_id,
    interval_mjeseci: interval_override, zadnji_datum, nacin_izvrsenja,
  })
```

- [ ] **Step 3: Write `nacin_izvrsenja` into the generated termin insert**

Update the `termini` insert (≈ lines 261-264) to include the field:

```ts
    await supabase.from("termini").insert({
      klijent_id, vrsta_provjere_id, lokacija_id,
      rok_dospijeca: rok, status: "planirano", interval_mjeseci: interval, nacin_izvrsenja,
    })
```

- [ ] **Step 4: Add the form control**

In `components/domain/DodajProvjeruButton.tsx`, add state for the value near the other `useState` hooks (≈ line 28):

```tsx
  const [nacin, setNacin] = useState<"izvrsava" | "pracenje">("izvrsava")
```

Set it in the form `action` callback (after `fd.set("lokacija_id", lokId)`, ≈ line 54):

```tsx
            fd.set("nacin_izvrsenja", nacin)
```

Reset it on success inside the `useEffect` (next to `setVrstaId(""); setLokId("none")`, ≈ line 40):

```tsx
            setNacin("izvrsava")
```

And add the control before the submit button (after the „Zadnji put rađeno" `label` block, ≈ line 90):

```tsx
          <label className="block text-sm">
            <span className="text-slate-600">Način izvršenja *</span>
            <Select value={nacin} onValueChange={(v) => setNacin((v as "izvrsava" | "pracenje") ?? "izvrsava")} items={{ izvrsava: "TEHPRO izvršava", pracenje: "Samo praćenje roka" }}>
              <SelectTrigger className="w-full" data-testid="profil-nacin"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="izvrsava">TEHPRO izvršava</SelectItem>
                <SelectItem value="pracenje">Samo praćenje roka</SelectItem>
              </SelectContent>
            </Select>
          </label>
```

- [ ] **Step 5: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: zeleno.

- [ ] **Step 6: Manual smoke (lokalno dev)**

Run: `pnpm dev` → otvori klijenta → „Dodaj provjeru" → izaberi „Samo praćenje roka" → spasi.
Expected: profil i generisani termin imaju `nacin_izvrsenja = 'pracenje'` (provjeri u DB: `select nacin_izvrsenja from termini order by created_at desc limit 1;`).

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/klijenti/actions.ts" components/domain/DodajProvjeruButton.tsx
git commit -m "feat(klijenti): unos nacina izvrsenja pri kreiranju profila provjere"
```

---

### Task 5: Plan UI — badge „Samo praćenje" + filter „Način"

**Files:**
- Modify: `components/domain/TerminiTable.tsx:71`
- Modify: `components/domain/TerminiFilters.tsx`
- Modify: `app/(dashboard)/plan-aktivnosti/_views/lista.tsx:36-45`

**Interfaces:**
- Consumes: `TerminRow.nacin_izvrsenja` (Task 1); `nacin` search param (čita ga backend iz Task 2).
- Produces: vidljiva oznaka i dropdown; `lista.tsx` prosljeđuje `nacin` u `getTerminiLista`.

- [ ] **Step 1: Add the badge in `TerminiTable`**

In `components/domain/TerminiTable.tsx`, replace the „Vrsta" cell (line 71):

```tsx
              <td className="px-3 py-2 text-slate-600">
                {r.vrsta_naziv ?? "—"}
                {r.nacin_izvrsenja === "pracenje" && (
                  <span className="ml-2 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 align-middle">
                    Samo praćenje
                  </span>
                )}
              </td>
```

- [ ] **Step 2: Forward `nacin` from the lista view**

In `app/(dashboard)/plan-aktivnosti/_views/lista.tsx`, add the read (after line 30, `const mjesecFilter = ...`):

```tsx
  const nacinFilter = searchParams.get("nacin") ?? "svi"
```

And add it to the `filters` object (inside the object literal, after `godina: godinaFilter,`):

```tsx
    nacin: nacinFilter,
```

- [ ] **Step 3: Add the „Način" dropdown in `TerminiFilters`**

In `components/domain/TerminiFilters.tsx`, read the param near the others (after line 32, `const lokacijaId = ...`):

```tsx
  const nacin = params.get("nacin") ?? "svi"
```

Build its items map near the others (after line 42, `const mjesecItems = ...`):

```tsx
  const nacinItems: Record<string, string> = { svi: "Svi načini", izvrsava: "Izvršava", pracenje: "Samo praćenje" }
```

Add the `Select` after the „Mjesec" dropdown block (after the closing `</Select>` of the mjesec dropdown, ≈ line 167):

```tsx
      {/* Način izvršenja dropdown */}
      <Select value={nacin} onValueChange={(v) => setParam("nacin", v)} items={nacinItems}>
        <SelectTrigger className="w-40" data-testid="filter-nacin">
          <SelectValue placeholder="Svi načini" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="svi">Svi načini</SelectItem>
          <SelectItem value="izvrsava">Izvršava</SelectItem>
          <SelectItem value="pracenje">Samo praćenje</SelectItem>
        </SelectContent>
      </Select>
```

(`setParam` već briše param kad je vrijednost `"svi"` → čist URL i default „Svi načini".)

- [ ] **Step 4: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: zeleno.

- [ ] **Step 5: Manual smoke (lokalno dev)**

Run: `pnpm dev` → Plan aktivnosti.
Expected: red s `pracenje` ima badge „Samo praćenje"; dropdown „Način" = „Izvršava" sakriva ga, „Samo praćenje" prikazuje samo njih; „Svi načini" vraća sve; izvoz (Excel/PDF) poštuje izabrani „Način".

- [ ] **Step 6: Commit**

```bash
git add components/domain/TerminiTable.tsx components/domain/TerminiFilters.tsx "app/(dashboard)/plan-aktivnosti/_views/lista.tsx"
git commit -m "feat(plan): badge Samo pracenje + filter Nacin"
```

---

## Rollout (nakon svih taskova)

- Cijela suita: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` zeleno.
- Cloud migracija je već primijenjena (Task 1, Step 7) prije merge-a.
- Whole-branch review (opus) → merge PR → Vercel auto-deploy.
- Smoke na produkciji: dodaj profil „Samo praćenje" → badge + filter + izvoz kolona rade.

## Self-Review (spec coverage)

- §1 (migracija: enum, kolone, auto_cycle, view) → Task 1 ✔
- §2 (server action + UI unosa) → Task 4 ✔
- §3 (filter „Način" dijeljen lista↔izvoz) → Task 2 (backend) + Task 5 (UI) ✔
- §4 (oznaka u listi) → Task 5 ✔
- §5 (kolona „Način" u izvozu) → Task 3 ✔
- §6 (podsjetnici bez izmjena) → nema task (namjerno) ✔
- Testiranje (unit parse, xlsx/pdf kolona, integracija auto_cycle/view) → Task 1 (integracija), Task 2 (parse), Task 3 (builderi) ✔
- Type consistency: `nacin` (PlanFilteri/PlanRed) string; `nacin_izvrsenja` (DB/red) `"izvrsava"|"pracenje"`; labele „Izvršava"/„Praćenje" samo u izvozu i badge tekst „Samo praćenje" — konzistentno korišteno.
