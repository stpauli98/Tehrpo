import { recipientsForKlijent, type RecipientIndex } from "./recipients"

export type IstekliRed = {
  terminId: string
  klijentId: string
  klijentNaziv: string
  vrstaNaziv: string
  rokDospijeca: string
  datumZakazan: string | null
  ciklusRok: string
  danaDoCiklusa: number
  lokacijaNaziv: string | null
}

/**
 * Grupiše istekle termine po primaocu, koristeći ISTA pravila opsega kao pojedinačni
 * interni podsjetnik — `recipientsForKlijent`. Namjerno nema vlastite logike o tome
 * ko šta smije vidjeti: da je ima, postojala bi dva izvora istine za pravilo koje se
 * mijenja (admini, dodjele, aktivan, prima_podsjetnike, REMINDER_TO).
 *
 * Čista funkcija: nula I/O, pa se sva pravila opsega testiraju bez baze.
 * Redoslijed unutar liste prati ulaz — RPC već sortira po kašnjenju.
 */
export function digestGroups(
  termini: IstekliRed[],
  index: RecipientIndex,
  base: string[],
): Map<string, IstekliRed[]> {
  const mapa = new Map<string, IstekliRed[]>()
  for (const red of termini) {
    for (const email of recipientsForKlijent(index, red.klijentId, base)) {
      const lista = mapa.get(email)
      if (lista) lista.push(red)
      else mapa.set(email, [red])
    }
  }
  return mapa
}
