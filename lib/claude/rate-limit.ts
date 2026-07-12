// Rate-limit za AI chat: sliding-window nad vlastitim user porukama (chat_poruke).
// Bez nove infrastrukture — brojanje ide kroz SSR/RLS klijent u ruti.
export const RATE_LIMIT_PER_MIN = 20
export const RATE_LIMIT_PER_DAY = 400

/** ISO pragovi za brojanje: poruke novije od (now - 60s) i (now - 24h). */
export function rateLimitWindows(nowMs: number): { minuteAgo: string; dayAgo: string } {
  return {
    minuteAgo: new Date(nowMs - 60_000).toISOString(),
    dayAgo: new Date(nowMs - 86_400_000).toISOString(),
  }
}

/** Prekoračen limit ako je broj poruka u minutnom ili dnevnom prozoru dostigao prag. */
export function prekoracenLimit(perMin: number, perDay: number): boolean {
  return perMin >= RATE_LIMIT_PER_MIN || perDay >= RATE_LIMIT_PER_DAY
}
