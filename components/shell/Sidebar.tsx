"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ClipboardList,
  Grid3x3,
  Calendar,
  Users,
  Bot,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/termini",  label: "Termini",  icon: ClipboardList },
  { href: "/prikaz",   label: "Prikaz",   icon: Grid3x3 },
  { href: "/plan",     label: "Plan",     icon: Calendar },
  { href: "/klijenti", label: "Klijenti", icon: Users },
  { href: "/asistent", label: "Asistent", icon: Bot },
  { href: "/pregled",  label: "Pregled",  icon: FileText },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Glavna navigacija"
      className="w-56 shrink-0 border-r border-slate-200 bg-slate-50 p-3 flex flex-col gap-1"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
              active
                ? "bg-brand text-white"
                : "text-slate-700 hover:bg-slate-100"
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="w-4 h-4" aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
