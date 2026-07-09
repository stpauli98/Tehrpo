# Podsjetnici → primaoci iz kontakata firme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** U tabu Podsjetnici, primaoci firminih podsjetnika (Kanal 2) se biraju iz sačuvanih kontakata firme (`kontakt_osobe`) umjesto ručnog kucanja mejla; `klijenti.podsjetnik_emails` se ukida.

**Architecture:** Jedan izvor istine = `kontakt_osobe`. Novi boolean `kontakt_osobe.podsjetnik_primalac` označava primaoce. Reminder engine čita mejlove flagovanih kontakata u trenutku slanja. Expand/contract migracija (A: dodaj+migriraj, unazad-kompatibilno; B: drop nakon deploya).

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`, `--webpack`), React 19, Supabase (SSR anon + `pg` za cloud migracije), next-intl (sr/en/de), Vitest (unit), Playwright (e2e cloud DEMO), Tailwind v4, pnpm.

## Global Constraints

- **`pnpm dev` MORA `--webpack`** (Turbopack pukne zbog razmaka u putanji „Ai Forward"). Skripte to već forsiraju.
- **Package manager `pnpm`** — ne npm/yarn.
- **Domenski jezik bosanski/srpski (latinica):** tabele/kolone/UI stringovi u domenskom jeziku (`kontakt_osobe`, `podsjetnik_primalac`…). Uskladi.
- **Migracije: local → DEMO → PROD.** Cloud NIJE dostupan kroz Supabase MCP → `pnpm db:apply-cloud <fajl>` (raw `pg` preko `DATABASE_URL`). Goli poziv ide na **PROD** (`.env.local`); za DEMO: `DATABASE_URL="$DATABASE_URL_DEMO" pnpm db:apply-cloud <fajl>`. **PROD ref = `fqtqkehjidkzeasiegnq` — provjeriti prije PROD upisa.**
- **`db/types.ts` je AUTO-GENERISAN** — nikad ručno; `pnpm db:types` po defaultu čita PROD `DATABASE_URL`, pa regen radi iz **lokalnog** stack-a (vidi Task 1/8).
- **Expand/contract:** Migracija A je unazad-kompatibilna (`podsjetnik_emails` ostaje) → smije na PROD prije deploya. Migracija B (`drop`) tek nakon što je novi kod živ na sve 3 instance.
- **Bez `sm:`/`md:` Tailwind breakpointa** (eslint `no-restricted-syntax`) — koristi `lg:`/`xl:` ili bez.
- **`no-await-in-loop: error`** svuda osim `scripts/`.
- **E2E ide na cloud DEMO** (živi `RESEND_API_KEY`, dijeljeni single-row `postavke`): svaki run `dryRun:true`, restauriraj izmijenjeno stanje nakon testa.
- **`de.json` čeka native review** — DE prijevodi su privremeni (memory „i18n status").
- **Backend testiranje ide kroz Docker** (lokalni Supabase stack: `supabase start`).

---

## Task 1: Migracija A (expand) — kolona + migracija podataka + lokalni apply + regen tipova

**Files:**
- Create: `supabase/migrations/20260709120000_kontakt_podsjetnik_primalac.sql`
- Modify (regen): `db/types.ts`

**Interfaces:**
- Produces: kolona `kontakt_osobe.podsjetnik_primalac boolean not null default false`; `db/types.ts` sadrži i `podsjetnik_primalac` i (još) `podsjetnik_emails`.

- [ ] **Step 1: Napiši migracioni fajl**

Create `supabase/migrations/20260709120000_kontakt_podsjetnik_primalac.sql`:

```sql
-- Podsjetnici: primaoci firminih podsjetnika biraju se iz kontakata (kontakt_osobe),
-- ne iz slobodne liste klijenti.podsjetnik_emails.
-- EXPAND korak: dodaj flag + migriraj postojeće podsjetnik_emails u kontakte.
-- podsjetnik_emails OSTAJE (drop je zasebna migracija B, nakon deploya novog koda).

begin;

-- 1) po-kontakt flag: „ovaj kontakt prima firmine podsjetnike"
alter table kontakt_osobe
  add column podsjetnik_primalac boolean not null default false;

-- 2a) postojeći kontakt čiji se mejl poklapa s podsjetnik_emails svoje firme → označi
update kontakt_osobe ko
set podsjetnik_primalac = true
from klijenti k
where ko.klijent_id = k.id
  and ko.email is not null
  and lower(btrim(ko.email)) = any (
    select lower(btrim(e)) from unnest(k.podsjetnik_emails) e where btrim(e) <> ''
  );

-- 2b) orphan mejl (nema kontakta) → napravi kontakt (ime=mejl, može se preimenovati)
insert into kontakt_osobe (klijent_id, ime, email, podsjetnik_primalac)
select distinct k.id, lower(btrim(e)), lower(btrim(e)), true
from klijenti k
cross join lateral unnest(k.podsjetnik_emails) e
where btrim(e) <> ''
  and not exists (
    select 1 from kontakt_osobe ko
    where ko.klijent_id = k.id
      and ko.email is not null
      and lower(btrim(ko.email)) = lower(btrim(e))
  );

commit;
```

- [ ] **Step 2: Pokreni lokalni Supabase stack (ako ne radi)**

Run: `supabase status || supabase start`
Expected: stack radi (API na `http://127.0.0.1:54321`, DB na `54322`).

- [ ] **Step 3: Primijeni sve migracije lokalno**

Run: `pnpm db:reset`
Expected: reapply svih migracija bez greške; zadnja je `20260709120000_kontakt_podsjetnik_primalac`.

Ako `db:reset` prijavi grešku na koraku 2a/2b zbog audit trigera (`tg_audit` traži `auth.uid()`), umetni **unutar `begin;…commit;`** prije koraka 2a:
`alter table kontakt_osobe disable trigger user;` i poslije 2b: `alter table kontakt_osobe enable trigger user;` — pa ponovi `pnpm db:reset`. (Očekivano nije potrebno: `pnpm seed` već ubacuje kontakte servisnom rolom bez actora.)

- [ ] **Step 4: Regeneriši tipove iz LOKALNOG stack-a**

Run: `supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > db/types.ts`
Expected: fajl se prepiše; `db/types.ts` sadrži `podsjetnik_primalac: boolean` u `kontakt_osobe` Row/Insert/Update, a `podsjetnik_emails` u `klijenti` **i dalje postoji**.

- [ ] **Step 5: Provjeri regen**

Run: `grep -n 'podsjetnik_primalac' db/types.ts && grep -c 'podsjetnik_emails' db/types.ts`
Expected: `podsjetnik_primalac` se pojavljuje (≥3×); `podsjetnik_emails` count > 0 (još nije obrisan).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260709120000_kontakt_podsjetnik_primalac.sql db/types.ts
git commit -m "feat(db): kontakt_osobe.podsjetnik_primalac + migracija podsjetnik_emails (expand)"
```

---

## Task 2: `recipients.ts` — tipovi + `buildRecipientIndex` iz kontakata (TDD)

**Files:**
- Modify: `lib/reminders/recipients.ts`
- Test: `lib/reminders/recipients.test.ts`

**Interfaces:**
- Consumes: `EMAIL_RE`, `RecipientIndex` (postoje).
- Produces:
  - `type KlijentReminderRow = { id: string; salji_podsjetnik_klijentu: boolean }`
  - `type KontaktPrimalacRow = { klijent_id: string; email: string | null; podsjetnik_primalac: boolean }`
  - `buildRecipientIndex(korisnici: KorisnikRow[], dodjele: {korisnik_id:string;klijent_id:string}[], klijenti?: KlijentReminderRow[], kontakti?: KontaktPrimalacRow[], saljiKlijentima?: boolean): RecipientIndex`
  - `firmaRecipientsForKlijent(index, klijentId)` — nepromijenjen potpis.

- [ ] **Step 1: Zamijeni „razdvajanje kanala" testove novom logikom (failing)**

U `lib/reminders/recipients.test.ts` zamijeni cijeli `describe("razdvajanje kanala", …)` blok (linije ~66–100) ovim:

```ts
describe("razdvajanje kanala (firmine adrese iz kontakata)", () => {
  const kor = [
    { id: "admin1", email: "admin@tehpro.test", uloga: "admin", aktivan: true, prima_podsjetnike: true },
    { id: "op1", email: "radnik@tehpro.test", uloga: "operater", aktivan: true, prima_podsjetnike: true },
  ]
  const dodjele = [{ korisnik_id: "op1", klijent_id: "K1" }]
  const klijenti = [{ id: "K1", salji_podsjetnik_klijentu: true }]
  const kontakti = [{ klijent_id: "K1", email: "firma@drina.ba", podsjetnik_primalac: true }]

  it("interni NE uključuje firmine adrese", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, kontakti, true)
    const to = recipientsForKlijent(idx, "K1", [])
    expect(to).toContain("radnik@tehpro.test")
    expect(to).toContain("admin@tehpro.test")
    expect(to).not.toContain("firma@drina.ba")
  })
  it("firmaRecipientsForKlijent vraća SAMO mejlove flagovanih kontakata", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, kontakti, true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual(["firma@drina.ba"])
  })
  it("global prekidač isključen → firma prazna", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, kontakti, false)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("per-firma flag isključen → firma prazna", () => {
    const idx = buildRecipientIndex(kor, dodjele, [{ id: "K1", salji_podsjetnik_klijentu: false }], kontakti, true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("kontakt bez podsjetnik_primalac se ignoriše", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: "firma@drina.ba", podsjetnik_primalac: false }], true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("flagovan kontakt bez emaila se ignoriše (nema praznog primaoca)", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: null, podsjetnik_primalac: true }], true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("dva flagovana kontakta iste firme → obje adrese", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, [
      { klijent_id: "K1", email: "a@firma.ba", podsjetnik_primalac: true },
      { klijent_id: "K1", email: "b@firma.ba", podsjetnik_primalac: true },
    ], true)
    expect(firmaRecipientsForKlijent(idx, "K1").sort()).toEqual(["a@firma.ba", "b@firma.ba"])
  })
  it("nevalidan mejl kontakta se odbacuje", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti,
      [{ klijent_id: "K1", email: "nijemejl", podsjetnik_primalac: true }], true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: FAIL (TS/tip greška: `buildRecipientIndex` još prima `podsjetnik_emails`, ne `kontakti`).

- [ ] **Step 3: Izmijeni `recipients.ts`**

Zamijeni `KlijentReminderRow` (linije 34–38) i `buildRecipientIndex` (linije 46–78):

```ts
export type KlijentReminderRow = {
  id: string
  salji_podsjetnik_klijentu: boolean
}

export type KontaktPrimalacRow = {
  klijent_id: string
  email: string | null
  podsjetnik_primalac: boolean
}

/** Indeks primalaca: admini + dodijeljeni (interni) + firmine adrese (Krug 2, iz flagovanih kontakata). */
export function buildRecipientIndex(
  korisnici: KorisnikRow[],
  dodjele: { korisnik_id: string; klijent_id: string }[],
  klijenti: KlijentReminderRow[] = [],
  kontakti: KontaktPrimalacRow[] = [],
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
  // Krug 2: firmine adrese = mejlovi flagovanih kontakata, samo kad je globalni prekidač
  // uključen I firma per-firma uključena. firmaRecipientsForKlijent kasnije lowercase-uje/dedupira.
  const klijentEmailsByKlijent = new Map<string, string[]>()
  if (saljiKlijentima) {
    const firmaUkljucena = new Set<string>()
    for (const k of klijenti) {
      if (k.salji_podsjetnik_klijentu) firmaUkljucena.add(k.id)
    }
    for (const ko of kontakti) {
      if (!ko.podsjetnik_primalac || !firmaUkljucena.has(ko.klijent_id)) continue
      const email = (ko.email ?? "").trim()
      if (!EMAIL_RE.test(email)) continue
      const arr = klijentEmailsByKlijent.get(ko.klijent_id) ?? []
      arr.push(email)
      klijentEmailsByKlijent.set(ko.klijent_id, arr)
    }
  }
  return { adminEmails, assignedByKlijent, klijentEmailsByKlijent }
}
```

(`firmaRecipientsForKlijent`, `recipientsForKlijent`, `assembleRecipients`, `parseEmailList`, `EMAIL_RE`, `RecipientIndex`, `KorisnikRow` ostaju nepromijenjeni.)

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: PASS (svi, uključujući postojeće `buildRecipientIndex + recipientsForKlijent` testove — oni koriste 2 argumenta i nisu dirani).

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/recipients.ts lib/reminders/recipients.test.ts
git commit -m "feat(reminders): firmine adrese iz flagovanih kontakata (recipients)"
```

---

## Task 3: `runReminders.ts` — fetch kontakata + izmjena klijenti selecta (TDD)

**Files:**
- Modify: `lib/reminders/runReminders.ts:68-77`
- Test: `lib/reminders/runReminders.test.ts`

**Interfaces:**
- Consumes: `buildRecipientIndex(...5 args)` (Task 2).
- Produces: engine čita `kontakt_osobe` i prosljeđuje ga u indeks; `klijenti` select više ne traži `podsjetnik_emails`.

- [ ] **Step 1: Ažuriraj test fake + podatke (failing)**

U `lib/reminders/runReminders.test.ts`:

(a) Zamijeni tip `KlRow` (linija 19):
```ts
type KlRow = { id: string; salji_podsjetnik_klijentu: boolean }
type KontaktRow = { klijent_id: string; email: string | null; podsjetnik_primalac: boolean }
```

(b) Dodaj u `opts` (unutar `makeFake(opts: {…})`, uz `klijenti?`):
```ts
  kontakti?: KontaktRow[]
```

(c) Izmijeni `klijenti` granu i dodaj `kontakt_osobe` granu u `from(table)` (uz postojeću `klijenti` granu, prije `podsjetnici`):
```ts
      if (table === "klijenti") {
        return { select: async () => (opts.klijentiError ? { data: null, error: { message: opts.klijentiError } } : { data: opts.klijenti ?? [], error: null }) }
      }
      if (table === "kontakt_osobe") {
        return { select: async () => ({ data: opts.kontakti ?? [], error: null }) }
      }
```

(d) U 4 test-slučaja zamijeni `podsjetnik_emails` sa kontaktima:
- linija ~138: `klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true }], kontakti: [{ klijent_id: "k1", email: "firma@klijent.com", podsjetnik_primalac: true }],`
- linija ~161: `klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true }], kontakti: [{ klijent_id: "k1", email: "firma@drina.ba", podsjetnik_primalac: true }],`
- linija ~180: `klijenti: [{ id: "k1", salji_podsjetnik_klijentu: false }], kontakti: [{ klijent_id: "k1", email: "firma@klijent.com", podsjetnik_primalac: true }],`
- linija ~195: `klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true }], kontakti: [{ klijent_id: "k1", email: "firma@klijent.com", podsjetnik_primalac: true }],`

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: FAIL (engine još čita `podsjetnik_emails` i ne poziva `kontakt_osobe`; `from("kontakt_osobe")` bi bacio „neočekivan from" da je pozvan — ili firmin kanal ne šalje).

- [ ] **Step 3: Izmijeni `runReminders.ts` (linije 68–77)**

```ts
  const { data: klijentiZaSlanje, error: klErr } = await supabase
    .from("klijenti")
    .select("id, salji_podsjetnik_klijentu")
  if (klErr) throw new Error(`Greška pri čitanju klijenata (Krug 2): ${klErr.message}`)
  // Firmine adrese dolaze iz flagovanih kontakata (jedan izvor istine = kontakt_osobe).
  // PostgREST ~1000-red limit: sigurno na trenutnoj skali; ako kontakti narastu dodaj .range()/count.
  const { data: kontaktiPrimaoci, error: kontErr } = await supabase
    .from("kontakt_osobe")
    .select("klijent_id, email, podsjetnik_primalac")
  if (kontErr) throw new Error(`Greška pri čitanju kontakata (Krug 2): ${kontErr.message}`)
  const recipientIndex = buildRecipientIndex(
    korisnici ?? [],
    dodjele ?? [],
    klijentiZaSlanje ?? [],
    kontaktiPrimaoci ?? [],
    saljiKlijentima,
  )
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/runReminders.ts lib/reminders/runReminders.test.ts
git commit -m "feat(reminders): engine čita firmine primaoce iz kontakt_osobe"
```

---

## Task 4: Podsjetnici tab — server akcije + tab + forma (checklist umjesto chips)

**Files:**
- Modify: `app/(dashboard)/klijenti/[id]/actions.ts` (zamijeni `updateKlijentPodsjetnici`)
- Modify: `components/domain/KlijentPodsjetniciTab.tsx`
- Rewrite: `components/domain/KlijentPodsjetniciForm.tsx`

**Interfaces:**
- Consumes: `ActionResult` (iz `klijenti/actions`), tipovi iz `db/types`.
- Produces:
  - `updateKlijentSaljiPodsjetnik(klijentId: string, salji: boolean): Promise<ActionResult>`
  - `updateKontaktPodsjetnikPrimalac(kontaktId: string, klijentId: string, primalac: boolean): Promise<ActionResult>`
  - `KlijentPodsjetniciForm` prop: `{ klijentId: string; salji: boolean; kontakti: KontaktZaPodsjetnik[] }`

- [ ] **Step 1: Zamijeni akcije u `klijenti/[id]/actions.ts`**

Ukloni `updateKlijentPodsjetnici` (linije 11–28) i konstantu `EMAIL_RE_KL` (linija 9). Umetni umjesto njih:

```ts
/** Per-firma: uključi/isključi slanje podsjetnika firmi. SSR → RLS klijenti_upd (operater sa pristupom smije). */
export async function updateKlijentSaljiPodsjetnik(
  klijentId: string,
  salji: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("klijenti")
    .update({ salji_podsjetnik_klijentu: salji })
    .eq("id", klijentId)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}

/** Označi/odznači kontakt kao primaoca firminih podsjetnika. SSR → RLS kontakt_osobe (ima_pristup_klijentu). */
export async function updateKontaktPodsjetnikPrimalac(
  kontaktId: string,
  klijentId: string,
  primalac: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("kontakt_osobe")
    .update({ podsjetnik_primalac: primalac })
    .eq("id", kontaktId)
    .eq("klijent_id", klijentId)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}
```

(`postaviDodjeleZaKlijenta` i njegovi importi `createAdminSupabaseClient`/`zahtijevajAdmina` ostaju.)

- [ ] **Step 2: Ažuriraj `KlijentPodsjetniciTab.tsx` (dohvati kontakte)**

Zamijeni `Promise.all` blok (linije 12–20) i poziv forme (linija 26):

```tsx
  const [klRes, kontaktiRes, radniciRes, dodjeleRes] = await Promise.all([
    supabase.from("klijenti").select("salji_podsjetnik_klijentu").eq("id", klijentId).maybeSingle(),
    supabase.from("kontakt_osobe").select("id, ime, funkcija, email, podsjetnik_primalac").eq("klijent_id", klijentId).order("ime"),
    jeAdmin ? supabase.from("korisnici").select("id, ime").eq("aktivan", true).order("ime") : Promise.resolve({ data: [] }),
    jeAdmin ? supabase.from("korisnik_klijent").select("korisnik_id").eq("klijent_id", klijentId) : Promise.resolve({ data: [] }),
  ])
  const salji = klRes.data?.salji_podsjetnik_klijentu ?? false
  const kontakti = (kontaktiRes.data ?? []).map((k) => ({
    id: k.id, ime: k.ime, funkcija: k.funkcija, email: k.email, podsjetnik_primalac: k.podsjetnik_primalac,
  }))
  const radnici = (radniciRes.data ?? []).map((r) => ({ id: r.id, ime: r.ime }))
  const izabrani = (dodjeleRes.data ?? []).map((d: { korisnik_id: string }) => d.korisnik_id)
```

Zatim u JSX zamijeni `<KlijentPodsjetniciForm klijentId={klijentId} salji={salji} emails={emails} />` sa:
```tsx
        <KlijentPodsjetniciForm klijentId={klijentId} salji={salji} kontakti={kontakti} />
```

- [ ] **Step 3: Prepiši `KlijentPodsjetniciForm.tsx`**

Zamijeni cijeli fajl:

```tsx
"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  updateKlijentSaljiPodsjetnik,
  updateKontaktPodsjetnikPrimalac,
} from "@/app/(dashboard)/klijenti/[id]/actions"

type KontaktZaPodsjetnik = {
  id: string
  ime: string
  funkcija: string | null
  email: string | null
  podsjetnik_primalac: boolean
}

export function KlijentPodsjetniciForm({
  klijentId, salji, kontakti,
}: { klijentId: string; salji: boolean; kontakti: KontaktZaPodsjetnik[] }) {
  const t = useTranslations("klijenti.podsjetnici")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [saljiState, setSalji] = useState(salji)
  const [izabrani, setIzabrani] = useState<Set<string>>(
    () => new Set(kontakti.filter((k) => k.podsjetnik_primalac).map((k) => k.id)),
  )

  function toggleSalji(next: boolean) {
    setSalji(next)
    startTransition(async () => {
      const res = await updateKlijentSaljiPodsjetnik(klijentId, next)
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else { setSalji(!next); toast.error(res.message) }
    })
  }

  function toggleKontakt(kontaktId: string, next: boolean) {
    setIzabrani((prev) => {
      const kopija = new Set(prev)
      if (next) kopija.add(kontaktId); else kopija.delete(kontaktId)
      return kopija
    })
    startTransition(async () => {
      const res = await updateKontaktPodsjetnikPrimalac(kontaktId, klijentId, next)
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else {
        setIzabrani((prev) => {
          const kopija = new Set(prev)
          if (next) kopija.delete(kontaktId); else kopija.add(kontaktId)
          return kopija
        })
        toast.error(res.message)
      }
    })
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
          onChange={(e) => toggleSalji(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">{t("saljiNaslov")}</span>
          <span className="block text-sm text-slate-500">{t("saljiOpis")}</span>
        </span>
      </label>

      <div>
        <p className="mb-2 text-sm font-medium">{t("primaociNaslov")}</p>
        {kontakti.length === 0 ? (
          <p className="text-sm text-slate-500" data-testid="klijent-primaoci-prazno">
            {t("nemaKontakata")}{" "}
            <Link href={`/klijenti/${klijentId}?tab=kontakti`} className="font-medium text-brand hover:underline">
              {t("dodajKontaktLink")}
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {kontakti.map((k) => {
              const imaEmail = !!(k.email && k.email.trim())
              return (
                <li
                  key={k.id}
                  data-testid={`klijent-primalac-red-${k.id}`}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={izabrani.has(k.id)}
                    disabled={pending || !imaEmail}
                    data-testid={`klijent-primalac-${k.id}`}
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                    onChange={(e) => toggleKontakt(k.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {k.ime}
                      {k.funkcija && <span className="font-normal text-slate-500"> · {k.funkcija}</span>}
                    </span>
                    {imaEmail ? (
                      <span className="block truncate text-sm text-slate-500">{k.email}</span>
                    ) : (
                      <span
                        className="block text-sm text-amber-600"
                        data-testid={`klijent-primalac-nema-email-${k.id}`}
                      >
                        {t("nemaEmail")}{" "}
                        <Link href={`/klijenti/${klijentId}?tab=kontakti`} className="underline">
                          {t("dodajEmailLink")}
                        </Link>
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS. (i18n ključevi `primaociNaslov`/`nemaKontakata`/`dodajKontaktLink`/`nemaEmail`/`dodajEmailLink` se dodaju u Task 7 — next-intl ih ne provjerava u tipovima, pa typecheck prolazi; nedostajući ključ bi se u runtime-u prikazao kao sam ključ dok se ne doda.)

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/klijenti/[id]/actions.ts" components/domain/KlijentPodsjetniciTab.tsx components/domain/KlijentPodsjetniciForm.tsx
git commit -m "feat(podsjetnici): checklist kontakata umjesto ručnog unosa mejla"
```

---

## Task 5: Ukloni `podsjetnik_emails` iz edit forme (`KlijentEditForm` + `updateKlijent` + `page.tsx`)

**Files:**
- Modify: `components/domain/KlijentEditForm.tsx` (prop type + polje)
- Modify: `app/(dashboard)/klijenti/actions.ts` (schema + `updateKlijent` + import)
- Modify: `app/(dashboard)/klijenti/[id]/page.tsx` (select + prop)

**Interfaces:**
- Produces: edit forma više ne piše `podsjetnik_emails` (kolona se ukida u Task 8).

- [ ] **Step 1: `KlijentEditForm.tsx` — ukloni polje i prop**

Obriši blok `<label>…primaociLabel…</label>` (linije 153–164). U prop tipu (linija 33) ukloni `podsjetnik_emails: string[];` (ostaje `id/naziv/napomena/tip_odnosa/…`). Ažuriraj komentar na liniji 26 da ne spominje `podsjetnik_emails`.

- [ ] **Step 2: `klijenti/actions.ts` — ukloni schema polje, blok i import**

- Ukloni iz `updateKlijentSchema` polje `podsjetnik_emails: z.string().max(2000).optional(),` (linija 86).
- Ukloni cijeli `if (formData.has("podsjetnik_emails")) { … }` blok (linije 107–116).
- Ukloni import `import { parseEmailList, EMAIL_RE } from "@/lib/reminders/recipients"` (linija 7) — postaje neiskorišten.

- [ ] **Step 3: `page.tsx` — ukloni iz selecta i propa**

- Linija 53: `.select("podsjetnik_emails, tip_odnosa, adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id")` → ukloni `podsjetnik_emails, ` (novo: `.select("tip_odnosa, adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id")`).
- Ukloni liniju 156: `podsjetnik_emails: primaociRes.data?.podsjetnik_emails ?? [],`.
- Ažuriraj komentar linija 47 (spominje `podsjetnik_emails`) da glasi npr.: `// klijenti_view ne izlaže sva polja edit-forme, pa dodajemo 4. fetch direktno iz klijenti tabele.`

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS. (Sve reference na `podsjetnik_emails` u app kodu su uklonjene osim `KoStaPrimaTab` — to je Task 6; `db/types.ts` još ima kolonu pa nema TS greške.)

- [ ] **Step 5: Commit**

```bash
git add components/domain/KlijentEditForm.tsx "app/(dashboard)/klijenti/actions.ts" "app/(dashboard)/klijenti/[id]/page.tsx"
git commit -m "refactor(klijenti): ukloni ručno polje podsjetnik_emails iz edit forme"
```

---

## Task 6: `KoStaPrimaTab` — „firma prima" i adrese iz kontakata

**Files:**
- Modify: `components/domain/KoStaPrimaTab.tsx`

**Interfaces:**
- Produces: admin pregled računa primaoce iz flagovanih kontakata (`podsjetnik_primalac`) umjesto `podsjetnik_emails`.

- [ ] **Step 1: Izmijeni fetch i računanje**

Zamijeni `Promise.all` blok (linije 18–23) — u `klijenti` select ukloni `podsjetnik_emails`, dodaj `kontakt_osobe` fetch:

```tsx
  const [postRes, korisniciRes, klijentiRes, dodjeleRes, kontaktiRes] = await Promise.all([
    supabase.from("postavke").select("salji_klijentima").eq("id", 1).maybeSingle(),
    supabase.from("korisnici").select("id, ime, prima_podsjetnike, aktivan").order("ime"),
    supabase.from("klijenti").select("id, naziv, salji_podsjetnik_klijentu").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
    supabase.from("kontakt_osobe").select("klijent_id, email, podsjetnik_primalac"),
  ])
  const saljiGlobalno = postRes.data?.salji_klijentima ?? false
  const korisnici = korisniciRes.data ?? []
  const dodjele = dodjeleRes.data ?? []
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  // klijent_id → validne adrese flagovanih kontakata
  const adreseByKlijent = new Map<string, string[]>()
  for (const ko of kontaktiRes.data ?? []) {
    if (!ko.podsjetnik_primalac) continue
    const email = (ko.email ?? "").trim()
    if (!EMAIL_RE.test(email)) continue
    const arr = adreseByKlijent.get(ko.klijent_id) ?? []
    arr.push(email)
    adreseByKlijent.set(ko.klijent_id, arr)
  }
```

Zatim u `.map((k) => {…})` (linija 33–50) zamijeni `const adrese = k.podsjetnik_emails ?? []` sa:
```tsx
    const adrese = adreseByKlijent.get(k.id) ?? []
```
(`firmaPrima` i `razlog` logika ostaju identični — koriste `adrese.length`.)

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS. Provjeri da nijedan app/komponentni fajl više ne referiše `podsjetnik_emails`:
Run: `grep -rn 'podsjetnik_emails' app components lib --include='*.ts' --include='*.tsx'`
Expected: **nema pogodaka** (samo `db/types.ts` još ima kolonu — nju briše Task 8).

- [ ] **Step 3: Commit**

```bash
git add components/domain/KoStaPrimaTab.tsx
git commit -m "refactor(postavke): KoStaPrima računa adrese iz flagovanih kontakata"
```

---

## Task 7: i18n — dodaj nove ključeve, ukloni orphan ključeve (sr/en/de)

**Files:**
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json`

**Interfaces:**
- Produces: `klijenti.podsjetnici` ključevi `primaociNaslov`, `nemaKontakata`, `dodajKontaktLink`, `nemaEmail`, `dodajEmailLink`.

- [ ] **Step 1: `klijenti.podsjetnici` — dodaj nove, ukloni stare (sve tri datoteke)**

U `klijenti.podsjetnici` **ukloni** ključeve koje je stara chip-forma koristila: `adreseNaslov`, `nemaAdresa`, `adresaPlaceholder`, `dodaj`, `ukloniAdresu`, `emailNeispravan`. **Dodaj** nove. Zadrži `sekcijaSlanje`, `sekcijaDodjela`, `saljiNaslov`, `saljiOpis`, `spaseno`.

`messages/sr.json` → `klijenti.podsjetnici` nakon izmjene:
```json
      "sekcijaSlanje": "Slanje firmi",
      "sekcijaDodjela": "Dodijeljeni radnici",
      "saljiNaslov": "Šalji podsjetnike ovoj firmi",
      "saljiOpis": "Radi samo ako je u Postavkama uključeno globalno slanje firmama.",
      "primaociNaslov": "Primaoci (kontakti firme)",
      "nemaKontakata": "Nema kontakata firme.",
      "dodajKontaktLink": "Dodaj kontakt →",
      "nemaEmail": "nema email —",
      "dodajEmailLink": "dodaj email",
      "spaseno": "Sačuvano."
```

`messages/en.json` → `klijenti.podsjetnici`:
```json
      "primaociNaslov": "Recipients (company contacts)",
      "nemaKontakata": "No company contacts.",
      "dodajKontaktLink": "Add a contact →",
      "nemaEmail": "no email —",
      "dodajEmailLink": "add email"
```
(uz zadržane `sekcijaSlanje/sekcijaDodjela/saljiNaslov/saljiOpis/spaseno` na engleskom kakvi već jesu.)

`messages/de.json` → `klijenti.podsjetnici` (privremeno, čeka native review):
```json
      "primaociNaslov": "Empfänger (Firmenkontakte)",
      "nemaKontakata": "Keine Firmenkontakte.",
      "dodajKontaktLink": "Kontakt hinzufügen →",
      "nemaEmail": "keine E-Mail —",
      "dodajEmailLink": "E-Mail hinzufügen"
```

- [ ] **Step 2: Ukloni orphan ključeve edit forme (sve tri datoteke)**

- `klijenti.uredi.primaociLabel` i `klijenti.uredi.primaociPlaceholder` — ukloni.
- `klijenti.actions.primaociNeispravanEmail` — ukloni.

- [ ] **Step 3: Provjeri validnost JSON-a i paritet ključeva**

Run:
```bash
node -e "for(const l of ['sr','en','de']){const m=require('./messages/'+l+'.json'); const p=m.klijenti.podsjetnici; console.log(l, Object.keys(p).sort().join(','));}"
```
Expected: sve tri datoteke ispišu **isti** skup ključeva uključujući `primaociNaslov,nemaKontakata,dodajKontaktLink,nemaEmail,dodajEmailLink`, bez `adreseNaslov/dodaj/…`.

- [ ] **Step 4: Commit**

```bash
git add messages/sr.json messages/en.json messages/de.json
git commit -m "i18n(podsjetnici): ključevi za checklist primalaca (sr/en/de)"
```

---

## Task 8: Migracija B (contract) — drop `podsjetnik_emails` + regen + puna verifikacija

**Files:**
- Create: `supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql`
- Modify (regen): `db/types.ts`

**Interfaces:**
- Produces: kolona `klijenti.podsjetnik_emails` uklonjena; `db/types.ts` bez nje.

- [ ] **Step 1: Napiši migraciju B**

Create `supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql`:
```sql
-- CONTRACT korak: primaoci firminih podsjetnika sada žive na kontakt_osobe.podsjetnik_primalac.
-- Pušta se TEK nakon što je novi kod (koji ne referiše ovu kolonu) živ na svim instancama.
alter table klijenti drop column podsjetnik_emails;
```

- [ ] **Step 2: Primijeni lokalno + regen tipova**

Run: `pnpm db:reset`
Then: `supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > db/types.ts`
Expected: bez greške.

- [ ] **Step 3: Provjeri da je kolona nestala iz tipova i koda**

Run: `grep -rn 'podsjetnik_emails' db/types.ts app components lib --include='*.ts' --include='*.tsx'`
Expected: **nema pogodaka**.

- [ ] **Step 4: Puna verifikacija (unit + lint + types)**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit`
Expected: sve PASS (typecheck bi pao da je ostala referenca na obrisanu kolonu — mreža za contract).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql db/types.ts
git commit -m "feat(db): drop klijenti.podsjetnik_emails (contract)"
```

---

## Task 9: E2E — checklist primalaca (Playwright, cloud DEMO)

**Files:**
- Create: `tests/e2e/24-podsjetnici-primaoci.spec.ts`

**Interfaces:**
- Consumes: postojeći auth/storageState obrazac (`auth.setup.ts`) i pomoćnici iz `tests/e2e/`.

> **Preduslov izvršenja:** DEMO cloud mora imati primijenjenu **Migraciju A** (Task 10, korak DEMO) prije pokretanja ovog testa — E2E ide na cloud DEMO, ne na lokalni stack. Test se **piše** sada; **pokreće** nakon DEMO migracije.

- [ ] **Step 1: Prouči postojeći obrazac**

Pročitaj `tests/e2e/23-podsjetnici-v2.spec.ts` i `tests/e2e/06-podsjetnici.spec.ts` — preuzmi: kako se bira klijent, kako se otvara tab `?tab=podsjetnici`, kako se čita/vraća stanje (izolacija: dry + restauracija). Koristi iste helpere (login storageState, `data-testid` selektore).

- [ ] **Step 2: Napiši test**

Create `tests/e2e/24-podsjetnici-primaoci.spec.ts`:
```ts
import { test, expect } from "@playwright/test"

// E2E ide na cloud DEMO. Ne mijenja trajno stanje: na kraju odznači sve što je test čekirao.
// Bira prvu firmu iz liste, dodaje kontakt sa mejlom, čekira ga kao primaoca, provjeri, počisti.

test.describe("Podsjetnici — izbor primalaca iz kontakata", () => {
  test("kontakt bez mejla je disabled; kontakt sa mejlom se može čekirati i odčekirati", async ({ page }) => {
    // 1) Otvori prvog klijenta, tab kontakti — kreiraj dva kontakta (jedan sa, jedan bez mejla)
    await page.goto("/klijenti")
    await page.getByTestId("klijent-red").first().click()
    const url = new URL(page.url())
    const klijentId = url.pathname.split("/").pop()!
    await page.goto(`/klijenti/${klijentId}?tab=kontakti`)

    // kontakt SA mejlom
    await page.getByTestId("novi-kontakt-btn").click()
    await page.getByTestId("kontakt-ime").fill("E2E Sa Mejlom")
    await page.getByTestId("kontakt-email").fill("e2e-primalac@example.com")
    await page.getByTestId("kontakt-submit").click()
    await expect(page.getByTestId("kontakt-form")).toBeHidden()

    // kontakt BEZ mejla
    await page.getByTestId("novi-kontakt-btn").click()
    await page.getByTestId("kontakt-ime").fill("E2E Bez Mejla")
    await page.getByTestId("kontakt-submit").click()
    await expect(page.getByTestId("kontakt-form")).toBeHidden()

    // 2) Tab podsjetnici — checklist
    await page.goto(`/klijenti/${klijentId}?tab=podsjetnici`)
    const form = page.getByTestId("klijent-podsjetnici-form")
    await expect(form).toBeVisible()

    // Kontakt bez mejla → checkbox disabled + naznaka
    const redovi = page.getByTestId(/^klijent-primalac-red-/)
    await expect(redovi.first()).toBeVisible()
    const disabledCb = page.locator('[data-testid^="klijent-primalac-"][disabled]')
    await expect(disabledCb.first()).toBeVisible()

    // Kontakt sa mejlom → čekiraj
    const saMejlom = page.locator('[data-testid^="klijent-primalac-"]:not([disabled])').first()
    await saMejlom.check()
    await expect(saMejlom).toBeChecked()

    // 3) Reload → stanje perzistira
    await page.reload()
    const saMejlom2 = page.locator('[data-testid^="klijent-primalac-"]:not([disabled])').first()
    await expect(saMejlom2).toBeChecked()

    // 4) Počisti: odčekiraj + obriši kontakte
    await saMejlom2.uncheck()
    await expect(saMejlom2).not.toBeChecked()
    await page.goto(`/klijenti/${klijentId}?tab=kontakti`)
    for (const ime of ["E2E Sa Mejlom", "E2E Bez Mejla"]) {
      const red = page.getByTestId("kontakt-red").filter({ hasText: ime })
      if (await red.count()) {
        await red.first().getByRole("button", { name: /obriši/i }).click()
        await expect(page.getByTestId("kontakt-red").filter({ hasText: ime })).toHaveCount(0)
      }
    }
  })
})
```
(Prilagodi selektore/`data-testid` ako `tests/e2e/06-podsjetnici.spec.ts` koristi drukčiji obrazac za izbor klijenta ili brisanje kontakta — uskladi s postojećim.)

- [ ] **Step 3: (Nakon DEMO migracije — vidi Task 10) pokreni test**

Run: `pnpm exec playwright test tests/e2e/24-podsjetnici-primaoci.spec.ts`
Expected: PASS (chromium + webkit).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/24-podsjetnici-primaoci.spec.ts
git commit -m "test(e2e): izbor primalaca iz kontakata firme"
```

---

## Task 10: Rollout (ops) — cloud migracije + deploy (staged)

> Ovo su **operativni koraci sa živim bazama** — izvršavaju se pažljivo, uz potvrdu. Nisu TDD. Redoslijed je bitan (expand pre deploya, contract poslije).

**Preduslov:** enumeriši sve instance baze. Repo deployuje 3 Vercel projekta s `main`, svaki sa svojom Supabase bazom. Potvrđene: PROD `fqtqkehjidkzeasiegnq`, DEMO `mtwwotmwrasozmcgqwhc`. **Provjeri ima li treći projekat (demo-app) zasebnu bazu**; ako da, sve cloud korake primijeni i na nju.

- [ ] **Step 1: Migracija A na DEMO**

Run: `DATABASE_URL="$DATABASE_URL_DEMO" pnpm db:apply-cloud supabase/migrations/20260709120000_kontakt_podsjetnik_primalac.sql`
Expected: `✅ Primijenjeno`. Verifikuj (read-only): `podsjetnik_primalac` postoji, orphan mejlovi postali kontakti.

- [ ] **Step 2: Pokreni E2E protiv DEMO (Task 9)**

Run: `pnpm exec playwright test tests/e2e/24-podsjetnici-primaoci.spec.ts`
Expected: PASS. (Ako padne — popravi prije nastavka; ne diraj PROD.)

- [ ] **Step 3: Migracija A na PROD (+ treća baza ako postoji)**

**Provjeri ref prije pokretanja:** `grep -E '^DATABASE_URL=' .env.local` → mora sadržati `fqtqkehjidkzeasiegnq`.
Run: `pnpm db:apply-cloud supabase/migrations/20260709120000_kontakt_podsjetnik_primalac.sql`
Expected: `✅`. Očekivano: 2 nova kontakta (CARMEUSE `dzonifu@gmail.com`, WAIKIKI `sef@firma.com`). `podsjetnik_emails` **još postoji** (stari kod radi).

- [ ] **Step 4: Merge grane → deploy na sve 3 instance**

Otvori PR `feat/podsjetnici-primaoci-iz-kontakata` → `main`; nakon zelenog CI merge. Vercel auto-deploy na sva 3 projekta. Novi kod sad koristi `podsjetnik_primalac` (kolona postoji svuda iz koraka 1/3).

- [ ] **Step 5: Verifikacija na produkciji (dry)**

Na svakoj instanci: otvori firmu → tab Podsjetnici → checklist kontakata radi; „Pokreni sada" (dry, POST) → firmin kanal ide na flagovane kontakte. Global + per-firma prekidač i dalje gate-uju.

- [ ] **Step 6: Migracija B (contract) na DEMO pa PROD (+ treća)**

Tek kad je novi kod potvrđeno živ svuda:
Run (DEMO): `DATABASE_URL="$DATABASE_URL_DEMO" pnpm db:apply-cloud supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql`
Run (PROD, uz ref-provjeru): `pnpm db:apply-cloud supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql`
Expected: `✅` na svakoj. Kolona nestaje.

- [ ] **Step 7: Zatvori granu**

Nakon merge-a i uspješne migracije B → grana je gotova. (Vidi superpowers:finishing-a-development-branch.)

---

## Self-review napomene (pokriveno)

- **Spec §1 (model):** Task 1 (A) + Task 8 (B). ✅
- **Spec §2 (engine):** Task 2 (recipients) + Task 3 (runReminders). ✅
- **Spec §3 (UI):** Task 4 (tab/forma/akcije), Task 5 (edit forma), Task 6 (KoStaPrima). ✅
- **Spec §4 (RLS):** nasljeđuje se; akcije koriste SSR klijent (Task 4). ✅
- **Spec Testovi:** unit (Task 2/3), e2e (Task 9). ✅
- **Spec Rollout (expand/contract, multi-instanca, ref-provjere):** Task 10. ✅
- **Migracija orphan → kontakt (odluka):** Task 1, korak 2b. ✅
- **i18n add + orphan cleanup:** Task 7. ✅
