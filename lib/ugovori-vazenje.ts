/**
 * Trajanje ugovora — preseti + slobodan unos.
 *
 * Yoink 2026-07-30, stavka 6: number input 1–600 zamijenjen je dropdownom sa
 * uobičajenim trajanjima, uz „custom" granu za sve ostalo. DB CHECK
 * (`chk_ugovori_vazenje`) i dalje drži opseg 1–600 — ovo je samo prva linija.
 */

/** Uobičajena trajanja ugovora u mjesecima. */
export const VAZENJE_PRESETI = [6, 12, 24, 36, 60] as const

export const VAZENJE_MIN = 1
export const VAZENJE_MAX = 600

export type VazenjeRezultat = { vazenje: number | null; greska: "opseg" | null }

/**
 * Pretvara izbor iz forme u broj mjeseci.
 *
 * `izbor` je vrijednost dropdowna: preset broj kao string, `"custom"`,
 * `"neodredjeno"`, ili prazno. `custom` je sadržaj slobodnog polja i čita se
 * samo kad je `izbor === "custom"`.
 *
 * Prazan custom NIJE greška — korisnik je izabrao „drugo" pa još nije upisao.
 * Greška je samo nešto upisano što nije cijeli broj u opsegu.
 */
export function normalizujVazenje(izbor: string, custom: string): VazenjeRezultat {
  if (izbor === "neodredjeno" || izbor === "") return { vazenje: null, greska: null }

  const sirovo = izbor === "custom" ? custom.trim() : izbor
  if (sirovo === "") return { vazenje: null, greska: null }

  const n = Number(sirovo)
  if (!Number.isInteger(n) || n < VAZENJE_MIN || n > VAZENJE_MAX) {
    return { vazenje: null, greska: "opseg" }
  }
  return { vazenje: n, greska: null }
}
