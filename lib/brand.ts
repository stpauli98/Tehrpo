// Brending aplikacije — centralizovano na jednom mjestu.
// Mijenja se ISKLJUČIVO preko env varijabli, bez izmjene koda:
//   NEXT_PUBLIC_APP_NAME     — naziv prikazan u interfejsu
//   NEXT_PUBLIC_APP_TAGLINE  — podnaslov pored naziva
// NEXT_PUBLIC_ varijable se ugrađuju u build, pa rade i na serveru i u klijentu.
// Ako varijabla nije postavljena, default je "Tehpro" → Tehpro instanca ostaje nepromijenjena.

import { APP_LOCALE, type Locale } from "@/lib/locale"

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Tehpro"

// Default tagline po jeziku deploymenta (env override i dalje pobjeđuje — brand ostaje flag).
// Lokalno-ključana mapa umjesto kataloga: brand.ts se importuje i u client i u server
// kodu na module-nivou, a povlačenje getMessages() (sva tri kataloga) ovdje bi probilo
// bundle disciplinu CLIENT_NAMESPACES (isti obrazac kao MOCK_TEKSTOVI u lib/claude/mock.ts).
const DEFAULT_TAGLINE: Record<Locale, string> = {
  sr: "Sistem za termine i provjere",
  en: "Appointment and inspection management system",
  de: "System für Termine und Prüfungen",
}

export const APP_TAGLINE =
  process.env.NEXT_PUBLIC_APP_TAGLINE?.trim() || DEFAULT_TAGLINE[APP_LOCALE]

// Inicijal za logo-bedž (prvo slovo naziva).
export const APP_INITIAL = (APP_NAME[0] ?? "T").toUpperCase()
