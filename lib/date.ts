/** Datumski helperi — Bosanski format DD.MM.YYYY. iz ISO YYYY-MM-DD. */

import { APP_LOCALE, type Locale } from "@/lib/locale"

export const MONTHS_BS = [
  "Januar", "Februar", "Mart", "April", "Maj", "Jun",
  "Jul", "Avgust", "Septembar", "Oktobar", "Novembar", "Decembar",
] as const

/**
 * ISO (ili Date-string) → lokalizovan prikaz datuma. Null/nevažeće → "—".
 * sr: zadržan postojeći hardkodirani "DD.MM.YYYY." oblik (early-return). Napomena:
 * provjereno empirijski (Node 24) da Intl.DateTimeFormat("sr"/"sr-Latn",
 * {day:"2-digit",month:"2-digit",year:"numeric"}) daje BAJT-IDENTIČAN tekst
 * ("28.07.2026.", uključujući tačku na kraju) — dakle ovdje razlika u formatu
 * NIJE razlog za hardkod. Zadržano zbog: (1) simetrije sa monthName() ispod, gdje
 * Intl za sr STVARNO daje drugačiji tekst, i (2) izbjegavanja runtime zavisnosti o
 * ICU podacima za "sr" (npr. small-icu Node build) za default lokal koji, po
 * §procedura-i18n Global Constraints, mora raditi bez ijedne env promjene.
 * en/de: Intl.DateTimeFormat(locale, ...) (§procedura-i18n Step 1).
 */
export function formatDatum(iso: string | null | undefined, locale: Locale = APP_LOCALE): string {
  if (!iso) return "—"
  const parts = iso.slice(0, 10).split("-")
  if (parts.length !== 3) return "—"
  const [y, mo, d] = parts
  if (!y || !mo || !d) return "—"
  if (y.length !== 4) return "—"
  if (locale === "sr") return `${d}.${mo}.${y}.`
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  }).format(dt)
}

/**
 * Naziv mjeseca (1=Januar), lokalizovan.
 * sr: zadržan postojeći hardkodirani MONTHS_BS (early-return) — CLDR "sr-Latn"
 * preko Intl.DateTimeFormat vraća malim slovom ("januar"), što bi promijenilo
 * postojeći, testovima provjeravan tekst (precedent: MonthCalendar.tsx, Task 8).
 * en/de: Intl.DateTimeFormat(locale, { month: "long" }).
 */
export function monthName(month1to12: number, locale: Locale = APP_LOCALE): string {
  if (month1to12 < 1 || month1to12 > 12) return ""
  if (locale === "sr") return MONTHS_BS[month1to12 - 1] ?? ""
  const fmt = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" })
  const label = fmt.format(new Date(Date.UTC(2024, month1to12 - 1, 1)))
  return label.charAt(0).toUpperCase() + label.slice(1)
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

/** Raspon [prvi dan tekućeg mjeseca, zadnji dan narednog mjeseca] (ISO, UTC, granica godine OK). */
export function tekuciNarednomMjesecuRange(danas?: Date): { from: string; to: string } {
  const base = danas ?? new Date()
  const y = base.getUTCFullYear()
  const m = base.getUTCMonth() // 0..11 (tekući)
  const pad = (n: number) => String(n).padStart(2, "0")
  const from = `${y}-${pad(m + 1)}-01`
  const end = new Date(Date.UTC(y, m + 2, 0)) // dan 0 mjeseca (m+2) = zadnji dan narednog (m+1)
  const to = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
  return { from, to }
}
