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
  zakazanoZa?: string | null
  terminId?: string
  klijentId?: string
  baseUrl?: string
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.podsjetnik" })
  const rok = formatDatum(args.rok)
  const kasni = args.danaDoRoka < 0
  const boja = kasni ? "#dc2626" : "#2563eb"
  const badgeTekst = `${kasni ? t("znackaKasni") : t("znackaUskoro")} · ${danaTekst(args.danaDoRoka, locale)}`
  const lokRed = args.lokacija ? poljeRed(t("poljeLokacija"), escapeHtml(args.lokacija)) : ""
  // Kad ciklus dolazi iz datum_zakazan, mejl mora prikazati OBA datuma — rok ostaje rok.
  const zakazanoRed = args.zakazanoZa
    ? poljeRed(t("poljeZakazanoZa"), formatDatum(args.zakazanoZa))
    : ""

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
            ${zakazanoRed}
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
  const rok = formatDatum(args.rok)
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

export function rokIstekaoFirmaSubject(
  args: { vrsta: string; klijent: string },
  locale: Locale = APP_LOCALE,
): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.rokIstekaoFirma" })
  return t("predmet", { vrsta: args.vrsta, klijent: args.klijent })
}

/**
 * Firmina obavijest da je rok istekao — poziv na dogovor, ne opomena.
 * Bez internih dugmadi i bez ICS priloga; brend iz FirmBrand.
 */
export function rokIstekaoFirmaHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  zakazanoZa?: string | null
  lokacija?: string | null
  brand: FirmBrand
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.rokIstekaoFirma" })
  const b = args.brand
  const boja = "#dc2626"
  const zakazanRed = args.zakazanoZa
    ? poljeRed(t("poljeZakazan"), formatDatum(args.zakazanoZa))
    : ""
  const lokRed = args.lokacija ? poljeRed(t("poljeLokacija"), escapeHtml(args.lokacija)) : ""
  const kontakt = [b.email, b.phone, b.web].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")
  const potpis = `${escapeHtml(b.name)} — ${escapeHtml(b.tagline)}${kontakt ? `<br>${kontakt}` : ""}`

  const telo = `${badge(boja, t("znacka"))}
          <p style="margin:12px 0 0;font-size:15px">${t("uvod")}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;border-top:1px solid #e2e8f0;font-size:14px">
            ${poljeRed(t("poljeRok"), formatDatum(args.rok), true)}
            ${zakazanRed}
            ${poljeRed(t("poljeVrsta"), escapeHtml(args.vrsta))}
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

// ─── Sedmični digest isteklih termina ────────────────────────────────────────

export type DigestStavka = {
  klijent: string
  vrsta: string
  rok: string
  zakazanoZa?: string | null
  lokacija?: string | null
  danaDoCiklusa: number
}

export function digestSubject(args: { broj: number }, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.digest" })
  return t("predmet", { broj: args.broj })
}

/**
 * Sedmični pregled isteklih termina — gola lista, bez sekcija i bez gornje granice.
 * Redoslijed dolazi iz RPC-a (najveće kašnjenje prvo) i ovdje se ne dira.
 */
export function digestHtml(args: {
  stavke: DigestStavka[]
  baseUrl?: string
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.digest" })
  const boja = "#dc2626"

  const redovi = args.stavke.map((s) => {
    const zakazano = s.zakazanoZa && s.zakazanoZa !== s.rok
      ? `<br><span style="color:#64748b;font-size:12px">${t("zakazanoZa", { datum: formatDatum(s.zakazanoZa) })}</span>`
      : ""
    const lok = s.lokacija ? `<br><span style="color:#64748b;font-size:12px">${escapeHtml(s.lokacija)}</span>` : ""
    return `<tr>
      <td style="padding:8px 0;border-top:1px solid #e2e8f0">${escapeHtml(s.klijent)}${lok}</td>
      <td style="padding:8px 0;border-top:1px solid #e2e8f0">${escapeHtml(s.vrsta)}</td>
      <td style="padding:8px 0;border-top:1px solid #e2e8f0;white-space:nowrap">${formatDatum(s.rok)}${zakazano}</td>
      <td style="padding:8px 0;border-top:1px solid #e2e8f0;text-align:right;white-space:nowrap;color:${boja}">${danaTekst(s.danaDoCiklusa, locale)}</td>
    </tr>`
  }).join("")

  const base = args.baseUrl ? args.baseUrl.replace(/\/$/, "") : ""
  const dugme = base
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px auto 0"><tr><td style="border-radius:6px;background:${boja}">
         <a href="${base}${localizeHref("/plan-aktivnosti", locale)}" style="display:inline-block;padding:10px 18px;font-size:14px;color:#ffffff;text-decoration:none">${t("dugmePlan")}</a>
       </td></tr></table>`
    : ""

  const telo = `${badge(boja, t("znacka"))}
          <p style="margin:12px 0 0;font-size:15px">${t("uvod")}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 0;font-size:14px">
            <tr style="color:#64748b;font-size:12px;text-align:left">
              <th style="padding:0 0 4px">${t("kolonaKlijent")}</th>
              <th style="padding:0 0 4px">${t("kolonaVrsta")}</th>
              <th style="padding:0 0 4px">${t("kolonaRok")}</th>
              <th style="padding:0 0 4px;text-align:right">${t("kolonaKasni")}</th>
            </tr>
            ${redovi}
          </table>
          ${dugme}`

  return layoutOmot({
    accent: boja,
    headerNaziv: escapeHtml(APP_NAME),
    headerLabel: t("headerLabel"),
    telo,
    footer: `${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}`,
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
  const rok = formatDatum(args.rok)
  const zakazan = formatDatum(args.zakazan)
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
