/** Datumski helperi — Bosanski format DD.MM.YYYY. iz ISO YYYY-MM-DD. */

export const MONTHS_BS = [
  "Januar", "Februar", "Mart", "April", "Maj", "Jun",
  "Jul", "Avgust", "Septembar", "Oktobar", "Novembar", "Decembar",
] as const

/** ISO (ili Date-string) → "DD.MM.YYYY.". Null/nevažeće → "—". */
export function formatDatum(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parts = iso.slice(0, 10).split("-")
  if (parts.length !== 3) return "—"
  const [y, mo, d] = parts
  if (!y || !mo || !d) return "—"
  if (y.length !== 4) return "—"
  return `${d}.${mo}.${y}.`
}

/** Današnji datum kao "YYYY-MM-DD" (UTC, usklađen s DB current_date). */
export function todayIso(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, "0")
  const d = String(now.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Tekuća godina (npr. 2026). */
export function currentYear(): number {
  return new Date().getFullYear()
}

/** Prvi i zadnji dan mjeseca (ISO). month1to12: 1=Januar. */
export function monthRange(year: number, month1to12: number): { from: string; to: string } {
  const mm = String(month1to12).padStart(2, "0")
  const from = `${year}-${mm}-01`
  // zadnji dan: dan 0 sljedećeg mjeseca
  const last = new Date(year, month1to12, 0).getDate()
  const to = `${year}-${mm}-${String(last).padStart(2, "0")}`
  return { from, to }
}

/** Datum (ISO 'YYYY-MM-DD') + N mjeseci, TZ-safe; clamp na zadnji dan ako kraći mjesec. */
export function addMjeseci(isoDatum: string, mjeseci: number): string {
  const [g, m, d] = isoDatum.split("-").map(Number)
  const baza = new Date(Date.UTC(g!, m! - 1, 1)) // prvi dan, izbjegava overflow
  baza.setUTCMonth(baza.getUTCMonth() + mjeseci)
  const ciljG = baza.getUTCFullYear()
  const ciljM = baza.getUTCMonth() // 0-indeksiran
  const zadnjiDan = new Date(Date.UTC(ciljG, ciljM + 1, 0)).getUTCDate()
  const dan = Math.min(d!, zadnjiDan)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${ciljG}-${pad(ciljM + 1)}-${pad(dan)}`
}

/** Raspon datuma za period (mjesec, kvartal ili godina). */
export function periodRange(
  period: "mjesec" | "kvartal" | "godina",
  godina: number,
  mjesec?: number,
  kvartal?: number
): { od: string; do: string } {
  const last = (y: number, m: number) => new Date(y, m, 0).getDate() // m = 1..12
  const pad = (n: number) => String(n).padStart(2, "0")
  if (period === "godina") {
    return { od: `${godina}-01-01`, do: `${godina}-12-31` }
  }
  if (period === "kvartal") {
    const q = kvartal ?? 1
    const startM = (q - 1) * 3 + 1
    const endM = startM + 2
    return { od: `${godina}-${pad(startM)}-01`, do: `${godina}-${pad(endM)}-${pad(last(godina, endM))}` }
  }
  const m = mjesec ?? 1
  return { od: `${godina}-${pad(m)}-01`, do: `${godina}-${pad(m)}-${pad(last(godina, m))}` }
}
