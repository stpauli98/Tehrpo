/** Domain mapiranja za termine statuse + DB upiti. */

import type { SupabaseClient } from "@supabase/supabase-js"
import { todayIso } from "@/lib/date"

export type HitnoKasniItem = {
  id: string
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  rok_dospijeca: string
  status_izvedeni: string
}

function isoPlusDays(days: number): string {
  const d = new Date(todayIso())
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function getPredstojeciCount(
  supabase: SupabaseClient,
  dana = 30
): Promise<number> {
  const { count } = await supabase
    .from("termini_view")
    .select("id", { count: "exact", head: true })
    .gte("rok_dospijeca", todayIso())
    .lte("rok_dospijeca", isoPlusDays(dana))
    .neq("status_izvedeni", "izvrseno")
  return count ?? 0
}

export async function getHitnoKasni(
  supabase: SupabaseClient,
  limit = 8
): Promise<HitnoKasniItem[]> {
  const { data } = await supabase
    .from("termini_view")
    .select("id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, rok_dospijeca, status_izvedeni")
    .or(`status_izvedeni.eq.kasni,and(rok_dospijeca.lte.${isoPlusDays(30)},status_izvedeni.neq.izvrseno)`)
    .order("rok_dospijeca", { ascending: true })
    .limit(limit)
  return (data ?? []) as HitnoKasniItem[]
}

export type DerivedStatus =
  | "planirano" | "zakazano" | "izvrseno" | "kasni" | "otkazano"

/** Soft-pill klase (Tailwind skale, ne sm:/md:). */
export const STATUS_BADGE_CLASS: Record<DerivedStatus, string> = {
  planirano: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
  zakazano: "bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-600/20",
  izvrseno: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20",
  kasni: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
  otkazano: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20",
}

/** Pune tačke za kalendar (bg-*-500 skala). Jedan izvor istine za MonthCalendar + PlanLegenda. */
export const STATUS_DOT_CLASS: Record<DerivedStatus, string> = {
  planirano: "bg-blue-500",
  zakazano: "bg-cyan-500",
  izvrseno: "bg-green-500",
  kasni: "bg-red-500",
  otkazano: "bg-slate-400",
}

/** Jače -100 nijanse s hover-om za gustu status-matricu (skenabilnost). Jedan izvor istine za MatrixGrid + MatrixLegenda. */
export const STATUS_CELL_CLASS: Record<DerivedStatus, string> = {
  izvrseno: "bg-green-100 text-green-800 hover:bg-green-200",
  planirano: "bg-blue-50 text-blue-800 hover:bg-blue-100",
  zakazano: "bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
  kasni: "bg-red-100 text-red-800 hover:bg-red-200",
  otkazano: "bg-slate-100 text-slate-500 hover:bg-slate-200",
}

/** Redoslijed statusa za legendu/prikaz. */
export const STATUS_ORDER = ["izvrseno", "planirano", "zakazano", "kasni", "otkazano"] as const

/** Opcije status filtera. labelKey = ključ u i18n namespace-u "status". */
export const STATUS_FILTER_OPTIONS = [
  { value: "svi", labelKey: "svi" },
  { value: "kasni", labelKey: "kasni" },
  { value: "planirano", labelKey: "planirano" },
  { value: "zakazano", labelKey: "zakazano" },
  { value: "izvrseno", labelKey: "izvrseno" },
  { value: "otkazano", labelKey: "otkazano" },
] as const

const VALID: ReadonlySet<string> = new Set<DerivedStatus>([
  "planirano", "zakazano", "izvrseno", "kasni", "otkazano",
])

/** Sigurno mapiranje string → DerivedStatus (fallback 'planirano'). */
export function toDerivedStatus(s: string | null | undefined): DerivedStatus {
  return s && VALID.has(s) ? (s as DerivedStatus) : "planirano"
}
