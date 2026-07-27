import { createTranslator } from "next-intl"
import { getTrenutniKorisnik, type TrenutniKorisnik } from "@/lib/auth/current-user"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

/** Server-only guard: vrati profil prijavljenog admina ili baci grešku. NIJE server action — čisti util. */
export async function zahtijevajAdmina(): Promise<TrenutniKorisnik> {
  const k = await getTrenutniKorisnik()
  if (!k || k.uloga !== "admin") throw new Error(t("samoAdministrator"))
  return k
}
