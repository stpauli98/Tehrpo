/** Domain mapiranja za termine statuse. */

export type DerivedStatus =
  | "planirano" | "zakazano" | "izvrseno" | "kasni" | "otkazano"

export const STATUS_LABEL: Record<DerivedStatus, string> = {
  planirano: "Planirano",
  zakazano: "Zakazano",
  izvrseno: "Izvršeno",
  kasni: "Kasni",
  otkazano: "Otkazano",
}

/** Soft-pill klase (Tailwind skale, ne sm:/md:). */
export const STATUS_BADGE_CLASS: Record<DerivedStatus, string> = {
  planirano: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
  zakazano: "bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-600/20",
  izvrseno: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20",
  kasni: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
  otkazano: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20",
}

export const STATUS_FILTER_OPTIONS = [
  { value: "svi", label: "Svi" },
  { value: "kasni", label: "Kasni" },
  { value: "planirano", label: "Planirano" },
  { value: "zakazano", label: "Zakazano" },
  { value: "izvrseno", label: "Izvršeno" },
  { value: "otkazano", label: "Otkazano" },
] as const

const VALID: ReadonlySet<string> = new Set<DerivedStatus>([
  "planirano", "zakazano", "izvrseno", "kasni", "otkazano",
])

/** Sigurno mapiranje string → DerivedStatus (fallback 'planirano'). */
export function toDerivedStatus(s: string | null | undefined): DerivedStatus {
  return s && VALID.has(s) ? (s as DerivedStatus) : "planirano"
}
