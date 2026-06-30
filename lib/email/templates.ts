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

export function reminderHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  danaDoRoka: number
  lokacija?: string | null
}): string {
  const rok = formatDatum(args.rok)
  const kasni = args.danaDoRoka < 0
  const naslov = kasni ? "Termin u kašnjenju" : "Podsjetnik o roku"
  const uvod = kasni
    ? `Termin <strong>${danaTekst(args.danaDoRoka)}</strong> (rok je bio ${rok}).`
    : `Termin dospijeva <strong>${danaTekst(args.danaDoRoka)}</strong> (${rok}).`
  const boja = kasni ? "#dc2626" : "#2563eb"
  const lokRed = args.lokacija
    ? `<p style="margin:4px 0"><strong>Lokacija:</strong> ${escapeHtml(args.lokacija)}</p>`
    : ""
  return `<!doctype html>
<html lang="bs"><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h2 style="color:${boja};margin:0 0 12px">${naslov}</h2>
    <p style="margin:0 0 12px">${uvod}</p>
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px">
      <p style="margin:4px 0"><strong>Klijent:</strong> ${escapeHtml(args.klijent)}</p>
      <p style="margin:4px 0"><strong>Vrsta:</strong> ${escapeHtml(args.vrsta)}</p>
      ${lokRed}
      <p style="margin:4px 0"><strong>Rok dospijeća:</strong> ${rok}</p>
    </div>
    <p style="margin:16px 0 0;color:#64748b;font-size:12px">${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}</p>
  </div>
</body></html>`
}
