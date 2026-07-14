import type { Database } from "@/db/types"

type MejlDostavaStatus = Database["public"]["Enums"]["mejl_dostava_status"]

const MAPA: Record<string, MejlDostavaStatus> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.failed": "delivery_failed",
  "email.bounced": "bounced",
  "email.complained": "complained",
}

/** Resend event tip → delivery_status. undefined = ignoriši (bez izmjene statusa). */
export function mapirajDostavu(type: string): MejlDostavaStatus | undefined {
  return MAPA[type]
}
