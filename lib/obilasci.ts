// Whitelist pravih BiH gradova (fold ključ → kanonski oblik za prikaz)
const GRADOVI_BIH: Record<string, string> = {
  "banja luka": "Banja Luka", "bijeljina": "Bijeljina", "brcko": "Brčko",
  "derventa": "Derventa", "doboj": "Doboj", "gradiska": "Gradiška",
  "istocno sarajevo": "Istočno Sarajevo", "prijedor": "Prijedor",
  "prnjavor": "Prnjavor", "trebinje": "Trebinje", "zvornik": "Zvornik",
  "laktasi": "Laktaši", "sarajevo": "Sarajevo", "mostar": "Mostar",
  "tuzla": "Tuzla", "zenica": "Zenica",
}

// lowercase + skini dijakritiku za poređenje s whitelistom
function foldGrad(s: string): string {
  return s
    .toLowerCase()
    .replace(/dž/g, "dz")
    .replace(/[čć]/g, "c")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .replace(/đ/g, "d")
    .trim()
}

/**
 * Izvlači grad iz naziva lokacije (whitelist BiH gradova; market/negeo → null).
 * Zadržava već postavljeni postojeciGrad.
 */
export function izvediGrad(naziv: string | null, postojeciGrad?: string | null): string | null {
  const pg = postojeciGrad?.trim()
  if (pg) return pg
  if (!naziv?.trim()) return null
  let s = naziv.trim()
  if (s.includes(",")) s = s.split(",")[0]!.trim()        // višegradski → prvi
  if (s.includes(" - ")) s = s.split(" - ")[0]!.trim()    // "Grad - Objekat" → grad
  return GRADOVI_BIH[foldGrad(s)] ?? null
}

export type ObilazakItem = {
  id: string
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  lokacija_naziv: string | null
  lokacija_grad: string | null
  rok_dospijeca: string
  status_izvedeni: string
}

export function groupByGrad(items: ObilazakItem[]): { grad: string; items: ObilazakItem[] }[] {
  const map = new Map<string, ObilazakItem[]>()
  for (const it of items) {
    const key = it.lokacija_grad ?? "Bez grada"
    const arr = map.get(key) ?? []
    arr.push(it)
    map.set(key, arr)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "Bez grada") return 1
      if (b === "Bez grada") return -1
      return a.localeCompare(b)
    })
    .map(([grad, items]) => ({ grad, items }))
}
