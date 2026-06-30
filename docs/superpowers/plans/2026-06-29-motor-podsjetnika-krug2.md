# Motor podsjetnika — Krug 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Podsjetnik za firmu ide dodijeljenim radnicima te firme (preko postojeće `korisnik_klijent` dodjele) + adminima, a admin po korisniku odlučuje ko prima (`prima_podsjetnike` flag).

**Architecture:** Čista rezolucija primalaca (`buildRecipientIndex` + `recipientsForKlijent` u `lib/reminders/recipients.ts`) koju `runReminders` puni iz `korisnici` + `korisnik_klijent` jednom po run-u i primjenjuje **po redu** (svaki termin nosi `klijent_id`). Per-korisnik flag `korisnici.prima_podsjetnike` + toggle u `Postavke→Korisnici`.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres/RLS), `@supabase/supabase-js`, Vitest, `pg` (integracija), pnpm.

## Global Constraints

- Package manager **pnpm**; dev server uvijek `--webpack` (razmak u putanji).
- Domenski jezik bosanski/srpski (latinica); prati postojeće obrasce (`postaviAktivan`, `DodjelaKlijenata`).
- **Klijent se NIKAD ne kontaktira** — primaoci su isključivo interni korisnici (admin/operater/pregled) + opcioni `REMINDER_TO`.
- Primalac je eligibilan akko `aktivan = true` **i** `prima_podsjetnike = true`; uz to mora biti `uloga='admin'` **ili** dodijeljen toj firmi (`korisnik_klijent`).
- `db/types.ts` je auto-generisan (`supabase gen types ... --local`), nikad ručno.
- Throttling (cap/grupe) i idempotencija po `(termin_id, dana_prije)` iz Krug 1 + A **ostaju netaknuti**; mijenja se samo *koji* su primaoci po redu.
- Lokalni Supabase (Docker) je UP (`127.0.0.1:54322`); `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Cloud se primjenjuje preko `db:apply-cloud` (zasebno).
- Bez `sm:`/`md:` Tailwind breakpointa (eslint); `no-await-in-loop` (osim `scripts/`).
- Grana: `feat/podsjetnici-po-dodjeli`.

---

### Task 1: Migracija — `korisnici.prima_podsjetnike` + tipovi

**Files:**
- Create: `supabase/migrations/20260629130000_korisnici_prima_podsjetnike.sql`
- Modify (generisano): `db/types.ts`

**Interfaces:**
- Produces: kolona `korisnici.prima_podsjetnike boolean not null default true`.

- [ ] **Step 1: Napiši migraciju**

`supabase/migrations/20260629130000_korisnici_prima_podsjetnike.sql`:
```sql
-- Krug 2: per-korisnik prekidač za email-podsjetnike.
-- Default true → postojeće ponašanje (admini primaju) ostaje; operateri se uključuju kad Krug 2 krene.
alter table korisnici
  add column prima_podsjetnike boolean not null default true;
```

- [ ] **Step 2: Primijeni lokalno**

Run: `pnpm db:reset`
Expected: sve migracije prolaze bez greške.

- [ ] **Step 3: Regeneriši tipove**

Run: `supabase gen types typescript --local | grep -vE '^(Connecting to db|A new version of Supabase|We recommend updating)' > db/types.ts`
Expected: `db/types.ts` počinje s `export type Json =`; `korisnici` Row sadrži `prima_podsjetnike: boolean`. Provjeri: `grep -n "prima_podsjetnike" db/types.ts` (≥1 pogodak) i `pnpm typecheck 2>&1 | grep 'db/types.ts' || echo "db/types.ts CLEAN"` → `db/types.ts CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260629130000_korisnici_prima_podsjetnike.sql db/types.ts
git commit -m "feat(podsjetnici): kolona korisnici.prima_podsjetnike (Krug 2)"
```

---

### Task 2: Čista rezolucija primalaca (`lib/reminders/recipients.ts`)

**Files:**
- Modify: `lib/reminders/recipients.ts`
- Test: `lib/reminders/recipients.test.ts`

**Interfaces:**
- Consumes: `assembleRecipients({ base, adminEmails })` (postoji), `parseEmailList` (postoji).
- Produces:
  - `type KorisnikRow = { id: string; email: string; uloga: string; aktivan: boolean; prima_podsjetnike: boolean }`
  - `type RecipientIndex = { adminEmails: string[]; assignedByKlijent: Map<string, string[]> }`
  - `buildRecipientIndex(korisnici: KorisnikRow[], dodjele: { korisnik_id: string; klijent_id: string }[]): RecipientIndex`
  - `recipientsForKlijent(index: RecipientIndex, klijentId: string, base: string[]): string[]`

- [ ] **Step 1: Dodaj testove** (na kraj `lib/reminders/recipients.test.ts`, prije EOF)

```ts
import { buildRecipientIndex, recipientsForKlijent } from "./recipients"

const K = (id: string, email: string, uloga: string, extra?: Partial<{ aktivan: boolean; prima_podsjetnike: boolean }>) => ({
  id, email, uloga, aktivan: extra?.aktivan ?? true, prima_podsjetnike: extra?.prima_podsjetnike ?? true,
})

describe("buildRecipientIndex + recipientsForKlijent", () => {
  it("operater dobija svoju firmu, ne tuđu; admin dobija sve firme", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin"), K("o1", "op1@x.com", "operater"), K("o2", "op2@x.com", "operater")],
      [{ korisnik_id: "o1", klijent_id: "FA" }, { korisnik_id: "o2", klijent_id: "FB" }],
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["op1@x.com", "admin@x.com"])
    expect(recipientsForKlijent(idx, "FB", [])).toEqual(["op2@x.com", "admin@x.com"])
  })

  it("prima_podsjetnike=false isključuje (i operatera i admina)", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin", { prima_podsjetnike: false }), K("o1", "op1@x.com", "operater", { prima_podsjetnike: false })],
      [{ korisnik_id: "o1", klijent_id: "FA" }],
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual([])
  })

  it("neaktivan korisnik se ignoriše", () => {
    const idx = buildRecipientIndex([K("o1", "op1@x.com", "operater", { aktivan: false })], [{ korisnik_id: "o1", klijent_id: "FA" }])
    expect(recipientsForKlijent(idx, "FA", [])).toEqual([])
  })

  it("firma bez dodjele → samo admini; base (REMINDER_TO) se dodaje i dedupira", () => {
    const idx = buildRecipientIndex([K("a", "admin@x.com", "admin")], [])
    expect(recipientsForKlijent(idx, "FX", ["admin@x.com", "bcc@x.com"])).toEqual(["admin@x.com", "bcc@x.com"])
  })

  it("pregled dodijeljen + prima → dobija (flag je kapija, ne uloga)", () => {
    const idx = buildRecipientIndex([K("p", "pregled@x.com", "pregled")], [{ korisnik_id: "p", klijent_id: "FA" }])
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["pregled@x.com"])
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: FAIL ("buildRecipientIndex is not a function" / import error).

- [ ] **Step 3: Implementiraj** (dodaj na kraj `lib/reminders/recipients.ts`)

```ts
export type KorisnikRow = {
  id: string
  email: string
  uloga: string
  aktivan: boolean
  prima_podsjetnike: boolean
}

export type RecipientIndex = { adminEmails: string[]; assignedByKlijent: Map<string, string[]> }

/** Indeks primalaca: admini (eligibilni) + mapa klijent_id → email-ovi dodijeljenih (eligibilnih). */
export function buildRecipientIndex(
  korisnici: KorisnikRow[],
  dodjele: { korisnik_id: string; klijent_id: string }[],
): RecipientIndex {
  const eligibleEmail = new Map<string, string>() // id → email (aktivan + prima_podsjetnike)
  const adminEmails: string[] = []
  for (const k of korisnici) {
    if (!k.aktivan || !k.prima_podsjetnike) continue
    eligibleEmail.set(k.id, k.email)
    if (k.uloga === "admin") adminEmails.push(k.email)
  }
  const assignedByKlijent = new Map<string, string[]>()
  for (const d of dodjele) {
    const email = eligibleEmail.get(d.korisnik_id)
    if (!email) continue
    const arr = assignedByKlijent.get(d.klijent_id) ?? []
    arr.push(email)
    assignedByKlijent.set(d.klijent_id, arr)
  }
  return { adminEmails, assignedByKlijent }
}

/** Primaoci za jednu firmu: dodijeljeni ∪ admini ∪ REMINDER_TO (dedupe/validacija preko assembleRecipients). */
export function recipientsForKlijent(index: RecipientIndex, klijentId: string, base: string[]): string[] {
  const assigned = index.assignedByKlijent.get(klijentId) ?? []
  return assembleRecipients({ base, adminEmails: [...assigned, ...index.adminEmails] })
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: PASS (svi, uključujući 5 novih).

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/recipients.ts lib/reminders/recipients.test.ts
git commit -m "feat(podsjetnici): rezolver primalaca po dodjeli + prima_podsjetnike flag"
```

---

### Task 3: Wiring rezolvera u `runReminders`

**Files:**
- Modify: `lib/reminders/runReminders.ts`
- Test: `lib/reminders/runReminders.test.ts`

**Interfaces:**
- Consumes: `buildRecipientIndex`, `recipientsForKlijent`, `parseEmailList` (Task 2); RPC kolona `klijent_id`.
- Produces: `runReminders` čita `korisnici` (`id,email,uloga,aktivan,prima_podsjetnike`) + `korisnik_klijent`, gradi indeks jednom, i računa `to` **po redu** preko `recipientsForKlijent`.

- [ ] **Step 1: Zamijeni uvoz i ukloni stari `internalRecipients`** (`lib/reminders/runReminders.ts`)

Zamijeni postojeću import liniju za recipients:
```ts
import { recipientsForKlijent, buildRecipientIndex, parseEmailList } from "@/lib/reminders/recipients"
```
(uklonjen `assembleRecipients` iz importa jer ga `runReminders` više ne zove direktno).

Ukloni cijelu funkciju `internalRecipients` (od `/** Interni primaoci (Krug 1)...` do njenog zatvarajućeg `}`).

- [ ] **Step 2: Zamijeni izračun primalaca + null-check + `to`**

Zamijeni blok koji počinje s `// Primaoci se računaju JEDNOM po pokretanju (Krug 1: isti za sve termine).` i liniju `const to = await internalRecipients(supabase)` te `if (to.length === 0 && rows.length > 0) {...}` ovim:

```ts
  // Indeks primalaca (jednom po run-u): admini + mapa klijent_id → dodijeljeni; eligibilnost = aktivan & prima_podsjetnike.
  const base = parseEmailList(env.REMINDER_TO)
  const { data: korisnici, error: korErr } = await supabase
    .from("korisnici")
    .select("id, email, uloga, aktivan, prima_podsjetnike")
  if (korErr) throw new Error(`Greška pri čitanju primalaca (korisnici): ${korErr.message}`)
  const { data: dodjele, error: kkErr } = await supabase
    .from("korisnik_klijent")
    .select("korisnik_id, klijent_id")
  if (kkErr) throw new Error(`Greška pri čitanju dodjela (korisnik_klijent): ${kkErr.message}`)
  const recipientIndex = buildRecipientIndex(korisnici ?? [], dodjele ?? [])
  if (recipientIndex.adminEmails.length === 0 && recipientIndex.assignedByKlijent.size === 0 && rows.length > 0) {
    console.warn("[reminders] nema eligibilnih primalaca (admini/dodjele s prima_podsjetnike) — sve se preskače")
  }
```

- [ ] **Step 3: U `processRow`, dodaj `klijent_id` u null-check i izračunaj `to` po redu**

U null-check uslovu (`if ( r.termin_id == null || ... )`) dodaj liniju `r.klijent_id == null ||` (uz ostale). Odmah nakon null-checka, **prije** `try {`, zamijeni stari `if (to.length === 0) {...}` ovim:

```ts
      const to = recipientsForKlijent(recipientIndex, r.klijent_id, base)
      if (to.length === 0) {
        return { kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "nema primalaca" }
      }
```
(`to` se sada koristi u `send({...})` i `insert({ poslat_na: to })` kao i ranije — bez drugih izmjena u `try`.)

- [ ] **Step 4: Ažuriraj test fake i testove** (`lib/reminders/runReminders.test.ts`)

Zamijeni `makeFake` i pomoćne tipove tako da vraća `korisnici` + `korisnik_klijent` umjesto `admins`:

```ts
type KorRow = { id: string; email: string; uloga: string; aktivan: boolean; prima_podsjetnike: boolean }

function makeFake(opts: {
  danaPrije?: number[]
  korisnici?: KorRow[]
  kk?: { korisnik_id: string; klijent_id: string }[]
  dueRows?: DueRow[]
  korisniciError?: string
}) {
  const inserts: Array<Record<string, unknown>> = []
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { dana_prije: opts.danaPrije ?? [60, 30, 15, 7] }, error: null }) }) }) }
      }
      if (table === "korisnici") {
        return { select: async () => (opts.korisniciError ? { data: null, error: { message: opts.korisniciError } } : { data: opts.korisnici ?? [], error: null }) }
      }
      if (table === "korisnik_klijent") {
        return { select: async () => ({ data: opts.kk ?? [], error: null }) }
      }
      if (table === "podsjetnici") {
        return { insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null } } }
      }
      throw new Error(`neočekivan from(${table})`)
    },
    rpc: async () => ({ data: opts.dueRows ?? [], error: null }),
  }
  return { supabase: fake as unknown as SupabaseClient<Database>, inserts }
}
```

`baseRow` dobija eksplicitan `klijent_id` (već ima `klijent_id: "k1"`). Zamijeni postojeće testove koji koriste `admins:` ovako:

- Test „šalje adminima…": `makeFake({ korisnici: [{ id: "a", email: "admin1@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }], dueRows: [baseRow] })`; očekuj `sends[0]!.to` da sadrži `admin1@tehpro.com`; `inserts[0]` `{ termin_id: "t1", dana_prije: 60 }` (send vraća `dryRun:false`).
- Test post-due: isti `korisnici` (admin), `dueRows` post-due red; očekuj subject „kasni 3 dana".
- Test „greška pri čitanju admina…": preimenuj u korisnici-grešku: `makeFake({ korisniciError: "connection refused", dueRows: [baseRow] })`; `await expect(runReminders(supabase)).rejects.toThrow("Greška pri čitanju primalaca (korisnici): connection refused")`.
- Test „nema internih primalaca…": `makeFake({ korisnici: [], dueRows: [baseRow] })`; očekuj `res.skipped[0]!.razlog === "nema primalaca"`.
- Dry-run test i throttling testovi: zamijeni `admins: [{ email: ... }]` s `korisnici: [{ id: "a", email: "a@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }]` (ostalo isto).

Dodaj jedan novi test (routing po dodjeli):
```ts
  it("routing: operater dobija samo svoju firmu (preko korisnik_klijent)", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => { sends.push(a); return { id: "r", dryRun: false } }
    const { supabase } = makeFake({
      korisnici: [
        { id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true },
        { id: "o", email: "op@tehpro.com", uloga: "operater", aktivan: true, prima_podsjetnike: true },
      ],
      kk: [{ korisnik_id: "o", klijent_id: "k1" }],
      dueRows: [baseRow], // baseRow.klijent_id === "k1"
    })
    await runReminders(supabase, { send, delayMs: 0 })
    expect(sends[0]!.to).toEqual(["op@tehpro.com", "admin@tehpro.com"])
  })
```

- [ ] **Step 5: Pokreni test — mora pasti pa proći**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: prvo FAIL dok ne preradiš `runReminders` (Step 1–3) i fake (Step 4); nakon toga PASS (svi, uključujući novi routing test).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck 2>&1 | grep -E "\.ts\(" | head; echo "errors: $(pnpm typecheck 2>&1 | grep -cE '\.ts\(')"`
Expected: `errors: 0`.

- [ ] **Step 7: Commit**

```bash
git add lib/reminders/runReminders.ts lib/reminders/runReminders.test.ts
git commit -m "feat(podsjetnici): runReminders računa primaoce po dodjeli (Krug 2 routing)"
```

---

### Task 4: Akcija + UI toggle (Postavke→Korisnici)

**Files:**
- Modify: `app/(dashboard)/postavke/actions.ts`
- Create: `components/domain/PrimaPodsjetnikeToggle.tsx`
- Modify: `components/domain/KorisniciTab.tsx`

**Interfaces:**
- Consumes: `zahtijevajAdmina()`, `createAdminSupabaseClient()`, `ActionResult` (postoje u actions.ts); kolona `prima_podsjetnike` (Task 1).
- Produces: `postaviPrimaPodsjetnike(korisnikId: string, prima: boolean): Promise<ActionResult>`.

- [ ] **Step 1: Dodaj akciju** (u `app/(dashboard)/postavke/actions.ts`, odmah nakon `postaviAktivan`)

```ts
export async function postaviPrimaPodsjetnike(korisnikId: string, prima: boolean): Promise<ActionResult> {
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from("korisnici").update({ prima_podsjetnike: prima }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}
```

- [ ] **Step 2: Napravi toggle komponentu** (`components/domain/PrimaPodsjetnikeToggle.tsx`)

```tsx
"use client"
import { useTransition } from "react"
import { postaviPrimaPodsjetnike } from "@/app/(dashboard)/postavke/actions"
import { toast } from "sonner"

export function PrimaPodsjetnikeToggle({ korisnikId, prima }: { korisnikId: string; prima: boolean }) {
  const [pending, start] = useTransition()
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      <input
        type="checkbox"
        defaultChecked={prima}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked
          start(async () => {
            const r = await postaviPrimaPodsjetnike(korisnikId, next)
            toast[r.ok ? "success" : "error"](r.ok ? "Sačuvano." : (r.message ?? "Greška."))
          })
        }}
      />
      Prima podsjetnike
    </label>
  )
}
```

- [ ] **Step 3: Učitaj `prima_podsjetnike` i renderuj toggle** (`components/domain/KorisniciTab.tsx`)

Dodaj import: `import { PrimaPodsjetnikeToggle } from "./PrimaPodsjetnikeToggle"`.

Proširi `korisnici` select: `select("id, ime, email, uloga, aktivan, prima_podsjetnike")`.

U `<li>`, zamijeni desni dio (od `{k.uloga !== "admin" && (` do pripadajućeg `)}`) ovako da prikaže i toggle (za SVE korisnike) i dodjelu (za ne-admine):
```tsx
            <div className="flex flex-col items-end gap-2">
              <PrimaPodsjetnikeToggle korisnikId={k.id} prima={k.prima_podsjetnike} />
              {k.uloga !== "admin" && (
                <DodjelaKlijenata
                  korisnikId={k.id}
                  klijenti={klijenti}
                  izabrani={dodjele.filter((d) => d.korisnik_id === k.id).map((d) => d.klijent_id)}
                />
              )}
            </div>
```

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm lint 2>&1 | grep -c "error" ; pnpm typecheck 2>&1 | grep -cE '\.ts\(' `
Expected: `0` grešaka lint, `0` typecheck.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/postavke/actions.ts" components/domain/PrimaPodsjetnikeToggle.tsx components/domain/KorisniciTab.tsx
git commit -m "feat(podsjetnici): toggle 'Prima podsjetnike' po korisniku (Postavke→Korisnici)"
```

---

### Task 5: Završna verifikacija

**Files:** (bez izmjena koda)

- [ ] **Step 1: Pun unit set bez DB**

Run: `pnpm test:unit`
Expected: PASS; integracioni `dueRpc` SKIP.

- [ ] **Step 2: Pun set s lokalnim DB**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:unit`
Expected: svi PASS.

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 grešaka.

- [ ] **Step 4: (opciono) E2E podsjetnici/auth**

Run: `pnpm exec playwright test tests/e2e/06-podsjetnici.spec.ts tests/e2e/18-auth-rls.spec.ts`
Expected: zeleno (ili nepromijenjeno u odnosu na main).

- [ ] **Step 5: Verifikuj kriterijume prihvatanja u specu**

Otvori `docs/superpowers/specs/2026-06-29-motor-podsjetnika-krug2-design.md` i ručno potvrdi.

---

## Napomene za cloud rollout (van automatske primjene)

Nakon merge-a: `pnpm db:apply-cloud supabase/migrations/20260629130000_korisnici_prima_podsjetnike.sql`, pa deploy (auto preko merge u `main`). Pošto su svi `prima_podsjetnike` default `true`, dodijeljeni operateri odmah počinju primati svoje firme; admin može isključiti pojedince u Postavke→Korisnici. (Email i dalje ne ide stvarno dok Resend ključ nije postavljen — vidi Krug 1 rollout.)

## Van obima

- Granularna per-(radnik, firma) pretplata; in-app kanal podsjetnika.
- Dry-run-bez-audita kao zaseban kod-fix (follow-up iz finalnog reviewa Krug 1).
