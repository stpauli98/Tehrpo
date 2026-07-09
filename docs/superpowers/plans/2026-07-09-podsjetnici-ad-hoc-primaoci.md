# Podsjetnici → ad-hoc primaoci uz sačuvane kontakte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** U tabu Podsjetnici, primaoci firminih podsjetnika se biraju kroz jedan combobox — izbor sačuvanog kontakta ILI dodavanje ad-hoc „čiste" adrese (`klijenti.podsjetnik_emails`), a engine šalje na uniju oba izvora.

**Architecture:** Zadržavamo `kontakt_osobe.podsjetnik_primalac` (kontakt-selektor) i vraćamo `klijenti.podsjetnik_emails text[]` (ad-hoc adrese). Primaoci firme = `{mejlovi flagovanih kontakata}` ∪ `{podsjetnik_emails}`, lowercase+dedup pri slanju (postojeći `firmaRecipientsForKlijent` već dedupira). UI je lagani inline combobox (React input + filtrirana lista + `badge.tsx` chipovi), bez eksternog combobox primitiva. Nula novih cloud migracija (obje baze već imaju obje kolone).

**Tech Stack:** Next.js 16 (App Router, `--webpack`), React 19, TypeScript, Supabase (SSR anon client), Vitest (unit), Playwright (e2e), next-intl (sr/en/de), Tailwind, shadcn/Base UI.

**Spec:** `docs/superpowers/specs/2026-07-09-podsjetnici-ad-hoc-primaoci-design.md`

## Global Constraints

- **Grana:** radi na `feat/podsjetnici-primaoci-iz-kontakata` (već checkout). PR #22 se dorađuje; ne otvarati novu granu.
- **Package manager:** `pnpm` (nikad npm/yarn).
- **`next dev` ide sa `--webpack`** (razmak u putanji ruši Turbopack). `pnpm dev`/e2e webServer to već forsiraju.
- **Domenski jezik:** bosanski/srpski latinica za identifikatore, kolone, UI stringove. `one` ICU plural zabranjen za `sr`.
- **`db/types.ts` je AUTO-GENERISAN** — regen sa `pnpm db:types` (iz LOKALNOG stacka), nikad ručno.
- **Supabase klijent:** u `app/`/`components/` isključivo SSR (`createServerSupabaseClient`) ili browser klijent; NIKAD service-role admin klijent u request putanji.
- **Tailwind:** zabranjeni `sm:`/`md:` breakpointi (lint) — koristi `lg:`/`xl:` ili bez breakpointa.
- **`no-await-in-loop: error`** svuda osim `scripts/`.
- **Svaki commit** završava trailerom:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Nema dummy podataka.** Nema TODO/stub-a u isporučenom kodu.

---

## Task 1: Vrati kolonu `klijenti.podsjetnik_emails` (obriši Migraciju B, regen tipova)

**Files:**
- Delete: `supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql`
- Modify (regen): `db/types.ts`

**Interfaces:**
- Produces: `Database["public"]["Tables"]["klijenti"]["Row"].podsjetnik_emails: string[]` (i `Insert`/`Update` opciono) u `db/types.ts` — na to se oslanjaju Task 3/4/6/8 upiti.

- [ ] **Step 1: Obriši drop-migraciju**

```bash
git rm supabase/migrations/20260709120100_drop_klijenti_podsjetnik_emails.sql
```

- [ ] **Step 2: Provjeri da lokalni Supabase stack radi (Docker)**

Run: `pnpm exec supabase status`
Expected: ispisuje URL-ove (API/DB). Ako je stopped: `pnpm exec supabase start` pa sačekaj da digne kontejnere.

- [ ] **Step 3: Reapliciraj migracije na lokalni DB (bez drop-a → kolona ostaje)**

Run: `pnpm db:reset`
Expected: „Applying migration …" za sve fajlove, BEZ `20260709120100`; završi bez greške.

- [ ] **Step 4: Regeneriši tipove iz lokalnog stacka**

Run: `pnpm db:types`
Expected: `db/types.ts` izmijenjen; `podsjetnik_emails` se vraća u `klijenti` Row.

- [ ] **Step 5: Verifikuj da je kolona u tipovima**

Run: `grep -n "podsjetnik_emails" db/types.ts`
Expected: bar 1 pogodak unutar `klijenti` tabele (Row/Insert/Update).

- [ ] **Step 6: Commit**

```bash
git add -A db/types.ts supabase/migrations
git commit -m "revert(db): zadrzi klijenti.podsjetnik_emails (obrisi Migraciju B)"
```

---

## Task 2: Engine — union flagovanih kontakata + `podsjetnik_emails` (`recipients.ts`)

**Files:**
- Modify: `lib/reminders/recipients.ts:34` (`KlijentReminderRow`), `:77-90` (`buildRecipientIndex` Krug 2 grana)
- Test: `lib/reminders/recipients.test.ts`

**Interfaces:**
- Consumes: `EMAIL_RE`, `firmaRecipientsForKlijent` (postojeći).
- Produces: `KlijentReminderRow = { id: string; salji_podsjetnik_klijentu: boolean; podsjetnik_emails?: string[] }`; `buildRecipientIndex(...)` sada uračunava `podsjetnik_emails` u `klijentEmailsByKlijent`. Signatura ostaje ista (5 pozicijskih argumenata).

- [ ] **Step 1: Napiši padajuće testove (union + dedup + gating)**

Dodaj na kraj `describe("razdvajanje kanala …")` bloka u `lib/reminders/recipients.test.ts` (prije zatvaranja `})` na liniji 116):

```typescript
  it("podsjetnik_emails (ad-hoc) se dodaju firminom kanalu uz flagovane kontakte", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      kontakti, // firma@drina.ba (flagovan)
      true,
    )
    expect(firmaRecipientsForKlijent(idx, "K1").sort()).toEqual(["adhoc@firma.ba", "firma@drina.ba"])
  })
  it("ad-hoc mejl jednak flagovanom kontaktu → dedup (jednom)", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["FIRMA@drina.ba"] }],
      kontakti,
      true,
    )
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual(["firma@drina.ba"])
  })
  it("global isključen → ni ad-hoc ne ide", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      [], false,
    )
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("per-firma isključen → ni ad-hoc ne ide", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: false, podsjetnik_emails: ["adhoc@firma.ba"] }],
      [], true,
    )
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
  it("nevalidan ad-hoc mejl se odbacuje", () => {
    const idx = buildRecipientIndex(
      kor, dodjele,
      [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["nijemejl"] }],
      [], true,
    )
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
```

- [ ] **Step 2: Pokreni testove — moraju pasti**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: FAIL (npr. `adhoc@firma.ba` se ne pojavljuje; `podsjetnik_emails` nije u tipu).

- [ ] **Step 3: Dodaj `podsjetnik_emails` u tip**

U `lib/reminders/recipients.ts` zamijeni `KlijentReminderRow` (linije 34-37):

```typescript
export type KlijentReminderRow = {
  id: string
  salji_podsjetnik_klijentu: boolean
  podsjetnik_emails?: string[]
}
```

- [ ] **Step 4: Uračunaj `podsjetnik_emails` u `buildRecipientIndex`**

U `lib/reminders/recipients.ts`, unutar `if (saljiKlijentima) { … }`, ODMAH nakon `for (const ko of kontakti) { … }` petlje (poslije linije 89, prije `}` koje zatvara `if`), dodaj:

```typescript
    // Ad-hoc „čiste" adrese firme (nisu kontakti). firmaRecipientsForKlijent kasnije
    // lowercase-uje/dedupira, pa preklapanje s mejlom flagovanog kontakta nije problem.
    for (const k of klijenti) {
      if (!firmaUkljucena.has(k.id)) continue
      for (const raw of k.podsjetnik_emails ?? []) {
        const email = (raw ?? "").trim()
        if (!EMAIL_RE.test(email)) continue
        const arr = klijentEmailsByKlijent.get(k.id) ?? []
        arr.push(email)
        klijentEmailsByKlijent.set(k.id, arr)
      }
    }
```

- [ ] **Step 5: Pokreni testove — moraju proći**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: PASS (svi, uklj. 5 novih).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add lib/reminders/recipients.ts lib/reminders/recipients.test.ts
git commit -m "feat(reminders): union flagovanih kontakata + podsjetnik_emails u firmin kanal"
```

---

## Task 3: Wire `runReminders` da čita `podsjetnik_emails`

**Files:**
- Modify: `lib/reminders/runReminders.ts:68-71` (select `klijenti`)
- Test: `lib/reminders/runReminders.test.ts:19` (`KlRow` tip) + novi test

**Interfaces:**
- Consumes: `buildRecipientIndex` (Task 2), `firmaRecipientsForKlijent`.
- Produces: firmin kanal (bcc) uključuje `podsjetnik_emails` na live run-u.

- [ ] **Step 1: Napiši padajući test (ad-hoc → firma bcc)**

U `lib/reminders/runReminders.test.ts`, prvo proširi `KlRow` (linija 19):

```typescript
type KlRow = { id: string; salji_podsjetnik_klijentu: boolean; podsjetnik_emails?: string[] }
```

Zatim dodaj nov test odmah iza postojećeg „Krug 2: salji_klijentima uključeno …" testa (poslije njegovog zatvaranja, oko linije 158). Koristi isti obrazac kao taj test (pogledaj ga za tačan oblik `makeFake`/asercija na bcc):

```typescript
  it("Krug 2: podsjetnik_emails (ad-hoc) idu u firmin bcc kanal", async () => {
    const sent: SendArgs[] = []
    const { supabase } = makeFake({
      korisnici: [{ id: "a", email: "admin@tehpro.test", uloga: "admin", aktivan: true, prima_podsjetnike: true }],
      kk: [],
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["adhoc@firma.ba"] }],
      kontakti: [],
      saljiKlijentima: true,
      dueRows: [{ ...baseRow, klijent_id: "k1" }],
    })
    await runReminders(supabase, { send: async (a) => { sent.push(a); return { id: "x", dryRun: true } } })
    const firmin = sent.find((s) => (s.bcc ?? []).includes("adhoc@firma.ba"))
    expect(firmin).toBeTruthy()
  })
```

> **Napomena za izvršioca:** provjeri stvarne nazive polja u `makeFake`/`baseRow`/`SendArgs` u tom fajlu (linije 19-55, 137-158) i uskladi test tačno s postojećim obrascem (nazivi `kontakti`, `dueRows`, oblik `send` rezultata). Cilj asercije: `adhoc@firma.ba` je u `bcc` firminog maila.

- [ ] **Step 2: Pokreni — mora pasti**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: FAIL (ad-hoc adresa se ne pojavljuje u bcc jer je select ne dohvata).

- [ ] **Step 3: Dodaj `podsjetnik_emails` u select**

U `lib/reminders/runReminders.ts` zamijeni select `klijenti` (linija 70):

```typescript
    .select("id, salji_podsjetnik_klijentu, podsjetnik_emails")
```

- [ ] **Step 4: Pokreni — mora proći**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add lib/reminders/runReminders.ts lib/reminders/runReminders.test.ts
git commit -m "feat(reminders): runReminders dohvata podsjetnik_emails za firmin kanal"
```

---

## Task 4: Admin pregled „Ko šta prima" uračunava ad-hoc adrese

**Files:**
- Modify: `components/domain/KoStaPrimaTab.tsx:22` (select), `:29-38` (`adreseByKlijent`)

**Interfaces:**
- Consumes: `EMAIL_RE`, `klijenti.podsjetnik_emails` (Task 1).
- Produces: tabela „ko šta prima" prikazuje i ad-hoc adrese; `firmaPrima` istinit i kad firma ima samo ad-hoc adresu.

- [ ] **Step 1: Dohvati `podsjetnik_emails`**

U `components/domain/KoStaPrimaTab.tsx` zamijeni klijenti select (linija 22):

```typescript
    supabase.from("klijenti").select("id, naziv, salji_podsjetnik_klijentu, podsjetnik_emails").order("naziv"),
```

- [ ] **Step 2: Ubaci ad-hoc adrese u `adreseByKlijent`**

U istom fajlu, ODMAH nakon petlje koja puni `adreseByKlijent` iz kontakata (poslije linije 38), dodaj:

```typescript
  // Ad-hoc „čiste" adrese (nisu kontakti) — u isti Set (dedup s kontakt-adresama je automatski).
  for (const k of klijentiRes.data ?? []) {
    const set = adreseByKlijent.get(k.id) ?? new Set<string>()
    for (const raw of k.podsjetnik_emails ?? []) {
      const email = (raw ?? "").trim().toLowerCase()
      if (!EMAIL_RE.test(email)) continue
      set.add(email)
    }
    if (set.size > 0) adreseByKlijent.set(k.id, set)
  }
```

- [ ] **Step 3: Verifikuj (typecheck + lint)**

Run: `pnpm typecheck && pnpm lint`
Expected: bez grešaka. (Ponašanje se ručno/e2e provjerava: firma sa samo ad-hoc adresom pokazuje „Da" i adresu u koloni „Adrese".)

- [ ] **Step 4: Commit**

```bash
git add components/domain/KoStaPrimaTab.tsx
git commit -m "feat(postavke): KoStaPrima uracunava ad-hoc podsjetnik_emails"
```

---

## Task 5: Čiste funkcije pickera (`lib/podsjetnici/primaociPicker.ts`) — TDD

**Files:**
- Create: `lib/podsjetnici/primaociPicker.ts`
- Test: `lib/podsjetnici/primaociPicker.test.ts`

**Interfaces:**
- Consumes: `EMAIL_RE` iz `@/lib/reminders/recipients`.
- Produces:
  - `norm(s: string): string`
  - `type KontaktOpcija = { id: string; ime: string; funkcija: string | null; email: string }`
  - `type KontaktRed = { id: string; ime: string; funkcija: string | null; email: string | null }`
  - `filtrirajKontakte(kontakti: KontaktRed[], query: string, izabraniIds: Set<string>): KontaktOpcija[]`
  - `mozeAdHoc(query: string, contactEmails: string[], adHocEmails: string[]): boolean`
  - `adHocZaPrikaz(adHocEmails: string[], flaggedContactEmails: string[]): string[]`
  - `type DodajRezultat = { ok: true; list: string[] } | { ok: false; razlog: "nevalidan" | "postoji" | "kontakt" }`
  - `dodajAdHoc(current: string[], raw: string, contactEmails: string[]): DodajRezultat`
  - `ukloniAdHoc(current: string[], raw: string): string[]`

- [ ] **Step 1: Napiši testove**

Kreiraj `lib/podsjetnici/primaociPicker.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { norm, filtrirajKontakte, mozeAdHoc, adHocZaPrikaz, dodajAdHoc, ukloniAdHoc } from "./primaociPicker"

const K = (id: string, ime: string, email: string | null) => ({ id, ime, funkcija: null, email })

describe("filtrirajKontakte", () => {
  const kontakti = [K("1", "Marko", "marko@f.ba"), K("2", "Ana", "ana@f.ba"), K("3", "Bez", null)]
  it("izuzima kontakte bez mejla i već izabrane", () => {
    const r = filtrirajKontakte(kontakti, "", new Set(["2"]))
    expect(r.map((k) => k.id)).toEqual(["1"])
  })
  it("filtrira po imenu/mejlu (case-insensitive)", () => {
    expect(filtrirajKontakte(kontakti, "ana", new Set()).map((k) => k.id)).toEqual(["2"])
    expect(filtrirajKontakte(kontakti, "MARKO@", new Set()).map((k) => k.id)).toEqual(["1"])
  })
})

describe("mozeAdHoc", () => {
  it("true za validan mejl koji nije kontakt ni već ad-hoc", () => {
    expect(mozeAdHoc("novi@f.ba", ["marko@f.ba"], [])).toBe(true)
  })
  it("false za nevalidan, za postojeći kontakt-mejl, za već ad-hoc", () => {
    expect(mozeAdHoc("nijemejl", [], [])).toBe(false)
    expect(mozeAdHoc("MARKO@f.ba", ["marko@f.ba"], [])).toBe(false)
    expect(mozeAdHoc("x@f.ba", [], ["X@f.ba"])).toBe(false)
  })
})

describe("adHocZaPrikaz", () => {
  it("izuzima adrese koje su već mejl flagovanog kontakta; dedup", () => {
    expect(adHocZaPrikaz(["a@f.ba", "A@f.ba", "b@f.ba"], ["b@f.ba"])).toEqual(["a@f.ba"])
  })
})

describe("dodajAdHoc / ukloniAdHoc", () => {
  it("dodaje normalizovano; odbija duplikat/kontakt/nevalidno", () => {
    expect(dodajAdHoc([], " Novi@F.ba ", [])).toEqual({ ok: true, list: ["novi@f.ba"] })
    expect(dodajAdHoc(["x@f.ba"], "X@f.ba", [])).toEqual({ ok: false, razlog: "postoji" })
    expect(dodajAdHoc([], "sef@f.ba", ["sef@f.ba"])).toEqual({ ok: false, razlog: "kontakt" })
    expect(dodajAdHoc([], "nijemejl", [])).toEqual({ ok: false, razlog: "nevalidan" })
  })
  it("uklanja case-insensitive", () => {
    expect(ukloniAdHoc(["a@f.ba", "b@f.ba"], "A@f.ba")).toEqual(["b@f.ba"])
  })
})
```

- [ ] **Step 2: Pokreni — mora pasti**

Run: `pnpm vitest run lib/podsjetnici/primaociPicker.test.ts`
Expected: FAIL (modul ne postoji).

- [ ] **Step 3: Implementiraj modul**

Kreiraj `lib/podsjetnici/primaociPicker.ts`:

```typescript
import { EMAIL_RE } from "@/lib/reminders/recipients"

export const norm = (s: string): string => s.trim().toLowerCase()

export type KontaktRed = { id: string; ime: string; funkcija: string | null; email: string | null }
export type KontaktOpcija = { id: string; ime: string; funkcija: string | null; email: string }

/** Kontakti firme koji imaju mejl i nisu već izabrani; filtrirani po query (ime/email). */
export function filtrirajKontakte(
  kontakti: KontaktRed[],
  query: string,
  izabraniIds: Set<string>,
): KontaktOpcija[] {
  const q = query.trim().toLowerCase()
  const out: KontaktOpcija[] = []
  for (const k of kontakti) {
    if (izabraniIds.has(k.id)) continue
    const email = (k.email ?? "").trim()
    if (!email) continue
    if (q !== "" && !k.ime.toLowerCase().includes(q) && !email.toLowerCase().includes(q)) continue
    out.push({ id: k.id, ime: k.ime, funkcija: k.funkcija, email })
  }
  return out
}

/** Da li ponuditi „dodaj kao jednokratni" za trenutni upit. */
export function mozeAdHoc(query: string, contactEmails: string[], adHocEmails: string[]): boolean {
  const e = norm(query)
  if (!EMAIL_RE.test(e)) return false
  if (contactEmails.some((c) => norm(c) === e)) return false
  if (adHocEmails.some((a) => norm(a) === e)) return false
  return true
}

/** Ad-hoc adrese za prikaz: iz podsjetnik_emails izuzmi one koje su već mejl flagovanog kontakta; dedup. */
export function adHocZaPrikaz(adHocEmails: string[], flaggedContactEmails: string[]): string[] {
  const flagged = new Set(flaggedContactEmails.map(norm))
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of adHocEmails) {
    const e = norm(raw)
    if (flagged.has(e) || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}

export type DodajRezultat =
  | { ok: true; list: string[] }
  | { ok: false; razlog: "nevalidan" | "postoji" | "kontakt" }

/** Dodaj ad-hoc adresu u listu (normalizovano). */
export function dodajAdHoc(current: string[], raw: string, contactEmails: string[]): DodajRezultat {
  const e = norm(raw)
  if (!EMAIL_RE.test(e)) return { ok: false, razlog: "nevalidan" }
  if (current.some((x) => norm(x) === e)) return { ok: false, razlog: "postoji" }
  if (contactEmails.some((c) => norm(c) === e)) return { ok: false, razlog: "kontakt" }
  return { ok: true, list: [...current, e] }
}

/** Ukloni ad-hoc adresu (case-insensitive). */
export function ukloniAdHoc(current: string[], raw: string): string[] {
  const e = norm(raw)
  return current.filter((x) => norm(x) !== e)
}
```

- [ ] **Step 4: Pokreni — mora proći**

Run: `pnpm vitest run lib/podsjetnici/primaociPicker.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add lib/podsjetnici/primaociPicker.ts lib/podsjetnici/primaociPicker.test.ts
git commit -m "feat(podsjetnici): ciste funkcije pickera (filter/adHoc/prikaz/validacija)"
```

---

## Task 6: Server akcije `dodajPodsjetnikEmail` / `ukloniPodsjetnikEmail`

**Files:**
- Modify: `app/(dashboard)/klijenti/[id]/actions.ts` (dodaj 2 akcije poslije `updateKontaktPodsjetnikPrimalac`, oko linije 39)

**Interfaces:**
- Consumes: `dodajAdHoc`, `ukloniAdHoc`, `norm` (Task 5); `ActionResult`; `createServerSupabaseClient`.
- Produces:
  - `dodajPodsjetnikEmail(klijentId: string, email: string): Promise<ActionResult>`
  - `ukloniPodsjetnikEmail(klijentId: string, email: string): Promise<ActionResult>`

- [ ] **Step 1: Dodaj import čistih funkcija**

U `app/(dashboard)/klijenti/[id]/actions.ts`, uz postojeće importe (poslije linije 7):

```typescript
import { dodajAdHoc, ukloniAdHoc, norm } from "@/lib/podsjetnici/primaociPicker"
```

- [ ] **Step 2: Implementiraj akcije**

Umetni ODMAH nakon `updateKontaktPodsjetnikPrimalac` (poslije njenog zatvaranja `}` na liniji 39):

```typescript
/** Dodaj ad-hoc „čistu" adresu (nije kontakt) u firmine primaoce. SSR → RLS klijenti_upd. */
export async function dodajPodsjetnikEmail(klijentId: string, email: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: kl, error: readErr } = await supabase
    .from("klijenti")
    .select("podsjetnik_emails")
    .eq("id", klijentId)
    .maybeSingle()
  if (readErr) return { ok: false, message: readErr.message }
  const { data: kont, error: kErr } = await supabase
    .from("kontakt_osobe")
    .select("email")
    .eq("klijent_id", klijentId)
  if (kErr) return { ok: false, message: kErr.message }
  const contactEmails = (kont ?? []).map((k) => k.email ?? "").filter((e) => e.length > 0)
  const rez = dodajAdHoc(kl?.podsjetnik_emails ?? [], email, contactEmails)
  if (!rez.ok) {
    const msg =
      rez.razlog === "nevalidan" ? "Nevažeća email adresa."
      : rez.razlog === "postoji" ? "Adresa je već dodata."
      : "Adresa je već primalac kao kontakt."
    return { ok: false, message: msg }
  }
  const { error } = await supabase
    .from("klijenti")
    .update({ podsjetnik_emails: rez.list })
    .eq("id", klijentId)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}

/** Ukloni ad-hoc adresu iz firminih primalaca. SSR → RLS klijenti_upd. */
export async function ukloniPodsjetnikEmail(klijentId: string, email: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: kl, error: readErr } = await supabase
    .from("klijenti")
    .select("podsjetnik_emails")
    .eq("id", klijentId)
    .maybeSingle()
  if (readErr) return { ok: false, message: readErr.message }
  const sljedeci = ukloniAdHoc(kl?.podsjetnik_emails ?? [], email)
  const { error } = await supabase
    .from("klijenti")
    .update({ podsjetnik_emails: sljedeci })
    .eq("id", klijentId)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}
```

> **Napomena:** `norm` je importovan zbog konzistentnosti sa čistim funkcijama; ako ga ESLint prijavi kao neiskorišten, ukloni ga iz importa. Čitanje-pa-pisanje niza je dovoljno na single-user tempu (nema atomarnog append-a — svjesna YAGNI odluka iz speca).

- [ ] **Step 3: Verifikuj (typecheck + lint)**

Run: `pnpm typecheck && pnpm lint`
Expected: bez grešaka (ako `norm` prijavljen neiskorišten — ukloni ga iz importa i ponovi).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/klijenti/[id]/actions.ts"
git commit -m "feat(podsjetnici): akcije dodaj/ukloni ad-hoc podsjetnik email"
```

---

## Task 7: Combobox UI + integracija u formu, tab-fetch i i18n

**Files:**
- Create: `components/domain/PrimaociCombobox.tsx`
- Modify: `components/domain/KlijentPodsjetniciForm.tsx` (koristi combobox; prima `adHocEmails`)
- Modify: `components/domain/KlijentPodsjetniciTab.tsx:12-21` (fetch + prosljeđivanje `podsjetnik_emails`)
- Modify: `messages/sr.json`, `messages/en.json`, `messages/de.json` (`klijenti.podsjetnici`)

**Interfaces:**
- Consumes: `filtrirajKontakte`, `mozeAdHoc`, `adHocZaPrikaz` (Task 5); `updateKontaktPodsjetnikPrimalac`, `dodajPodsjetnikEmail`, `ukloniPodsjetnikEmail` (Task 6); `badge.tsx`.
- Produces: `PrimaociCombobox({ klijentId, kontakti, adHocEmails })`; `KontaktZaPodsjetnik` tip.

- [ ] **Step 1: Dodaj i18n ključeve (sr)**

U `messages/sr.json`, unutar `klijenti.podsjetnici`, zamijeni blok (od `"primaociNaslov"` do `"dodajEmailLink"`) i zadrži `"spaseno"`:

```json
    "primaociNaslov": "Primaoci obavještenja",
    "primaociOpis": "Izaberi sačuvani kontakt ili dodaj jednokratnu adresu.",
    "comboPlaceholder": "Ukucaj mejl ili izaberi kontakt",
    "dodajJednokratni": "Dodaj \"{email}\" kao jednokratni",
    "tagJednokratno": "jednokratno",
    "nemaPrimalaca": "Nema izabranih primalaca.",
    "nemaRezultata": "Nema kontakata za taj upit.",
    "ukloniPrimaoca": "Ukloni primaoca",
    "nemaKontakata": "Nema kontakata firme.",
    "dodajKontaktLink": "Dodaj kontakt →",
```

> Zadrži postojeći `"spaseno"`. Ukloni stare ključeve `"nemaEmail"` i `"dodajEmailLink"` samo ako grep (`grep -rn "podsjetnici.nemaEmail\|podsjetnici.dodajEmailLink" app components`) ne vrati druge korisnike; inače ih ostavi.

- [ ] **Step 2: Dodaj iste ključeve u `en.json` i `de.json`**

`messages/en.json` → `klijenti.podsjetnici`:

```json
    "primaociNaslov": "Notification recipients",
    "primaociOpis": "Pick a saved contact or add a one-off address.",
    "comboPlaceholder": "Type an email or pick a contact",
    "dodajJednokratni": "Add \"{email}\" as one-off",
    "tagJednokratno": "one-off",
    "nemaPrimalaca": "No recipients selected.",
    "nemaRezultata": "No contacts for that query.",
    "ukloniPrimaoca": "Remove recipient",
    "nemaKontakata": "No company contacts.",
    "dodajKontaktLink": "Add contact →",
```

`messages/de.json` → `klijenti.podsjetnici`:

```json
    "primaociNaslov": "Empfänger der Benachrichtigungen",
    "primaociOpis": "Wähle einen gespeicherten Kontakt oder füge eine einmalige Adresse hinzu.",
    "comboPlaceholder": "E-Mail eingeben oder Kontakt wählen",
    "dodajJednokratni": "\"{email}\" als einmalig hinzufügen",
    "tagJednokratno": "einmalig",
    "nemaPrimalaca": "Keine Empfänger ausgewählt.",
    "nemaRezultata": "Keine Kontakte für diese Suche.",
    "ukloniPrimaoca": "Empfänger entfernen",
    "nemaKontakata": "Keine Firmenkontakte.",
    "dodajKontaktLink": "Kontakt hinzufügen →",
```

- [ ] **Step 3: Provjeri validnost JSON-a**

Run: `node -e "['sr','en','de'].forEach(l=>{const m=require('./messages/'+l+'.json'); if(!m.klijenti.podsjetnici.comboPlaceholder) throw new Error(l); }); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Kreiraj `PrimaociCombobox.tsx`**

Kreiraj `components/domain/PrimaociCombobox.tsx`:

```tsx
"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { X, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  updateKontaktPodsjetnikPrimalac,
  dodajPodsjetnikEmail,
  ukloniPodsjetnikEmail,
} from "@/app/(dashboard)/klijenti/[id]/actions"
import {
  filtrirajKontakte,
  mozeAdHoc,
  adHocZaPrikaz,
} from "@/lib/podsjetnici/primaociPicker"

export type KontaktZaPodsjetnik = {
  id: string
  ime: string
  funkcija: string | null
  email: string | null
  podsjetnik_primalac: boolean
}

export function PrimaociCombobox({
  klijentId,
  kontakti,
  adHocEmails,
}: {
  klijentId: string
  kontakti: KontaktZaPodsjetnik[]
  adHocEmails: string[]
}) {
  const t = useTranslations("klijenti.podsjetnici")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const [izabraniIds, setIzabraniIds] = useState<Set<string>>(
    () => new Set(kontakti.filter((k) => k.podsjetnik_primalac).map((k) => k.id)),
  )
  const [adHoc, setAdHoc] = useState<string[]>(() => [...adHocEmails])

  const contactEmails = useMemo(
    () => kontakti.map((k) => (k.email ?? "").trim()).filter((e) => e.length > 0),
    [kontakti],
  )
  const izabraniKontakti = useMemo(
    () => kontakti.filter((k) => izabraniIds.has(k.id)),
    [kontakti, izabraniIds],
  )
  const flaggedEmails = useMemo(
    () => izabraniKontakti.map((k) => (k.email ?? "").trim()).filter((e) => e.length > 0),
    [izabraniKontakti],
  )
  const adHocPrikaz = useMemo(() => adHocZaPrikaz(adHoc, flaggedEmails), [adHoc, flaggedEmails])

  const opcije = useMemo(() => filtrirajKontakte(kontakti, q, izabraniIds), [kontakti, q, izabraniIds])
  const nudiAdHoc = mozeAdHoc(q, contactEmails, adHoc)
  const brojOpcija = opcije.length + (nudiAdHoc ? 1 : 0)

  function dodajKontakt(id: string) {
    setIzabraniIds((p) => new Set(p).add(id))
    setQ(""); setOpen(false)
    startTransition(async () => {
      const res = await updateKontaktPodsjetnikPrimalac(id, klijentId, true)
      if (res.ok) { router.refresh() }
      else { setIzabraniIds((p) => { const n = new Set(p); n.delete(id); return n }); toast.error(res.message) }
    })
  }

  function ukloniKontakt(id: string) {
    setIzabraniIds((p) => { const n = new Set(p); n.delete(id); return n })
    startTransition(async () => {
      const res = await updateKontaktPodsjetnikPrimalac(id, klijentId, false)
      if (res.ok) { router.refresh() }
      else { setIzabraniIds((p) => new Set(p).add(id)); toast.error(res.message) }
    })
  }

  function dodajEmail(email: string) {
    const prethodni = adHoc
    setAdHoc((p) => [...p, email.trim().toLowerCase()])
    setQ(""); setOpen(false)
    startTransition(async () => {
      const res = await dodajPodsjetnikEmail(klijentId, email)
      if (res.ok) { router.refresh() }
      else { setAdHoc(prethodni); toast.error(res.message) }
    })
  }

  function ukloniEmail(email: string) {
    const prethodni = adHoc
    setAdHoc((p) => p.filter((e) => e.toLowerCase() !== email.toLowerCase()))
    startTransition(async () => {
      const res = await ukloniPodsjetnikEmail(klijentId, email)
      if (res.ok) { router.refresh() }
      else { setAdHoc(prethodni); toast.error(res.message) }
    })
  }

  function izaberiHighlight() {
    if (hi < opcije.length) dodajKontakt(opcije[hi].id)
    else if (nudiAdHoc) dodajEmail(q)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, Math.max(0, brojOpcija - 1))) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); izaberiHighlight() }
    else if (e.key === "Escape") { setOpen(false) }
  }

  const nemaPrimalaca = izabraniKontakti.length === 0 && adHocPrikaz.length === 0

  return (
    <div className="max-w-xl">
      <p className="mb-1 text-sm font-medium">{t("primaociNaslov")}</p>
      <p className="mb-2 text-sm text-slate-500">{t("primaociOpis")}</p>

      {/* Izabrani primaoci (chipovi) */}
      <div className="mb-2 flex flex-wrap gap-2" data-testid="primaoci-izabrani">
        {nemaPrimalaca && <span className="text-sm text-slate-400">{t("nemaPrimalaca")}</span>}
        {izabraniKontakti.map((k) => (
          <Badge key={k.id} variant="secondary" className="gap-1" data-testid={`primalac-kontakt-${k.id}`}>
            <span className="truncate">{k.ime} · {k.email}</span>
            <button
              type="button" disabled={pending} aria-label={t("ukloniPrimaoca")}
              data-testid={`ukloni-kontakt-${k.id}`}
              className="ml-0.5 rounded hover:bg-slate-300/60 disabled:opacity-50"
              onClick={() => ukloniKontakt(k.id)}
            ><X className="h-3 w-3" /></button>
          </Badge>
        ))}
        {adHocPrikaz.map((email) => (
          <Badge key={email} variant="outline" className="gap-1" data-testid="primalac-adhoc">
            <span className="truncate">{email}</span>
            <span className="text-xs text-slate-400">⟨{t("tagJednokratno")}⟩</span>
            <button
              type="button" disabled={pending} aria-label={t("ukloniPrimaoca")}
              data-testid={`ukloni-adhoc-${email}`}
              className="ml-0.5 rounded hover:bg-slate-200 disabled:opacity-50"
              onClick={() => ukloniEmail(email)}
            ><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>

      {/* Combobox */}
      <div
        ref={rootRef} className="relative"
        onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}
      >
        <input
          type="text" role="combobox" aria-expanded={open} aria-controls="primaoci-lista"
          data-testid="primaoci-combobox-input"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
          placeholder={t("comboPlaceholder")}
          value={q} disabled={pending}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {open && (opcije.length > 0 || nudiAdHoc || q.trim() !== "") && (
          <ul
            id="primaoci-lista" role="listbox" data-testid="primaoci-lista"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {opcije.map((o, i) => (
              <li key={o.id} role="option" aria-selected={hi === i}>
                <button
                  type="button" data-testid={`opcija-kontakt-${o.id}`}
                  className={`flex w-full flex-col px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${hi === i ? "bg-slate-50" : ""}`}
                  onMouseEnter={() => setHi(i)} onClick={() => dodajKontakt(o.id)}
                >
                  <span className="font-medium">{o.ime}{o.funkcija && <span className="font-normal text-slate-500"> · {o.funkcija}</span>}</span>
                  <span className="text-slate-500">{o.email}</span>
                </button>
              </li>
            ))}
            {nudiAdHoc && (
              <li role="option" aria-selected={hi === opcije.length}>
                <button
                  type="button" data-testid="opcija-adhoc"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-brand hover:bg-slate-50 ${hi === opcije.length ? "bg-slate-50" : ""}`}
                  onMouseEnter={() => setHi(opcije.length)} onClick={() => dodajEmail(q)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("dodajJednokratni", { email: q.trim().toLowerCase() })}
                </button>
              </li>
            )}
            {opcije.length === 0 && !nudiAdHoc && q.trim() !== "" && (
              <li className="px-3 py-1.5 text-sm text-slate-400" data-testid="primaoci-nema-rezultata">{t("nemaRezultata")}</li>
            )}
          </ul>
        )}
      </div>

      {kontakti.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">
          {t("nemaKontakata")}{" "}
          <Link href={`/klijenti/${klijentId}?tab=kontakti`} className="font-medium text-brand hover:underline">
            {t("dodajKontaktLink")}
          </Link>
        </p>
      )}
    </div>
  )
}
```

> **Napomena za izvršioca:** provjeri `variant` opcije u `components/ui/badge.tsx` (npr. `secondary`/`outline`); ako neka ne postoji, koristi postojeću ili izostavi `variant`. `text-brand`/`border-brand`/`accent-brand` su već u upotrebi u `KlijentPodsjetniciForm.tsx`.

- [ ] **Step 5: Prepiši `KlijentPodsjetniciForm.tsx` da koristi combobox**

Zamijeni CIJELI `components/domain/KlijentPodsjetniciForm.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { updateKlijentSaljiPodsjetnik } from "@/app/(dashboard)/klijenti/[id]/actions"
import { PrimaociCombobox, type KontaktZaPodsjetnik } from "./PrimaociCombobox"

export function KlijentPodsjetniciForm({
  klijentId, salji, kontakti, adHocEmails,
}: {
  klijentId: string
  salji: boolean
  kontakti: KontaktZaPodsjetnik[]
  adHocEmails: string[]
}) {
  const t = useTranslations("klijenti.podsjetnici")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [saljiState, setSalji] = useState(salji)

  function toggleSalji(next: boolean) {
    setSalji(next)
    startTransition(async () => {
      const res = await updateKlijentSaljiPodsjetnik(klijentId, next)
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else { setSalji(!next); toast.error(res.message) }
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

      <PrimaociCombobox klijentId={klijentId} kontakti={kontakti} adHocEmails={adHocEmails} />
    </div>
  )
}
```

- [ ] **Step 6: Dohvati i proslijedi `podsjetnik_emails` u tabu**

U `components/domain/KlijentPodsjetniciTab.tsx`:

(a) select `klijenti` (linija 13) → dodaj `podsjetnik_emails`:

```typescript
    supabase.from("klijenti").select("salji_podsjetnik_klijentu, podsjetnik_emails").eq("id", klijentId).maybeSingle(),
```

(b) izvedi `adHocEmails` (poslije linije 18 `const salji = …`):

```typescript
  const adHocEmails = klRes.data?.podsjetnik_emails ?? []
```

(c) proslijedi formi (linija 29):

```tsx
        <KlijentPodsjetniciForm klijentId={klijentId} salji={salji} kontakti={kontakti} adHocEmails={adHocEmails} />
```

- [ ] **Step 7: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: sve prolazi (nema neiskorištenih importa, nema `sm:`/`md:`).

- [ ] **Step 8: Commit**

```bash
git add components/domain/PrimaociCombobox.tsx components/domain/KlijentPodsjetniciForm.tsx components/domain/KlijentPodsjetniciTab.tsx messages/sr.json messages/en.json messages/de.json
git commit -m "feat(podsjetnici): combobox za primaoce (kontakti + ad-hoc), i18n"
```

---

## Task 8: E2E — combobox scenariji (`24-podsjetnici-primaoci.spec.ts`)

**Files:**
- Modify: `tests/e2e/24-podsjetnici-primaoci.spec.ts`

**Interfaces:**
- Consumes: `data-testid` kuke iz Task 7 (`primaoci-combobox-input`, `opcija-kontakt-<id>`, `opcija-adhoc`, `primalac-kontakt-<id>`, `primalac-adhoc`, `ukloni-kontakt-<id>`, `ukloni-adhoc-<email>`).

- [ ] **Step 1: Zamijeni tijelo testa na combobox tok**

Zamijeni CIJELI `tests/e2e/24-podsjetnici-primaoci.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"
import { insertKlijent, deleteKlijentByNaziv } from "./db"

// Podsjetnici → primaoci: combobox bira sačuvani kontakt ILI dodaje ad-hoc „čistu" adresu.
// Izolacija: throwaway klijent; kontakt_osobe ima on delete cascade → brisanje u finally čisti sve.
test.describe("Podsjetnici — combobox primalaca (kontakti + ad-hoc)", () => {
  test("izabere kontakt, doda ad-hoc mejl, oba perzistiraju, pa se uklone", async ({ page }) => {
    const naziv = "E2E-TMP PRIMAOCI " + Date.now()
    const kid = await insertKlijent(naziv)
    const adHoc = `adhoc-${Date.now()}@example.com`
    try {
      // 1) Kreiraj jedan kontakt SA mejlom.
      await page.goto(`/klijenti/${kid}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible()
      await page.getByTestId("novi-kontakt-btn").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeVisible()
      await page.getByTestId("kontakt-ime").fill("E2E Sa Mejlom")
      await page.getByTestId("kontakt-email").fill("e2e-primalac@example.com")
      await page.getByTestId("kontakt-submit").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeHidden({ timeout: 5000 })

      // 2) Tab podsjetnici — combobox.
      await page.goto(`/klijenti/${kid}?tab=podsjetnici`)
      await expect(page.getByTestId("klijent-podsjetnici-form")).toBeVisible()
      const input = page.getByTestId("primaoci-combobox-input")

      // 2a) Izaberi postojeći kontakt iz liste.
      await input.click()
      await input.fill("E2E Sa")
      const opcijaKontakt = page.getByTestId(/^opcija-kontakt-/)
      await expect(opcijaKontakt).toHaveCount(1)
      await opcijaKontakt.first().click()
      await expect(page.getByTestId(/^primalac-kontakt-/)).toHaveCount(1)
      await expect(input).toBeEnabled() // sačekaj da transition završi

      // 2b) Dodaj ad-hoc mejl.
      await input.fill(adHoc)
      await expect(page.getByTestId("opcija-adhoc")).toBeVisible()
      await page.getByTestId("opcija-adhoc").click()
      await expect(page.getByTestId("primalac-adhoc").filter({ hasText: adHoc })).toBeVisible()
      await expect(input).toBeEnabled()

      // 3) Reload → oba perzistirala (SSR fetch, ne lokalni state).
      await page.reload()
      await expect(page.getByTestId(/^primalac-kontakt-/)).toHaveCount(1)
      await expect(page.getByTestId("primalac-adhoc").filter({ hasText: adHoc })).toBeVisible()

      // 4) Ukloni oba (izolacija).
      await page.getByTestId(/^ukloni-kontakt-/).first().click()
      await expect(page.getByTestId(/^primalac-kontakt-/)).toHaveCount(0)
      await page.getByTestId(`ukloni-adhoc-${adHoc}`).click()
      await expect(page.getByTestId("primalac-adhoc")).toHaveCount(0)
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
```

> **Napomena za izvršioca:** E2E ide na cloud DEMO (već ima obje kolone). Ako `getByTestId` sa regexom ne radi kako očekuješ za `ukloni-adhoc-${adHoc}` (tačka u mejlu), koristi `page.locator('[data-testid="primalac-adhoc"]').getByRole("button")` kao alternativu. Provjeri stvarne testid-e kontakt-sheet-a (linije 24-36 originala) — nepromijenjeni.

- [ ] **Step 2: Pokreni E2E (chromium)**

Run: `pnpm exec playwright test tests/e2e/24-podsjetnici-primaoci.spec.ts --project=chromium`
Expected: PASS. (Ako auth setup traži — pokreće se automatski; webServer diže `--webpack`.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/24-podsjetnici-primaoci.spec.ts
git commit -m "test(e2e): combobox primalaca (izbor kontakta + ad-hoc mejl)"
```

---

## Task 9: Zeleni gate + finalizacija PR #22

**Files:** (bez izmjena koda — validacija i doc)

- [ ] **Step 1: Puni green gate**

Run: `pnpm test:unit && pnpm typecheck && pnpm lint`
Expected: sve PASS. Ako nešto padne → root-cause, popravi, ponovi (ne preskači).

- [ ] **Step 2: Provjeri da nema zaostalog `podsjetnik_emails` drop-a ni stub-a**

Run: `ls supabase/migrations | grep 20260709120100 && echo "GRESKA: drop migracija još tu" || echo "ok — drop migracija obrisana"`
Expected: `ok — drop migracija obrisana`.

- [ ] **Step 3: Gurni granu i ažuriraj PR #22**

```bash
git push
```

Zatim ažuriraj opis PR #22 (napomena da više NE dropa `podsjetnik_emails`, da dodaje combobox + ad-hoc primaoce, bez novih cloud migracija):

```bash
gh pr edit 22 --body "$(cat <<'EOF'
Podsjetnici → primaoci firme: kontakt-selektor (podsjetnik_primalac) + ad-hoc „čiste" adrese (klijenti.podsjetnik_emails), kroz jedan combobox. Engine šalje na uniju oba izvora (dedup pri slanju).

Promjena opsega u odnosu na raniji PR: NE dropa se podsjetnik_emails (Migracija B uklonjena). Bez novih cloud migracija — obje baze već imaju podsjetnik_primalac (Migracija A) i podsjetnik_emails.

Spec: docs/superpowers/specs/2026-07-09-podsjetnici-ad-hoc-primaoci-design.md
Plan: docs/superpowers/plans/2026-07-09-podsjetnici-ad-hoc-primaoci.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Ručna dim-provjera na dev-u (opciono ali preporučeno)**

Run: `pnpm dev` → otvori `/klijenti/<id>?tab=podsjetnici`; potvrdi: combobox filtrira kontakte, „Dodaj kao jednokratni" se pojavi za nov mejl, chipovi se uklanjaju; Postavke → „Ko šta prima" prikazuje ad-hoc adresu.

---

## Self-Review (autor plana)

- **Spec coverage:** Model (Task 1), UI combobox+dedup prikaza (Task 5,7), engine union (Task 2,3), KoStaPrima (Task 4), akcije (Task 6), migracije/rollout (Task 1,9), i18n (Task 7), testovi (Task 2,3,5,8). ✔ svi dijelovi speca pokriveni.
- **Placeholder scan:** nema TBD/TODO; svaki kod-korak ima pun kod. ✔
- **Type consistency:** `KlijentReminderRow.podsjetnik_emails?` (Task 2) usklađen s `KlRow` (Task 3) i select-om; `KontaktZaPodsjetnik` (Task 7) = `KontaktRed` polja + `podsjetnik_primalac`; akcije `dodaj/ukloniPodsjetnikEmail(klijentId, email)` (Task 6) = pozivi u comboboxu (Task 7); `dodajAdHoc/ukloniAdHoc/filtrirajKontakte/mozeAdHoc/adHocZaPrikaz` (Task 5) = uvoz u Task 6/7. ✔
- **Rizik:** `badge.tsx` varijante i Base UI detalji provjeravaju se u koraku (napomene uz Task 7); E2E regex za tačku u mejlu ima fallback.
