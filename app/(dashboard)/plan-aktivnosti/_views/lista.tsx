"use client"

import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { ClipboardList, AlertTriangle, CheckCircle2, Bell } from "lucide-react"
import Link from "next/link"
import { StatCard } from "@/components/domain/StatCard"
import { TerminiTable, type TerminRow } from "@/components/domain/TerminiTable"
import { TerminiFilters } from "@/components/domain/TerminiFilters"
import { TerminSheet } from "@/components/domain/TerminSheet"
import { NoviTerminButton } from "@/components/domain/NoviTerminButton"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { currentYear, todayIso } from "@/lib/date"
import { getTerminiLista, getTerminDetail } from "@/lib/queries/plan-aktivnosti"
import type { Database } from "@/db/types"

const PER_PAGE = 50

export function ListaView() {
  const searchParams = useSearchParams()

  const pageNum = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
  const statusFilter = searchParams.get("status") ?? "svi"
  const qFilter = (searchParams.get("q") ?? "").trim()
  const klijentFilter = searchParams.get("klijent_id") ?? ""
  const lokacijaFilter = searchParams.get("lokacija") ?? ""
  const vrstaFilter = searchParams.get("vrsta_id") ?? ""
  const mjesecFilter = searchParams.get("mjesec") ?? ""
  const godinaFilter = Number(searchParams.get("godina")) || currentYear()
  const selectedId = searchParams.get("selected")

  const ovajMjesec = String(Number(todayIso().slice(5, 7)))

  const filters = {
    page: pageNum,
    status: statusFilter,
    q: qFilter,
    klijent_id: klijentFilter,
    lokacija: lokacijaFilter,
    vrsta_id: vrstaFilter,
    mjesec: mjesecFilter,
    godina: godinaFilter,
  }

  const { data, isPending } = useQuery({
    queryKey: ["termini-lista", filters],
    queryFn: () => getTerminiLista(filters),
    staleTime: 60_000,
  })

  const { data: detailData } = useQuery({
    queryKey: ["termin-detail", selectedId],
    queryFn: () => getTerminDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  })

  const rows = (data?.rows ?? []) as TerminRow[]
  const total = data?.total ?? 0
  const stats = data?.stats ?? {
    ukupno: 0,
    ovog_mjeseca: 0,
    kasni: 0,
    izvrseno_ovog_mjeseca: 0,
  }
  const klijenti = (data?.klijenti ?? []) as { id: string; naziv: string }[]
  const vrste = (data?.vrste ?? []) as { id: string; naziv: string }[]
  const lokacije = (data?.lokacije ?? []) as {
    id: string
    naziv: string
    klijent_id: string
  }[]

  const lokacijeByFirma: Record<string, { id: string; naziv: string }[]> = {}
  for (const l of lokacije) {
    ;(lokacijeByFirma[l.klijent_id] ??= []).push({ id: l.id, naziv: l.naziv })
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const currentSearch = searchParams.toString()

  const selectedTermin = selectedId
    ? ((detailData?.termin ?? null) as TerminRow | null)
    : null
  const istorija = (detailData?.istorija ?? []) as TerminRow[]
  const dokumenti = (detailData?.dokumenti ?? []) as Database["public"]["Tables"]["dokumenti"]["Row"][]

  const closeParams = new URLSearchParams(currentSearch)
  closeParams.delete("selected")
  const closeHref = `/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}`

  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("page", String(p))
    return `/plan-aktivnosti?${params.toString()}`
  }

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <NoviTerminButton klijenti={klijenti} vrste={vrste} lokacijeByFirma={lokacijeByFirma} />
      </div>

      {/* Klikabilne KPI kartice → postave brzi filter na listu (aktivna je uokvirena) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" data-testid="termini-stats">
        <Link href="/plan-aktivnosti?view=lista" className="block" aria-label="Ukupno termina">
          <StatCard
            testId="stat-ukupno"
            label="Ukupno termina"
            value={stats.ukupno}
            sub="svi termini"
            icon={ClipboardList}
            interactive
            active={statusFilter === "svi" && mjesecFilter === ""}
          />
        </Link>
        <Link href={`/plan-aktivnosti?view=lista&mjesec=${ovajMjesec}`} className="block">
          <StatCard
            testId="stat-ovog-mjeseca"
            label="Ovog mjeseca"
            value={stats.ovog_mjeseca}
            sub="rok dospijeća"
            icon={Bell}
            tone="warning"
            interactive
            active={mjesecFilter === ovajMjesec}
          />
        </Link>
        <Link href="/plan-aktivnosti?view=lista&status=kasni" className="block">
          <StatCard
            testId="stat-kasni"
            label="Kasni rokovi"
            value={stats.kasni}
            sub="zahtijevaju akciju"
            icon={AlertTriangle}
            tone="danger"
            interactive
            active={statusFilter === "kasni"}
          />
        </Link>
        <Link href="/plan-aktivnosti?view=lista&status=izvrseno" className="block">
          <StatCard
            testId="stat-izvrseno"
            label="Izvršeni ovog mjeseca"
            value={stats.izvrseno_ovog_mjeseca}
            sub="završeno"
            icon={CheckCircle2}
            tone="success"
            interactive
            active={statusFilter === "izvrseno"}
          />
        </Link>
      </div>

      <TerminiFilters klijenti={klijenti} vrste={vrste} lokacijeByFirma={lokacijeByFirma} />

      <TerminiTable rows={rows} currentSearch={currentSearch} />

      <div
        className="flex items-center justify-between text-sm text-slate-600"
        data-testid="termini-pagination"
      >
        <span data-testid="termini-total">Ukupno rezultata: {total}</span>
        <div className="flex items-center gap-2">
          {pageNum <= 1 ? (
            <span
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "pointer-events-none opacity-50",
              )}
            >
              Prethodna
            </span>
          ) : (
            <Link
              href={pageHref(pageNum - 1)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Prethodna
            </Link>
          )}
          <span data-testid="termini-page">
            Strana {pageNum} / {totalPages}
          </span>
          {pageNum >= totalPages ? (
            <span
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "pointer-events-none opacity-50",
              )}
            >
              Sljedeća
            </span>
          ) : (
            <Link
              href={pageHref(pageNum + 1)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Sljedeća
            </Link>
          )}
        </div>
      </div>

      {selectedTermin && (
        <TerminSheet
          termin={selectedTermin}
          istorija={istorija}
          dokumenti={dokumenti}
          closeHref={closeHref}
        />
      )}
    </div>
  )
}
