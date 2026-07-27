/**
 * Čiste funkcije domena Klijenti.
 *
 * `normalizujNaziv` je zajednički ključ za app-nivo dedup provjeru lokacija i
 * kontakata (S8.7): „  Skladište  " i „skladište" su isti unos za korisnika, pa
 * ih i provjera mora tako vidjeti. Prava UNIQUE ograda u bazi je van obima
 * tab-grane (ide kroz lockstep migracioni PR) — ovo zatvara UX dio.
 */
export function normalizujNaziv(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase()
}
