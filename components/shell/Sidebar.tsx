"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  LayoutDashboard,
  Calendar,
  Map,
  Users,
  Bot,
  FileText,
  ScrollText,
  Settings,
  ChevronsLeft,
  Mail,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn, FOCUS_RING } from "@/lib/utils"
import { href } from "@/i18n/routes"
import { useUloga } from "@/providers/korisnik-provider"

const NAV_ITEMS = [
  { href: href("/pregled"),         labelKey: "pregled",         icon: LayoutDashboard },
  { href: href("/plan-aktivnosti"), labelKey: "planAktivnosti",  icon: Calendar },
  { href: href("/obilasci"),        labelKey: "obilasci",        icon: Map },
  { href: href("/klijenti"),        labelKey: "klijenti",        icon: Users },
  { href: href("/poslati-mejlovi"), labelKey: "poslatiMejlovi",  icon: Mail },
  { href: href("/asistent"),        labelKey: "asistent",        icon: Bot },
  { href: href("/zapisnici"),       labelKey: "zapisnici",       icon: FileText },
  { href: href("/aktivnost"),       labelKey: "aktivnost",       icon: ScrollText },
] as const

// Postavke se prikvačuje na dno (kao zadnji li:last-child u originalu).
const FOOTER_ITEM = { href: href("/postavke"), labelKey: "postavke", icon: Settings } as const

const MIN_WIDTH = 64          // skupljeno — samo ikonice
const MAX_WIDTH = 264
const DEFAULT_WIDTH = 224
const COLLAPSE_THRESHOLD = 140 // ispod ove širine se ponaša kao skupljeno i snapuje na MIN
const RESIZE_STEP = 16         // korak za resize sa tastature (strelice)
const STORAGE_KEY = "tehpro:sidebar-width"

export function Sidebar({ mejlGreske = 0 }: { mejlGreske?: number }) {
  const pathname = usePathname()
  const uloga = useUloga()
  const t = useTranslations("shell.nav")
  const tSidebar = useTranslations("shell.sidebar")
  const navRef = useRef<HTMLElement>(null)
  const resizingRef = useRef(false)
  const lastExpandedRef = useRef(DEFAULT_WIDTH)

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [animating, setAnimating] = useState(false)

  const collapsed = width < COLLAPSE_THRESHOLD

  // Admin-only stavke: Asistent i Zapisnici (yoink zahtjev 2026-07-29) + Aktivnost.
  // null uloga (profil nedostaje) = najmanja privilegija → također sakriveno.
  let navItems: (typeof NAV_ITEMS)[number][] = [...NAV_ITEMS]
  if (uloga !== "admin") {
    const adminOnly: string[] = [href("/asistent"), href("/zapisnici"), href("/aktivnost")]
    navItems = navItems.filter((i) => !adminOnly.includes(i.href))
  }

  // Učitaj zapamćenu širinu nakon mounta. Početni render (server i klijent) koristi
  // DEFAULT_WIDTH pa nema hydration mismatch-a; perzistirana širina se primjenjuje tek
  // nakon hidracije, što je namjeran jednokratni read iz localStorage-a.
  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- jednokratna inicijalizacija iz localStorage nakon mounta
      setWidth(saved)
      if (saved >= COLLAPSE_THRESHOLD) lastExpandedRef.current = saved
    }
  }, [])

  // Perzistuj širinu + zapamti zadnju "razvučenu" širinu za toggle.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width))
    if (width >= COLLAPSE_THRESHOLD) lastExpandedRef.current = width
  }, [width])

  // Povlačenje ručice → mijenja širinu.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizingRef.current) return
      const left = navRef.current?.getBoundingClientRect().left ?? 0
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX - left))
      setWidth(next)
    }
    function onUp() {
      if (!resizingRef.current) return
      resizingRef.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      // Snap: ako je povučeno ispod praga, skupi do kraja.
      setAnimating(true)
      setWidth((w) => (w < COLLAPSE_THRESHOLD ? MIN_WIDTH : w))
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    setAnimating(false) // tokom povlačenja bez tranzicije → odzivno
    document.body.style.cursor = "ew-resize"
    document.body.style.userSelect = "none"
  }, [])

  const toggle = useCallback(() => {
    setAnimating(true)
    setWidth((w) => (w < COLLAPSE_THRESHOLD ? lastExpandedRef.current || DEFAULT_WIDTH : MIN_WIDTH))
  }, [])

  // Resize sa tastature dok je ručica fokusirana: strelice mijenjaju širinu, Enter/Space skuplja/proširuje.
  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault()
        const delta = e.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP
        setAnimating(false) // koraci bez tranzicije → odzivno na držanje tipke
        setWidth((w) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + delta)))
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        toggle()
      }
    },
    [toggle],
  )

  const renderItem = ({ href: itemHref, labelKey, icon: Icon }: { href: string; labelKey: string; icon: typeof Settings }) => {
    const active = pathname.startsWith(itemHref)
    const label = t(labelKey)
    return (
      <Link
        key={itemHref}
        href={itemHref}
        prefetch
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/item relative flex h-10 items-center rounded-lg text-sm transition-colors",
          FOCUS_RING,
          collapsed ? "justify-center px-0" : "gap-3 px-3",
          active
            ? "bg-brand text-white"
            : "text-foreground hover:bg-muted",
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
        {!collapsed && <span className="min-w-0 truncate">{label}</span>}
        {itemHref === href("/poslati-mejlovi") && mejlGreske > 0 && !collapsed && (
          <Badge variant="destructive" className="ml-auto">
            {mejlGreske}
            <span className="sr-only">{tSidebar("bedzGreske")}</span>
          </Badge>
        )}
        {itemHref === href("/poslati-mejlovi") && mejlGreske > 0 && collapsed && (
          <>
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
            <span className="sr-only">{tSidebar("bedzGreske")}</span>
          </>
        )}
        {collapsed && (
          <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-md group-hover/item:block">
            {label}
          </span>
        )}
      </Link>
    )
  }

  return (
    <nav
      ref={navRef}
      aria-label={tSidebar("glavnaNavigacija")}
      style={{ width }}
      onTransitionEnd={() => setAnimating(false)}
      className={cn(
        "relative my-3 ml-3 shrink-0",
        animating && "transition-[width] duration-300 ease-out motion-reduce:transition-none",
      )}
    >
      <div className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-card/70 p-2 shadow-sm backdrop-blur">
        <ul className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <li key={item.href}>{renderItem(item)}</li>
          ))}
        </ul>

        <div className="mt-auto flex flex-col gap-1 pt-1">
          {renderItem(FOOTER_ITEM)}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? tSidebar("prosiriNavigaciju") : tSidebar("skupiNavigaciju")}
            className={cn(
              "group/item relative flex h-9 items-center rounded-lg text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground",
              FOCUS_RING,
              collapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
          >
            <ChevronsLeft
              className={cn("h-[18px] w-[18px] shrink-0 transition-transform", collapsed && "rotate-180")}
              aria-hidden
            />
            {!collapsed && <span className="truncate">{tSidebar("skupi")}</span>}
          </button>
        </div>
      </div>

      {/* Ručica za promjenu širine: povuci da resize-uješ, dvoklik da skupiš/proširiš. */}
      <div
        onMouseDown={startResize}
        onDoubleClick={toggle}
        onKeyDown={onHandleKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label={tSidebar("resizeHint")}
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title={tSidebar("resizeHint")}
        className="group/handle absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center outline-none"
      >
        <span className="h-12 w-1 rounded-full bg-slate-200 transition-all group-hover/handle:bg-brand group-focus-visible/handle:h-16 group-focus-visible/handle:w-1.5 group-focus-visible/handle:bg-brand" />
      </div>
    </nav>
  )
}
