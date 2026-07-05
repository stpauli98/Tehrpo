import { createTranslator } from "next-intl"
import { APP_NAME } from "@/lib/brand"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

/** iCal escaping: backslash, tačka-zarez, zarez, novi red. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
}

/** "YYYY-MM-DD" → "YYYYMMDD". */
function dateBasic(iso: string): string {
  return iso.replace(/-/g, "")
}

/** "YYYY-MM-DD" + 1 dan → "YYYYMMDD" (TZ-safe preko UTC). */
function nextDayBasic(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + 1))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(dt.getUTCDate()).padStart(2, "0")
  return `${yy}${mm}${dd}`
}

/** Date → iCal UTC timestamp "YYYYMMDDTHHMMSSZ". */
function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

export function buildTerminIcs(args: {
  vrsta: string
  klijent: string
  rok: string // ISO "YYYY-MM-DD"
  terminId: string
  lokacija?: string | null
  baseUrl?: string
  now?: Date
}, locale: Locale = APP_LOCALE): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "email.ics" })
  const now = args.now ?? new Date()
  const host = args.baseUrl ? new URL(args.baseUrl).hostname : "termini"
  const summary = icsEscape(`${args.vrsta} — ${args.klijent}`)
  const descText = args.baseUrl
    ? `${t("opis")}\n\n${t("detalji", { url: `${args.baseUrl}/plan-aktivnosti?selected=${args.terminId}` })}`
    : t("opis")
  const description = icsEscape(descText)
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Podsjetnici//BS`,
    "METHOD:PUBLISH",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${args.terminId}@${host}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${dateBasic(args.rok)}`,
    `DTEND;VALUE=DATE:${nextDayBasic(args.rok)}`,
    `SUMMARY:${summary}`,
    ...(args.lokacija ? [`LOCATION:${icsEscape(args.lokacija)}`] : []),
    `DESCRIPTION:${description}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-P1D",
    `DESCRIPTION:${summary}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  // RFC 5545 §3.1: svaka content-linija (uključujući zadnju) završava CRLF.
  return lines.join("\r\n") + "\r\n"
}
