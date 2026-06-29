/** Vercel Cron šalje `Authorization: Bearer $CRON_SECRET`. Fail-closed ako secret nije postavljen. */
export function isCronAuthorized(
  authHeader: string | null,
  secret: string | undefined | null,
): boolean {
  if (!secret) return false
  return authHeader === `Bearer ${secret}`
}
