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
