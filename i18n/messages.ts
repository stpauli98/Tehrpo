import sr from "@/messages/sr.json"
import en from "@/messages/en.json"
import de from "@/messages/de.json"
import { APP_LOCALE, type Locale } from "@/lib/locale"

const CATALOGS = { sr, en, de } as const

export function getMessages(locale: Locale = APP_LOCALE) {
  return CATALOGS[locale]
}
