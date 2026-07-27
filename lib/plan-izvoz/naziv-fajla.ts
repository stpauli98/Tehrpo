/**
 * Ime fajla za blob-download (S13).
 *
 * Kad se izvoz preuzima kroz `fetch` + `URL.createObjectURL` (umjesto navigacije),
 * pregledač više ne vidi `Content-Disposition` — ime mora ručno na `<a download>`.
 * Zato se header parsira ovdje, sa fallback-om kad ga nema ili je neupotrebljiv.
 */
export function imeIzContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback

  // RFC 5987 (`filename*=UTF-8''ime.pdf`) ima prednost nad golim `filename=`.
  const prosireni = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header)
  const prosireniDio = prosireni?.[1]
  if (prosireniDio) {
    const kandidat = ocisti(dekodiraj(prosireniDio.trim()))
    if (kandidat) return kandidat
  }

  const obicni = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header)
  const obicniDio = obicni ? obicni[2] ?? obicni[1] : undefined
  if (obicniDio !== undefined) {
    const kandidat = ocisti(obicniDio.trim())
    if (kandidat) return kandidat
  }

  return fallback
}

function dekodiraj(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/** Skini putanju i navodnike — ime fajla nikad ne smije nositi separator staze. */
function ocisti(v: string): string {
  const bezPutanje = v.replace(/^["']|["']$/g, "").split(/[\\/]/).pop() ?? ""
  return bezPutanje.trim()
}
