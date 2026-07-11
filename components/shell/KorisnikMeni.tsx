"use client"

import { useTransition } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, LogOut } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { odjaviSe } from "@/app/(dashboard)/odjava/actions"
import type { TrenutniKorisnik } from "@/lib/auth/current-user"
import { cn, FOCUS_RING } from "@/lib/utils"

/** Inicijali iz imena: prvo slovo prve i posljednje riječi (npr. "Demo Administrator" → "DA"). */
function inicijali(ime: string): string {
  const rijeci = ime.trim().split(/\s+/).filter(Boolean)
  const prva = rijeci[0]
  if (!prva) return "?"
  if (rijeci.length === 1) return prva.slice(0, 2).toUpperCase()
  const zadnja = rijeci[rijeci.length - 1] ?? prva
  return (prva.charAt(0) + zadnja.charAt(0)).toUpperCase()
}

export function KorisnikMeni({ korisnik }: { korisnik: TrenutniKorisnik }) {
  const t = useTranslations("shell.topBar")
  const tUloge = useTranslations("postavke.uloge")
  const [odjavaPending, startOdjava] = useTransition()

  const ini = inicijali(korisnik.ime)
  const ulogaLabel = tUloge(korisnik.uloga)

  function odjava() {
    startOdjava(() => {
      void odjaviSe()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t("korisnickiMeni")}
            className={cn(
              "group flex h-9 items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-left transition-colors hover:bg-muted data-[popup-open]:bg-muted",
              FOCUS_RING,
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-light text-[11px] font-semibold text-brand">
              {ini}
            </span>
            <span className="max-w-[12rem] truncate text-sm font-medium text-foreground">
              {korisnik.ime}
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[popup-open]:rotate-180"
              aria-hidden
            />
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <div className="flex items-center gap-3 px-1.5 py-1.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-light text-sm font-semibold text-brand">
            {ini}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] leading-tight text-muted-foreground">{t("prijavljenKao")}</p>
            <p className="truncate text-sm font-medium text-foreground">{korisnik.ime}</p>
            <Badge variant="secondary" className="mt-1">
              {ulogaLabel}
            </Badge>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={odjavaPending} onClick={odjava}>
          <LogOut aria-hidden /> {t("odjava")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
