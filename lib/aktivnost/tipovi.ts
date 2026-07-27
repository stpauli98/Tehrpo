/**
 * Jedini izvor liste akcija u aplikativnom kodu (S8.4): iz runtime konstanti se
 * izvode i tipovi, pa `AktivnostFilteri` (select) i `app/api/aktivnost/route.ts`
 * (Zod enum) ne drže vlastite kopije. SQL whitelist u
 * `20260711130000_aktivnost_log.sql` ostaje svjesna odbrambena kopija.
 */
export const AKCIJE_UI = ["NAVIGATE", "VIEW", "LOGIN", "LOGOUT", "FILTER"] as const
export const AKCIJE = ["INSERT", "UPDATE", "DELETE", ...AKCIJE_UI] as const

export type AkcijaUI = (typeof AKCIJE_UI)[number]
export type Akcija = (typeof AKCIJE)[number]

export interface DogadjajUnos {
  akcija: AkcijaUI
  entitet: string | null
  entitet_id: string | null
  detalji: Record<string, unknown> | null
}
