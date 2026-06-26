import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
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
    <html lang="sr" className={cn("font-sans", inter.variable)} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
