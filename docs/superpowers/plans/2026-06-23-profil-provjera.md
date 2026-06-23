# Profil provjera po klijentu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klijent dobija "profil provjera" (lista vrsta + opciono lokacija + interval + zadnji datum); iz svake stavke se generiše jedan sljedeći termin, a postojeći auto-cycle nastavlja ponavljanje.

**Architecture:** Nova tabela `klijent_provjere` (standing zapis). Server akcija pri dodavanju stavke računa `rok = zadnji_datum + interval` (`addMjeseci`) i kreira jedan termin ako već ne postoji aktivan za (klijent+vrsta+lokacija). UI: novi tab "Profil" u klijent detaljima (lista + dodaj/obriši stavku).

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Tailwind v4, base-ui Sheet/Dialog/Select, Supabase (cloud), `pg` (jednokratni DDL), vitest, Playwright e2e (cloud), pnpm.

## Global Constraints

- Grana: `feature/profil-provjera` (NE `main`). Već kreirana i aktivna.
- Cloud Supabase — DDL preko `pg`-skripte koja izvršava SAMO novu migraciju (`DATABASE_URL` iz `.env.local`); NE `supabase db push` (pokupio bi necommitovanu reminders WIP migraciju). DML/upiti preko `@supabase/supabase-js`.
- ⚠️ Cloud auto-uključuje RLS na nove tabele → migracija mora `ALTER TABLE klijent_provjere DISABLE ROW LEVEL SECURITY`.
- Bez duplikata: generisanje termina provjerava postojeći AKTIVAN termin (status ∉ {izvrseno, otkazano}) za (klijent+vrsta+lokacija).
- Desktop-only: zabranjen `sm:`/`md:` breakpoint. ESLint `no-await-in-loop` (skripte: scoped disable).
- e2e protiv cloud-a + throwaway klijent (`"E2E-TMP " + Date.now()`) + `finally { deleteTerminiByKlijent(kid); deleteKlijentByNaziv(naziv) }` (klijent_provjere.klijent_id je ON DELETE CASCADE → profil-stavke nestaju s klijentom). Playwright `--workers=1`, warm server.
- AGENTS.md: NIJE standardni Next.js — kod iz plana je tačan; po potrebi `node_modules/next/dist/docs/`.
- FK: `klijent_provjere.klijent_id` CASCADE; `vrsta_provjere_id` RESTRICT; `lokacija_id` SET NULL.

---

### Task 1: `addMjeseci` helper + unit testovi

**Files:**
- Modify: `lib/date.ts` (dodati `addMjeseci`)
- Test: `lib/date.test.ts` (dodati `describe("addMjeseci")`)

**Interfaces:**
- Produces: `addMjeseci(isoDatum: string, mjeseci: number): string` (ISO "YYYY-MM-DD", TZ-safe, clamp na zadnji dan kraćeg mjeseca).

- [ ] **Step 1: Napisati padajuće testove u `lib/date.test.ts`**

Dodati (uz postojeći import iz `./date` proširiti na `addMjeseci`):
```ts
describe("addMjeseci", () => {
  it("dodaje mjesece unutar godine", () => {
    expect(addMjeseci("2026-03-15", 3)).toBe("2026-06-15")
  })
  it("prelazi godinu", () => {
    expect(addMjeseci("2026-11-15", 3)).toBe("2027-02-15")
  })
  it("clamp na zadnji dan kraćeg mjeseca (31 jan +1 → 28 feb)", () => {
    expect(addMjeseci("2026-01-31", 1)).toBe("2026-02-28")
  })
  it("prestupna godina (29 feb)", () => {
    expect(addMjeseci("2024-01-31", 1)).toBe("2024-02-29")
  })
  it("0 i 12 mjeseci", () => {
    expect(addMjeseci("2026-05-10", 0)).toBe("2026-05-10")
    expect(addMjeseci("2026-05-10", 12)).toBe("2027-05-10")
  })
})
```

- [ ] **Step 2: Pokrenuti — mora pasti**

Run: `pnpm exec vitest run lib/date.test.ts`
Expected: FAIL ("addMjeseci is not a function").

- [ ] **Step 3: Implementirati `addMjeseci` u `lib/date.ts`**

```ts
/** Datum (ISO 'YYYY-MM-DD') + N mjeseci, TZ-safe; clamp na zadnji dan ako kraći mjesec. */
export function addMjeseci(isoDatum: string, mjeseci: number): string {
  const [g, m, d] = isoDatum.split("-").map(Number)
  const baza = new Date(Date.UTC(g!, m! - 1, 1)) // prvi dan, izbjegava overflow
  baza.setUTCMonth(baza.getUTCMonth() + mjeseci)
  const ciljG = baza.getUTCFullYear()
  const ciljM = baza.getUTCMonth() // 0-indeksiran
  const zadnjiDan = new Date(Date.UTC(ciljG, ciljM + 1, 0)).getUTCDate()
  const dan = Math.min(d!, zadnjiDan)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${ciljG}-${pad(ciljM + 1)}-${pad(dan)}`
}
```

- [ ] **Step 4: Pokrenuti — mora proći**

Run: `pnpm exec vitest run lib/date.test.ts`
Expected: PASS (svi addMjeseci + postojeći date testovi).

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 6: Commit**

```bash
git add lib/date.ts lib/date.test.ts
git commit -m "feat(profil): addMjeseci helper (rok = zadnji + interval)"
```

---

### Task 2: Migracija `klijent_provjere` + primjena na cloud + TS tipovi

**Files:**
- Create: `supabase/migrations/20260623160000_klijent_provjere.sql`
- Create: `scripts/apply-cloud-migration.ts`
- Modify: `package.json` (dev dep `pg`, `@types/pg`; npm script `db:apply-cloud`)
- Modify: `db/types.ts` (regen — dobija `klijent_provjere`)

**Interfaces:**
- Produces: tabela `klijent_provjere` na cloud-u; `Database["public"]["Tables"]["klijent_provjere"]` tip.

- [ ] **Step 1: Napisati migraciju `supabase/migrations/20260623160000_klijent_provjere.sql`**

```sql
-- Profil provjera po klijentu: koje vrste klijent ima (opciono na lokaciji), interval, zadnji datum.
-- IF NOT EXISTS svuda → migracija je re-run sigurna (review-loop može ponoviti apply).
create table if not exists klijent_provjere (
  id                uuid primary key default gen_random_uuid(),
  klijent_id        uuid not null references klijenti(id) on delete cascade,
  vrsta_provjere_id uuid not null references vrste_provjera(id) on delete restrict,
  lokacija_id       uuid references lokacije(id) on delete set null,
  interval_mjeseci  int check (interval_mjeseci is null or interval_mjeseci between 1 and 120),
  zadnji_datum      date not null,
  aktivan           bool not null default true,
  created_at        timestamptz not null default now()
);

create unique index if not exists uq_klijent_provjere
  on klijent_provjere (klijent_id, vrsta_provjere_id, coalesce(lokacija_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_klijent_provjere_klijent on klijent_provjere (klijent_id);

-- App koristi anon ključ bez Auth-a → RLS off (kao ostale tabele)
alter table klijent_provjere disable row level security;
```

- [ ] **Step 2: Dodati `pg` i napisati `scripts/apply-cloud-migration.ts`**

Run: `pnpm add -D pg @types/pg`

```ts
/**
 * Primjenjuje JEDAN SQL migracioni fajl na cloud preko DATABASE_URL (session pooler).
 * Pokretanje: pnpm db:apply-cloud supabase/migrations/<fajl>.sql
 */
import { readFileSync } from "node:fs"
import { Client } from "pg"

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("Putanja do .sql fajla je obavezna")
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL nije postavljen")
  const sql = readFileSync(file, "utf8")
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(sql)
    console.log(`✅ Primijenjeno: ${file}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
```

Dodati u `package.json` `"scripts"`:
```json
    "db:apply-cloud": "tsx --env-file=.env.local scripts/apply-cloud-migration.ts",
```

- [ ] **Step 3: Primijeniti migraciju na cloud**

Run: `pnpm db:apply-cloud supabase/migrations/20260623160000_klijent_provjere.sql`
Expected: `✅ Primijenjeno: supabase/migrations/20260623160000_klijent_provjere.sql`. (Migracija je `if not exists` → ponovni run je bezopasan/idempotentan.)

- [ ] **Step 4: Verifikovati tabelu na cloud-u**

```bash
cat > ./_v.mjs <<'EOF'
import { createClient } from "@supabase/supabase-js"; import { readFileSync } from "fs"
const env=Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY)
const {error,count}=await sb.from("klijent_provjere").select("id",{count:"exact",head:true})
console.log(error ? "GREŠKA: "+error.message : "klijent_provjere OK, redova: "+count)
EOF
node ./_v.mjs; rm -f ./_v.mjs
```
Expected: `klijent_provjere OK, redova: 0`.

- [ ] **Step 5: Regenerisati TS tipove iz cloud-a**

Run: `supabase gen types typescript --db-url "$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)" > db/types.ts`
Zatim: `git diff --stat db/types.ts` — očekuje se dodatak `klijent_provjere` u `public.Tables`. Provjeriti `git diff db/types.ts` da je dodata SAMO `klijent_provjere` tabela (+ eventualne relacije); ako se pojave nepovezane promjene (npr. iz neke cloud razlike), zadržati samo dodatak `klijent_provjere` (ručno vratiti ostalo). `pnpm typecheck` mora proći.

- [ ] **Step 6: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260623160000_klijent_provjere.sql scripts/apply-cloud-migration.ts package.json pnpm-lock.yaml db/types.ts
git commit -m "feat(profil): klijent_provjere tabela + cloud apply skripta + tipovi"
```

---

### Task 3: Tab "Profil" + lista + brisanje stavke

**Files:**
- Modify: `components/domain/KlijentTabs.tsx` (5. tab)
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (VALID_TABS + dohvat + render ProfilTab)
- Create: `components/domain/ProfilTab.tsx`
- Create: `components/domain/ObrisiProfilButton.tsx`
- Modify: `app/(dashboard)/klijenti/actions.ts` (`deleteProfilProvjere`)
- Test: `tests/e2e/16-profil.spec.ts` (tab + empty state)

**Interfaces:**
- Consumes: `addMjeseci` iz `@/lib/date`.
- Produces: `deleteProfilProvjere(prev: ActionResult, formData: FormData): Promise<ActionResult>`; `ProfilTab` prima `{ stavke: ProfilStavka[] }`; tip `ProfilStavka = { id: string; vrsta_naziv: string; lokacija_naziv: string | null; interval_mjeseci: number | null; zadnji_datum: string; sljedeci_rok: string }`.

- [ ] **Step 1: Dodati `deleteProfilProvjere` u `app/(dashboard)/klijenti/actions.ts`**

Uz postojeće akcije (koristi isti `ActionResult` tip i `createServerSupabaseClient`):
```ts
export async function deleteProfilProvjere(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "Nedostaje id." }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijent_provjere").delete().eq("id", id)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
```

- [ ] **Step 2: Dodati 5. tab u `components/domain/KlijentTabs.tsx`**

U `TABS` niz dodati na kraj:
```ts
  { value: "profil", label: "Profil" },
```

- [ ] **Step 3: `components/domain/ObrisiProfilButton.tsx` (Dialog dva-koraka)**

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { deleteProfilProvjere, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function ObrisiProfilButton({ id }: { id: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(deleteProfilProvjere, initial)
  const submitted = useRef(false)
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="obrisi-profil-btn">Obriši</Button>
        }
      />
      <DialogContent data-testid="obrisi-profil-dialog">
        <DialogHeader>
          <DialogTitle>Ukloniti provjeru iz profila?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">
          Uklanja stavku iz profila. Postojeći termini ostaju (vode se kroz Termini).
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Otkaži</Button>} />
          <form action={(fd) => { submitted.current = true; action(fd) }}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="destructive" disabled={pending} data-testid="obrisi-profil-potvrdi">
              {pending ? "Brišem…" : "Ukloni"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: `components/domain/ProfilTab.tsx` (lista + Dodaj dugme placeholder)**

```tsx
import { DodajProvjeruButton } from "@/components/domain/DodajProvjeruButton"
import { ObrisiProfilButton } from "@/components/domain/ObrisiProfilButton"
import { formatDatum } from "@/lib/date"

export type ProfilStavka = {
  id: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  interval_mjeseci: number | null
  zadnji_datum: string
  sljedeci_rok: string
}

export function ProfilTab({
  klijentId,
  stavke,
  vrste,
  lokacije,
}: {
  klijentId: string
  stavke: ProfilStavka[]
  vrste: { id: string; naziv: string; interval: number | null }[]
  lokacije: { id: string; naziv: string }[]
}) {
  return (
    <div data-testid="tab-profil-content" className="space-y-4">
      <div className="flex justify-end">
        <DodajProvjeruButton klijentId={klijentId} vrste={vrste} lokacije={lokacije} />
      </div>
      {stavke.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Nema provjera u profilu. Dodajte provjeru da generišete termine.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Vrsta", "Lokacija", "Interval (mj)", "Zadnji put", "Sljedeći rok", ""].map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stavke.map((s) => (
                <tr key={s.id} data-testid="profil-row" className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{s.vrsta_naziv}</td>
                  <td className="px-3 py-2 text-slate-600">{s.lokacija_naziv ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{s.interval_mjeseci ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{formatDatum(s.zadnji_datum)}</td>
                  <td className="px-3 py-2 tabular-nums font-medium">{formatDatum(s.sljedeci_rok)}</td>
                  <td className="px-3 py-2 text-right"><ObrisiProfilButton id={s.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

NAPOMENA: `DodajProvjeruButton` se pravi u Tasku 4 — DA BI OVAJ TASK KOMPAJLIRAO, kreirati MINIMALNI stub `components/domain/DodajProvjeruButton.tsx` koji prima props `{ klijentId, vrste, lokacije }` i renderuje `<Button data-testid="dodaj-provjeru-btn">Dodaj provjeru</Button>` (puna forma u Tasku 4). Tako je Task 3 nezavisno testabilan.

- [ ] **Step 5: Minimalni stub `components/domain/DodajProvjeruButton.tsx`**

```tsx
"use client"
import { Button } from "@/components/ui/button"

export function DodajProvjeruButton({
  klijentId, vrste, lokacije,
}: {
  klijentId: string
  vrste: { id: string; naziv: string; interval: number | null }[]
  lokacije: { id: string; naziv: string }[]
}) {
  void klijentId; void vrste; void lokacije
  return <Button data-testid="dodaj-provjeru-btn">Dodaj provjeru</Button>
}
```

- [ ] **Step 6: Dohvat + render u `app/(dashboard)/klijenti/[id]/page.tsx`**

`VALID_TABS` (linija 18) → dodati `"profil"`:
```ts
const VALID_TABS = ["termini", "lokacije", "kontakti", "dokumenti", "profil"]
```

Dodati dohvat profil-stavki + vrsta/lokacija liste (uz postojeće upite; vrste su globalne). Poslije postojećih fetch-eva:
```ts
  const [profilRes, vrsteRes] = await Promise.all([
    supabase
      .from("klijent_provjere")
      .select("id, interval_mjeseci, zadnji_datum, vrsta_provjere:vrste_provjera(naziv, podrazumevani_interval_mjeseci), lokacija:lokacije(naziv)")
      .eq("klijent_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("vrste_provjera").select("id, naziv, podrazumevani_interval_mjeseci").eq("aktivna", true).order("naziv"),
  ])
  const { addMjeseci } = await import("@/lib/date")
  const profilStavke = (profilRes.data ?? []).map((p) => {
    const interval = p.interval_mjeseci ?? (p.vrsta_provjere as { podrazumevani_interval_mjeseci: number | null } | null)?.podrazumevani_interval_mjeseci ?? null
    return {
      id: p.id as string,
      vrsta_naziv: (p.vrsta_provjere as { naziv: string } | null)?.naziv ?? "—",
      lokacija_naziv: (p.lokacija as { naziv: string } | null)?.naziv ?? null,
      interval_mjeseci: p.interval_mjeseci as number | null,
      zadnji_datum: p.zadnji_datum as string,
      sljedeci_rok: interval ? addMjeseci(p.zadnji_datum as string, interval) : (p.zadnji_datum as string),
    }
  })
  const vrsteOpcije = (vrsteRes.data ?? []).map((v) => ({ id: v.id as string, naziv: v.naziv as string, interval: v.podrazumevani_interval_mjeseci as number | null }))
  const lokacijeOpcije = lokacije.map((l) => ({ id: l.id, naziv: l.naziv }))
```
(`import` `addMjeseci` može biti i statički na vrhu fajla umjesto dinamičkog — preferirati statički: `import { ..., addMjeseci } from "@/lib/date"`.)

Render (uz ostale tab grane):
```tsx
      {tab === "profil" && (
        <ProfilTab klijentId={id} stavke={profilStavke} vrste={vrsteOpcije} lokacije={lokacijeOpcije} />
      )}
```
Import `ProfilTab` na vrhu.

- [ ] **Step 7: e2e `tests/e2e/16-profil.spec.ts` (tab + empty state)**

```ts
import { test, expect } from "@playwright/test"
import { insertKlijent, deleteTerminiByKlijent, deleteKlijentByNaziv } from "./db"

test.describe("Faza Profil — tab", () => {
  test("Profil tab prikazuje prazno stanje za novog klijenta", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await expect(page.getByTestId("dodaj-provjeru-btn")).toBeVisible()
      await expect(page.getByText("Nema provjera u profilu")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})
```

- [ ] **Step 8: Pokrenuti e2e (warm server)**

Zagrijati dev server, pa:
Run: `pnpm exec playwright test tests/e2e/16-profil.spec.ts --workers=1 --reporter=line`
Expected: PASS (cx+wk).

- [ ] **Step 9: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka.

- [ ] **Step 10: Commit**

```bash
git add components/domain/KlijentTabs.tsx components/domain/ProfilTab.tsx components/domain/ObrisiProfilButton.tsx components/domain/DodajProvjeruButton.tsx "app/(dashboard)/klijenti/[id]/page.tsx" "app/(dashboard)/klijenti/actions.ts" tests/e2e/16-profil.spec.ts
git commit -m "feat(profil): tab Profil + lista stavki + brisanje (stub Dodaj)"
```

---

### Task 4: `DodajProvjeruButton` forma + `createProfilProvjere` + generisanje termina

**Files:**
- Modify: `components/domain/DodajProvjeruButton.tsx` (puna Sheet forma)
- Modify: `app/(dashboard)/klijenti/actions.ts` (`createProfilProvjere`)
- Test: `tests/e2e/16-profil.spec.ts` (dodaj → termin generisan; duplikat; bez lokacije; brisanje)

**Interfaces:**
- Consumes: `addMjeseci` iz `@/lib/date`; `createServerSupabaseClient`; `ActionResult`.
- Produces: `createProfilProvjere(prev: ActionResult, formData: FormData): Promise<ActionResult>`.

- [ ] **Step 1: Napisati `createProfilProvjere` u `app/(dashboard)/klijenti/actions.ts`**

```ts
export async function createProfilProvjere(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const klijent_id = String(formData.get("klijent_id") ?? "")
  const vrsta_provjere_id = String(formData.get("vrsta_provjere_id") ?? "")
  const lokRaw = String(formData.get("lokacija_id") ?? "")
  const lokacija_id = lokRaw && lokRaw !== "none" ? lokRaw : null
  const intRaw = String(formData.get("interval_mjeseci") ?? "").trim()
  const interval_override = intRaw ? Number(intRaw) : null
  const zadnji_datum = String(formData.get("zadnji_datum") ?? "")

  if (!klijent_id || !vrsta_provjere_id || !zadnji_datum) {
    return { ok: false, message: "Vrsta i zadnji datum su obavezni." }
  }
  if (interval_override !== null && (!Number.isInteger(interval_override) || interval_override < 1 || interval_override > 120)) {
    return { ok: false, message: "Interval mora biti 1–120 mjeseci." }
  }

  const supabase = await createServerSupabaseClient()

  // lokacija mora pripadati klijentu
  if (lokacija_id) {
    const { data: lok } = await supabase.from("lokacije").select("id").eq("id", lokacija_id).eq("klijent_id", klijent_id).maybeSingle()
    if (!lok) return { ok: false, message: "Lokacija ne pripada klijentu." }
  }

  // interval: override → vrsta default
  const { data: vrsta } = await supabase.from("vrste_provjera").select("podrazumevani_interval_mjeseci").eq("id", vrsta_provjere_id).maybeSingle()
  const interval = interval_override ?? (vrsta?.podrazumevani_interval_mjeseci ?? null)
  if (!interval) return { ok: false, message: "Interval je obavezan (vrsta nema podrazumevani)." }

  // upiši profil-stavku
  const { error: insErr } = await supabase.from("klijent_provjere").insert({
    klijent_id, vrsta_provjere_id, lokacija_id,
    interval_mjeseci: interval_override, zadnji_datum,
  })
  if (insErr) {
    return insErr.code === "23505"
      ? { ok: false, message: "Ova provjera već postoji u profilu." }
      : { ok: false, message: insErr.message }
  }

  // generiši jedan termin ako ne postoji aktivan za (klijent+vrsta+lokacija)
  const { addMjeseci } = await import("@/lib/date")
  const rok = addMjeseci(zadnji_datum, interval)
  let q = supabase.from("termini").select("id").eq("klijent_id", klijent_id).eq("vrsta_provjere_id", vrsta_provjere_id).not("status", "in", "(izvrseno,otkazano)")
  q = lokacija_id ? q.eq("lokacija_id", lokacija_id) : q.is("lokacija_id", null)
  const { data: postoji } = await q.limit(1)
  if (!postoji || postoji.length === 0) {
    await supabase.from("termini").insert({
      klijent_id, vrsta_provjere_id, lokacija_id,
      rok_dospijeca: rok, status: "planirano", interval_mjeseci: interval,
    })
  }

  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}
```
(`revalidatePath` se već importuje u `actions.ts`; provjeriti.)

- [ ] **Step 2: Puna Sheet forma u `components/domain/DodajProvjeruButton.tsx`**

```tsx
"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { createProfilProvjere, type ActionResult } from "@/app/(dashboard)/klijenti/actions"

const initial: ActionResult = { ok: true }

export function DodajProvjeruButton({
  klijentId, vrste, lokacije,
}: {
  klijentId: string
  vrste: { id: string; naziv: string; interval: number | null }[]
  lokacije: { id: string; naziv: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [vrstaId, setVrstaId] = useState("")
  const [lokId, setLokId] = useState("none")
  const [state, action, pending] = useActionState(createProfilProvjere, initial)
  const submitted = useRef(false)

  const vrstaItems: Record<string, string> = Object.fromEntries(vrste.map((v) => [v.id, v.naziv]))
  const lokItems: Record<string, string> = { none: "— bez lokacije —", ...Object.fromEntries(lokacije.map((l) => [l.id, l.naziv])) }
  const intervalPlaceholder = String(vrste.find((v) => v.id === vrstaId)?.interval ?? "")

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      setOpen(false)
      setVrstaId(""); setLokId("none")
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button data-testid="dodaj-provjeru-btn"><Plus className="w-4 h-4" aria-hidden /> Dodaj provjeru</Button>} />
      <SheetContent side="right" className="w-full lg:max-w-md flex flex-col" data-testid="dodaj-provjeru-sheet">
        <SheetHeader><SheetTitle>Dodaj provjeru u profil</SheetTitle></SheetHeader>
        <form
          action={(fd) => {
            fd.set("klijent_id", klijentId)
            fd.set("vrsta_provjere_id", vrstaId)
            fd.set("lokacija_id", lokId)
            submitted.current = true
            action(fd)
          }}
          className="flex-1 overflow-auto px-4 space-y-3"
          data-testid="dodaj-provjeru-form"
        >
          <label className="block text-sm">
            <span className="text-slate-600">Vrsta *</span>
            <Select value={vrstaId} onValueChange={(v) => setVrstaId(v ?? "")} items={vrstaItems}>
              <SelectTrigger className="w-full" data-testid="profil-vrsta"><SelectValue placeholder="Izaberi vrstu" /></SelectTrigger>
              <SelectContent>
                {vrste.map((v) => <SelectItem key={v.id} value={v.id}>{v.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Lokacija</span>
            <Select value={lokId} onValueChange={(v) => setLokId(v ?? "none")} items={lokItems}>
              <SelectTrigger className="w-full" data-testid="profil-lokacija"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— bez lokacije —</SelectItem>
                {lokacije.map((l) => <SelectItem key={l.id} value={l.id}>{l.naziv}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Interval (mjeseci) — prazno = podrazumevani vrste</span>
            <Input name="interval_mjeseci" type="number" min={1} max={120} placeholder={intervalPlaceholder || "npr. 12"} data-testid="profil-interval" />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">Zadnji put rađeno *</span>
            <Input name="zadnji_datum" type="date" required data-testid="profil-zadnji-datum" />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-red-600" role="alert">{state.message}</p>
          )}

          <Button type="submit" disabled={pending || !vrstaId} data-testid="profil-submit">
            {pending ? "Dodajem…" : "Dodaj i generiši termin"}
          </Button>
        </form>
        <SheetFooter>
          <SheetClose render={<Button variant="outline">Otkaži</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3: Dodati e2e u `tests/e2e/16-profil.spec.ts` (puni tok)**

Dodati novi describe blok:
```ts
import { firstActiveVrstaId } from "./db"

test.describe("Faza Profil — dodavanje i generisanje termina", () => {
  test("dodaj provjeru → stavka + generisan termin; duplikat odbijen", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("profil-interval").fill("12")
      await page.getByTestId("profil-zadnji-datum").fill("2026-01-10")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeHidden({ timeout: 5000 })
      // stavka u tabeli
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      // sljedeći rok = 2027-01-10
      await expect(page.getByTestId("profil-row")).toContainText("2027")
      // termin generisan → vidljiv na /termini filtriran po klijentu
      await page.goto(`/termini?klijent_id=${kid}`)
      await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
      // duplikat profila odbijen
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await page.getByTestId("dodaj-provjeru-btn").click()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("profil-zadnji-datum").fill("2026-02-01")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByText("Ova provjera već postoji u profilu.")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("brisanje stavke ne briše generisani termin", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await page.getByTestId("dodaj-provjeru-btn").click()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("profil-interval").fill("6")
      await page.getByTestId("profil-zadnji-datum").fill("2026-03-01")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      // obriši stavku
      await page.getByTestId("obrisi-profil-btn").click()
      await page.getByTestId("obrisi-profil-potvrdi").click()
      await expect(page.getByTestId("profil-row")).toHaveCount(0)
      // termin i dalje postoji
      await page.goto(`/termini?klijent_id=${kid}`)
      await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})
```
NAPOMENA: `firstActiveVrstaId` import nije nužan ako e2e bira vrstu kroz UI (prvi option). Ukloniti ako se ne koristi.

- [ ] **Step 4: Pokrenuti e2e (warm server, --workers=1)**

Run: `pnpm exec playwright test tests/e2e/16-profil.spec.ts --workers=1 --reporter=line`
Expected: sve zeleno (3 testa × 2 browsera).

- [ ] **Step 5: Lint + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: 0 grešaka.

- [ ] **Step 6: Higijena-provjera (suite ne ostavlja junk)**

Prebroj klijente prije/poslije punog `16-profil` runa (node snippet kao u ranijim fazama) — **prije == poslije** (throwaway cleanup u finally). Ugasiti server.

- [ ] **Step 7: Commit**

```bash
git add components/domain/DodajProvjeruButton.tsx "app/(dashboard)/klijenti/actions.ts" tests/e2e/16-profil.spec.ts
git commit -m "feat(profil): forma Dodaj provjeru + createProfilProvjere (generiše termin, bez duplikata)"
```

---

## Završna verifikacija (cijela grana)

- [ ] `pnpm lint && pnpm typecheck && pnpm build` — 0 grešaka; `pnpm exec vitest run lib/date.test.ts` zeleno.
- [ ] Cloud: `klijent_provjere` postoji (RLS off).
- [ ] `16-profil` zelen; klijent-broj prije==poslije (higijena).
- [ ] Regresija: `04-klijenti`, `03-termini`, `10-pregled` zeleni.
- [ ] Vizuelno: Profil tab — dodaj provjeru → stavka + sljedeći rok; termin se pojavi u Termini/Plan; brisanje stavke ne dira termin.
