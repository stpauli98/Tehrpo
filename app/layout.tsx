import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { NextIntlClientProvider } from "next-intl"
import { getTranslations } from "next-intl/server"
import { cn } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { APP_LOCALE } from "@/lib/locale"
import { getMessages as getAllMessages } from "@/i18n/messages"
import { CLIENT_NAMESPACES } from "@/i18n/client-namespaces"
import { DEMO_MODE } from "@/lib/demo"

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.layout")
  return {
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: t("description", { appName: APP_NAME }),
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const all = getAllMessages() as Record<string, unknown>
  const clientMessages = Object.fromEntries(
    CLIENT_NAMESPACES.filter((ns) => ns in all).map((ns) => [ns, all[ns]])
  )
  return (
    <html
      lang={APP_LOCALE}
      className={cn("font-sans", inter.variable)}
      // DEMO deploy dobija narandžastu paletu preko html[data-demo] override-a u
      // globals.css; undefined = atributa nema, pa je PROD markup bajt-identičan.
      data-demo={DEMO_MODE ? "1" : undefined}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <NextIntlClientProvider locale={APP_LOCALE} messages={clientMessages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
