/**
 * Datumski helperi — JEDINI standard vremena u aplikaciji:
 *  - vremenska zona: APP_TIME_ZONE (Europe/Belgrade, CET/CEST) za svako
 *    "danas"/"sada"/granicu dana i svaku konverziju instanta u zidno vrijeme;
 *  - prikaz: "dd.MM.yyyy" za datume, "dd.MM.yyyy HH:mm" (24h) za datum+vrijeme —
 *    identično za SVE lokale (sr/en/de), bez Intl grananja po lokalu;
 *  - interno: ISO "YYYY-MM-DD" / ISO timestampovi (poređenja leksikografski).
 */

import { APP_LOCALE, type Locale } from "@/lib/locale"

/** Jedina vremenska zona aplikacije. Vienna/Zagreb/Sarajevo imaju identičan offset — standard je Belgrade. */
export const APP_TIME_ZONE = "Europe/Belgrade"

export const MONTHS_BS = [
  "Januar", "Februar", "Mart", "April", "Maj", "Jun",
  "Jul", "Avgust", "Septembar", "Oktobar", "Novembar", "Decembar",
] as const

/**
 * Zidne komponente instanta u APP_TIME_ZONE (dvocifreno, 24h).
 * Preko Intl.formatToParts — bez zavisnosti o locale patternu ("en-CA" je samo
 * nosač; sastavljanje je ručno), hourCycle "h23" da ponoć bude "00", ne "24".
 */
function zidneKomponente(instant: Date): { g: string; m: string; d: string; h: string; min: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant)
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? ""
  return { g: p("year"), m: p("month"), d: p("day"), h: p("hour"), min: p("minute") }
}

/**
 * ISO datum (ili Date-string; uzima se samo datum-dio) → "dd.MM.yyyy".
 * Null/nevažeće → "—". Jedan format za sve lokale — kalendarski datum se NE
 * konvertuje kroz zonu (ulaz je već zidni datum); za instante (timestamptz)
 * koristi formatDatumInstant / formatDatumVrijeme.
 */
export function formatDatum(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parts = iso.slice(0, 10).split("-")
  if (parts.length !== 3) return "—"
  const [y, mo, d] = parts
  if (!y || !mo || !d) return "—"
  if (y.length !== 4) return "—"
  return `${d}.${mo}.${y}`
}

/**
 * Naziv mjeseca (1=Januar), lokalizovan — tekstualni nazivi su i dalje po
 * lokalu (standard dd.MM.yyyy se odnosi na numerički prikaz, ne na riječi).
 * sr: hardkodirani MONTHS_BS (CLDR "sr-Latn" vraća malim slovom).
 */
export function monthName(month1to12: number, locale: Locale = APP_LOCALE): string {
  if (month1to12 < 1 || month1to12 > 12) return ""
  if (locale === "sr") return MONTHS_BS[month1to12 - 1] ?? ""
  const fmt = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" })
  const label = fmt.format(new Date(Date.UTC(2024, month1to12 - 1, 1)))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Današnji zidni datum u APP_TIME_ZONE kao "YYYY-MM-DD". (SQL parnjak: `(now() at time zone 'Europe/Belgrade')::date`.) */
export function todayIso(): string {
  const { g, m, d } = zidneKomponente(new Date())
  return `${g}-${m}-${d}`
}

/** Tekuća godina (npr. 2026) po APP_TIME_ZONE. */
export function currentYear(): number {
  return Number(todayIso().slice(0, 4))
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

/** ISO timestamp (instant) → "dd.MM.yyyy HH:mm" (24h) u APP_TIME_ZONE. Null/nevažeće → "—". Bez sekundi. */
export function formatDatumVrijeme(iso: string | null | undefined): string {
  if (!iso) return "—"
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return "—"
  const { g, m, d, h, min } = zidneKomponente(dt)
  return `${d}.${m}.${g} ${h}:${min}`
}

/** ISO timestamp (instant) → samo zidni datum "dd.MM.yyyy" u APP_TIME_ZONE. Null/nevažeće → "—". Za timestamptz kolone (npr. uploaded_at) kad se vrijeme ne prikazuje — slice(0,10) bi dao UTC datum! */
export function formatDatumInstant(iso: string | null | undefined): string {
  if (!iso) return "—"
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return "—"
  const { g, m, d } = zidneKomponente(dt)
  return `${d}.${m}.${g}`
}

/** Offset zone APP_TIME_ZONE (ms) za dati UTC instant, izračunat preko Intl (bez novih zavisnosti). */
function zonaOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(instant)
  const p = (type: string) => Number(parts.find((x) => x.type === type)?.value)
  // hour12:false može dati "24" za ponoć — normalizuj na 0
  const zidnoVrijeme = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour") % 24, p("minute"), p("second"))
  return zidnoVrijeme - instant.getTime()
}

/**
 * Type-guard za ISO datum "YYYY-MM-DD" — JEDINI izvor validacije prije
 * `utcGranicaDana` / `dodajDan(a)`. Korisnički kontrolisan ulaz
 * (URL parametar, polje forme) uvijek provući kroz ovo, pa nevaljan tiho
 * ignorisati — kao što stranice već rade za `tip`/`status`.
 *
 * Zašto round-trip, a ne `Date.parse`: ISO gramatika dozvoljava DD do 31 u
 * svakom mjesecu, pa `Date.parse("2026-02-30")` NE puca — `Date.UTC` to tiho
 * prelije u 02.03. Vrijednost se prihvata samo ako se vrati identična.
 */
export function jeIsoDatum(v: string | null | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [g, m, d] = v.split("-").map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(g, m - 1, d))
  return dt.getUTCFullYear() === g && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Ulazna ograda datumskih helpera. Bez nje su dvije tihe katastrofe moguće:
 * `dodajDan("abc")` je vraćao string "NaN-NaN-NaN" (korupcija koja putuje
 * dalje u upit), a `utcGranicaDana("abc")` je bacao goli
 * `RangeError` iz Intl-a nad Invalid Date — poruku iz koje se ne vidi ni koja
 * funkcija ni koja vrijednost je kriva.
 */
function tvrdiIsoDatum(isoDatum: string, funkcija: string): void {
  if (!jeIsoDatum(isoDatum)) {
    throw new Error(
      `${funkcija}: očekivan ISO datum "YYYY-MM-DD", dobijeno ${JSON.stringify(isoDatum)}. ` +
        `Korisnički unos validiraj sa jeIsoDatum() prije poziva.`,
    )
  }
}

/** ISO datum "YYYY-MM-DD" → UTC instant ponoći tog datuma u APP_TIME_ZONE, npr. "2026-07-26" → "2026-07-25T22:00:00.000Z" (ljeto, UTC+2). Za datumske granice filtera (S7: eksplicitna zona, `do` kao ekskluzivni sljedeći dan). Baca na nevaljan ulaz — v. `jeIsoDatum`. */
export function utcGranicaDana(isoDatum: string): string {
  tvrdiIsoDatum(isoDatum, "utcGranicaDana")
  const [g, m, d] = isoDatum.split("-").map(Number)
  const utcPonoc = Date.UTC(g!, m! - 1, d!)
  // DST prelazi (CET/CEST) su u 02:00/03:00 lokalno — offset u UTC ponoć važi i za lokalnu ponoć istog dana
  const offset = zonaOffsetMs(new Date(utcPonoc))
  return new Date(utcPonoc - offset).toISOString()
}

/** ISO datum + N dana (N može biti negativan), TZ-safe (obrazac kao addMjeseci). Baca na nevaljan ulaz — v. `jeIsoDatum`. */
export function dodajDana(isoDatum: string, dana: number): string {
  tvrdiIsoDatum(isoDatum, "dodajDana")
  const [g, m, d] = isoDatum.split("-").map(Number)
  const dt = new Date(Date.UTC(g!, m! - 1, d! + dana)) // Date.UTC normalizuje overflow dana
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** ISO datum + 1 dan. Baca na nevaljan ulaz — v. `jeIsoDatum`. */
export function dodajDan(isoDatum: string): string {
  tvrdiIsoDatum(isoDatum, "dodajDan")
  return dodajDana(isoDatum, 1)
}

/** Raspon [prvi dan tekućeg mjeseca, zadnji dan narednog mjeseca] (ISO, granica godine OK). "Tekući" po APP_TIME_ZONE zidnom datumu instanta `danas` (default: sada). */
export function tekuciNarednomMjesecuRange(danas?: Date): { from: string; to: string } {
  const zid = zidneKomponente(danas ?? new Date())
  const y = Number(zid.g)
  const m = Number(zid.m) - 1 // 0..11 (tekući)
  const pad = (n: number) => String(n).padStart(2, "0")
  const from = `${y}-${pad(m + 1)}-01`
  const end = new Date(Date.UTC(y, m + 2, 0)) // dan 0 mjeseca (m+2) = zadnji dan narednog (m+1)
  const to = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
  return { from, to }
}
