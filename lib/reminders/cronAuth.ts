import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Konstantno-vremenska usporedba dva stringa. Hešujemo oba na SHA-256 (fiksnih 32 bajta)
 * prije timingSafeEqual da izbjegnemo i curenje DUŽINE (timingSafeEqual baca na različitim
 * dužinama, a rani return na dužini bi bio tajming-kanal).
 */
function sigurnoJednako(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest()
  const hb = createHash("sha256").update(b, "utf8").digest()
  return timingSafeEqual(ha, hb)
}

/** Vercel Cron šalje `Authorization: Bearer $CRON_SECRET`. Fail-closed ako secret nije postavljen. */
export function isCronAuthorized(
  authHeader: string | null,
  secret: string | undefined | null,
): boolean {
  if (!secret) return false
  if (authHeader === null) return false
  // Konstantno-vrijeme: sprječava tajming-napad na pogađanje tajne bajt-po-bajt.
  return sigurnoJednako(authHeader, `Bearer ${secret}`)
}
