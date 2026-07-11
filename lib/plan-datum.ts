/** Plan pozicioniranje/upozorenje: poređenje zakazanog datuma i roka. ISO 'YYYY-MM-DD'. */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** True kad je zakazani datum STROGO poslije roka. Prazno/nevažeće → false. */
export function jeZakazanoPoslijeRoka(
  rok: string | null | undefined,
  zakazan: string | null | undefined,
): boolean {
  if (!rok || !zakazan) return false
  const r = rok.slice(0, 10)
  const z = zakazan.slice(0, 10)
  if (!ISO_RE.test(r) || !ISO_RE.test(z)) return false
  return z > r // leksikografsko poređenje ISO datuma
}

/** Broj kalendarskih dana (zakazan − rok). Pozitivan kad je zakazan poslije roka. */
export function danaPoslijeRoka(rok: string, zakazan: string): number {
  const r = Date.UTC(
    Number(rok.slice(0, 4)), Number(rok.slice(5, 7)) - 1, Number(rok.slice(8, 10)),
  )
  const z = Date.UTC(
    Number(zakazan.slice(0, 4)), Number(zakazan.slice(5, 7)) - 1, Number(zakazan.slice(8, 10)),
  )
  return Math.round((z - r) / 86_400_000)
}
