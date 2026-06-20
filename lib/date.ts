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

/** Današnji datum kao "YYYY-MM-DD" (lokalna zona). */
export function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
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
