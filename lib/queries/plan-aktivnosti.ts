/**
 * Client-side query functions for plan-aktivnosti API routes (Task 7).
 * Used by TanStack Query in the "use client" view components.
 */

function qs(o: Record<string, unknown>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v != null && v !== "") p.set(k, String(v))
  return p.toString()
}

export async function getTerminiLista(f: Record<string, unknown>) {
  const r = await fetch(`/api/plan-aktivnosti/lista?${qs(f)}`)
  if (!r.ok) throw new Error("lista fetch failed")
  return r.json() as Promise<{
    rows: unknown[]
    total: number
    stats: {
      ukupno: number
      ovog_mjeseca: number
      kasni: number
      izvrseno_ovog_mjeseca: number
    } | null
    klijenti: { id: string; naziv: string }[]
    vrste: { id: string; naziv: string }[]
    lokacije: { id: string; naziv: string; klijent_id: string }[]
  }>
}

export async function getTerminiMatrica(f: Record<string, unknown>) {
  const r = await fetch(`/api/plan-aktivnosti/matrica?${qs(f)}`)
  if (!r.ok) throw new Error("matrica fetch failed")
  return r.json()
}

export async function getTerminiKalendar(godina: number, mjesec: number) {
  const r = await fetch(`/api/plan-aktivnosti/kalendar?${qs({ godina, mjesec })}`)
  if (!r.ok) throw new Error("kalendar fetch failed")
  return r.json()
}

export async function getTerminDetail(id: string) {
  const r = await fetch(`/api/plan-aktivnosti/detail?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error("detail fetch failed")
  return r.json()
}
