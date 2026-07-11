# Osvježenje email template-a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Osvježiti izgled svih odlaznih email-ova i uskladiti aplikativne (Resend, u kodu) sa Supabase reset-password mejlom kroz jedan dijeljeni vizuelni okvir.

**Architecture:** U `lib/email/templates.ts` uvodimo tri dijeljena helpera (`layoutOmot`, `badge`, `poljeRed`) i refaktorišemo četiri postojeće template funkcije da ih koriste — potpisi funkcija se ne mijenjaju, pa pozivaoci ostaju netaknuti. Zatim dodajemo standalone `docs/email/supabase-reset-password.html` (srpski) koji se ručno lijepi u Supabase, s istim okvirom.

**Tech Stack:** TypeScript, Vitest (node env), next-intl (`createTranslator`), table-based HTML email (inline stilovi).

## Global Constraints

- **Osvježenje, ne redizajn:** zadržati table-based ("bulletproof") strukturu, plavu `#2563eb` akcenat, crvenu `#dc2626` za kašnjenje, tekstualni brend (bez `<img>` loga), Arial font.
- **Brend nikad kao literal:** interni mejlovi koriste `APP_NAME`/`APP_TAGLINE`, klijentski `FirmBrand`. Ne upisivati naziv firme u kod.
- **i18n bez novih ključeva:** osvježenje je čisto vizuelno; `messages/{sr,en,de}.json` se ne dira. Svi tekstovi idu i dalje kroz `createTranslator` (`email.*`, `common.rok`).
- **Potpisi funkcija nepromijenjeni:** `reminderHtml`, `reminderHtmlFirma`, `zakazanoNakonRokaHtml`, `testEmailHtml` zadržavaju iste argumente i export-e.
- **Očuvati tekstualne tokene** koje testovi provjeravaju: `TESTNI EMAIL`/`TEST EMAIL`, `USKORO`/`UPCOMING`, `KASNI`, `Otvori termin`/`Open appointment`, `Otvori klijenta`/`Open client`, `Due date:`, `<html lang="...">`, escape-ovane vrijednosti, dashboard URL-ovi.
- **Supabase reset:** samo srpski (latinica), jedan HTML za oba projekta; koristi `{{ .ConfirmationURL }}` i `{{ .Email }}`; aplikacija ga ne učitava.
- **Testiranje backenda ide kroz Docker** (projekat konvencija) — ali ovdje je čista logika, `pnpm test:unit` (Vitest, node) je dovoljan i ne dira mrežu/DB.

---

### Task 1: Dijeljeni okvir + refaktor `templates.ts` (vizuelno osvježenje)

**Files:**
- Modify: `lib/email/templates.ts` (kompletna zamjena tijela, isti export-i)
- Test: `lib/email/templates.test.ts` (dodati jedan blok; postojeći ostaju)

**Interfaces:**
- Consumes: `escapeHtml`, `htmlLang`, `formatDatum`, `createTranslator`, `getMessages`, `localizeHref`, `APP_NAME`, `APP_TAGLINE`, `FirmBrand` (sve postojeće).
- Produces (nepromijenjeni export-i, koriste ih pozivaoci u Task-neovisnom kodu):
  - `reminderHtml(args, locale?) => string`
  - `reminderHtmlFirma(args, locale?) => string`
  - `zakazanoNakonRokaHtml(args, locale?) => string`
  - `testEmailHtml(args, locale?) => string`
  - `reminderSubject`, `testEmailSubject`, `zakazanoNakonRokaSubject`, `escapeHtml` — bez izmjene.
- Novi **interni** (nije export): `layoutOmot`, `badge`, `poljeRed`.

- [ ] **Step 1: Baseline — potvrdi da postojeći testovi prolaze**

Run: `pnpm vitest run lib/email/templates.test.ts`
Expected: PASS (svi postojeći testovi zeleni prije izmjene).

- [ ] **Step 2: Napiši novi (padajući) test za dijeljeni osvježeni okvir**

Dodaj na kraj `lib/email/templates.test.ts`. Prvo dopuni import da uključuje `zakazanoNakonRokaHtml`:

```ts
import {
  reminderSubject, reminderHtml, escapeHtml, testEmailSubject, testEmailHtml,
  reminderHtmlFirma, zakazanoNakonRokaHtml,
} from "./templates"
```

Zatim dodaj blok:

```ts
describe("osvježeni dijeljeni okvir", () => {
  const outs = [
    testEmailHtml({ ime: "X" }),
    reminderHtml({ klijent: "K", vrsta: "V", rok: "2026-09-15", danaDoRoka: 7, lokacija: null }),
    reminderHtmlFirma({ klijent: "K", vrsta: "V", rok: "2026-09-15", danaDoRoka: 7, lokacija: null, brand: { name: "B", tagline: "T" } }),
    zakazanoNakonRokaHtml({ klijent: "K", vrsta: "V", rok: "2026-09-15", zakazan: "2026-09-20", lokacija: null }),
  ]
  it("sve četiri poruke dijele osvježenu karticu (radius 12px + sjenka)", () => {
    for (const html of outs) {
      expect(html).toContain("border-radius:12px")
      expect(html).toContain("box-shadow:0 1px 3px rgba(15,23,42,.08)")
    }
  })
})
```

- [ ] **Step 3: Pokreni novi test — mora pasti**

Run: `pnpm vitest run lib/email/templates.test.ts -t "osvježeni dijeljeni okvir"`
Expected: FAIL (stari kod ima `border-radius:10px` i nema `box-shadow`).

- [ ] **Step 4: Zamijeni `lib/email/templates.ts` osvježenom verzijom**

Kompletan novi sadržaj fajla:

```ts
import { createTranslator } from "next-intl"
import { formatDatum } from "../date"
import { APP_NAME, APP_TAGLINE } from "../brand"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { localizeHref } from "@/i18n/routes"
import type { FirmBrand } from "./firmBrand"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** "sr" → "bs" (postojeći hardkodirani html lang, ijekavica latinica); en/de → ISO kod. */
function htmlLang(locale: Locale): string {
  return locale === "sr" ? "bs" : locale
}

// ─── Dijeljeni vizuelni okvir (osvježeno) ────────────────────────────────────

/** Ujednačen pill badge. */
function badge(boja: string, tekst: string): string {
  return `<span style="display:inline-block;background:${boja};color:#ffffff;font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px;letter-spacing:.3px">${tekst}</span>`
}

/** Jedan red tabele "labela → vrijednost" (prvi red ima veći gornji razmak). */
function poljeRed(labela: string, vrijednost: string, prvi = false): string {
  const pad = prvi ? "8px" : "4px"
  return `<tr><td style="padding:${pad} 0;color:#64748b">${labela}</td><td style="padding:${pad} 0;text-align:right">${vrijednost}</td></tr>`
}

/** Zajednički omot: pozadina → kartica → header → telo → footer. */
function layoutOmot(a: {
  accent: string
  headerNaziv: string
  headerLabel: string
  telo: string
  footer: string
  locale: Locale
}): string {
  return `<!doctype html>
<html lang="${htmlLang(a.locale)}"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.08)">
        <tr><td style="background:${a.accent};padding:18px 24px">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:.3px">${a.headerNaziv}</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;opacity:.85">${a.headerLabel}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px">${a.telo}</td></tr>
        <tr><td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;text-align:center">${a.footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

// ─── Predmet (subject) ───────────────────────────────────────────────────────

/**
 * Tekst za broj dana do roka: negativan = kašnjenje, 0 = danas, pozitivan = za N dana.
 * Dijeli ICU plural ključeve (`common.rok`) s lib/hitno.ts.
 */
function danaTekst(d: number, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "common.rok" })
  if (d === 0) return t("danas")
  if (d < 0) return t("kasni", { count: -d })
  return t("za", { count: d })
}

export function reminderSubject(
  args: { vrsta: string; klijent: string; danaDoRoka: number },
  locale: Locale = APP_LOCALE,
): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.podsjetnik" })
  const tekst = danaTekst(args.danaDoRoka, locale)
  const stanje = args.danaDoRoka < 0 ? tekst : t("rok", { tekst })
  return t("predmet", { vrsta: args.vrsta, klijent: args.klijent, stanje })
}

export function testEmailSubject(locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.test" })
  return t("predmet", { appName: APP_NAME })
}

export function zakazanoNakonRokaSubject(
  args: { vrsta: string; klijent: string },
  locale: Locale = APP_LOCALE,
): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.zakazanoNakonRoka" })
  return t("predmet", { vrsta: args.vrsta, klijent: args.klijent })
}

// ─── Test email ──────────────────────────────────────────────────────────────

/** Jednostavan brendiran test-email: potvrđuje da primalac dobija mejlove iz sistema. */
export function testEmailHtml(args: { ime?: string | null }, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.test" })
  const pozdrav = args.ime ? t("pozdravIme", { ime: escapeHtml(args.ime) }) : t("pozdrav")
  const telo = `${badge("#16a34a", t("znacka"))}
          <p style="margin:14px 0 0;font-size:15px">${pozdrav}</p>
          <p style="margin:8px 0 0;font-size:14px;color:#334155">${t("opis")}</p>
          <p style="margin:16px 0 0;font-size:13px;color:#64748b">${t("napomena")}</p>`
  return layoutOmot({
    accent: "#2563eb",
    headerNaziv: escapeHtml(APP_NAME),
    headerLabel: t("headerLabel"),
    telo,
    footer: `${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}`,
    locale,
  })
}

// ─── Podsjetnik (interni + firmin) ───────────────────────────────────────────

export function reminderHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  danaDoRoka: number
  lokacija?: string | null
  terminId?: string
  klijentId?: string
  baseUrl?: string
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.podsjetnik" })
  const rok = formatDatum(args.rok, locale)
  const kasni = args.danaDoRoka < 0
  const boja = kasni ? "#dc2626" : "#2563eb"
  const badgeTekst = `${kasni ? t("znackaKasni") : t("znackaUskoro")} · ${danaTekst(args.danaDoRoka, locale)}`
  const lokRed = args.lokacija ? poljeRed(t("poljeLokacija"), escapeHtml(args.lokacija)) : ""

  // Dugmad: samo s baseUrl + odgovarajući id. Table-based ("bulletproof") za Outlook.
  const base = args.baseUrl ? args.baseUrl.replace(/\/$/, "") : ""
  const terminUrl = base && args.terminId
    ? `${base}${localizeHref(`/plan-aktivnosti?selected=${encodeURIComponent(args.terminId)}`, locale)}`
    : ""
  const klijentUrl = base && args.klijentId
    ? `${base}${localizeHref(`/klijenti/${encodeURIComponent(args.klijentId)}`, locale)}`
    : ""
  const dugme = (url: string, tekst: string, filled: boolean) =>
    `<td style="padding:0 6px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:6px;background:${filled ? boja : "#ffffff"};border:1px solid ${boja}"><a href="${url}" style="display:inline-block;padding:10px 18px;font-size:14px;color:${filled ? "#ffffff" : boja};text-decoration:none">${tekst}</a></td></tr></table></td>`
  const dugmici = [
    terminUrl ? dugme(terminUrl, t("dugmeTermin"), true) : "",
    klijentUrl ? dugme(klijentUrl, t("dugmeKlijent"), false) : "",
  ].join("")
  const dugmadBlok = dugmici
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px auto 0"><tr>${dugmici}</tr></table>`
    : ""

  const telo = `${badge(boja, badgeTekst)}
          <p style="margin:12px 0 0;font-size:15px"><strong>${t("rokDospijeca")}</strong> ${rok}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-top:1px solid #e2e8f0;font-size:14px">
            ${poljeRed(t("poljeVrsta"), escapeHtml(args.vrsta), true)}
            ${poljeRed(t("poljeKlijent"), escapeHtml(args.klijent))}
            ${lokRed}
          </table>
          ${dugmadBlok}`
  return layoutOmot({
    accent: boja,
    headerNaziv: escapeHtml(APP_NAME),
    headerLabel: t("headerLabel"),
    telo,
    footer: `${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}`,
    locale,
  })
}

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
  const badgeTekst = `${kasni ? t("znackaKasni") : t("znackaUskoro")} · ${danaTekst(args.danaDoRoka, locale)}`
  const b = args.brand
  const lokRed = args.lokacija ? poljeRed(t("poljeLokacija"), escapeHtml(args.lokacija)) : ""
  const kontakt = [b.email, b.phone, b.web].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")
  const potpis = `${escapeHtml(b.name)} — ${escapeHtml(b.tagline)}${kontakt ? `<br>${kontakt}` : ""}`

  const telo = `${badge(boja, badgeTekst)}
          <p style="margin:12px 0 0;font-size:15px"><strong>${t("rokDospijeca")}</strong> ${rok}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-top:1px solid #e2e8f0;font-size:14px">
            ${poljeRed(t("poljeVrsta"), escapeHtml(args.vrsta), true)}
            ${poljeRed(t("poljeKlijent"), escapeHtml(args.klijent))}
            ${lokRed}
          </table>`
  return layoutOmot({
    accent: boja,
    headerNaziv: escapeHtml(b.name),
    headerLabel: t("headerLabel"),
    telo,
    footer: potpis,
    locale,
  })
}

// ─── Zakazano nakon roka ─────────────────────────────────────────────────────

export function zakazanoNakonRokaHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  zakazan: string
  lokacija?: string | null
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.zakazanoNakonRoka" })
  const boja = "#dc2626"
  const rok = formatDatum(args.rok, locale)
  const zakazan = formatDatum(args.zakazan, locale)
  const lokRed = args.lokacija ? poljeRed(t("poljeLokacija"), escapeHtml(args.lokacija)) : ""
  const telo = `${badge(boja, t("znacka"))}
          <p style="margin:12px 0 0;font-size:15px">${t("uvod")}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-top:1px solid #e2e8f0;font-size:14px">
            ${poljeRed(t("poljeRok"), rok, true)}
            <tr><td style="padding:4px 0;color:#64748b">${t("poljeZakazan")}</td><td style="padding:4px 0;text-align:right;font-weight:bold">${zakazan}</td></tr>
            ${poljeRed(t("poljeVrsta"), escapeHtml(args.vrsta))}
            ${poljeRed(t("poljeKlijent"), escapeHtml(args.klijent))}
            ${lokRed}
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#64748b">${t("napomena")}</p>`
  return layoutOmot({
    accent: boja,
    headerNaziv: escapeHtml(APP_NAME),
    headerLabel: t("znacka"),
    telo,
    footer: `${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}`,
    locale,
  })
}
```

- [ ] **Step 5: Pokreni cijeli email test-fajl — sve zeleno**

Run: `pnpm vitest run lib/email/templates.test.ts`
Expected: PASS (postojeći + novi blok). Ovim je potvrđeno da su svi tekstualni tokeni i URL-ovi očuvani nakon refaktora.

- [ ] **Step 6: Provjeri lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: bez grešaka.

- [ ] **Step 7: Commit**

```bash
git add lib/email/templates.ts lib/email/templates.test.ts
git commit -m "refactor(email): dijeljeni okvir + vizuelno osvježenje template-a"
```

---

### Task 2: Supabase reset-password HTML (srpski, izvor za copy-paste)

**Files:**
- Create: `docs/email/supabase-reset-password.html`

**Interfaces:**
- Consumes: isti vizuelni okvir kao Task 1 (isti header/kartica/footer stilovi), ali kao statični HTML (Supabase ne izvršava app kod).
- Produces: standalone fajl; aplikacija ga ne importuje. Supabase varijable `{{ .ConfirmationURL }}`, `{{ .Email }}`.

- [ ] **Step 1: Kreiraj `docs/email/supabase-reset-password.html`**

```html
<!-- Supabase → Authentication → Emails → Reset Password (Recovery)
     Zalijepiti u HTML editor, ODVOJENO za DEMO i PROD projekat.
     Brend "Tehpro" je upisan kao tekst — promijeniti ručno po firmi.
     Aplikacija NE učitava ovaj fajl; on je samo izvor za copy-paste. -->
<!doctype html>
<html lang="bs"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.08)">
        <tr><td style="background:#2563eb;padding:18px 24px">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:.3px">Tehpro</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;opacity:.85">Sigurnost naloga</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px">
          <span style="display:inline-block;background:#2563eb;color:#ffffff;font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px;letter-spacing:.3px">PROMJENA LOZINKE</span>
          <p style="margin:14px 0 0;font-size:15px">Zdravo,</p>
          <p style="margin:8px 0 0;font-size:14px;color:#334155">Primili smo zahtjev za promjenu lozinke za nalog <strong>{{ .Email }}</strong>. Klikni na dugme ispod da postaviš novu lozinku.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px auto 0"><tr>
            <td style="border-radius:6px;background:#2563eb;border:1px solid #2563eb"><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 22px;font-size:14px;color:#ffffff;text-decoration:none">Postavi novu lozinku</a></td>
          </tr></table>
          <p style="margin:20px 0 0;font-size:13px;color:#64748b">Ako nisi ti tražio/la promjenu lozinke, slobodno ignoriši ovu poruku — tvoja lozinka ostaje nepromijenjena. Link ističe nakon isteka roka podešenog u Supabase-u.</p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;text-align:center">Tehpro — ZNR i ZOP</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
```

- [ ] **Step 2: Vizuelna provjera renderovanja**

Otvori fajl u browseru:
Run: `open docs/email/supabase-reset-password.html`
Expected: kartica sa plavim headerom "Tehpro", značkom "PROMJENA LOZINKE", dugmetom "Postavi novu lozinku" i footerom "Tehpro — ZNR i ZOP". `{{ .Email }}` i `{{ .ConfirmationURL }}` su vidljivi kao literali (Supabase ih zamjenjuje pri slanju). Vizuelno usklađeno s izlazom iz Task 1.

- [ ] **Step 3: Commit**

```bash
git add docs/email/supabase-reset-password.html
git commit -m "docs(email): Supabase reset-password template (srpski, usklađen okvir)"
```

---

## Napomena za deploy (ručni korak, van koda)

Nakon merge-a: zalijepiti sadržaj `docs/email/supabase-reset-password.html` u **Supabase → Authentication → Emails → Reset Password**, HTML editor, **odvojeno za DEMO (`mtwwotmwrasozmcgqwhc`) i PROD (`fqtqkehjidkzeasiegnq`)**. Kod-template-i (Task 1) idu automatski kroz Resend nakon deploy-a.

## Self-Review

- **Spec coverage:** Vizuelni tokeni → Task 1 `layoutOmot`/`badge`/`poljeRed`. Izmjene `templates.ts` → Task 1. Nepromijenjeni pozivaoci → potpisi očuvani (Global Constraints + Task 1 Interfaces). Testovi → Step 5. Supabase reset HTML → Task 2. Van obima (logo/env boja/višejezični auth) → nije uključeno. ✅
- **Placeholder scan:** nema TBD/TODO; sav kod je konkretan. ✅
- **Type consistency:** `layoutOmot({accent, headerNaziv, headerLabel, telo, footer, locale})` konzistentno pozvan u sve četiri funkcije; `badge(boja, tekst)` i `poljeRed(labela, vrijednost, prvi?)` konzistentni. Export potpisi identični originalu. ✅
