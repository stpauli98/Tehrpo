/** Mapira Postgres/PostgREST error kod na domaću poruku; nikad ne vraća sirovi interni tekst. */

import { createTranslator } from "next-intl"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "dbErrors" })

export function friendlyDbError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string {
  // Poznati constrainti → precizna poruka (prije generičkog mapiranja po kodu)
  if (error?.message?.includes("chk_termini_datumi")) {
    return t("chkTerminiDatumi")
  }
  switch (error?.code) {
    case "23505": return t("duplikat")
    case "23503": return t("uUpotrebi")
    case "23514": return t("nevazeciPodaci")
    case "23502": return t("obaveznoPolje")
    default: return t("genericka")
  }
}
