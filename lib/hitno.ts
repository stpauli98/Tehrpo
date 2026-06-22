export type RokTon = "danger" | "warning"
export type RokOznaka = { text: string; tone: RokTon }

// Cijeli dani od a do b (b - a); ulazi su ISO "YYYY-MM-DD".
function danaIzmedju(aIso: string, bIso: string): number {
  const a = Date.UTC(+aIso.slice(0, 4), +aIso.slice(5, 7) - 1, +aIso.slice(8, 10))
  const b = Date.UTC(+bIso.slice(0, 4), +bIso.slice(5, 7) - 1, +bIso.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

function danRijec(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? "dan" : "dana"
}

export function rokRelativnaOznaka(rokIso: string, todayIso: string): RokOznaka {
  const dani = danaIzmedju(todayIso, rokIso) // rok - danas
  if (dani < 0) {
    const n = -dani
    return { text: `kasni ${n} ${danRijec(n)}`, tone: "danger" }
  }
  if (dani === 0) return { text: "danas", tone: "danger" }
  return { text: `za ${dani} ${danRijec(dani)}`, tone: "warning" }
}
