// Jezik aplikacije — fiksiran per-deployment, bira ga isključivo developer.
// Mijenja se ISKLJUČIVO preko env varijable (zahtijeva rebuild):
//   NEXT_PUBLIC_APP_LOCALE — "sr" | "en" | "de"; default "sr".
// Isti pattern kao lib/brand.ts.

export const SUPPORTED_LOCALES = ["sr", "en", "de"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export function parseLocale(raw: string | undefined): Locale {
  const v = raw?.trim().toLowerCase()
  if (v && (SUPPORTED_LOCALES as readonly string[]).includes(v)) return v as Locale
  if (v) console.warn(`[locale] Nepoznat NEXT_PUBLIC_APP_LOCALE="${raw}" — fallback na "sr".`)
  return "sr"
}

export const APP_LOCALE: Locale = parseLocale(process.env.NEXT_PUBLIC_APP_LOCALE)
