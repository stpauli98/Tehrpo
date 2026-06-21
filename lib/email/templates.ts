import { formatDatum } from "../date"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function danaTekst(d: number): string {
  if (d === 0) return "danas"
  return `za ${d} ${d === 1 ? "dan" : "dana"}`
}

export function reminderSubject(args: {
  vrsta: string
  klijent: string
  danaPrije: number
}): string {
  return `Podsjetnik: ${args.vrsta} — ${args.klijent} (rok ${danaTekst(args.danaPrije)})`
}

export function reminderHtml(args: {
  klijent: string
  vrsta: string
  rok: string
  danaPrije: number
  lokacija?: string | null
}): string {
  const rok = formatDatum(args.rok)
  const lokRed = args.lokacija
    ? `<p style="margin:4px 0"><strong>Lokacija:</strong> ${escapeHtml(args.lokacija)}</p>`
    : ""
  return `<!doctype html>
<html lang="bs"><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h2 style="color:#2563eb;margin:0 0 12px">Podsjetnik o roku</h2>
    <p style="margin:0 0 12px">Termin dospijeva <strong>${danaTekst(args.danaPrije)}</strong> (${rok}).</p>
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px">
      <p style="margin:4px 0"><strong>Klijent:</strong> ${escapeHtml(args.klijent)}</p>
      <p style="margin:4px 0"><strong>Vrsta:</strong> ${escapeHtml(args.vrsta)}</p>
      ${lokRed}
      <p style="margin:4px 0"><strong>Rok dospijeća:</strong> ${rok}</p>
    </div>
    <p style="margin:16px 0 0;color:#64748b;font-size:12px">Tehpro — Sistem za termine i provjere</p>
  </div>
</body></html>`
}
