/**
 * Kadenca sedmičnog digesta.
 *
 * Ulaz je uvijek LOKALNI BEČKI datum kao ISO string ("2026-07-20"), izračunat
 * u lokalniSatIDatum. Dan u sedmici se izvodi aritmetikom nad tim datumom, bez
 * Intl-a i bez oslanjanja na zonu procesa: Intl sa weekday daje lokalizovane
 * stringove i zavisi od locale-a, što je očekivano mjesto za bug.
 */

const PRAG_ZAGLAVLJENOG_MS = 15 * 60 * 1000

/** Je li dati bečki ISO datum ponedjeljak. */
export function jePonedjeljak(beckiDatum: string): boolean {
  return new Date(`${beckiDatum}T00:00:00Z`).getUTCDay() === 1
}

function danaIzmedju(od: string, do_: string): number {
  const a = Date.parse(`${od}T00:00:00Z`)
  const b = Date.parse(`${do_}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * Treba li ovom primaocu poslati digest danas.
 *
 * Dvije nezavisne provjere:
 *  1. je li danas već obrađen — 'poslato' zatvara dan, a 'u_toku' zatvara samo
 *     dok je svjež; zaglavljen claim stariji od 15 min mora biti dostižan, inače
 *     bi pad slanja progutao digest do sljedeće sedmice,
 *  2. kadenca — ponedjeljak, ili oporavak kad je posljednji stariji od 7 dana.
 *     Primalac koji nikad nije dobio digest čeka ponedjeljak.
 */
export function trebaDigest(args: {
  danas: string
  zadnjiPoslat: string | null
  danasnji: { stanje: string; claimedAt: string } | null
  now: Date
}): boolean {
  const { danas, zadnjiPoslat, danasnji, now } = args

  if (danasnji) {
    if (danasnji.stanje === "poslato") return false
    if (danasnji.stanje === "u_toku") {
      const star = now.getTime() - Date.parse(danasnji.claimedAt)
      if (star < PRAG_ZAGLAVLJENOG_MS) return false
    }
  }

  if (jePonedjeljak(danas)) return true
  if (!zadnjiPoslat) return false
  return danaIzmedju(zadnjiPoslat, danas) >= 7
}
