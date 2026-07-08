# Firmi-prilagođeni podsjetnici (email) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firme (klijenti) dobijaju zaseban, klijentu-primjeren email podsjetnik (bez internih dugmadi, fiksni TEHPRO brend iz env-a, potpis), odvojen od internog (radničkog) mejla.

**Architecture:** Reminder engine po roku šalje do **dva** kanala: `interni` (postojeći mejl sa dugmadima, `APP_NAME` brend) i `firma` (novi mejl bez dugmadi, `FIRM_BRAND_*` brend, firmine adrese u BCC). Idempotencija po kanalu preko nove kolone `podsjetnici.kanal`.

**Tech Stack:** Next.js 16, TypeScript, Supabase (Postgres), Resend, next-intl, Vitest.

## Global Constraints

- Domain jezik = bosanski/srpski (latinica); tabele/kolone/identifikatori u domenskom jeziku (verbatim iz spec-a).
- `no-await-in-loop: error` svuda OSIM u `scripts/`.
- Nema novih i18n ključeva bez pariteta sr/en/de (`i18n/paritet.test.ts`) — ovaj plan NE dodaje i18n ključeve (potpis je env-driven).
- `db/types.ts` je AUTO-GENERISAN — nikad ručno; `pnpm db:types` poslije migracije.
- Cloud migracije: `pnpm db:apply-cloud <file>` gađa PROD preko `.env.local`; DEMO se cilja preko `DATABASE_URL_DEMO`. Uvijek guard na ref prije primjene.
- Firmin mejl brend NE koristi `APP_NAME` (koji je „Demo" na demu) — koristi `FIRM_BRAND_*`.

---

## File Structure

- `lib/env.ts` — modify: dodati `FIRM_BRAND_NAME/TAGLINE` (default) + `FIRM_CONTACT_EMAIL/PHONE/WEB` (opciono).
- `.env.local.example` — modify: dokumentovati nove varijable.
- `lib/email/firmBrand.ts` — create: `FirmBrand` tip + `firmBrand()` čita env sa defaultima.
- `lib/email/resend.ts` — modify: `SendArgs.bcc?` + proslijediti u Resend.
- `lib/email/templates.ts` — modify: `reminderHtmlFirma(...)` + izdvojen zajednički helper za tijelo.
- `lib/email/templates.test.ts` — create: firmin template (nema internih linkova, ima brend).
- `lib/reminders/recipients.ts` — modify: `recipientsForKlijent` bez firminih adresa; nova `firmaRecipientsForKlijent`.
- `lib/reminders/recipients.test.ts` — modify: interni vs firma razdvojeni.
- `supabase/migrations/20260708130000_podsjetnici_kanal.sql` — create: kolona `kanal` + unique po kanalu.
- `lib/reminders/runReminders.ts` — modify: dva kanala + audit `kanal`.
- `lib/reminders/runReminders.test.ts` — modify: dva kanala, idempotencija po kanalu.

---

## Task 1: Render trenutnog mejla (Artifact — „before" referenca)

Vizuelni deliverable, bez testova/koda u repou (jednokratna skripta).

**Files:**
- Temp: `scripts/_tmp-render-email.ts` (obrisati na kraju)

- [ ] **Step 1: Napiši skriptu koja generiše produkcijsku verziju (sa dugmadima)**

```ts
// scripts/_tmp-render-email.ts
import { writeFileSync } from "node:fs"
import { reminderHtml } from "@/lib/email/templates"
const html = reminderHtml({
  klijent: "Drina Komerc d.o.o.",
  vrsta: "Ispitivanje sredstava rada (mašine i oprema)",
  rok: "2026-07-09",
  danaDoRoka: 1,
  lokacija: "Centralni magacin",
  terminId: "demo-termin-id",
  klijentId: "demo-klijent-id",
  baseUrl: "https://de.nextpixel.dev", // → generiše "Otvori termin"/"Otvori klijenta" dugmad
})
writeFileSync("/tmp/tehpro-email-before.html", html)
console.log("Napisano /tmp/tehpro-email-before.html")
```

- [ ] **Step 2: Pokreni**

Run: `pnpm exec tsx --env-file=.env.local scripts/_tmp-render-email.ts`
Expected: `Napisano /tmp/tehpro-email-before.html`

- [ ] **Step 3: Objavi kao Artifact** — Artifact tool sa `/tmp/tehpro-email-before.html` (favicon 📧), naslov „TEHPRO podsjetnik — trenutni (interni) mejl". Prikaži korisniku URL.

- [ ] **Step 4: Očisti** — `rm -f scripts/_tmp-render-email.ts`

---

## Task 2: Env varijable za firmin brend

**Files:**
- Modify: `lib/env.ts`
- Modify: `.env.local.example`

**Interfaces:**
- Produces: `env.FIRM_BRAND_NAME: string`, `env.FIRM_BRAND_TAGLINE: string`, `env.FIRM_CONTACT_EMAIL/PHONE/WEB: string | undefined`

- [ ] **Step 1: Dodaj u `envSchema` (lib/env.ts) unutar `z.object({...})`, poslije `REMINDER_BATCH_DELAY_MS`:**

```ts
  // Firmin (klijentski) email brend — nezavisno od NEXT_PUBLIC_APP_NAME.
  FIRM_BRAND_NAME: z.string().min(1).default("TEHPRO"),
  FIRM_BRAND_TAGLINE: z.string().min(1).default("Zaštita na radu i zaštita od požara"),
  FIRM_CONTACT_EMAIL: optionalSecret,
  FIRM_CONTACT_PHONE: optionalSecret,
  FIRM_CONTACT_WEB: optionalSecret,
```

- [ ] **Step 2: Dodaj u `safeParse({...})` objekat (lib/env.ts), poslije `REMINDER_BATCH_DELAY_MS`:**

```ts
  FIRM_BRAND_NAME: process.env.FIRM_BRAND_NAME,
  FIRM_BRAND_TAGLINE: process.env.FIRM_BRAND_TAGLINE,
  FIRM_CONTACT_EMAIL: process.env.FIRM_CONTACT_EMAIL,
  FIRM_CONTACT_PHONE: process.env.FIRM_CONTACT_PHONE,
  FIRM_CONTACT_WEB: process.env.FIRM_CONTACT_WEB,
```

- [ ] **Step 3: Dokumentuj u `.env.local.example` (dodaj na kraj):**

```
# Firmin (klijentski) email brend — koristi se SAMO u mejlu koji ide firmama.
# Nezavisno od NEXT_PUBLIC_APP_NAME (koji na demu = "Demo").
FIRM_BRAND_NAME=TEHPRO
FIRM_BRAND_TAGLINE=Zaštita na radu i zaštita od požara
# FIRM_CONTACT_EMAIL=info@tehpro.ba
# FIRM_CONTACT_PHONE=+387 51 000 000
# FIRM_CONTACT_WEB=https://tehpro.ba
```

- [ ] **Step 4: Provjeri boot (env se validira na import)**

Run: `pnpm exec tsx --env-file=.env.local -e "import('@/lib/env').then(m=>console.log(m.env.FIRM_BRAND_NAME, '|', m.env.FIRM_BRAND_TAGLINE))"`
Expected: `TEHPRO | Zaštita na radu i zaštita od požara` (ili env override)

- [ ] **Step 5: Commit**

```bash
git add lib/env.ts .env.local.example
git commit -m "feat(email): env varijable za firmin brend (FIRM_BRAND_*)"
```

---

## Task 3: FirmBrand helper

**Files:**
- Create: `lib/email/firmBrand.ts`
- Test: `lib/email/firmBrand.test.ts`

**Interfaces:**
- Consumes: `env` (Task 2)
- Produces: `type FirmBrand = { name: string; tagline: string; email?: string; phone?: string; web?: string }`; `firmBrand(): FirmBrand`

- [ ] **Step 1: Failing test (`lib/email/firmBrand.test.ts`)**

```ts
import { describe, it, expect } from "vitest"
import { firmBrand } from "./firmBrand"

describe("firmBrand", () => {
  it("vraća name i tagline (default TEHPRO ako env ne override-uje)", () => {
    const b = firmBrand()
    expect(b.name.length).toBeGreaterThan(0)
    expect(b.tagline.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run — fails (modul ne postoji)**

Run: `pnpm vitest run lib/email/firmBrand.test.ts`
Expected: FAIL — "Cannot find module './firmBrand'"

- [ ] **Step 3: Implementiraj (`lib/email/firmBrand.ts`)**

```ts
import { env } from "@/lib/env"

export type FirmBrand = {
  name: string
  tagline: string
  email?: string
  phone?: string
  web?: string
}

/** Firmin (klijentski) brend iz env-a; nezavisno od APP_NAME. */
export function firmBrand(): FirmBrand {
  return {
    name: env.FIRM_BRAND_NAME,
    tagline: env.FIRM_BRAND_TAGLINE,
    email: env.FIRM_CONTACT_EMAIL,
    phone: env.FIRM_CONTACT_PHONE,
    web: env.FIRM_CONTACT_WEB,
  }
}
```

- [ ] **Step 4: Run — passes**

Run: `pnpm vitest run lib/email/firmBrand.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/email/firmBrand.ts lib/email/firmBrand.test.ts
git commit -m "feat(email): firmBrand() helper iz env-a"
```

---

## Task 4: BCC podrška u sendEmail

**Files:**
- Modify: `lib/email/resend.ts`

**Interfaces:**
- Produces: `SendArgs` sada ima opciono `bcc?: string[]`

- [ ] **Step 1: Dodaj `bcc` u `SendArgs` (lib/email/resend.ts:7-12)**

```ts
export type SendArgs = {
  to: string[]
  subject: string
  html: string
  attachments?: { filename: string; content: Buffer }[]
  bcc?: string[]
}
```

- [ ] **Step 2: Proslijedi `bcc` u Resend poziv (lib/email/resend.ts, unutar `resend.emails.send({...})`)**

```ts
  const { data, error } = await resend.emails.send({
    from: FROM(),
    to: args.to,
    bcc: args.bcc,
    subject: args.subject,
    html: args.html,
    attachments: args.attachments,
  })
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add lib/email/resend.ts
git commit -m "feat(email): sendEmail podržava bcc"
```

---

## Task 5: Firmin email template

**Files:**
- Modify: `lib/email/templates.ts`
- Test: `lib/email/templates.test.ts`

**Interfaces:**
- Consumes: `FirmBrand` (Task 3)
- Produces: `reminderHtmlFirma(args: { klijent, vrsta, rok, danaDoRoka, lokacija?, brand: FirmBrand }, locale?): string`

- [ ] **Step 1: Failing test (`lib/email/templates.test.ts`)**

```ts
import { describe, it, expect } from "vitest"
import { reminderHtmlFirma } from "./templates"

const brand = { name: "TEHPRO", tagline: "ZNR i ZOP", email: "info@tehpro.ba", phone: "+387 51 000 000" }
const base = { klijent: "Drina Komerc d.o.o.", vrsta: "Ispitivanje hidrantske mreže", rok: "2026-07-18", danaDoRoka: 10, lokacija: "Centralni magacin", brand }

describe("reminderHtmlFirma", () => {
  it("NE sadrži interne linkove ka aplikaciji", () => {
    const html = reminderHtmlFirma(base)
    expect(html).not.toContain("/plan-aktivnosti")
    expect(html).not.toContain("/klijenti/")
    expect(html).not.toContain("Otvori termin")
  })
  it("prikazuje firmin brend i kontakt (ne APP_NAME)", () => {
    const html = reminderHtmlFirma(base)
    expect(html).toContain("TEHPRO")
    expect(html).toContain("ZNR i ZOP")
    expect(html).toContain("info@tehpro.ba")
  })
  it("prikazuje osnovne podatke roka", () => {
    const html = reminderHtmlFirma(base)
    expect(html).toContain("Drina Komerc d.o.o.")
    expect(html).toContain("Ispitivanje hidrantske mreže")
    expect(html).toContain("Centralni magacin")
  })
})
```

- [ ] **Step 2: Run — fails**

Run: `pnpm vitest run lib/email/templates.test.ts`
Expected: FAIL — "reminderHtmlFirma is not a function"

- [ ] **Step 3: Implementiraj u `lib/email/templates.ts`**

Dodaj import na vrh (uz postojeće):
```ts
import type { FirmBrand } from "./firmBrand"
```

Dodaj funkciju (poslije `reminderHtml`). Reuse-uje `escapeHtml`, `htmlLang`, `danaTekst`, `formatDatum` iz istog fajla:
```ts
/** Firmin (klijentski) podsjetnik — bez internih dugmadi, brend iz FirmBrand. */
export function reminderHtmlFirma(args: {
  klijent: string
  vrsta: string
  rok: string
  danaDoRoka: number
  lokacija?: string | null
  brand: FirmBrand
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.podsjetnik" })
  const rok = formatDatum(args.rok, locale)
  const kasni = args.danaDoRoka < 0
  const boja = kasni ? "#dc2626" : "#2563eb"
  const badge = `${kasni ? t("znackaKasni") : t("znackaUskoro")} · ${danaTekst(args.danaDoRoka, locale)}`
  const b = args.brand
  const lokRed = args.lokacija
    ? `<tr><td style="padding:4px 0;color:#64748b">${t("poljeLokacija")}</td><td style="padding:4px 0;text-align:right">${escapeHtml(args.lokacija)}</td></tr>`
    : ""
  const kontakt = [b.email, b.phone, b.web].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")
  const potpis = `${escapeHtml(b.name)} — ${escapeHtml(b.tagline)}${kontakt ? `<br>${kontakt}` : ""}`

  return `<!doctype html>
<html lang="${htmlLang(locale)}"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:${boja};padding:16px 24px">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:16px;font-weight:bold">${escapeHtml(b.name)}</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;opacity:.85">${t("headerLabel")}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px">
          <span style="display:inline-block;background:${boja};color:#ffffff;font-size:12px;font-weight:bold;padding:4px 10px;border-radius:999px">${badge}</span>
          <p style="margin:12px 0 0;font-size:15px"><strong>${t("rokDospijeca")}</strong> ${rok}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-top:1px solid #e2e8f0;font-size:14px">
            <tr><td style="padding:8px 0;color:#64748b">${t("poljeVrsta")}</td><td style="padding:8px 0;text-align:right">${escapeHtml(args.vrsta)}</td></tr>
            <tr><td style="padding:4px 0;color:#64748b">${t("poljeKlijent")}</td><td style="padding:4px 0;text-align:right">${escapeHtml(args.klijent)}</td></tr>
            ${lokRed}
          </table>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center">${potpis}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
```

- [ ] **Step 4: Run — passes**

Run: `pnpm vitest run lib/email/templates.test.ts`
Expected: PASS (3 testa)

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts lib/email/templates.test.ts
git commit -m "feat(email): reminderHtmlFirma — firmin template bez internih dugmadi"
```

---

## Task 6: Razdvajanje primalaca (interni vs firma)

**Files:**
- Modify: `lib/reminders/recipients.ts`
- Modify: `lib/reminders/recipients.test.ts`

**Interfaces:**
- Consumes: `RecipientIndex` (postojeći)
- Produces: `recipientsForKlijent(index, klijentId, base)` — sada BEZ firminih adresa (samo interni); `firmaRecipientsForKlijent(index, klijentId): string[]` — samo firmine adrese

- [ ] **Step 1: Ažuriraj test (`lib/reminders/recipients.test.ts`)** — dodaj/izmijeni testove:

```ts
import { describe, it, expect } from "vitest"
import { buildRecipientIndex, recipientsForKlijent, firmaRecipientsForKlijent } from "./recipients"

const kor = [
  { id: "admin1", email: "admin@tehpro.test", uloga: "admin", aktivan: true, prima_podsjetnike: true },
  { id: "op1", email: "radnik@tehpro.test", uloga: "operater", aktivan: true, prima_podsjetnike: true },
]
const dodjele = [{ korisnik_id: "op1", klijent_id: "K1" }]
const klijenti = [{ id: "K1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["firma@drina.ba"] }]

describe("razdvajanje kanala", () => {
  it("recipientsForKlijent (interni) NE uključuje firmine adrese", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, true)
    const to = recipientsForKlijent(idx, "K1", [])
    expect(to).toContain("radnik@tehpro.test")
    expect(to).toContain("admin@tehpro.test")
    expect(to).not.toContain("firma@drina.ba")
  })
  it("firmaRecipientsForKlijent vraća SAMO firmine adrese", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, true)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual(["firma@drina.ba"])
  })
  it("firma prazna kad je global prekidač isključen", () => {
    const idx = buildRecipientIndex(kor, dodjele, klijenti, false)
    expect(firmaRecipientsForKlijent(idx, "K1")).toEqual([])
  })
})
```

- [ ] **Step 2: Run — fails**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: FAIL — "firmaRecipientsForKlijent is not a function" i/ili interni sadrži firma@drina.ba

- [ ] **Step 3: Izmijeni `recipientsForKlijent` (lib/reminders/recipients.ts:81-85) — ukloni `firma` iz internih:**

```ts
/** Interni primaoci za jednu firmu: dodijeljeni ∪ admini ∪ REMINDER_TO base. BEZ firminih adresa. */
export function recipientsForKlijent(index: RecipientIndex, klijentId: string, base: string[]): string[] {
  const assigned = index.assignedByKlijent.get(klijentId) ?? []
  return assembleRecipients({ base, adminEmails: [...assigned, ...index.adminEmails] })
}

/** Firmine (Krug 2) adrese za jednu firmu — prazno ako global/per-firma isključen ili nema adresa. */
export function firmaRecipientsForKlijent(index: RecipientIndex, klijentId: string): string[] {
  const firma = index.klijentEmailsByKlijent.get(klijentId) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of firma) {
    const e = raw.trim().toLowerCase()
    if (!EMAIL_RE.test(e) || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}
```

- [ ] **Step 4: Run — passes**

Run: `pnpm vitest run lib/reminders/recipients.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/recipients.ts lib/reminders/recipients.test.ts
git commit -m "feat(reminders): razdvoji interne primaoce od firminih (Krug 2)"
```

---

## Task 7: Migracija — podsjetnici.kanal

**Files:**
- Create: `supabase/migrations/20260708130000_podsjetnici_kanal.sql`
- Modify (auto): `db/types.ts`

**Interfaces:**
- Produces: kolona `podsjetnici.kanal text` (`interni`|`firma`), unique `(termin_id, dana_prije, kanal)`

- [ ] **Step 1: Napiši migraciju (`supabase/migrations/20260708130000_podsjetnici_kanal.sql`)**

```sql
-- Firmi-prilagođeni podsjetnici: razdvoji audit po kanalu (interni vs firma),
-- da oba mejla imaju nezavisan "poslato" trag i ne dupliraju se.
alter table podsjetnici
  add column kanal text not null default 'interni'
  check (kanal in ('interni','firma'));

-- Zamijeni jedinstvenost (termin_id, dana_prije) → (termin_id, dana_prije, kanal).
drop index if exists uq_podsjetnici_termin_dana;  -- unique INDEX iz 20260621
create unique index uq_podsjetnici_termin_dana_kanal
  on podsjetnici (termin_id, dana_prije, kanal);
```

- [ ] **Step 2: Primijeni na LOKALNI stack (Docker Supabase)**

Run: `pnpm db:reset`
Expected: sve migracije reapply-ovane bez greške (uključujući novu). (Preduslov: `supabase start`.)

- [ ] **Step 3: Regeneriši tipove**

Run: `pnpm db:types`
Expected: `db/types.ts` sada ima `kanal` u `podsjetnici` Row/Insert.

- [ ] **Step 4: Verifikuj**

Run: `pnpm exec tsx --env-file=.env.local -e "import('node:fs').then(fs=>console.log(fs.readFileSync('db/types.ts','utf8').includes('kanal')))"`
Expected: `true`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260708130000_podsjetnici_kanal.sql db/types.ts
git commit -m "feat(db): podsjetnici.kanal + unique po (termin_id, dana_prije, kanal)"
```

---

## Task 8: Dva kanala u runReminders

**Files:**
- Modify: `lib/reminders/runReminders.ts`
- Modify: `lib/reminders/runReminders.test.ts`

**Interfaces:**
- Consumes: `firmaRecipientsForKlijent` (Task 6), `reminderHtmlFirma` (Task 5), `firmBrand` (Task 3), `SendArgs.bcc` (Task 4), `podsjetnici.kanal` (Task 7)

- [ ] **Step 1: Ažuriraj test (`lib/reminders/runReminders.test.ts`)** — dodaj scenario sa firmom. Koristi postojeći mock `send`/supabase obrazac iz fajla (pročitaj postojeće testove za oblik mocka). Ključne tvrdnje:

```ts
// Uz postojeći supabase/rpc mock koji vraća jedan due red za klijent K1
// (salji_klijentima=true, K1.salji_podsjetnik_klijentu=true, podsjetnik_emails=["firma@drina.ba"]),
// i jednog dodijeljenog radnika radnik@tehpro.test:
it("šalje DVA kanala kad je firma primalac (interni + firma)", async () => {
  const sent: { to: string[]; bcc?: string[] }[] = []
  const send = async (a: { to: string[]; bcc?: string[] }) => { sent.push({ to: a.to, bcc: a.bcc }); return { id: "x", dryRun: true } }
  await runReminders(supabaseMock, { send })
  // interni: radnik u to, firma NIJE u to
  const interni = sent.find((s) => s.to.includes("radnik@tehpro.test"))
  expect(interni).toBeTruthy()
  expect(interni!.to).not.toContain("firma@drina.ba")
  // firmin: firma u bcc
  const firmin = sent.find((s) => (s.bcc ?? []).includes("firma@drina.ba"))
  expect(firmin).toBeTruthy()
})
```

(Ako firma isključena → samo jedan send, bez `bcc`. Dodaj i taj test po uzoru na postojeće.)

- [ ] **Step 2: Run — fails**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: FAIL — trenutno se šalje samo jedan mejr; nema firminog kanala.

- [ ] **Step 3: Izmijeni `runReminders.ts`**

Dodaj importe (uz postojeće):
```ts
import { recipientsForKlijent, firmaRecipientsForKlijent, buildRecipientIndex, parseEmailList } from "@/lib/reminders/recipients"
import { reminderSubject, reminderHtml, reminderHtmlFirma } from "@/lib/email/templates"
import { firmBrand } from "@/lib/email/firmBrand"
```

Izračunaj brand jednom (prije `processRow`):
```ts
  const brand = firmBrand()
  const fromAddr = env.EMAIL_FROM ?? "no-reply@tehpro"
```

U `processRow`, zamijeni jedinstveno slanje logikom za dva kanala. Zamijeni blok od `const to = recipientsForKlijent(...)` do kraja `try/catch` sljedećim (vraća **niz** ishoda, jer red može proizvesti do dva slanja):

```ts
  const processRow = async (r: (typeof rows)[number]): Promise<Outcome[]> => {
    if (r.termin_id == null || r.klijent_id == null || r.dana_prije == null || r.dana_do_roka == null ||
        r.rok_dospijeca == null || r.klijent_naziv == null || r.vrsta_naziv == null) {
      return [{ kind: "skip", terminId: r.termin_id ?? "", danaPrije: r.dana_prije ?? -9999, razlog: "nepotpun red" }]
    }
    const ics = buildTerminIcs({
      vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, rok: r.rok_dospijeca, terminId: r.termin_id,
      lokacija: r.lokacija_naziv, baseUrl: env.NEXT_PUBLIC_APP_URL,
    })
    const subject = reminderSubject({ vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, danaDoRoka: r.dana_do_roka })
    const prilog = [{ filename: t("prilogNaziv"), content: Buffer.from(ics, "utf-8") }]
    const out: Outcome[] = []

    // Pomoćna: pošalji jedan kanal + audit po kanalu.
    const posalji = async (kanal: "interni" | "firma", args: SendArgs): Promise<Outcome> => {
      try {
        const res = await send(args)
        const primaoci = [...(args.to ?? []), ...(args.bcc ?? [])]
        if (res.dryRun) return { kind: "sent", terminId: r.termin_id!, danaPrije: r.dana_prije!, to: primaoci, resendId: res.id, dryRun: true }
        const { error: insErr } = await supabase.from("podsjetnici").insert({
          termin_id: r.termin_id!, dana_prije: r.dana_prije!, kanal, poslat_na: primaoci, resend_id: res.id,
        })
        if (insErr) {
          if (/duplicate|unique/i.test(insErr.message)) return { kind: "skip", terminId: r.termin_id!, danaPrije: r.dana_prije!, razlog: `vec poslat (${kanal})` }
          return { kind: "err", terminId: r.termin_id!, danaPrije: r.dana_prije!, message: insErr.message }
        }
        return { kind: "sent", terminId: r.termin_id!, danaPrije: r.dana_prije!, to: primaoci, resendId: res.id, dryRun: false }
      } catch (e) {
        return { kind: "err", terminId: r.termin_id!, danaPrije: r.dana_prije!, message: e instanceof Error ? e.message : String(e) }
      }
    }

    // Kanal 1: interni (radnici/admini/base) — mejl sa dugmadima.
    const interni = recipientsForKlijent(recipientIndex, r.klijent_id, base)
    if (interni.length > 0) {
      out.push(await posalji("interni", {
        to: interni, subject, attachments: prilog,
        html: reminderHtml({ klijent: r.klijent_naziv, vrsta: r.vrsta_naziv, rok: r.rok_dospijeca, danaDoRoka: r.dana_do_roka, lokacija: r.lokacija_naziv, terminId: r.termin_id, klijentId: r.klijent_id, baseUrl: env.NEXT_PUBLIC_APP_URL }),
      }))
    }
    // Kanal 2: firma (Krug 2) — mejl bez dugmadi, TEHPRO brend, adrese u BCC.
    const firma = firmaRecipientsForKlijent(recipientIndex, r.klijent_id)
    if (firma.length > 0) {
      out.push(await posalji("firma", {
        to: [fromAddr], bcc: firma, subject, attachments: prilog,
        html: reminderHtmlFirma({ klijent: r.klijent_naziv, vrsta: r.vrsta_naziv, rok: r.rok_dospijeca, danaDoRoka: r.dana_do_roka, lokacija: r.lokacija_naziv, brand }),
      }))
    }
    if (out.length === 0) return [{ kind: "skip", terminId: r.termin_id, danaPrije: r.dana_prije, razlog: "nema primalaca" }]
    return out
  }
```

Ažuriraj sabiranje ishoda (jer `processRow` sad vraća `Outcome[]`): u petlji `for (const batch ...)` promijeni:
```ts
    const batchOut = (await Promise.all(batch.map(processRow))).flat()
```
Ostatak (`outcomes.push(...batchOut)`, razvrstavanje u sent/skipped/errors) ostaje isti — sada radi nad `Outcome[]`.

Napomena o `throttling` cap-u: `toProcess = rows.slice(0, maxPerRun)` ostaje kako jeste (cap po redu/terminu). `deferred` računanje ostaje isto.

- [ ] **Step 4: Run — passes**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + puni unit**

Run: `pnpm typecheck && pnpm test:unit`
Expected: exit 0, svi zeleni

- [ ] **Step 6: Commit**

```bash
git add lib/reminders/runReminders.ts lib/reminders/runReminders.test.ts
git commit -m "feat(reminders): dva kanala slanja (interni + firma) sa audit-om po kanalu"
```

---

## Task 9: Primijeni migraciju na DEMO

**Files:** none (DB operacija)

- [ ] **Step 1: Napiši guarded apply skriptu (`scripts/_tmp-apply-kanal-demo.ts`)**

```ts
import { readFileSync } from "node:fs"
import { Client } from "pg"
const DEMO = "mtwwotmwrasozmcgqwhc", PROD = "fqtqkehjidkzeasiegnq"
const FILE = "supabase/migrations/20260708130000_podsjetnici_kanal.sql"
async function main() {
  const url = process.env.DATABASE_URL_DEMO ?? ""
  if (url.includes(PROD)) throw new Error("GUARD: cilja PROD")
  if (!url.includes(DEMO)) throw new Error("GUARD: nije DEMO")
  const c = new Client({ connectionString: url }); await c.connect()
  try {
    await c.query("begin"); await c.query(readFileSync(FILE, "utf8")); await c.query("commit")
    const col = await c.query("select 1 from information_schema.columns where table_name='podsjetnici' and column_name='kanal'")
    console.log("DEMO kanal kolona:", col.rowCount === 1 ? "✅" : "❌")
  } catch (e) { await c.query("rollback").catch(()=>{}); throw e } finally { await c.end() }
}
main().catch((e)=>{console.error("❌", e instanceof Error?e.message:e); process.exit(1)})
```

- [ ] **Step 2: Pokreni + očisti**

Run: `pnpm exec tsx --env-file=.env.local scripts/_tmp-apply-kanal-demo.ts && rm -f scripts/_tmp-apply-kanal-demo.ts`
Expected: `DEMO kanal kolona: ✅`

---

## Task 10: Dry-run na DEMO (verifikuj dva kanala)

**Files:** temp skripta (obrisati)

- [ ] **Step 1: Guarded dry skripta (`scripts/_tmp-dry-kanal.ts`)** — kreira 1 test-termin za Drina (rok=today+1), pokrene `runReminders` sa `drySend`, ispiše primaoce po kanalu, pa obriše termin. (Vidi obrazac iz ranijih `_tmp` skripti: guard `NEXT_PUBLIC_SUPABASE_URL` = DEMO, `createClient` sa DEMO url+service key, pooler `DATABASE_URL_DEMO` za insert/cleanup.) Ključ: ispiši `res.sent` sa oznakom da li je adresa u to (interni) ili bcc (firma).

- [ ] **Step 2: Pokreni**

Run: `pnpm exec tsx --env-file=.env.local --env-file=.env.development.local scripts/_tmp-dry-kanal.ts`
Expected: dva reda za Drina — interni (radnik/admin) i firma (firmina adresa); 0 preskočeno. Zatim `rm -f scripts/_tmp-dry-kanal.ts`.

---

## Task 11: Live firmin mejl na nmil32@icloud.com (DEMO)

**Files:** temp skripta (obrisati)

- [ ] **Step 1: Guarded live skripta** — po uzoru na raniji `_tmp-live-send.ts`, ali koristi `reminderHtmlFirma` + `firmBrand()`; šalje SAMO firmin kanal na `nmil32@icloud.com` (BCC), override `EMAIL_FROM="TEHPRO Podsjetnici <podsjetnik@nextpixel.dev>"`, guard protiv sandbox sendera. Kreira 1 test-termin (rok=today+1), pošalje, obriše termin.

- [ ] **Step 2: Pokreni**

Run: `EMAIL_FROM="TEHPRO Podsjetnici <podsjetnik@nextpixel.dev>" pnpm exec tsx --env-file=.env.local scripts/_tmp-live-firma.ts`
Expected: `POSLATO id=…`; korisnik potvrđuje prijem firminog mejla (bez dugmadi, TEHPRO brend). Zatim `rm -f scripts/_tmp-live-firma.ts`.

- [ ] **Step 3: Vizuelna potvrda** — korisnik uporedi firmin mejl sa „before" Artifact-om iz Task 1.

---

## Task 12: Primijeni migraciju na PROD

**Files:** none (DB operacija) — **korisnik pokreće** (prod blokiran u auto-modu)

- [ ] **Step 1: Korisnik kuca (trailing ` #` zbog paste-dupliranja):**

```
! pnpm db:apply-cloud supabase/migrations/20260708130000_podsjetnici_kanal.sql #
```
(gađa PROD preko `.env.local` `DATABASE_URL`.) Expected: `✅ Primijenjeno`.

- [ ] **Step 2: Verifikacija (korisnik kuca):**

```
! pnpm exec tsx --env-file=.env.local -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();console.log((await c.query(\"select 1 from information_schema.columns where table_name='podsjetnici' and column_name='kanal'\")).rowCount===1?'PROD kanal ✅':'❌');await c.end()})()" #
```

---

## Self-Review (popunjeno)

- **Spec coverage:** render (T1), template firma (T5), env brend (T2/T3), razdvajanje slanja (T6/T8), BCC (T4/T8), migracija kanal (T7) + primjena local/DEMO/PROD (T7/T9/T12), testovi (T3/T5/T6/T8) + dry (T10) + live (T11). Sve pokriveno.
- **Placeholder scan:** temp skripte u T10/T11 opisane obrascem (guard + reuse ranijih `_tmp` skripti koje postoje u istoriji) umjesto punog koda — namjerno, jer su jednokratne i variraju; izvršilac reuse-uje dokazani obrazac.
- **Type consistency:** `FirmBrand` (T3) → `reminderHtmlFirma` (T5) → `runReminders` (T8); `firmaRecipientsForKlijent` (T6) → T8; `SendArgs.bcc` (T4) → T8; `kanal` (T7) → T8 insert. Konzistentno.
