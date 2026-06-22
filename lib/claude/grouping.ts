export type GrupaKlijent = { klijent: string; ukupno: number; kasni: number }

/** Grupiše termine po klijentu; sortira po broju kasnih (pa po ukupno) opadajuće. */
export function grupisiPoKlijentu(
  termini: Array<{ klijent_naziv: string | null; status_izvedeni: string | null }>,
): GrupaKlijent[] {
  const map = new Map<string, GrupaKlijent>()
  for (const t of termini) {
    const klijent = t.klijent_naziv ?? "—"
    const g = map.get(klijent) ?? { klijent, ukupno: 0, kasni: 0 }
    g.ukupno += 1
    if (t.status_izvedeni === "kasni") g.kasni += 1
    map.set(klijent, g)
  }
  return [...map.values()].sort((a, b) => b.kasni - a.kasni || b.ukupno - a.ukupno)
}
