import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Tehpro — Sistem za termine i provjere",
  description: "Praćenje periodičnih pregleda, ispitivanja i provjera za Tehpro tim.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="sr" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
