/** True ako je raspored datuma ugovora valjan: istek ≥ potpis, ili bilo koji nedostaje. */
export function validUgovorDatumi(potpis: string | null, istek: string | null): boolean {
  if (!potpis || !istek) return true
  return istek >= potpis // ISO YYYY-MM-DD → leksikografsko poređenje = hronološko
}
