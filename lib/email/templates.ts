import { formatDatum } from "../date"
import { APP_NAME, APP_TAGLINE } from "../brand"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Tekst za broj dana do roka: negativan = kašnjenje, 0 = danas, pozitivan = za N dana. */
function danaTekst(d: number): string {
  if (d === 0) return "danas"
  if (d < 0) {
    const n = -d
    return `kasni ${n} ${n === 1 ? "dan" : "dana"}`
  }
  return `za ${d} ${d === 1 ? "dan" : "dana"}`
}

export function reminderSubject(args: { vrsta: string; klijent: string; danaDoRoka: number }): string {
  const stanje = args.danaDoRoka < 0 ? danaTekst(args.danaDoRoka) : `rok ${danaTekst(args.danaDoRoka)}`
  return `Podsjetnik: ${args.vrsta} — ${args.klijent} (${stanje})`
}

export function testEmailSubject(): string {
  return `Testni email — ${APP_NAME}`
}

/** Jednostavan brendiran test-email: potvrđuje da primalac dobija mejlove iz sistema. */
export function testEmailHtml(args: { ime?: string | null }): string {
  const pozdrav = args.ime ? `Zdravo ${escapeHtml(args.ime)},` : "Zdravo,"
  return `<!doctype html>
<html lang="bs"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#2563eb;padding:16px 24px">
          <table role="presentation" width="100%"><tr>
            <td style="color:#ffffff;font-size:16px;font-weight:bold">${escapeHtml(APP_NAME)}</td>
            <td style="color:#ffffff;font-size:13px;text-align:right;opacity:.85">Test</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px">
          <span style="display:inline-block;background:#16a34a;color:#ffffff;font-size:12px;font-weight:bold;padding:4px 10px;border-radius:999px">TESTNI EMAIL</span>
          <p style="margin:14px 0 0;font-size:15px">${pozdrav}</p>
          <p style="margin:8px 0 0;font-size:14px;color:#334155">Ako vidiš ovu poruku, dostava emaila na tvoju adresu radi ispravno. Na ovu adresu ćeš primati automatske podsjetnike o rokovima dospijeća.</p>
          <p style="margin:16px 0 0;font-size:13px;color:#64748b">Ovo je test poslan iz postavki — nije potrebno ništa raditi.</p>
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
