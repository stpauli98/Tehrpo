import { getRequestConfig } from "next-intl/server"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

export default getRequestConfig(async () => ({
  locale: APP_LOCALE,
  messages: getMessages(),
}))
