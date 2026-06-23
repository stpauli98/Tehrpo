export type TerminRed = {
  id: string
  klijent_id: string | null
  vrsta_provjere_id: string | null
  lokacija_id: string | null
  rok_dospijeca: string
  status: string
}

export const STATUS_PRIO: Record<string, number> = {
  izvrseno: 4, zakazano: 3, planirano: 2, otkazano: 1,
}

/** Ključ grupe: isti klijent+vrsta+lokacija+rok. */
export function grupaKljuc(t: TerminRed): string {
  return `${t.klijent_id ?? "∅"}|${t.vrsta_provjere_id ?? "∅"}|${t.lokacija_id ?? "∅"}|${t.rok_dospijeca}`
}

/** Bira jedan red (keep) po grupi: dokument-bearing > status-prioritet > stabilno (id). */
export function odaberiCuvara(rows: TerminRed[], docIds: Set<string>): { keep: TerminRed; drop: TerminRed[] } {
  const sorted = [...rows].sort((a, b) => {
    const ad = docIds.has(a.id) ? 1 : 0, bd = docIds.has(b.id) ? 1 : 0
    if (ad !== bd) return bd - ad
    const ap = STATUS_PRIO[a.status] ?? 0, bp = STATUS_PRIO[b.status] ?? 0
    if (ap !== bp) return bp - ap
    return a.id.localeCompare(b.id)
  })
  return { keep: sorted[0]!, drop: sorted.slice(1) }
}
