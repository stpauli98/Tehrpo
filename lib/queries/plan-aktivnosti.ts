/**
 * Client-side query funkcije za `/api/plan-aktivnosti/*` rute.
 * Koristi ih TanStack Query u „use client" view komponentama.
 *
 * S1 ugovor: rute na grešci vraćaju `{ error: <i18n string> }`; fetcher tu poruku
 * podiže u `Error.message` da je `GreskaUcitavanja` prikaže doslovno. Kad poruke
 * nema (mrežni pad, ne-JSON odgovor), `Error.message` ostaje prazan i
 * `porukaGreske()` vrati `undefined` → komponenta pada na `common.greskaUcitavanja`.
 */

function qs(o: Record<string, unknown>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v != null && v !== "") p.set(k, String(v))
  return p.toString()
}

/** Izvuci `{ error }` iz neuspješnog odgovora; "" kad ga nema (nikad ne baca). */
export async function porukaIzOdgovora(r: Response): Promise<string> {
  try {
    const body: unknown = await r.json()
    if (body && typeof body === "object" && "error" in body) {
      const poruka = (body as { error?: unknown }).error
      if (typeof poruka === "string" && poruka.trim() !== "") return poruka
    }
  } catch {
    // ne-JSON odgovor (HTML error stranica, prazan body) → bez poruke
  }
  return ""
}

/**
 * Poruka za `GreskaUcitavanja.poruka` iz `useQuery` greške.
 * `undefined` = nema serverske poruke → komponenta koristi `common` fallback.
 */
export function porukaGreske(e: unknown): string | undefined {
  return e instanceof Error && e.message !== "" ? e.message : undefined
}

async function baci(r: Response): Promise<never> {
  throw new Error(await porukaIzOdgovora(r))
}

export async function getTerminiLista(f: Record<string, unknown>) {
  const r = await fetch(`/api/plan-aktivnosti/lista?${qs(f)}`)
  if (!r.ok) await baci(r)
  return r.json() as Promise<{
    rows: unknown[]
    total: number
    klijenti: { id: string; naziv: string }[]
    vrste: { id: string; naziv: string }[]
    lokacije: { id: string; naziv: string; klijent_id: string }[]
  }>
}

export async function getTerminiMatrica(f: Record<string, unknown>) {
  const r = await fetch(`/api/plan-aktivnosti/matrica?${qs(f)}`)
  if (!r.ok) await baci(r)
  return r.json()
}

export async function getTerminiKalendar(godina: number, mjesec: number) {
  const r = await fetch(`/api/plan-aktivnosti/kalendar?${qs({ godina, mjesec })}`)
  if (!r.ok) await baci(r)
  return r.json()
}

export async function getTerminDetail(id: string) {
  const r = await fetch(`/api/plan-aktivnosti/detail?id=${encodeURIComponent(id)}`)
  if (!r.ok) await baci(r)
  return r.json()
}
