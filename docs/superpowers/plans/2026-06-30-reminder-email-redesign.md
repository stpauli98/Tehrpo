# Reminder mejl — redizajn + deep-linkovi (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bogatiji, brendiran HTML reminder mejl s dva „bulletproof" dugmeta koja vode na termin i klijenta u dashboardu.

**Architecture:** Čist redizajn `reminderHtml` (proširi args opcionim `terminId`/`klijentId`/`baseUrl`, table-based email-safe HTML). Motor (`runReminders`) čita novu env var `NEXT_PUBLIC_APP_URL` i prosljeđuje id-jeve + baseUrl. Bez izmjene logike motora ni DB-a.

**Tech Stack:** TypeScript, Vitest (unit), Next.js env (zod-validiran), Resend (slanje — netaknuto).

## Global Constraints

- Email-safe HTML: **tabele + inline CSS**, bez vanjskog CSS/JS/flexboxa; max-width **600px**. Outlook/Gmail kompatibilno.
- **Bez hardkodiranog URL-a** — base-URL isključivo iz `NEXT_PUBLIC_APP_URL` (vidi pravilo „sve preko flaga").
- Nova polja `reminderHtml` su **opciona** (povratna kompatibilnost); dugmad se renderuju **samo** kad postoje `baseUrl` + odgovarajući id.
- `escapeHtml` na SVIM korisničkim vrijednostima (klijent, vrsta, lokacija); `encodeURIComponent` na id-jevima u URL-u.
- Brendiranje preko `APP_NAME`/`APP_TAGLINE` iz `lib/brand.ts` (već uvezeni u `templates.ts`).
- Boja statusa: kašnjenje `#dc2626`, inače `#2563eb`.
- Logika motora (detekcija/rutiranje/throttling/idempotencija) — **netaknuta**.

---

### Task 1: Redizajn `reminderHtml` (šablon + testovi)

**Files:**
- Modify: `lib/email/templates.ts` (funkcija `reminderHtml`, linije 28-59)
- Modify: `lib/email/templates.test.ts` (blok `describe("reminderHtml", …)`)

**Interfaces:**
- Produces: `reminderHtml(args: { klijent: string; vrsta: string; rok: string; danaDoRoka: number; lokacija?: string | null; terminId?: string; klijentId?: string; baseUrl?: string }): string`. `reminderSubject`, `escapeHtml`, `danaTekst` nepromijenjeni.

- [ ] **Step 1: Ažuriraj/dopuni testove (failing)**

U `lib/email/templates.test.ts` zamijeni cijeli `describe("reminderHtml", …)` blok ovim:

```ts
describe("reminderHtml", () => {
  const baza = { klijent: "AS & co", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null }

  it("sadrži klijenta, vrstu i formatiran rok; escape-uje vrijednosti", () => {
    const html = reminderHtml(baza)
    expect(html).toContain("AS &amp; co")
    expect(html).toContain("Hidranti")
    expect(html).toContain("15.09.2026.")
  })
  it("izostavlja lokaciju kad je null", () => {
    expect(reminderHtml(baza)).not.toContain("Lokacija")
  })
  it("status badge: USKORO za budući rok, KASNI za istekao", () => {
    expect(reminderHtml({ ...baza, danaDoRoka: 7 })).toContain("USKORO")
    const kasni = reminderHtml({ ...baza, danaDoRoka: -3 })
    expect(kasni).toContain("KASNI")
    expect(kasni).toContain("kasni 3 dana")
  })
  it("s baseUrl + id-jevima: oba dugmeta i tačni dashboard URL-ovi", () => {
    const html = reminderHtml({ ...baza, terminId: "t-123", klijentId: "k-456", baseUrl: "https://app.test" })
    expect(html).toContain("https://app.test/plan-aktivnosti?selected=t-123")
    expect(html).toContain("https://app.test/klijenti/k-456")
    expect(html).toContain("Otvori termin")
    expect(html).toContain("Otvori klijenta")
  })
  it("bez baseUrl: nema dugmadi ni linkova", () => {
    const html = reminderHtml({ ...baza, terminId: "t-123", klijentId: "k-456" })
    expect(html).not.toContain("Otvori termin")
    expect(html).not.toContain("/plan-aktivnosti?selected")
  })
})
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `pnpm vitest run lib/email/templates.test.ts`
Expected: FAIL — stari `reminderHtml` nema „USKORO"/„KASNI" badge ni dugmad (npr. „USKORO" nije u outputu; novi args nepoznati TS-u).

- [ ] **Step 3: Zamijeni `reminderHtml`**

U `lib/email/templates.ts` zamijeni cijelu funkciju `reminderHtml` (linije 28-59) ovim:

```ts
export function reminderHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  danaDoRoka: number
  lokacija?: string | null
  terminId?: string
  klijentId?: string
  baseUrl?: string
}): string {
  const rok = formatDatum(args.rok)
  const kasni = args.danaDoRoka < 0
  const boja = kasni ? "#dc2626" : "#2563eb"
  const badge = `${kasni ? "KASNI" : "USKORO"} · ${danaTekst(args.danaDoRoka)}`
  const lokRed = args.lokacija
    ? `<tr><td style="padding:4px 0;color:#64748b">Lokacija</td><td style="padding:4px 0;text-align:right">${escapeHtml(args.lokacija)}</td></tr>`
    : ""

  // Dugmad: samo s baseUrl + odgovarajući id. Table-based ("bulletproof") za Outlook.
  const base = args.baseUrl ? args.baseUrl.replace(/\/$/, "") : ""
  const terminUrl = base && args.terminId ? `${base}/plan-aktivnosti?selected=${encodeURIComponent(args.terminId)}` : ""
  const klijentUrl = base && args.klijentId ? `${base}/klijenti/${encodeURIComponent(args.klijentId)}` : ""
  const dugme = (url: string, tekst: string, filled: boolean) =>
    `<td style="padding:0 6px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:6px;background:${filled ? boja : "#ffffff"};border:1px solid ${boja}"><a href="${url}" style="display:inline-block;padding:10px 18px;font-size:14px;color:${filled ? "#ffffff" : boja};text-decoration:none">${tekst}</a></td></tr></table></td>`
  const dugmici = [
    terminUrl ? dugme(terminUrl, "Otvori termin", true) : "",
    klijentUrl ? dugme(klijentUrl, "Otvori klijenta", false) : "",
  ].join("")
  const dugmadBlok = dugmici
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px auto 0"><tr>${dugmici}</tr></table>`
    : ""

  return `<!doctype html>
<html lang="bs"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:${boja};padding:16px 24px">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:16px;font-weight:bold">${escapeHtml(APP_NAME)}</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;opacity:.85">Podsjetnik</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px">
          <span style="display:inline-block;background:${boja};color:#ffffff;font-size:12px;font-weight:bold;padding:4px 10px;border-radius:999px">${badge}</span>
          <p style="margin:12px 0 0;font-size:15px"><strong>Rok dospijeća:</strong> ${rok}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-top:1px solid #e2e8f0;font-size:14px">
            <tr><td style="padding:8px 0;color:#64748b">Vrsta</td><td style="padding:8px 0;text-align:right">${escapeHtml(args.vrsta)}</td></tr>
            <tr><td style="padding:4px 0;color:#64748b">Klijent</td><td style="padding:4px 0;text-align:right">${escapeHtml(args.klijent)}</td></tr>
            ${lokRed}
          </table>
          ${dugmadBlok}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center">${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `pnpm vitest run lib/email/templates.test.ts`
Expected: PASS (svih ~9 testova: escapeHtml + reminderSubject + 5 reminderHtml).

- [ ] **Step 5: Typecheck + cijela unit suita**

Run: `pnpm typecheck && pnpm test:unit`
Expected: zeleno (provjeri da `runReminders` poziv `reminderHtml` i dalje typecheck-uje — nova polja su opciona).

- [ ] **Step 6: Commit**

```bash
git add lib/email/templates.ts lib/email/templates.test.ts
git commit -m "feat(email): redizajn reminder mejla (header/badge/dugmad), opcioni deep-link args"
```

---

### Task 2: Env `NEXT_PUBLIC_APP_URL` + wiring u motoru

**Files:**
- Modify: `lib/env.ts` (envSchema + runtimeEnv mapa)
- Modify: `lib/reminders/runReminders.ts:89-95` (poziv `reminderHtml`)
- Modify: `.env.local.example` (dokumentuj novu var)

**Interfaces:**
- Consumes: `reminderHtml` s `terminId`/`klijentId`/`baseUrl` (Task 1); `env.NEXT_PUBLIC_APP_URL`.
- Produces: motor prosljeđuje `terminId: r.termin_id, klijentId: r.klijent_id, baseUrl` u `reminderHtml`.

- [ ] **Step 1: Dodaj `NEXT_PUBLIC_APP_URL` u env shemu**

U `lib/env.ts`, u `envSchema` (poslije `NEXT_PUBLIC_SUPABASE_ANON_KEY`) dodaj:

```ts
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
```

i u `runtimeEnv` mapu (objekat proslijeđen u `safeParse`, poslije `NEXT_PUBLIC_SUPABASE_ANON_KEY`):

```ts
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
```

- [ ] **Step 2: Proslijedi id-jeve + baseUrl u motoru**

U `lib/reminders/runReminders.ts` zamijeni poziv `reminderHtml({...})` (linije 89-95) ovim:

```ts
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
```

(`env` je već uvezen u `runReminders.ts`; `r.termin_id`/`r.klijent_id` su već u redu — koriste se u skip/audit granama.)

- [ ] **Step 3: Dokumentuj env var**

U `.env.local.example` dodaj red (uz ostale NEXT_PUBLIC varijable):

```
# Bazni URL dashboarda za linkove u email-podsjetnicima (po deploymentu; bez ovoga dugmad se izostave)
NEXT_PUBLIC_APP_URL=https://primjer-dashboard.domena
```

- [ ] **Step 4: Typecheck + lint + suita + build**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`
Expected: zeleno; build prolazi.

- [ ] **Step 5: Vizuelni pregled (generiši HTML uzorak)**

Kreiraj privremenu skriptu `scripts/_preview_email.tmp.ts`:

```ts
import { reminderHtml } from "@/lib/email/templates"
import { writeFileSync } from "fs"
const html = reminderHtml({
  klijent: "Neretva Gradnja d.o.o.", vrsta: "Ispitivanje gromobranske instalacije",
  lokacija: "Gradilište Sjever", rok: "2026-09-01", danaDoRoka: 30,
  terminId: "demo-termin-id", klijentId: "demo-klijent-id", baseUrl: "https://app.test",
})
writeFileSync("/tmp/reminder-preview.html", html)
console.log("✅ /tmp/reminder-preview.html")
```

Run: `pnpm exec tsx scripts/_preview_email.tmp.ts && rm -f scripts/_preview_email.tmp.ts`
Expected: ispiše putanju; otvori `/tmp/reminder-preview.html` u browseru i provjeri: header s `APP_NAME`, badge „USKORO · za 30 dana", rok, detalji, dva dugmeta. (Controller/korisnik može poslati i pravi test-mejl preko Resend-a kao ranije.)

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts lib/reminders/runReminders.ts .env.local.example
git commit -m "feat(reminders): proslijedi deep-link URL-ove (NEXT_PUBLIC_APP_URL) u mejl"
```

---

## Rollout (nakon oba taska)

- Cijela suita: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` zeleno.
- Bez DB migracije.
- Postaviti `NEXT_PUBLIC_APP_URL` u Vercel env (demo + tehpro, svaki svoju dashboard domenu) + u `.env.local` za lokalni test.
- Whole-branch review → merge → deploy.

## Self-Review (spec coverage)

- §1 (env NEXT_PUBLIC_APP_URL) → Task 2 ✔
- §2 (šablon: header/badge/rok/detalji/dugmad/footer + opciona polja + escape + encode) → Task 1 ✔
- §3 (motor prosljeđuje termin_id/klijent_id/baseUrl) → Task 2 ✔
- Testiranje (linkovi, bez-baseUrl, badge, escape, lokacija) → Task 1 testovi; vizuelni → Task 2 Step 5 ✔
- Graceful bez baseUrl → Task 1 (dugmadBlok prazan) + test „bez baseUrl" ✔
- Type consistency: `reminderHtml` args isti u Task 1 (definicija) i Task 2 (poziv): klijent/vrsta/rok/danaDoRoka/lokacija/terminId/klijentId/baseUrl ✔
