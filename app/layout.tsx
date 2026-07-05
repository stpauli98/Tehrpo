import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { NextIntlClientProvider } from "next-intl"
import { cn } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { APP_LOCALE } from "@/lib/locale"
import { getMessages as getAllMessages } from "@/i18n/messages"
import { CLIENT_NAMESPACES } from "@/i18n/client-namespaces"

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description: `Praćenje periodičnih pregleda, ispitivanja i provjera za ${APP_NAME} tim.`,
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
    <html lang={APP_LOCALE} className={cn("font-sans", inter.variable)} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <NextIntlClientProvider locale={APP_LOCALE} messages={clientMessages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
