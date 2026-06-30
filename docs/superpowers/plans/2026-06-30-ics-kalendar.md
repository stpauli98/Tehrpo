# `.ics` „Dodaj u kalendar" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Svaki email-podsjetnik nosi `.ics` prilog (`termin.ics`) → korisnik klikom dodaje cjelodnevni event (s alarmom dan ranije) u Outlook/Google/Apple kalendar.

**Architecture:** Čista funkcija `buildTerminIcs` generiše iCalendar tekst (bez biblioteke). `SendArgs` dobija opcioni `attachments`; `sendEmail` ih prosljeđuje Resend-u. Motor (`runReminders`) gradi ics po terminu i kači ga. Bez DB migracije, bez izmjene logike motora.

**Tech Stack:** TypeScript, Vitest (unit), Resend `^6.14` (attachments), Next.js env.

## Global Constraints

- iCalendar **bez biblioteke** (čista string funkcija); linije spojene **CRLF** (`\r\n`); `BEGIN:VCALENDAR`…`END:VCALENDAR`.
- **Cjelodnevni** event: `DTSTART;VALUE=DATE:<YYYYMMDD>` (rok), `DTEND;VALUE=DATE:<YYYYMMDD>` (rok **+ 1 dan**, ekskluzivno).
- `METHOD:PUBLISH`; `VALARM` `ACTION:DISPLAY` `TRIGGER:-P1D` (alarm dan ranije).
- **Stabilan `UID`** po terminu: `${terminId}@${host}` (host = `baseUrl` hostname ili `"termini"`) — isti UID na svim podsjetnicima istog termina.
- iCal **escaping** na SUMMARY/LOCATION/DESCRIPTION (`\\`, `\;`, `\,`, `\n`).
- `PRODID` preko **`APP_NAME`** iz `lib/brand.ts` (bez hardkodiranja brenda).
- `SendArgs.attachments` **opcioni**; `drySend` ih ignoriše; `sendEmail` ih prosljeđuje Resend-u.
- Logika motora (detekcija/rutiranje/throttling/idempotencija) — **netaknuta**. Bez DB migracije.

---

### Task 1: iCalendar generator (`lib/email/ics.ts` + test)

**Files:**
- Create: `lib/email/ics.ts`
- Create: `lib/email/ics.test.ts`

**Interfaces:**
- Produces: `buildTerminIcs(args: { vrsta: string; klijent: string; rok: string; terminId: string; lokacija?: string | null; baseUrl?: string; now?: Date }): string`

- [ ] **Step 1: Write the failing test**

Create `lib/email/ics.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildTerminIcs } from "./ics"

const FIXED = new Date("2026-06-30T10:00:00.000Z")
const baza = { vrsta: "Hidranti", klijent: "AS", rok: "2026-09-01", terminId: "t1", now: FIXED }

describe("buildTerminIcs", () => {
  it("cjelodnevni event: DTSTART = rok, DTEND = rok+1; VCALENDAR omotač, CRLF", () => {
    const ics = buildTerminIcs(baza)
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true)
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true)
    expect(ics).toContain("DTSTART;VALUE=DATE:20260901")
    expect(ics).toContain("DTEND;VALUE=DATE:20260902")
    expect(ics).toContain("\r\n") // CRLF
    expect(ics).toContain("METHOD:PUBLISH")
  })
  it("SUMMARY 'Vrsta — Klijent', stabilan UID s terminId, DTSTAMP iz now", () => {
    const ics = buildTerminIcs(baza)
    expect(ics).toContain("SUMMARY:Hidranti — AS")
    expect(ics).toContain("UID:t1@")
    expect(ics).toContain("DTSTAMP:20260630T100000Z")
  })
  it("iCal escaping na SUMMARY (zarez/tačka-zarez)", () => {
    const ics = buildTerminIcs({ ...baza, klijent: "AS, d.o.o.; BL" })
    expect(ics).toContain("SUMMARY:Hidranti — AS\\, d.o.o.\\; BL")
  })
  it("VALARM dan ranije", () => {
    const ics = buildTerminIcs(baza)
    expect(ics).toContain("BEGIN:VALARM")
    expect(ics).toContain("TRIGGER:-P1D")
  })
  it("LOCATION kad ima lokacije; izostaje kad je null", () => {
    expect(buildTerminIcs({ ...baza, lokacija: "Gradilište Sjever" })).toContain("LOCATION:Gradilište Sjever")
    expect(buildTerminIcs({ ...baza, lokacija: null })).not.toContain("LOCATION:")
  })
  it("DESCRIPTION nosi deep-link kad ima baseUrl; UID host iz baseUrl", () => {
    const ics = buildTerminIcs({ ...baza, baseUrl: "https://app.test" })
    expect(ics).toContain("plan-aktivnosti?selected=t1")
    expect(ics).toContain("UID:t1@app.test")
  })
  it("bez baseUrl: nema linka u DESCRIPTION", () => {
    expect(buildTerminIcs(baza)).not.toContain("http")
  })
})
```

- [ ] **Step 2: Run the test — must fail**

Run: `pnpm vitest run lib/email/ics.test.ts`
Expected: FAIL — `buildTerminIcs` ne postoji.

- [ ] **Step 3: Implement `lib/email/ics.ts`**

```ts
import { APP_NAME } from "@/lib/brand"

/** iCal escaping: backslash, tačka-zarez, zarez, novi red. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
}

/** "YYYY-MM-DD" → "YYYYMMDD". */
function dateBasic(iso: string): string {
  return iso.replace(/-/g, "")
}

/** "YYYY-MM-DD" + 1 dan → "YYYYMMDD" (TZ-safe preko UTC). */
function nextDayBasic(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + 1))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(dt.getUTCDate()).padStart(2, "0")
  return `${yy}${mm}${dd}`
}

/** Date → iCal UTC timestamp "YYYYMMDDTHHMMSSZ". */
function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

export function buildTerminIcs(args: {
  vrsta: string
  klijent: string
  rok: string // ISO "YYYY-MM-DD"
  terminId: string
  lokacija?: string | null
  baseUrl?: string
  now?: Date
}): string {
  const now = args.now ?? new Date()
  const host = args.baseUrl ? new URL(args.baseUrl).hostname : "termini"
  const summary = icsEscape(`${args.vrsta} — ${args.klijent}`)
  const descText = args.baseUrl
    ? `Podsjetnik o roku.\n\nDetalji: ${args.baseUrl}/plan-aktivnosti?selected=${args.terminId}`
    : "Podsjetnik o roku."
  const description = icsEscape(descText)
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Podsjetnici//BS`,
    "METHOD:PUBLISH",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${args.terminId}@${host}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${dateBasic(args.rok)}`,
    `DTEND;VALUE=DATE:${nextDayBasic(args.rok)}`,
    `SUMMARY:${summary}`,
    ...(args.lokacija ? [`LOCATION:${icsEscape(args.lokacija)}`] : []),
    `DESCRIPTION:${description}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-P1D",
    `DESCRIPTION:${summary}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  return lines.join("\r\n")
}
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run lib/email/ics.test.ts`
Expected: PASS (7 testova).

- [ ] **Step 5: Typecheck + cijela suita**

Run: `pnpm typecheck && pnpm test:unit`
Expected: zeleno.

- [ ] **Step 6: Commit**

```bash
git add lib/email/ics.ts lib/email/ics.test.ts
git commit -m "feat(email): buildTerminIcs — iCalendar generator za termin (cjelodnevni + VALARM)"
```

---

### Task 2: Prilog u mejlu + wiring u motoru

**Files:**
- Modify: `lib/email/resend.ts` (`SendArgs` + `sendEmail`)
- Modify: `lib/reminders/runReminders.ts:85-99` (send blok)
- Modify: `lib/reminders/runReminders.test.ts` (novi test za prilog)

**Interfaces:**
- Consumes: `buildTerminIcs` (Task 1).
- Produces: `SendArgs.attachments?: { filename: string; content: Buffer }[]`; motor šalje `attachments: [{ filename: "termin.ics", content: Buffer }]`.

- [ ] **Step 1: Write the failing test (motor kači prilog)**

U `lib/reminders/runReminders.test.ts`, dodaj novi `it(...)` unutar `describe("runReminders", …)` (koristi postojeći `makeFake`/`baseRow`):

```ts
  it("šalje .ics prilog (termin.ics) uz podsjetnik", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => { sends.push(a); return { id: "r", dryRun: false } }
    const { supabase } = makeFake({
      korisnici: [{ id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }],
      dueRows: [baseRow],
    })
    await runReminders(supabase, { send })
    const att = sends[0]!.attachments
    expect(att).toHaveLength(1)
    expect(att![0]!.filename).toBe("termin.ics")
    expect(att![0]!.content.toString("utf-8")).toContain("BEGIN:VCALENDAR")
    expect(att![0]!.content.toString("utf-8")).toContain("SUMMARY:Hidranti — AS")
  })
```

- [ ] **Step 2: Run — must fail**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts`
Expected: FAIL — `SendArgs` nema `attachments` (TS) / `att` je undefined.

- [ ] **Step 3: Proširi `SendArgs` + `sendEmail` (`lib/email/resend.ts`)**

Zamijeni `SendArgs` tip i tijelo `sendEmail` poziva Resend-u:

```ts
export type SendArgs = {
  to: string[]
  subject: string
  html: string
  attachments?: { filename: string; content: Buffer }[]
}
```

i u `sendEmail`, u `resend.emails.send({...})` dodaj `attachments`:

```ts
  const { data, error } = await resend.emails.send({
    from: FROM(),
    to: args.to,
    subject: args.subject,
    html: args.html,
    attachments: args.attachments,
  })
```

(`drySend` ostaje nepromijenjen — prima isti `SendArgs`, ne koristi `attachments`.)

- [ ] **Step 4: Kači ics u motoru (`lib/reminders/runReminders.ts`)**

Dodaj import na vrh (uz ostale `@/lib/email` importe):

```ts
import { buildTerminIcs } from "@/lib/email/ics"
```

Zatim u `try` bloku zamijeni `const res = await send({ ... })` (linije ~85-99) ovim — gradi ics prije i dodaje `attachments`:

```ts
      try {
        const ics = buildTerminIcs({
          vrsta: r.vrsta_naziv,
          klijent: r.klijent_naziv,
          rok: r.rok_dospijeca,
          terminId: r.termin_id,
          lokacija: r.lokacija_naziv,
          baseUrl: env.NEXT_PUBLIC_APP_URL,
        })
        const res = await send({
          to,
          subject: reminderSubject({ vrsta: r.vrsta_naziv, klijent: r.klijent_naziv, danaDoRoka: r.dana_do_roka }),
          html: reminderHtml({
            klijent: r.klijent_naziv,
            vrsta: r.vrsta_naziv,
            rok: r.rok_dospijeca,
            danaDoRoka: r.dana_do_roka,
            lokacija: r.lokacija_naziv,
            terminId: r.termin_id,
            klijentId: r.klijent_id,
            baseUrl: env.NEXT_PUBLIC_APP_URL,
          }),
          attachments: [{ filename: "termin.ics", content: Buffer.from(ics, "utf-8") }],
        })
```

(Ostatak `try` bloka — audit/idempotencija — ostaje nepromijenjen.)

- [ ] **Step 5: Run — must pass**

Run: `pnpm vitest run lib/reminders/runReminders.test.ts lib/email/ics.test.ts`
Expected: PASS (postojeći runReminders testovi + novi prilog test + ics testovi).

- [ ] **Step 6: Typecheck + lint + cijela suita + build**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`
Expected: zeleno; build prolazi.

- [ ] **Step 7: Commit**

```bash
git add lib/email/resend.ts lib/reminders/runReminders.ts lib/reminders/runReminders.test.ts
git commit -m "feat(reminders): .ics prilog (termin.ics) u svakom podsjetniku"
```

---

## Rollout (nakon oba taska)

- Cijela suita: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` zeleno.
- Bez DB migracije, bez nove env var.
- Pravi test: pošalji reminder s prilogom (kontrolisana skripta kao raniji test-mejlovi) → otvori u Apple Mail/Outlook → „Dodaj u kalendar" kreira cjelodnevni event + alarm dan ranije.
- Whole-branch review → merge → deploy.

## Self-Review (spec coverage)

- §1 (buildTerminIcs: VCALENDAR/VEVENT/VALARM, CRLF, all-day, UID, escape, PUBLISH, PRODID=APP_NAME) → Task 1 ✔
- §2 (SendArgs.attachments + sendEmail passthrough + drySend ignoriše) → Task 2 ✔
- §3 (motor gradi ics i kači termin.ics; logika netaknuta) → Task 2 ✔
- Testiranje (ics jedinični + motor-prilog) → Task 1 + Task 2 ✔
- Type consistency: `buildTerminIcs` args isti u Task 1 (def) i Task 2 (poziv: vrsta/klijent/rok/terminId/lokacija/baseUrl); `SendArgs.attachments` `{filename, content: Buffer}` isti u resend.ts i runReminders i testu ✔
- Resend prilog: `content: Buffer` (v6 prima Buffer). Ako bi SDK tražio base64 string, fallback `content.toString("base64")` — ali Buffer je podržan; pokriva ga build + pravi test-mejl. ✔
