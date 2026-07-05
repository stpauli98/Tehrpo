import { createTranslator } from "next-intl"
import { formatDatum } from "../date"
import { APP_NAME, APP_TAGLINE } from "../brand"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

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

/**
 * Tekst za broj dana do roka: negativan = kašnjenje, 0 = danas, pozitivan = za N dana.
 * Dijeli ICU plural ključeve (`common.rok`) s lib/hitno.ts. Originalna logika ovdje je bila
 * `n === 1 ? "dan" : "dana"` — BEZ sr mod-10 izuzetka (21/31...) koji ima hitno.ts — pa ICU
 * `=1` egzaktni match reprodukuje sr izlaz bajt-identično za SVE brojeve (uklj. 21, 31…),
 * bez potrebe za posebnom sr granom.
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

/** Jednostavan brendiran test-email: potvrđuje da primalac dobija mejlove iz sistema. */
export function testEmailHtml(args: { ime?: string | null }, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.test" })
  const pozdrav = args.ime ? t("pozdravIme", { ime: escapeHtml(args.ime) }) : t("pozdrav")
  return `<!doctype html>
<html lang="${htmlLang(locale)}"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#2563eb;padding:16px 24px">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:16px;font-weight:bold">${escapeHtml(APP_NAME)}</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;opacity:.85">${t("headerLabel")}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px">
          <span style="display:inline-block;background:#16a34a;color:#ffffff;font-size:12px;font-weight:bold;padding:4px 10px;border-radius:999px">${t("znacka")}</span>
          <p style="margin:14px 0 0;font-size:15px">${pozdrav}</p>
          <p style="margin:8px 0 0;font-size:14px;color:#334155">${t("opis")}</p>
          <p style="margin:16px 0 0;font-size:13px;color:#64748b">${t("napomena")}</p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center">${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

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
  const badge = `${kasni ? t("znackaKasni") : t("znackaUskoro")} · ${danaTekst(args.danaDoRoka, locale)}`
  const lokRed = args.lokacija
    ? `<tr><td style="padding:4px 0;color:#64748b">${t("poljeLokacija")}</td><td style="padding:4px 0;text-align:right">${escapeHtml(args.lokacija)}</td></tr>`
    : ""

  // Dugmad: samo s baseUrl + odgovarajući id. Table-based ("bulletproof") za Outlook.
  const base = args.baseUrl ? args.baseUrl.replace(/\/$/, "") : ""
  const terminUrl = base && args.terminId ? `${base}/plan-aktivnosti?selected=${encodeURIComponent(args.terminId)}` : ""
  const klijentUrl = base && args.klijentId ? `${base}/klijenti/${encodeURIComponent(args.klijentId)}` : ""
  const dugme = (url: string, tekst: string, filled: boolean) =>
    `<td style="padding:0 6px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:6px;background:${filled ? boja : "#ffffff"};border:1px solid ${boja}"><a href="${url}" style="display:inline-block;padding:10px 18px;font-size:14px;color:${filled ? "#ffffff" : boja};text-decoration:none">${tekst}</a></td></tr></table></td>`
  const dugmici = [
    terminUrl ? dugme(terminUrl, t("dugmeTermin"), true) : "",
    klijentUrl ? dugme(klijentUrl, t("dugmeKlijent"), false) : "",
  ].join("")
  const dugmadBlok = dugmici
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px auto 0"><tr>${dugmici}</tr></table>`
    : ""

  return `<!doctype html>
<html lang="${htmlLang(locale)}"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:${boja};padding:16px 24px">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:16px;font-weight:bold">${escapeHtml(APP_NAME)}</td>
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
          ${dugmadBlok}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center">${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
