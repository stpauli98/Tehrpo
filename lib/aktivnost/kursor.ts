// Keyset kursor za Aktivnost: (vrijeme, id) posljednjeg prikazanog reda.
// Namjerno bez ijednog importa iz lib/supabase — ovaj modul mora biti čist,
// da ga vitest (node env) može testirati bez podizanja klijenta.

export type AktivnostKursor = { vrijeme: string; id: number }

/** Kursor za sljedeću porciju = posljednji red trenutne porcije. */
export function kursorOd(redovi: { vrijeme: string; id: number }[]): AktivnostKursor | null {
  const zadnji = redovi[redovi.length - 1]
  return zadnji ? { vrijeme: zadnji.vrijeme, id: zadnji.id } : null
}

/**
 * Kursor iz query stringa. Pokvaren kursor NIJE greška — vraća null, što znači
 * „prva porcija". Isti princip kao sanitacija datuma: ručno pokvaren URL ne smije
 * srušiti stranicu.
 */
export function parsirajKursor(
  vrijeme: string | undefined,
  id: string | undefined,
): AktivnostKursor | null {
  if (!vrijeme || !id) return null
  if (!/^-?\d+$/.test(id)) return null
  const broj = Number(id)
  if (!Number.isSafeInteger(broj)) return null
  if (Number.isNaN(new Date(vrijeme).getTime())) return null
  return { vrijeme, id: broj }
}
