export const PLAN_VIEWS = ["lista", "kalendar", "matrica"] as const
export type PlanView = (typeof PLAN_VIEWS)[number]

export function jeValidanView(v: string | undefined): v is PlanView {
  return v !== undefined && (PLAN_VIEWS as readonly string[]).includes(v)
}

/** URL za /plan-aktivnosti sa zadanim view-om; čuva ostale parametre (view ide na kraj). */
export function buildViewHref(params: URLSearchParams, view: PlanView): string {
  const next = new URLSearchParams(params)
  next.delete("view")
  next.set("view", view)
  const qs = next.toString()
  return `/plan-aktivnosti${qs ? `?${qs}` : ""}`
}

/** Redirect URL sa stare rute: čuva sve string query-parametre + dodaje view. */
export function buildRedirectHref(view: PlanView, sp: Record<string, string | string[] | undefined>): string {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") next.set(k, v)
  }
  next.set("view", view)
  return `/plan-aktivnosti?${next.toString()}`
}
