# Podsjetnici v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-podesivo vrijeme slanja podsjetnika (default 08:00 Europe/Vienna), opciono slanje firmama (Krug 2, globalno + per-firma), i dvosmjerno upravljanje dodjelom radnik↔firma sa pregledom „ko šta prima".

**Architecture:** Jedna SQL migracija dodaje kolone na `postavke` i `klijenti`. Cron GET ruta dobija gate „lokalni sat ≥ izabrani, najviše jednom dnevno" (`zadnje_slanje_datum`); okida ga GitHub Actions svaki sat (UTC), a Vercel dnevni cron je rezerva. Engine primaoce proširuje firminim adresama samo kad su oba prekidača uključena. UI: Postavke (vrijeme + globalni prekidač + pregled) i tab „Podsjetnici" na stranici firme (per-firma prekidač/adrese = operater; dodjela radnika = admin-only).

**Tech Stack:** Next.js 16 (App Router, `--webpack`), TypeScript, Supabase (Postgres + RLS), next-intl, Vitest (unit), Playwright (e2e), Resend (email), pnpm.

## Global Constraints

- **Grana:** `feat/podsjetnici-v2` (već postoji, spec je na njoj). Nikad raditi na `main`.
- **Package manager:** `pnpm` (ne npm/yarn).
- **`next dev` uvijek `--webpack`** (Turbopack puca zbog razmaka u putanji). `pnpm dev` to već forsira.
- **Domenski jezik bosanski/srpski (latinica)** — imena tabela/kolona/ruta/stringova u domenskom jeziku (`postavke`, `klijenti`, `korisnik_klijent`, `podsjetnik_emails`, `salji_klijentima`…). Namjerno.
- **Tri Supabase klijenta** (`lib/supabase/`): browser (anon), server SSR (anon+cookie, **default** za akcije/rute), admin (service-role, **zaobilazi RLS** — samo `scripts/`, cron, storage). Nikad admin klijent u `app/`/`components/` request-putu OSIM postojećeg obrasca admin-only akcija (`postaviDodjele`).
- **RLS:** `postavke_wr = je_admin()`; `klijenti_upd = ima_pristup_klijentu(id) and not je_pregled()`; **`kk_wr` (korisnik_klijent upis) = `je_admin()` — NE olabavljivati.**
- **`db/types.ts` je auto-generisan** — `pnpm db:types`, nikad ručno. **Oprez:** `db:types` čita aktivni `DATABASE_URL` iz `.env.local` (= PROD); za regen iz lokalnog stack-a vidi Task 13.
- **Cloud DB nije u Supabase MCP-u** — migracije na cloud idu `pnpm db:apply-cloud <fajl>` jedan po jedan. **Goli poziv gađa PROD**; za DEMO: `DATABASE_URL="$DATABASE_URL_DEMO" pnpm db:apply-cloud <fajl>`.
- **Tailwind:** bez `sm:`/`md:` breakpointa (desktop-only; koristi `lg:`/`xl:`/`2xl:` ili bez).
- **`no-await-in-loop: error`** svugdje osim `scripts/`.
- **Prije „gotovo":** `pnpm lint && pnpm typecheck && pnpm test:unit` zeleno.
- **Spec:** `docs/superpowers/specs/2026-07-07-podsjetnici-v2-design.md` (autoritativan).

---

## File Structure

**Kreirati:**
- `supabase/migrations/<ts>_podsjetnici_v2.sql` — kolone (Task 1)
- `.github/workflows/reminders.yml` — hourly okidač (Task 11)
- `components/domain/VrijemeSlanjaForm.tsx` — select sata (Task 7)
- `components/domain/SaljiKlijentimaToggle.tsx` — globalni Krug-2 prekidač (Task 7)
- `components/domain/KoStaPrimaTab.tsx` — pregled (Task 8)
- `components/domain/KlijentPodsjetniciTab.tsx` — server shell taba firme (Task 10)
- `components/domain/KlijentPodsjetniciForm.tsx` — per-firma toggle + adrese, client (Task 10)
- `components/domain/DodjelaRadnikaFirmi.tsx` — dodjela radnika (admin), client (Task 10)
- `tests/e2e/19-podsjetnici-v2.spec.ts` — e2e (Task 12)

**Modifikovati:**
- `lib/reminders/gating.ts` + `gating.test.ts` — helperi sata (Task 2)
- `app/api/cron/reminders/route.ts` — gate integracija (Task 3)
- `lib/reminders/recipients.ts` + `recipients.test.ts` — Krug 2 (Task 4)
- `lib/reminders/runReminders.ts` — fetch klijenti + salji_klijentima (Task 5)
- `app/(dashboard)/postavke/actions.ts` — nove akcije (Task 6)
- `app/(dashboard)/klijenti/[id]/actions.ts` — nove akcije firme (Task 9)
- `app/(dashboard)/postavke/page.tsx` — ubaci VrijemeSlanja/SaljiKlijentima/KoStaPrima (Task 7, 8)
- `app/(dashboard)/klijenti/[id]/page.tsx` — novi tab render (Task 10)
- `components/domain/KlijentTabs.tsx` — dodaj tab „podsjetnici" (Task 10)
- `vercel.json` — cron `0 6` → `0 8` (Task 11)
- `messages/{sr,en,de}.json` — stringovi (unutar Task 7, 8, 10)

---

## Task 1: Migracija — kolone `postavke` i `klijenti`

**Files:**
- Create: `supabase/migrations/<ts>_podsjetnici_v2.sql` (`<ts>` = trenutni UTC timestamp, format `YYYYMMDDHHmmss`, npr. `20260708120000`)
- Modify (auto): `db/types.ts` (regen u Task 13; ovdje samo lokalno)

**Interfaces:**
- Produces: kolone `postavke.vrijeme_slanja_sat smallint`, `postavke.zadnje_slanje_datum date`, `postavke.salji_klijentima boolean`, `klijenti.salji_podsjetnik_klijentu boolean`.

- [ ] **Step 1: Napiši migraciju**

Kreiraj `supabase/migrations/20260708120000_podsjetnici_v2.sql` (zamijeni timestamp aktuelnim):

```sql
-- Podsjetnici v2: podesivo vrijeme slanja, "poslato danas" marker, Krug 2 (slanje firmama).

-- postavke: sat slanja (lokalno Europe/Vienna) + datum zadnjeg auto-runa + globalni Krug-2 prekidač
alter table postavke
  add column vrijeme_slanja_sat  smallint not null default 8,
  add column zadnje_slanje_datum date,
  add column salji_klijentima    boolean  not null default false;
alter table postavke
  add constraint chk_postavke_sat check (vrijeme_slanja_sat between 0 and 23);

-- klijenti: per-firma prekidač za slanje podsjetnika firmi (podsjetnik_emails već postoji)
alter table klijenti
  add column salji_podsjetnik_klijentu boolean not null default false;
```

- [ ] **Step 2: Primijeni na lokalni stack i provjeri**

Pretpostavka: `supabase start` je pokrenut (lokalni stack radi).

Run: `pnpm db:reset`
Expected: prolazi sve migracije bez greške, uključujući novu (`Applying migration 20260708120000_podsjetnici_v2.sql...`).

- [ ] **Step 3: Verifikuj kolone u lokalnoj bazi**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d postavke" -c "\d klijenti"`
Expected: `postavke` ima `vrijeme_slanja_sat` (smallint, default 8), `zadnje_slanje_datum` (date), `salji_klijentima` (boolean, default false); `klijenti` ima `salji_podsjetnik_klijentu` (boolean, default false).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260708120000_podsjetnici_v2.sql
git commit -m "feat(db): podsjetnici v2 kolone (vrijeme_slanja_sat, zadnje_slanje_datum, salji_klijentima, salji_podsjetnik_klijentu)"
```

> **Napomena:** `db/types.ts` se NE regeneriše ovdje (Task 13 to radi tačno iz lokalnog stack-a). Tasks 2–10 rade protiv lokalnih tipova; ako typecheck padne zbog nedostajućih kolona u `db/types.ts`, uradi Task 13 Step 1–2 (regen iz lokalnog) pa nastavi.

---

## Task 2: Gating helperi — `lokalniSatIDatum` + `trebaSlatiSada`

**Files:**
- Modify: `lib/reminders/gating.ts`
- Test: `lib/reminders/gating.test.ts`

**Interfaces:**
- Consumes: ništa (čista funkcija).
- Produces:
  - `lokalniSatIDatum(now: Date, timeZone?: string): { sat: number; datum: string }` — `sat` 0–23 lokalni, `datum` ISO `YYYY-MM-DD` lokalni.
  - `trebaSlatiSada(vrijemeSat: number, zadnjeSlanjeDatum: string | null, now: Date, timeZone?: string): boolean`.
  - Zadržava postojeći `podsjetniciAktivni(row)`.

- [ ] **Step 1: Napiši failing testove**

Dodaj u `lib/reminders/gating.test.ts` (zadrži postojeći `podsjetniciAktivni` describe):

```ts
import { describe, it, expect } from "vitest"
import { podsjetniciAktivni, lokalniSatIDatum, trebaSlatiSada } from "./gating"

// 2026-07-08T04:00:00Z — ljeti CEST (UTC+2) → lokalno 06:00, datum 2026-07-08
const LJETO_04Z = new Date("2026-07-08T04:00:00Z")
// 2026-07-08T07:00:00Z → lokalno 09:00 ljeti
const LJETO_07Z = new Date("2026-07-08T07:00:00Z")
// 2026-01-08T07:00:00Z — zimi CET (UTC+1) → lokalno 08:00, datum 2026-01-08
const ZIMA_07Z = new Date("2026-01-08T07:00:00Z")
// Spring-forward: 2026-03-29 02:00→03:00 lokalno. 01:30Z = 02:30 CET? Ne — 00:30Z=01:30 CET, 01:00Z=03:00 CEST.
const SPRING_01Z = new Date("2026-03-29T01:00:00Z") // preskočeni lokalni sat 02 → ovo je 03:00 lokalno

describe("lokalniSatIDatum (Europe/Vienna)", () => {
  it("ljeti CEST: 04:00Z → sat 6, datum 2026-07-08", () => {
    expect(lokalniSatIDatum(LJETO_04Z)).toEqual({ sat: 6, datum: "2026-07-08" })
  })
  it("zimi CET: 07:00Z → sat 8, datum 2026-01-08", () => {
    expect(lokalniSatIDatum(ZIMA_07Z)).toEqual({ sat: 8, datum: "2026-01-08" })
  })
  it("spring-forward: 01:00Z (29.03) → lokalni sat 3 (02 ne postoji)", () => {
    expect(lokalniSatIDatum(SPRING_01Z).sat).toBe(3)
  })
})

describe("trebaSlatiSada", () => {
  it("sat < izabrani → false", () => {
    // LJETO_04Z = 06:00 lokalno; izabrani 8 → 6 < 8
    expect(trebaSlatiSada(8, null, LJETO_04Z)).toBe(false)
  })
  it("sat >= izabrani i danas nije slato → true", () => {
    // LJETO_07Z = 09:00 lokalno; izabrani 8 → 9 >= 8, zadnje null
    expect(trebaSlatiSada(8, null, LJETO_07Z)).toBe(true)
  })
  it("vec slato danas (isti lokalni datum) → false", () => {
    expect(trebaSlatiSada(8, "2026-07-08", LJETO_07Z)).toBe(false)
  })
  it("slato jučer → true (novi dan)", () => {
    expect(trebaSlatiSada(8, "2026-07-07", LJETO_07Z)).toBe(true)
  })
  it("spring-forward: izabran preskočeni sat 2, tik u 03 lokalno → true (šalje isti dan)", () => {
    expect(trebaSlatiSada(2, null, SPRING_01Z)).toBe(true)
  })
})
```

- [ ] **Step 2: Pokreni testove — moraju pasti**

Run: `pnpm vitest run lib/reminders/gating.test.ts`
Expected: FAIL — `lokalniSatIDatum`/`trebaSlatiSada` nisu eksportovani.

- [ ] **Step 3: Implementiraj helpere**

Dodaj u `lib/reminders/gating.ts` (ispod postojećeg `podsjetniciAktivni`):

```ts
/**
 * Lokalni sat (0–23) i ISO datum (YYYY-MM-DD) za dati trenutak u datoj zoni.
 * `now` i `timeZone` se ubacuju (bez Date.now()) → čisto i testabilno.
 */
export function lokalniSatIDatum(
  now: Date,
  timeZone = "Europe/Vienna",
): { sat: number; datum: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(now)
  const get = (t: string) => parts.find((x) => x.type === t)!.value
  const sat = Number(get("hour")) % 24 // 24 → 0 (ponoć u nekim okruženjima)
  return { sat, datum: `${get("year")}-${get("month")}-${get("day")}` }
}

/**
 * Treba li automatski (cron) run slati SADA: lokalni sat je dostigao izabrani
 * i danas (po lokalnom datumu) još nije slato.
 */
export function trebaSlatiSada(
  vrijemeSat: number,
  zadnjeSlanjeDatum: string | null,
  now: Date,
  timeZone = "Europe/Vienna",
): boolean {
  const { sat, datum } = lokalniSatIDatum(now, timeZone)
  return sat >= vrijemeSat && zadnjeSlanjeDatum !== datum
}
```

- [ ] **Step 4: Pokreni testove — moraju proći**

Run: `pnpm vitest run lib/reminders/gating.test.ts`
Expected: PASS (svi, uključujući postojeće `podsjetniciAktivni`).

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/gating.ts lib/reminders/gating.test.ts
git commit -m "feat(reminders): lokalniSatIDatum + trebaSlatiSada gating helperi (Europe/Vienna, >= sat + jednom dnevno)"
```

---

## Task 3: Cron ruta — gate po satu + „poslato danas" marker

**Files:**
- Modify: `app/api/cron/reminders/route.ts`

**Interfaces:**
- Consumes: `lokalniSatIDatum`, `trebaSlatiSada`, `podsjetniciAktivni` iz Task 2.
- Produces: GET šalje samo kad `podsjetnici_aktivni && trebaSlatiSada(...)`; upisuje `zadnje_slanje_datum` nakon uspjeha. POST i dalje sve zaobilazi.

- [ ] **Step 1: Izmijeni GET granu**

U `app/api/cron/reminders/route.ts` zamijeni postojeći `if (req.method === "GET") { ... }` blok i poziv `runReminders` ovim (import na vrhu proširi):

```ts
import { podsjetniciAktivni, lokalniSatIDatum, trebaSlatiSada } from "@/lib/reminders/gating"
```

Zamijeni GET-gate blok:

```ts
  // Prekidač + vrijeme važe SAMO za automatski (cron) GET; POST (ručno/test) uvijek radi.
  let datumZaMarker: string | null = null
  if (req.method === "GET") {
    const { data: post } = await supabase
      .from("postavke")
      .select("podsjetnici_aktivni, vrijeme_slanja_sat, zadnje_slanje_datum")
      .eq("id", 1)
      .maybeSingle()
    if (!podsjetniciAktivni(post)) {
      return NextResponse.json({ ok: true, skipped: "podsjetnici_iskljuceni" })
    }
    const vrijemeSat = post?.vrijeme_slanja_sat ?? 8
    const { sat, datum } = lokalniSatIDatum(new Date())
    if (sat < vrijemeSat) {
      return NextResponse.json({ ok: true, skipped: "izvan_sata" })
    }
    if (!trebaSlatiSada(vrijemeSat, post?.zadnje_slanje_datum ?? null, new Date())) {
      return NextResponse.json({ ok: true, skipped: "vec_slato_danas" })
    }
    datumZaMarker = datum
  }
```

Zatim izmijeni try-blok da nakon uspješnog runa upiše marker (samo za GET):

```ts
  try {
    const result = await runReminders(supabase, dryRun ? { send: drySend } : {})
    // Uspješan auto-run: obilježi da je danas (lokalni datum) slato → spriječi ponovni run istog dana.
    if (datumZaMarker) {
      await supabase.from("postavke").update({ zadnje_slanje_datum: datumZaMarker }).eq("id", 1)
    }
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Greška"
    return NextResponse.json({ error: message }, { status: 500 })
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (ako padne zbog `vrijeme_slanja_sat`/`zadnje_slanje_datum` u `db/types.ts`, uradi Task 13 Step 1–2 pa ponovi).

- [ ] **Step 3: Ručna provjera gate-a lokalno (dry)**

Pokreni dev (`pnpm dev` u drugom terminalu). Simuliraj cron GET sa CRON_SECRET iz `.env.local`:

Run: `curl -s -X POST http://localhost:3000/api/cron/reminders -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2-)" -H 'content-type: application/json' -d '{"dryRun":true}'`
Expected: JSON `{"sent":[...],"skipped":[...],...}` (POST zaobilazi gate — uvijek radi).

Run (GET, isti secret): `curl -s http://localhost:3000/api/cron/reminders -H "Authorization: Bearer $(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2-)"`
Expected: ako je lokalni sat < 8 → `{"ok":true,"skipped":"izvan_sata"}`; ako ≥ 8 i danas nije slato → run rezultat pa `zadnje_slanje_datum` postavljen (drugi GET isti dan → `{"ok":true,"skipped":"vec_slato_danas"}`).

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/reminders/route.ts
git commit -m "feat(cron): gate po lokalnom satu (>= izabrani, jednom dnevno) uz zadnje_slanje_datum marker"
```

---

## Task 4: Recipients — Krug 2 (firmine adrese)

**Files:**
- Modify: `lib/reminders/recipients.ts`
- Test: `lib/reminders/recipients.test.ts`

**Interfaces:**
- Consumes: postojeći `assembleRecipients`, `EMAIL_RE`, `KorisnikRow`.
- Produces:
  - Tip `KlijentReminderRow = { id: string; salji_podsjetnik_klijentu: boolean; podsjetnik_emails: string[] | null }`.
  - `buildRecipientIndex(korisnici, dodjele, klijenti, saljiKlijentima)` — proširen 3./4. parametrom; `RecipientIndex` dobija `klijentEmailsByKlijent: Map<string, string[]>`.
  - `recipientsForKlijent(index, klijentId, base)` — spaja interne ∪ firmine adrese.

- [ ] **Step 1: Napiši failing testove**

Dodaj u `lib/reminders/recipients.test.ts` novi describe (zadrži postojeće; ažuriraj postojeće `buildRecipientIndex` pozive — vidi Step 3 napomenu o potpisu):

```ts
const KL = (id: string, salji: boolean, emails: string[] | null) => ({
  id, salji_podsjetnik_klijentu: salji, podsjetnik_emails: emails,
})

describe("Krug 2 — firmine adrese", () => {
  it("salji_klijentima=false → firmine adrese se NIKAD ne dodaju", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin")], [],
      [KL("FA", true, ["firma@fa.com"])], false,
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["admin@x.com"])
  })

  it("oba prekidača true + neprazna lista → firmine adrese dodate", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin")], [],
      [KL("FA", true, ["firma@fa.com"])], true,
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["admin@x.com", "firma@fa.com"])
  })

  it("per-firma false uz globalni true → firma preskočena", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin")], [],
      [KL("FA", false, ["firma@fa.com"])], true,
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["admin@x.com"])
  })

  it("dedupe kad se firmina adresa poklopi sa internom (case-insensitive)", () => {
    const idx = buildRecipientIndex(
      [K("a", "shared@x.com", "admin")], [],
      [KL("FA", true, ["SHARED@x.com"])], true,
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["shared@x.com"])
  })

  it("prazna/na null podsjetnik_emails → nema praznog slanja", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin")], [],
      [KL("FA", true, []), KL("FB", true, null)], true,
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["admin@x.com"])
    expect(recipientsForKlijent(idx, "FB", [])).toEqual(["admin@x.com"])
  })

  it("nevalidna firmina adresa se odbacuje", () => {
    const idx = buildRecipientIndex(
      [K("a", "admin@x.com", "admin")], [],
      [KL("FA", true, ["nevalidno", "ok@fa.com"])], true,
    )
    expect(recipientsForKlijent(idx, "FA", [])).toEqual(["admin@x.com", "ok@fa.com"])
  })
})
```

- [ ] **Step 2: Pokreni — moraju pasti**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: FAIL — `buildRecipientIndex` ne prima klijente/saljiKlijentima, `RecipientIndex` nema `klijentEmailsByKlijent`.

- [ ] **Step 3: Izmijeni `recipients.ts`**

Zamijeni tip `RecipientIndex`, `buildRecipientIndex` i `recipientsForKlijent`:

```ts
export type KlijentReminderRow = {
  id: string
  salji_podsjetnik_klijentu: boolean
  podsjetnik_emails: string[] | null
}

export type RecipientIndex = {
  adminEmails: string[]
  assignedByKlijent: Map<string, string[]>
  klijentEmailsByKlijent: Map<string, string[]>
}

/** Indeks primalaca: admini + dodijeljeni (interni) + firmine adrese (Krug 2, samo ako je uključeno). */
export function buildRecipientIndex(
  korisnici: KorisnikRow[],
  dodjele: { korisnik_id: string; klijent_id: string }[],
  klijenti: KlijentReminderRow[] = [],
  saljiKlijentima = false,
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
  // Krug 2: firmine adrese samo kad je globalni prekidač uključen I firma per-firma uključena.
  const klijentEmailsByKlijent = new Map<string, string[]>()
  if (saljiKlijentima) {
    for (const k of klijenti) {
      if (!k.salji_podsjetnik_klijentu) continue
      const emails = (k.podsjetnik_emails ?? []).filter((e) => EMAIL_RE.test(e.trim()))
      if (emails.length > 0) klijentEmailsByKlijent.set(k.id, emails)
    }
  }
  return { adminEmails, assignedByKlijent, klijentEmailsByKlijent }
}

/** Primaoci za jednu firmu: interni (dodijeljeni ∪ admini ∪ REMINDER_TO) ∪ firmine adrese. */
export function recipientsForKlijent(index: RecipientIndex, klijentId: string, base: string[]): string[] {
  const assigned = index.assignedByKlijent.get(klijentId) ?? []
  const firma = index.klijentEmailsByKlijent.get(klijentId) ?? []
  return assembleRecipients({ base, adminEmails: [...assigned, ...index.adminEmails, ...firma] })
}
```

> Postojeći testovi zovu `buildRecipientIndex(korisnici, dodjele)` — novi parametri imaju default (`[]`, `false`), pa i dalje prolaze bez izmjene.

- [ ] **Step 4: Pokreni — moraju proći**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: PASS (svi — stari i novi).

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/recipients.ts lib/reminders/recipients.test.ts
git commit -m "feat(reminders): Krug 2 — firmine adrese u recipients (globalni + per-firma prekidač)"
```

---

## Task 5: `runReminders` — dohvat firmi + prosljeđivanje `salji_klijentima`

**Files:**
- Modify: `lib/reminders/runReminders.ts`
- Test: `lib/reminders/runReminders.test.ts` (proširenje ako postoji odgovarajući mock; inače pokriveno Task 4 unit + Task 12 e2e)

**Interfaces:**
- Consumes: `buildRecipientIndex(korisnici, dodjele, klijenti, saljiKlijentima)` iz Task 4.
- Produces: engine šalje i firmine adrese kad je uključeno.

- [ ] **Step 1: Dodaj čitanje `salji_klijentima`**

U `runReminders.ts` proširi postojeći `postavke` select da uključi `salji_klijentima`:

```ts
  const { data: post } = await supabase
    .from("postavke")
    .select("dana_prije, salji_klijentima")
    .eq("id", 1)
    .maybeSingle()
  const danaPrije = post?.dana_prije && post.dana_prije.length > 0 ? post.dana_prije : DEFAULT_DANA
  const saljiKlijentima = post?.salji_klijentima ?? false
```

- [ ] **Step 2: Dodaj fetch klijenata i proširi indeks**

Ispod postojećeg `dodjele` fetch-a (prije `buildRecipientIndex`) dodaj:

```ts
  const { data: klijentiZaSlanje, error: klErr } = await supabase
    .from("klijenti")
    .select("id, salji_podsjetnik_klijentu, podsjetnik_emails")
  if (klErr) throw new Error(`Greška pri čitanju klijenata (Krug 2): ${klErr.message}`)
```

I izmijeni poziv:

```ts
  const recipientIndex = buildRecipientIndex(
    korisnici ?? [],
    dodjele ?? [],
    klijentiZaSlanje ?? [],
    saljiKlijentima,
  )
```

- [ ] **Step 3: Typecheck + unit**

Run: `pnpm typecheck && pnpm vitest run lib/reminders/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/reminders/runReminders.ts
git commit -m "feat(reminders): runReminders dohvata firme i prosljeđuje salji_klijentima u indeks primalaca"
```

---

## Task 6: Postavke akcije — `updateVrijemeSlanja` + `updateSaljiKlijentima`

**Files:**
- Modify: `app/(dashboard)/postavke/actions.ts`

**Interfaces:**
- Consumes: postojeći `zahtijevajAdmina`, `createServerSupabaseClient`, `ActionResult`.
- Produces:
  - `updateVrijemeSlanja(_prev: ActionResult, formData: FormData): Promise<ActionResult>` (polje `vrijeme_slanja_sat`, string 0–23).
  - `updateSaljiKlijentima(_prev: ActionResult, formData: FormData): Promise<ActionResult>` (checkbox `salji`).

- [ ] **Step 1: Dodaj akcije**

Dodaj u `app/(dashboard)/postavke/actions.ts` (uz ostale reminder akcije, npr. ispod `updatePodsjetniciAktivni`):

```ts
// ─── Vrijeme slanja (lokalni sat Europe/Vienna) ─────────────────────────────

export async function updateVrijemeSlanja(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const raw = String(formData.get("vrijeme_slanja_sat") ?? "")
  const sat = Number(raw)
  if (!Number.isInteger(sat) || sat < 0 || sat > 23) {
    return { ok: false, message: t("vrijemeSatNeispravan") }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("postavke").update({ vrijeme_slanja_sat: sat }).eq("id", 1)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Globalni Krug-2 prekidač: slanje podsjetnika i firmama ──────────────────

export async function updateSaljiKlijentima(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const salji = formData.get("salji") === "on"
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("postavke").update({ salji_klijentima: salji }).eq("id", 1)
  if (error) return { ok: false, message: t("saljiKlijentimaGreska") }
  revalidatePath("/postavke")
  return { ok: true }
}
```

- [ ] **Step 2: Dodaj i18n ključeve**

U `messages/sr.json` pod `postavke.actions` dodaj:
```json
"vrijemeSatNeispravan": "Sat mora biti cijeli broj 0–23.",
"saljiKlijentimaGreska": "Greška pri promjeni slanja firmama."
```
U `messages/en.json` pod `postavke.actions`:
```json
"vrijemeSatNeispravan": "Hour must be an integer 0–23.",
"saljiKlijentimaGreska": "Failed to change sending to clients."
```
U `messages/de.json` pod `postavke.actions`:
```json
"vrijemeSatNeispravan": "Stunde muss eine ganze Zahl 0–23 sein.",
"saljiKlijentimaGreska": "Änderung des Versands an Firmen fehlgeschlagen."
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/postavke/actions.ts messages/sr.json messages/en.json messages/de.json
git commit -m "feat(postavke): akcije updateVrijemeSlanja + updateSaljiKlijentima"
```

---

## Task 7: Postavke UI — select sata + globalni prekidač

**Files:**
- Create: `components/domain/VrijemeSlanjaForm.tsx`
- Create: `components/domain/SaljiKlijentimaToggle.tsx`
- Modify: `app/(dashboard)/postavke/page.tsx`
- Modify: `messages/{sr,en,de}.json`

**Interfaces:**
- Consumes: `updateVrijemeSlanja`, `updateSaljiKlijentima` (Task 6), `ActionResult`.
- Produces: renderovane kontrole u sekciji „Email podsjetnici".

- [ ] **Step 1: `VrijemeSlanjaForm.tsx`**

Kreiraj `components/domain/VrijemeSlanjaForm.tsx`:

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { updateVrijemeSlanja, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }
const SATI = Array.from({ length: 24 }, (_, i) => i)

export function VrijemeSlanjaForm({ vrijemeSat }: { vrijemeSat: number }) {
  const t = useTranslations("postavke.vrijemeSlanja")
  const router = useRouter()
  const [state, action, pending] = useActionState(updateVrijemeSlanja, initial)
  const prev = useRef<ActionResult>(initial)

  useEffect(() => {
    if (!pending && state !== prev.current) {
      prev.current = state
      if (state.ok) router.refresh()
    }
  }, [state, pending, router])

  return (
    <form action={action} className="max-w-xl space-y-2" data-testid="vrijeme-slanja-form">
      <label htmlFor="vrijeme_slanja_sat" className="text-sm font-medium">{t("naslov")}</label>
      <p className="text-sm text-slate-500">{t("opis")}</p>
      <div className="flex items-center gap-2">
        <select
          id="vrijeme_slanja_sat"
          name="vrijeme_slanja_sat"
          defaultValue={String(vrijemeSat)}
          disabled={pending}
          data-testid="vrijeme-slanja-select"
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm disabled:opacity-50"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {SATI.map((s) => (
            <option key={s} value={String(s)}>
              {String(s).padStart(2, "0")}:00
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-400">{t("zona")}</span>
      </div>
      {state.ok === false && state.message && (
        <p className="text-sm text-red-600" role="alert">{state.message}</p>
      )}
    </form>
  )
}
```

- [ ] **Step 2: `SaljiKlijentimaToggle.tsx`**

Kreiraj `components/domain/SaljiKlijentimaToggle.tsx` (obrazac iz `PodsjetniciKontrole` toggle-a: server-perzistencija + rollback na grešku):

```tsx
"use client"

import { useActionState, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { updateSaljiKlijentima, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function SaljiKlijentimaToggle({ salji }: { salji: boolean }) {
  const t = useTranslations("postavke.saljiKlijentima")
  const checkboxRef = useRef<HTMLInputElement>(null)
  const [state, action, pending] = useActionState(updateSaljiKlijentima, initial)
  const obradjeno = useRef(initial)

  useEffect(() => {
    if (state !== obradjeno.current) {
      obradjeno.current = state
      if (state.ok === false && checkboxRef.current) checkboxRef.current.checked = salji
    }
  }, [state, salji])

  return (
    <div className="space-y-2">
      <form action={action} className="flex items-start gap-3">
        <input
          ref={checkboxRef}
          type="checkbox"
          name="salji"
          defaultChecked={salji}
          disabled={pending}
          aria-label={t("naslov")}
          data-testid="salji-klijentima-toggle"
          className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <div>
          <p className="text-sm font-medium">{t("naslov")}</p>
          <p className="text-sm text-amber-600">{t("upozorenje")}</p>
        </div>
      </form>
      {state.ok === false && state.message && (
        <p className="text-xs text-red-600" role="alert">{state.message}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: i18n ključevi**

U `messages/sr.json` pod `postavke` dodaj:
```json
"vrijemeSlanja": {
  "naslov": "Vrijeme slanja",
  "opis": "Podsjetnici se šalju u prvom satu na/nakon izabranog, jednom dnevno.",
  "zona": "po lokalnom vremenu (Beč)"
},
"saljiKlijentima": {
  "naslov": "Šalji podsjetnike i firmama",
  "upozorenje": "Uključeno = mailovi izlaze van TehPro-a (klijentima). Šalje se samo firmama koje su pojedinačno uključene i imaju upisane adrese."
}
```
`messages/en.json` pod `postavke`:
```json
"vrijemeSlanja": {
  "naslov": "Send time",
  "opis": "Reminders are sent at the first hour at/after the selected one, once per day.",
  "zona": "local time (Vienna)"
},
"saljiKlijentima": {
  "naslov": "Also send reminders to clients",
  "upozorenje": "Enabled = emails leave TehPro (to clients). Only clients individually enabled and with addresses set will receive them."
}
```
`messages/de.json` pod `postavke`:
```json
"vrijemeSlanja": {
  "naslov": "Sendezeit",
  "opis": "Erinnerungen werden zur ersten Stunde ab der gewählten gesendet, einmal täglich.",
  "zona": "Ortszeit (Wien)"
},
"saljiKlijentima": {
  "naslov": "Erinnerungen auch an Firmen senden",
  "upozorenje": "Aktiviert = E-Mails verlassen TehPro (an Kunden). Nur einzeln aktivierte Firmen mit hinterlegten Adressen erhalten sie."
}
```

- [ ] **Step 4: Ubaci u `postavke/page.tsx`**

U `app/(dashboard)/postavke/page.tsx`: proširi `postavke` select-om novih kolona i renderuj komponente. Zamijeni `.select("*")` (već tolerantan) — ostaje `*`. Dodaj importe:

```tsx
import { VrijemeSlanjaForm } from "@/components/domain/VrijemeSlanjaForm"
import { SaljiKlijentimaToggle } from "@/components/domain/SaljiKlijentimaToggle"
```

Unutar `<div className="space-y-6">` reminders sekcije, ispod `<ReminderForm .../>` i `<PodsjetniciKontrole .../>` dodaj:

```tsx
            <VrijemeSlanjaForm vrijemeSat={postRes.data?.vrijeme_slanja_sat ?? 8} />
            <SaljiKlijentimaToggle salji={postRes.data?.salji_klijentima ?? false} />
```

- [ ] **Step 5: Provjeri render (dev)**

Run: `pnpm dev` pa otvori `http://localhost:3000/postavke` kao admin.
Expected: „Vrijeme slanja" select (default 08:00) i „Šalji podsjetnike i firmama" toggle vidljivi; promjena sata → refresh bez greške.

- [ ] **Step 6: Lint + typecheck + commit**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS.

```bash
git add components/domain/VrijemeSlanjaForm.tsx components/domain/SaljiKlijentimaToggle.tsx app/(dashboard)/postavke/page.tsx messages/sr.json messages/en.json messages/de.json
git commit -m "feat(postavke): UI select vremena slanja + globalni prekidač slanja firmama"
```

---

## Task 8: Pregled „Ko šta prima"

**Files:**
- Create: `components/domain/KoStaPrimaTab.tsx`
- Modify: `app/(dashboard)/postavke/page.tsx`
- Modify: `messages/{sr,en,de}.json`

**Interfaces:**
- Consumes: SSR supabase, `getTrenutniKorisnik` (admin gate na stranici).
- Produces: read-only tabela firmi (dodijeljeni radnici, firma prima?, adrese) — obrazac `KorisniciTab` (paralelni select, bez view/RPC).

- [ ] **Step 1: `KoStaPrimaTab.tsx`**

Kreiraj `components/domain/KoStaPrimaTab.tsx`:

```tsx
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { CollapsibleSection } from "./CollapsibleSection"

export async function KoStaPrimaTab() {
  const t = await getTranslations("postavke.koStaPrima")
  const supabase = await createServerSupabaseClient()
  const [postRes, korisniciRes, klijentiRes, dodjeleRes] = await Promise.all([
    supabase.from("postavke").select("salji_klijentima").eq("id", 1).maybeSingle(),
    supabase.from("korisnici").select("id, ime, prima_podsjetnike, aktivan").order("ime"),
    supabase.from("klijenti").select("id, naziv, salji_podsjetnik_klijentu, podsjetnik_emails").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
  ])
  const saljiGlobalno = postRes.data?.salji_klijentima ?? false
  const korisnici = korisniciRes.data ?? []
  const dodjele = dodjeleRes.data ?? []
  const imeZa = (id: string) => korisnici.find((k) => k.id === id)?.ime ?? "—"
  const primaZa = (id: string) => korisnici.find((k) => k.id === id)?.prima_podsjetnike ?? false

  const redovi = (klijentiRes.data ?? []).map((k) => {
    const radnici = dodjele
      .filter((d) => d.klijent_id === k.id)
      .map((d) => d.korisnik_id)
      .filter((uid) => primaZa(uid))
      .map((uid) => imeZa(uid))
    const adrese = k.podsjetnik_emails ?? []
    const firmaPrima = saljiGlobalno && k.salji_podsjetnik_klijentu && adrese.length > 0
    return { id: k.id, naziv: k.naziv, radnici, adrese, firmaPrima }
  })

  return (
    <CollapsibleSection title={t("naslov")} description={t("opis")}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="ko-sta-prima-tabela">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="px-3 py-2">{t("firma")}</th>
              <th className="px-3 py-2">{t("radnici")}</th>
              <th className="px-3 py-2">{t("firmaPrima")}</th>
              <th className="px-3 py-2">{t("adrese")}</th>
            </tr>
          </thead>
          <tbody>
            {redovi.map((r) => (
              <tr key={r.id} className="border-t border-slate-100" data-testid={`ksp-red-${r.id}`}>
                <td className="px-3 py-2 font-medium">{r.naziv}</td>
                <td className="px-3 py-2">{r.radnici.length > 0 ? r.radnici.join(", ") : "—"}</td>
                <td className="px-3 py-2">
                  <span className={r.firmaPrima ? "text-green-700" : "text-slate-400"}>
                    {r.firmaPrima ? t("da") : t("ne")}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{r.adrese.length > 0 ? r.adrese.join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}
```

- [ ] **Step 2: i18n ključevi**

`messages/sr.json` pod `postavke`:
```json
"koStaPrima": {
  "naslov": "Ko šta prima",
  "opis": "Pregled: za svaku firmu koji radnici i koje adrese firme dobijaju podsjetnik.",
  "firma": "Firma", "radnici": "Dodijeljeni radnici", "firmaPrima": "Firma prima?",
  "adrese": "Adrese firme", "da": "Da", "ne": "Ne"
}
```
`messages/en.json` pod `postavke`:
```json
"koStaPrima": {
  "naslov": "Who receives what",
  "opis": "Overview: for each client, which workers and which client addresses get the reminder.",
  "firma": "Client", "radnici": "Assigned workers", "firmaPrima": "Client receives?",
  "adrese": "Client addresses", "da": "Yes", "ne": "No"
}
```
`messages/de.json` pod `postavke`:
```json
"koStaPrima": {
  "naslov": "Wer erhält was",
  "opis": "Übersicht: für jede Firma welche Mitarbeiter und welche Firmenadressen die Erinnerung erhalten.",
  "firma": "Firma", "radnici": "Zugewiesene Mitarbeiter", "firmaPrima": "Firma erhält?",
  "adrese": "Firmenadressen", "da": "Ja", "ne": "Nein"
}
```

- [ ] **Step 3: Ubaci u `postavke/page.tsx`**

Import: `import { KoStaPrimaTab } from "@/components/domain/KoStaPrimaTab"`.
Ispod `{jeAdminKor && <KorisniciTab />}` dodaj: `{jeAdminKor && <KoStaPrimaTab />}`.

- [ ] **Step 4: Provjeri render + lint/typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS. U dev-u `/postavke` prikazuje tabelu „Ko šta prima" (firma prima? = Ne dok je globalni prekidač isključen).

- [ ] **Step 5: Commit**

```bash
git add components/domain/KoStaPrimaTab.tsx app/(dashboard)/postavke/page.tsx messages/sr.json messages/en.json messages/de.json
git commit -m "feat(postavke): pregled 'Ko šta prima' (KorisniciTab obrazac, bez view/RPC)"
```

---

## Task 9: Akcije firme — `updateKlijentPodsjetnici` + `postaviDodjeleZaKlijenta`

**Files:**
- Modify: `app/(dashboard)/klijenti/[id]/actions.ts`

**Interfaces:**
- Consumes: postojeći obrasci iz `klijenti/actions.ts` (SSR klijent) i `postavke/actions.ts` `postaviDodjele` (admin klijent + `zahtijevajAdmina`).
- Produces:
  - `updateKlijentPodsjetnici(klijentId, salji, emails): Promise<ActionResult>` — **SSR klijent** (RLS `klijenti_upd`, operater sa pristupom smije).
  - `postaviDodjeleZaKlijenta(klijentId, korisnikIds[]): Promise<ActionResult>` — **admin-only** (service-role + `zahtijevajAdmina`), obrnuti `postaviDodjele`.

- [ ] **Step 1: Provjeri postojeći header `klijenti/[id]/actions.ts`**

Run: `sed -n '1,30p' "app/(dashboard)/klijenti/[id]/actions.ts"`
Expected: vidi koji su importi/`ActionResult` već prisutni. Ako `ActionResult`/`zahtijevajAdmina`/`createAdminSupabaseClient` nisu importovani, dodaj ih (iz `@/app/(dashboard)/postavke/actions` odnosno `@/lib/...`). Ako `ActionResult` nije izvezen tamo, koristi lokalni tip `type R = { ok: true } | { ok: false; message: string }`.

- [ ] **Step 2: Dodaj akcije**

Dodaj u `app/(dashboard)/klijenti/[id]/actions.ts` (prilagodi importe prema Step 1):

```ts
const EMAIL_RE_KL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Per-firma: uključi/isključi slanje firmi + adrese. SSR klijent → RLS klijenti_upd (operater sa pristupom smije). */
export async function updateKlijentPodsjetnici(
  klijentId: string,
  salji: boolean,
  emails: string[],
): Promise<ActionResult> {
  const cist = Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE_KL.test(e))),
  )
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("klijenti")
    .update({ salji_podsjetnik_klijentu: salji, podsjetnik_emails: cist })
    .eq("id", klijentId)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}

/** Postavi tačan skup dodijeljenih radnika za firmu (zamijeni). ADMIN-ONLY (kk_wr = je_admin()). */
export async function postaviDodjeleZaKlijenta(
  klijentId: string,
  korisnikIds: string[],
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  if (korisnikIds.length > 0) {
    const { data: valid, error: chkErr } = await admin.from("korisnici").select("id").in("id", korisnikIds)
    if (chkErr) return { ok: false, message: chkErr.message }
    if (!valid || valid.length !== korisnikIds.length) {
      return { ok: false, message: "Nepostojeći korisnik u dodjeli." }
    }
  }
  const { error: delErr } = await admin.from("korisnik_klijent").delete().eq("klijent_id", klijentId)
  if (delErr) return { ok: false, message: delErr.message }
  if (korisnikIds.length > 0) {
    const rows = korisnikIds.map((korisnik_id) => ({ korisnik_id, klijent_id: klijentId }))
    const { error: insErr } = await admin.from("korisnik_klijent").insert(rows)
    if (insErr) return { ok: false, message: insErr.message }
  }
  revalidatePath(`/klijenti/${klijentId}`)
  revalidatePath("/postavke")
  return { ok: true }
}
```

> **Sigurnosno:** `updateKlijentPodsjetnici` NAMJERNO koristi SSR klijent (RLS štiti pristup firmi i blokira `pregled`). `postaviDodjeleZaKlijenta` NAMJERNO koristi admin klijent + `zahtijevajAdmina()` jer je `kk_wr = je_admin()`; **ne** prebacivati na SSR (operater bi dobio RLS odbijanje) niti izostaviti guard (bio bi escalacija).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/klijenti/[id]/actions.ts"
git commit -m "feat(klijenti): updateKlijentPodsjetnici (SSR/RLS) + postaviDodjeleZaKlijenta (admin-only)"
```

---

## Task 10: Tab „Podsjetnici" na stranici firme

**Files:**
- Create: `components/domain/KlijentPodsjetniciTab.tsx` (server shell)
- Create: `components/domain/KlijentPodsjetniciForm.tsx` (client — toggle + adrese)
- Create: `components/domain/DodjelaRadnikaFirmi.tsx` (client — dodjela, admin)
- Modify: `components/domain/KlijentTabs.tsx`
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx`
- Modify: `messages/{sr,en,de}.json`

**Interfaces:**
- Consumes: `updateKlijentPodsjetnici`, `postaviDodjeleZaKlijenta` (Task 9), `getTrenutniKorisnik`, SSR supabase.
- Produces: novi tab `"podsjetnici"`.

- [ ] **Step 1: Dodaj tab u `KlijentTabs.tsx`**

U `TABS` nizu dodaj prije `profil`: `{ value: "podsjetnici", labelKey: "podsjetnici" },`.

- [ ] **Step 2: Dodaj `"podsjetnici"` u `VALID_TABS`**

U `app/(dashboard)/klijenti/[id]/page.tsx` promijeni:
```tsx
const VALID_TABS = ["id-karta", "termini", "lokacije", "kontakti", "dokumenti", "podsjetnici", "profil"]
```

- [ ] **Step 3: `KlijentPodsjetniciForm.tsx` (client)**

Kreiraj `components/domain/KlijentPodsjetniciForm.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { X, Plus } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateKlijentPodsjetnici } from "@/app/(dashboard)/klijenti/[id]/actions"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function KlijentPodsjetniciForm({
  klijentId, salji, emails,
}: { klijentId: string; salji: boolean; emails: string[] }) {
  const t = useTranslations("klijenti.podsjetnici")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [saljiState, setSalji] = useState(salji)
  const [lista, setLista] = useState<string[]>(emails)
  const [nova, setNova] = useState("")
  const [greska, setGreska] = useState<string | null>(null)

  function spasi(nextSalji: boolean, nextLista: string[]) {
    startTransition(async () => {
      const res = await updateKlijentPodsjetnici(klijentId, nextSalji, nextLista)
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else toast.error(res.message)
    })
  }

  function dodaj() {
    const e = nova.trim().toLowerCase()
    if (!EMAIL_RE.test(e)) { setGreska(t("emailNeispravan")); return }
    if (lista.includes(e)) { setNova(""); return }
    setGreska(null)
    const next = [...lista, e]
    setLista(next); setNova("")
    spasi(saljiState, next)
  }

  function ukloni(e: string) {
    const next = lista.filter((x) => x !== e)
    setLista(next); spasi(saljiState, next)
  }

  return (
    <div className="max-w-xl space-y-4" data-testid="klijent-podsjetnici-form">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={saljiState}
          disabled={pending}
          data-testid="klijent-salji-toggle"
          className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
          onChange={(e) => { setSalji(e.target.checked); spasi(e.target.checked, lista) }}
        />
        <span>
          <span className="block text-sm font-medium">{t("saljiNaslov")}</span>
          <span className="block text-sm text-slate-500">{t("saljiOpis")}</span>
        </span>
      </label>

      <div>
        <p className="mb-2 text-sm font-medium">{t("adreseNaslov")}</p>
        <div className="flex flex-wrap gap-2">
          {lista.map((e) => (
            <span key={e} data-testid={`klijent-email-${e}`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white py-1 pl-3 pr-1.5 text-sm text-slate-600">
              {e}
              <button type="button" onClick={() => ukloni(e)} disabled={pending}
                aria-label={t("ukloniAdresu", { email: e })}
                className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ))}
          {lista.length === 0 && <span className="text-sm text-slate-400">{t("nemaAdresa")}</span>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input type="email" value={nova} onChange={(e) => setNova(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); dodaj() } }}
            placeholder={t("adresaPlaceholder")} className="w-64" data-testid="klijent-email-input" />
          <Button type="button" variant="outline" size="sm" onClick={dodaj} disabled={pending} data-testid="klijent-email-add">
            <Plus className="h-4 w-4" aria-hidden /> {t("dodaj")}
          </Button>
        </div>
        {greska && <p className="mt-1 text-sm text-red-600" role="alert">{greska}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `DodjelaRadnikaFirmi.tsx` (client, admin)**

Kreiraj `components/domain/DodjelaRadnikaFirmi.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { postaviDodjeleZaKlijenta } from "@/app/(dashboard)/klijenti/[id]/actions"

export function DodjelaRadnikaFirmi({
  klijentId, radnici, izabrani,
}: { klijentId: string; radnici: { id: string; ime: string }[]; izabrani: string[] }) {
  const t = useTranslations("klijenti.dodjelaRadnika")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [sel, setSel] = useState<Set<string>>(new Set(izabrani))

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function spasi() {
    startTransition(async () => {
      const res = await postaviDodjeleZaKlijenta(klijentId, [...sel])
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else toast.error(res.message)
    })
  }

  return (
    <div className="max-w-xl space-y-3" data-testid="dodjela-radnika">
      <div>
        <p className="text-sm font-medium">{t("naslov")}</p>
        <p className="text-sm text-slate-500">{t("opis")}</p>
      </div>
      <div className="space-y-1">
        {radnici.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm" data-testid={`radnik-${r.id}`}>
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)}
              className="h-4 w-4 cursor-pointer accent-brand" />
            {r.ime}
          </label>
        ))}
        {radnici.length === 0 && <p className="text-sm text-slate-400">{t("nemaRadnika")}</p>}
      </div>
      <Button type="button" size="sm" onClick={spasi} disabled={pending} data-testid="dodjela-radnika-spasi">
        {pending ? t("snimam") : t("spasi")}
      </Button>
    </div>
  )
}
```

- [ ] **Step 5: `KlijentPodsjetniciTab.tsx` (server shell)**

Kreiraj `components/domain/KlijentPodsjetniciTab.tsx`:

```tsx
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { KlijentPodsjetniciForm } from "./KlijentPodsjetniciForm"
import { DodjelaRadnikaFirmi } from "./DodjelaRadnikaFirmi"

export async function KlijentPodsjetniciTab({ klijentId }: { klijentId: string }) {
  const t = await getTranslations("klijenti.podsjetnici")
  const ja = await getTrenutniKorisnik()
  const jeAdmin = ja?.uloga === "admin"
  const supabase = await createServerSupabaseClient()
  const [klRes, radniciRes, dodjeleRes] = await Promise.all([
    supabase.from("klijenti").select("salji_podsjetnik_klijentu, podsjetnik_emails").eq("id", klijentId).maybeSingle(),
    jeAdmin ? supabase.from("korisnici").select("id, ime").eq("aktivan", true).order("ime") : Promise.resolve({ data: [] }),
    jeAdmin ? supabase.from("korisnik_klijent").select("korisnik_id").eq("klijent_id", klijentId) : Promise.resolve({ data: [] }),
  ])
  const salji = klRes.data?.salji_podsjetnik_klijentu ?? false
  const emails = klRes.data?.podsjetnik_emails ?? []
  const radnici = (radniciRes.data ?? []).map((r) => ({ id: r.id, ime: r.ime }))
  const izabrani = (dodjeleRes.data ?? []).map((d: { korisnik_id: string }) => d.korisnik_id)

  return (
    <div className="space-y-8" data-testid="tab-podsjetnici-content">
      <section>
        <h2 className="mb-3 text-lg font-medium">{t("sekcijaSlanje")}</h2>
        <KlijentPodsjetniciForm klijentId={klijentId} salji={salji} emails={emails} />
      </section>
      {jeAdmin && (
        <section>
          <h2 className="mb-3 text-lg font-medium">{t("sekcijaDodjela")}</h2>
          <DodjelaRadnikaFirmi klijentId={klijentId} radnici={radnici} izabrani={izabrani} />
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Renderuj tab u `page.tsx`**

U `app/(dashboard)/klijenti/[id]/page.tsx` dodaj import i render blok (uz ostale `{tab === ...}` blokove):

```tsx
import { KlijentPodsjetniciTab } from "@/components/domain/KlijentPodsjetniciTab"
```
```tsx
      {tab === "podsjetnici" && <KlijentPodsjetniciTab klijentId={id} />}
```

- [ ] **Step 7: i18n ključevi**

`messages/sr.json` pod `klijenti.tabs` dodaj (prije `profil`):
```json
"podsjetnici": { "label": "Podsjetnici", "info": "Slanje podsjetnika ovoj firmi (uključi + adrese) i dodjela radnika koji rade na firmi." }
```
`messages/sr.json` pod `klijenti` dodaj dvije grupe:
```json
"podsjetnici": {
  "sekcijaSlanje": "Slanje firmi", "sekcijaDodjela": "Dodijeljeni radnici",
  "saljiNaslov": "Šalji podsjetnike ovoj firmi",
  "saljiOpis": "Radi samo ako je u Postavkama uključeno globalno slanje firmama.",
  "adreseNaslov": "Email adrese firme", "nemaAdresa": "Nema adresa.",
  "adresaPlaceholder": "email@firma.com", "dodaj": "Dodaj",
  "ukloniAdresu": "Ukloni {email}", "emailNeispravan": "Neispravna email adresa.",
  "spaseno": "Sačuvano."
},
"dodjelaRadnika": {
  "naslov": "Radnici na firmi", "opis": "Izabrani radnici imaju pristup firmi i primaju njene podsjetnike.",
  "nemaRadnika": "Nema aktivnih radnika.", "spasi": "Spasi", "snimam": "Snimam…", "spaseno": "Dodjela sačuvana."
}
```
Prevedi iste ključeve u `messages/en.json` i `messages/de.json` (isti oblik; label „Reminders"/„Erinnerungen" itd.).

- [ ] **Step 8: Lint + typecheck + dev provjera**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS. U dev-u otvori firmu → tab „Podsjetnici": kao admin vidiš obje sekcije; kao operater (sa pristupom) samo „Slanje firmi".

- [ ] **Step 9: Commit**

```bash
git add components/domain/KlijentPodsjetniciTab.tsx components/domain/KlijentPodsjetniciForm.tsx components/domain/DodjelaRadnikaFirmi.tsx components/domain/KlijentTabs.tsx "app/(dashboard)/klijenti/[id]/page.tsx" messages/sr.json messages/en.json messages/de.json
git commit -m "feat(klijenti): tab Podsjetnici (per-firma slanje = operater, dodjela radnika = admin-only)"
```

---

## Task 11: GitHub Actions hourly + Vercel cron pomjeranje

**Files:**
- Create: `.github/workflows/reminders.yml`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: cron ruta iz Task 3 (gate propušta na/nakon izabranog sata).
- Produces: hourly okidač za sve instance; Vercel dnevni cron kao rezerva `0 8 * * *`.

- [ ] **Step 1: Pomjeri Vercel cron**

U `vercel.json` promijeni `"schedule": "0 6 * * *"` → `"schedule": "0 8 * * *"` (08:00 UTC = 09/10h lokalno ≥ 8 cijele godine).

- [ ] **Step 2: Kreiraj workflow**

Kreiraj `.github/workflows/reminders.yml`:

```yaml
name: Podsjetnici (hourly)

on:
  schedule:
    - cron: "0 * * * *" # svaki puni sat (UTC); aplikacija odlučuje kad tačno šalje
  workflow_dispatch: {}

jobs:
  okini:
    runs-on: ubuntu-latest
    steps:
      - name: TEHPRO produkcija (tehpro-demo)
        run: >
          curl -sS --max-time 120 -X GET
          -H "Authorization: Bearer ${{ secrets.PROD_CRON_SECRET }}"
          "${{ secrets.PROD_URL }}/api/cron/reminders" || true
      - name: TEHPRO DE
        run: >
          curl -sS --max-time 120 -X GET
          -H "Authorization: Bearer ${{ secrets.DE_CRON_SECRET }}"
          "${{ secrets.DE_URL }}/api/cron/reminders" || true
      # Nova instanca = dodaj korak + PAR secreta (URL + CRON_SECRET).
```

> **GitHub Secrets (repo → Settings → Secrets → Actions):** `PROD_URL` (npr. `https://tehpro-demo.nextpixel.dev`), `PROD_CRON_SECRET` (= CRON_SECRET tog Vercel projekta), `DE_URL`, `DE_CRON_SECRET`. Vrijednosti CRON_SECRET moraju odgovarati onima u Vercel env svake instance.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/reminders.yml vercel.json
git commit -m "feat(cron): GitHub Actions hourly okidač + Vercel rezerva pomjerena na 0 8 * * *"
```

> **Napomena:** Workflow se aktivno okida tek nakon što je na `default` grani (GitHub scheduled workflow-i rade samo sa default grane). Do merge-a testiraj ručno `workflow_dispatch`-om ili `curl`-om.

---

## Task 12: E2E testovi

**Files:**
- Create: `tests/e2e/19-podsjetnici-v2.spec.ts`

**Interfaces:**
- Consumes: sve prethodne taskove.
- Produces: e2e pokrivenost vremena, globalnog prekidača, per-firma taba, dvosmjerne dodjele, gate-bypass regresije.

> **KRITIČNO — izolacija:** e2e ide protiv **cloud DEMO**, koji ima **živi Resend** i **dijeljeni single-row `postavke`**. Zato: (a) svaki `Pokreni sada` / cron POST ide sa `dryRun: true`; (b) test na kraju vraća `salji_klijentima` i per-firma `salji_podsjetnik_klijentu` na `false` i restaurira vrijednosti; (c) koristi postojeći `tests/e2e/db.ts` helper i `--workers=1` (serijsko). Model po uzoru na `tests/e2e/06-podsjetnici.spec.ts`.

- [ ] **Step 1: Pogledaj postojeći obrazac**

Run: `sed -n '1,60p' tests/e2e/06-podsjetnici.spec.ts && sed -n '1,40p' tests/e2e/db.ts`
Expected: vidi kako se loginuje (storageState), kako se čita/restaurira `postavke`, i kako se poziva cron POST sa `dryRun`.

- [ ] **Step 2: Napiši spec**

Kreiraj `tests/e2e/19-podsjetnici-v2.spec.ts` po obrascu iz Step 1. Pokrij (svaki `test.step` sa restauracijom u `finally`/`afterAll`):

```ts
import { test, expect } from "@playwright/test"
// + importi iz ./db i ./helpers po obrascu 06-podsjetnici.spec.ts

test.describe.configure({ mode: "serial" })

test.describe("Podsjetnici v2", () => {
  test("vrijeme slanja se sačuva i prikaže", async ({ page }) => {
    // idi na /postavke, izaberi npr. 09:00 u [data-testid=vrijeme-slanja-select], sačekaj refresh,
    // reload, potvrdi da select ima value "9". Na kraju vrati na 8.
  })

  test("globalni prekidač slanja firmama se sačuva", async ({ page }) => {
    // klikni [data-testid=salji-klijentima-toggle], potvrdi perzistenciju reloadom, vrati na false.
  })

  test("tab firme: per-firma toggle + dodavanje/uklanjanje adrese", async ({ page }) => {
    // otvori firmu ?tab=podsjetnici, uključi [data-testid=klijent-salji-toggle],
    // upiši email u [data-testid=klijent-email-input], klikni add, potvrdi chip,
    // ukloni, potvrdi. Na kraju: salji=false, prazna lista.
  })

  test("dodjela radnika sa strane firme se odrazi u Postavke → Korisnici", async ({ page }) => {
    // kao admin: ?tab=podsjetnici, čekiraj radnika [data-testid=radnik-<id>], klikni spasi,
    // idi na /postavke → Korisnici, potvrdi da taj korisnik ima firmu u dodjelama. Na kraju vrati.
  })

  test("regresija: POST Pokreni sada radi bez obzira na sat (dry)", async ({ page }) => {
    // klikni [data-testid=pokreni-podsjetnike] → potvrdi → [data-testid=pokreni-rezultat] vidljiv.
  })
})
```

Popuni konkretne korake selektorima iz Task 7/10 (svi imaju `data-testid`). Za DB restauraciju koristi `db.ts` service klijent (upravo za DEMO), analogno `06-podsjetnici`.

- [ ] **Step 3: Pokreni ciljano**

Run: `pnpm exec playwright test tests/e2e/19-podsjetnici-v2.spec.ts`
Expected: PASS (chromium + webkit). Ako webkit race-a na refresh, dodaj `await page.waitForLoadState("networkidle")` (obrazac iz postojećih specova).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/19-podsjetnici-v2.spec.ts
git commit -m "test(e2e): podsjetnici v2 — vrijeme, globalni prekidač, tab firme, dvosmjerna dodjela, gate-bypass regresija"
```

---

## Task 13: Regen tipova + cloud rollout (DEMO → PROD)

**Files:**
- Modify (auto): `db/types.ts`
- Manual: cloud DB (DEMO, PROD)

**Interfaces:**
- Consumes: migracija iz Task 1.
- Produces: `db/types.ts` sa novim kolonama; migracija primijenjena na DEMO i PROD.

- [ ] **Step 1: Regen tipova iz LOKALNOG stack-a**

`pnpm db:types` čita aktivni `DATABASE_URL` iz `.env.local` (= PROD). Za lokalni regen, generiši direktno protiv lokalnog pooler-a (ne diraj `.env.local`):

Run: `pnpm supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > db/types.ts`
Expected: `db/types.ts` sadrži `vrijeme_slanja_sat`, `zadnje_slanje_datum`, `salji_klijentima`, `salji_podsjetnik_klijentu`.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Commit tipova**

```bash
git add db/types.ts
git commit -m "chore(db): regen types za podsjetnici v2 kolone (iz lokalnog stacka)"
```

- [ ] **Step 3: Primijeni migraciju na DEMO cloud**

Run: `DATABASE_URL="$DATABASE_URL_DEMO" pnpm db:apply-cloud supabase/migrations/20260708120000_podsjetnici_v2.sql`
Expected: uspješna primjena na DEMO bazu (`mtwwotmwrasozmcgqwhc`). Verifikuj: `DATABASE_URL="$DATABASE_URL_DEMO" psql "$DATABASE_URL_DEMO" -c "\d postavke"` pokazuje nove kolone.

- [ ] **Step 4: Primijeni migraciju na PROD cloud**

> **PROVJERI ref prije pokretanja** — goli `db:apply-cloud` čita `DATABASE_URL` iz `.env.local` = PROD `fqtqkehjidkzeasiegnq`. Svjestan PROD upis.

Run: `pnpm db:apply-cloud supabase/migrations/20260708120000_podsjetnici_v2.sql`
Expected: uspješna primjena na PROD.

- [ ] **Step 5: Finalna verifikacija**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit`
Expected: sve zeleno.

---

## Self-Review (autor plana)

**Spec coverage:**
- Podesivo vrijeme (08:00 Vienna) → Task 1 (kolona), 2 (helper), 3 (gate), 6 (akcija), 7 (UI). ✅
- Krug 2 globalni+per-firma → Task 1, 4 (recipients), 5 (engine), 6 (globalni), 9+10 (per-firma). ✅
- Dvosmjerna dodjela + „ko šta prima" → Task 8 (pregled), 9 (akcija), 10 (UI). ✅
- Mehanizam sata (≥ + jednom dnevno, GH Actions, Vercel rezerva) → Task 3, 11. ✅
- RLS (dodjela admin-only, per-firma operater) → Task 9 (klijent + guard), 10 (UI gate). ✅
- Rollout (lokalno → db:types lokalni → DEMO → PROD) → Task 13. ✅
- Testovi (unit gating/recipients, e2e izolacija) → Task 2, 4, 12. ✅

**Placeholder scan:** Task 12 koristi skeletne `test.step` opise namjerno (e2e selektori zavise od finalnog renderiranja) uz eksplicitne `data-testid` i referentni postojeći spec — nije „TODO bez uputa". Ostali taskovi imaju pun kod.

**Type consistency:** `buildRecipientIndex(korisnici, dodjele, klijenti, saljiKlijentima)` i `RecipientIndex.klijentEmailsByKlijent` konzistentni Task 4↔5. `updateVrijemeSlanja`/`updateSaljiKlijentima` potpisi konzistentni Task 6↔7. `updateKlijentPodsjetnici(klijentId, salji, emails)` i `postaviDodjeleZaKlijenta(klijentId, korisnikIds[])` konzistentni Task 9↔10. `lokalniSatIDatum`/`trebaSlatiSada` konzistentni Task 2↔3.
