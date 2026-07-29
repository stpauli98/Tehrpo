/**
 * Provjere nad messages/{sr,en,de}.json.
 *
 * next-intl tipizira namespace i ključ prema literalnoj uniji iz JSON-a, pa je
 * neusklađen paritet tvrda tsc greška, ne upozorenje. Više grana paralelno
 * dodaje ključeve u ista tri fajla — svaka sama prolazi, spoj ne mora.
 *
 * ICU kategorija `one` se u srpskom ne koristi (1, 21, 31… idu u `one` po CLDR-u
 * ali katalog je pisan bez nje) — prijavljuje se da ne uđe nezapaženo.
 *
 * Čisto nad podacima: bez dodira s diskom, mrežom i process.env.
 */

export type Katalog = Record<string, unknown>

export type NalazPariteta = {
  kljuc: string
  /** Jezici u kojima ključ nedostaje, sortirano. */
  nedostajeU: string[]
}

/** Ugniježđeni katalog → sortirani parovi [putanja.s.tackama, vrijednost]. */
export function parovi(katalog: Katalog, prefiks = ""): Array<[string, string]> {
  const rezultat: Array<[string, string]> = []

  for (const [kljuc, vrijednost] of Object.entries(katalog)) {
    const puna = prefiks ? `${prefiks}.${kljuc}` : kljuc
    const jeNivo =
      vrijednost !== null && typeof vrijednost === "object" && !Array.isArray(vrijednost)

    if (jeNivo) rezultat.push(...parovi(vrijednost as Katalog, puna))
    else rezultat.push([puna, String(vrijednost)])
  }

  return rezultat.sort((a, b) => a[0].localeCompare(b[0]))
}

/** Samo ključevi, sortirano. */
export function spljosti(katalog: Katalog): string[] {
  return parovi(katalog).map(([kljuc]) => kljuc)
}

/** Ključevi koji ne postoje u svakom od datih kataloga. */
export function nadjiNeparitet(katalozi: Record<string, Katalog>): NalazPariteta[] {
  const jezici = Object.keys(katalozi).sort()
  const poJeziku = new Map(jezici.map((j) => [j, new Set(spljosti(katalozi[j]!))]))

  const svi = new Set<string>()
  for (const skup of poJeziku.values()) for (const kljuc of skup) svi.add(kljuc)

  return [...svi]
    .sort((a, b) => a.localeCompare(b))
    .map((kljuc) => ({
      kljuc,
      nedostajeU: jezici.filter((j) => !poJeziku.get(j)!.has(kljuc)),
    }))
    .filter((nalaz) => nalaz.nedostajeU.length > 0)
}

// `one` kao ICU kategorija: riječ na granici, pa razmaci, pa vitičasta.
const ICU_ONE = /(?:^|[\s,]) *one\s*\{/

/** Ključevi čija poruka koristi ICU kategoriju `one`. */
export function nadjiIcuOne(katalog: Katalog): string[] {
  return parovi(katalog)
    .filter(([, vrijednost]) => ICU_ONE.test(vrijednost))
    .map(([kljuc]) => kljuc)
}
