"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { prevMonth, nextMonth, monthLabel } from "@/lib/calendar"
import { MONTHS_BS } from "@/lib/date"
import { cn } from "@/lib/utils"

export function PlanNav({
  godina,
  mjesec,
  godine,
  danas,
}: {
  godina: number
  mjesec: number
  godine: number[]
  danas: { godina: number; mjesec: number }
}) {
  const router = useRouter()
  const params = useSearchParams()

  const href = (g: number, m: number) => {
    const p = new URLSearchParams(params.toString())
    p.set("godina", String(g))
    p.set("mjesec", String(m))
    p.delete("dan")
    p.delete("selected")
    return `/plan-aktivnosti?${p.toString()}`
  }

  const p = prevMonth(godina, mjesec)
  const n = nextMonth(godina, mjesec)

  return (
    <div className="flex items-center gap-2" data-testid="plan-nav">
      <Link
        href={href(p.year, p.month)}
        className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
        data-testid="plan-nav-prev"
        aria-label="Prethodni mjesec"
      >
        <ChevronLeft className="w-4 h-4" />
      </Link>

      <span
        className="min-w-[140px] text-center font-medium"
        data-testid="plan-nav-label"
      >
        {monthLabel(mjesec)} {godina}
      </span>

      <Link
        href={href(n.year, n.month)}
        className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
        data-testid="plan-nav-next"
        aria-label="Sljedeći mjesec"
      >
        <ChevronRight className="w-4 h-4" />
      </Link>

      <Link
        href={href(danas.godina, danas.mjesec)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        data-testid="plan-nav-today"
      >
        Danas
      </Link>

      <Select
        value={String(mjesec)}
        onValueChange={(v) => {
          const m = Number(v)
          if (m) router.push(href(godina, m))
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-32"
          data-testid="plan-nav-mjesec"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MONTHS_BS.map((naziv, i) => (
            <SelectItem key={naziv} value={String(i + 1)}>
              {naziv}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(godina)}
        onValueChange={(v) => {
          const g = Number(v)
          if (g) router.push(href(g, mjesec))
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-24"
          data-testid="plan-nav-godina"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {godine.map((g) => (
            <SelectItem key={g} value={String(g)}>
              {g}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
