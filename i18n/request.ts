import { getRequestConfig } from "next-intl/server"
import { APP_LOCALE } from "@/lib/locale"
import { APP_TIME_ZONE } from "@/lib/date"
import { getMessages } from "@/i18n/messages"

export default getRequestConfig(async () => ({
  locale: APP_LOCALE,
  messages: getMessages(),
  // Jedina zona aplikacije — next-intl formatteri ne smiju pasti na zonu servera
  timeZone: APP_TIME_ZONE,
}))
