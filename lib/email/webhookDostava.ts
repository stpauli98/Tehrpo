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

/**
 * Adrese koje je neuspjeh stvarno pogodio, iz `data.to` bounce/failed eventa.
 *
 * Jedan `mejl_log` red = jedan Resend send sa više primalaca, a Resend za taj send šalje
 * JEDAN event. Bez ovog podatka cijeli red se boji u „Odbijeno" iako je mejl stigao svima
 * osim jednom (PROD 30.07.2026, kriva jedina `.local` adresa u nizu).
 *
 * Tolerantno prema obliku jer je ulaz tuđi JSON: prihvata niz ili goli string, odbacuje
 * sve što nije neprazan string, dedupira i lowercase-uje radi poređenja sa `primaoci`.
 * Prazan rezultat NIJE tvrdnja da nije bilo pogođenih — `dostavaObim` ga konzervativno
 * čita kao potpun neuspjeh, isto kao i prije ove izmjene.
 */
export function pogodjeneAdrese(to: string[] | string | null | undefined): string[] {
  const sirovo = typeof to === "string" ? [to] : Array.isArray(to) ? to : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of sirovo) {
    if (typeof x !== "string") continue
    const e = x.trim().toLowerCase()
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}
