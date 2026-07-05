import { createTranslator } from "next-intl"
import { monthName } from "@/lib/date"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

export type MjesecOpcija = { value: string; label: string }

/** Mjesec opcije za filter — value je "tn" | "1".."12", lokalizovano preko lib/date.ts monthName. */
export function buildMonthsOption(locale: Locale = APP_LOCALE): MjesecOpcija[] {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "termini.filteri" })
  return [
    { value: "tn", label: t("tekuciNaredni") },
    ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1, locale) })),
  ]
}

/** Mjesec opcije za filter (APP_LOCALE — fiksirano per-deployment, isto kao ostale lib/ konstante). */
export const MONTHS_BS_OPTION = buildMonthsOption()
