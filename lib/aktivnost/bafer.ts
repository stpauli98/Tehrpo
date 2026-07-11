import type { DogadjajUnos } from "./tipovi"

export interface BaferStanje {
  redovi: DogadjajUnos[]
  zadnjiKljuc: string | null
}

export function noviBafer(): BaferStanje {
  return { redovi: [], zadnjiKljuc: null }
}

function kljuc(d: DogadjajUnos): string {
  return `${d.akcija}:${d.entitet ?? ""}:${d.entitet_id ?? ""}:${JSON.stringify(d.detalji ?? {})}`
}

/** Dodaj uz dedup uzastopnog identičnog događaja. Vraća true ako je dodan. */
export function dodaj(stanje: BaferStanje, d: DogadjajUnos): boolean {
  const k = kljuc(d)
  if (k === stanje.zadnjiKljuc) return false
  stanje.redovi.push(d)
  stanje.zadnjiKljuc = k
  return true
}

/** Vrati skupljene redove i očisti bafer (zadnjiKljuc ostaje radi dedupa preko flush-a). */
export function isprazni(stanje: BaferStanje): DogadjajUnos[] {
  const out = stanje.redovi
  stanje.redovi = []
  return out
}
