/**
 * In-place dedup postojećih termina: jedan po (klijent,vrsta,lokacija,rok).
 * Čuvar: dokument-bearing > status-prioritet > stabilno. Briše ostale.
 * Pokretanje: pnpm dedup:termini
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { odaberiCuvara, grupaKljuc, type TerminRed } from "../lib/dedup"

async function main() {
  const sb = createAdminSupabaseClient()
  const { data: termini, error } = await sb
    .from("termini")
    .select("id, klijent_id, vrsta_provjere_id, lokacija_id, rok_dospijeca, status")
  if (error) throw new Error(`select termini failed: ${error.message}`)
  const rows = (termini ?? []) as TerminRed[]

  const { data: dok, error: dErr } = await sb.from("dokumenti").select("termin_id")
  if (dErr) throw new Error(`select dokumenti failed: ${dErr.message}`)
  const docIds = new Set((dok ?? []).map((d) => d.termin_id as string).filter(Boolean))

  const grupe = new Map<string, TerminRed[]>()
  for (const t of rows) {
    const k = grupaKljuc(t)
    const a = grupe.get(k) ?? []
    a.push(t)
    grupe.set(k, a)
  }

  const zaBrisanje: string[] = []
  let grupaSaDup = 0
  for (const g of grupe.values()) {
    if (g.length <= 1) continue
    grupaSaDup++
    const { drop } = odaberiCuvara(g, docIds)
    zaBrisanje.push(...drop.map((d) => d.id))
  }

  console.log(`Grupa sa duplikatima: ${grupaSaDup}; za brisanje: ${zaBrisanje.length} redova`)

  const BATCH = 100
  for (let i = 0; i < zaBrisanje.length; i += BATCH) {
    const slice = zaBrisanje.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error: delErr } = await sb.from("termini").delete().in("id", slice)
    if (delErr) throw new Error(`delete batch failed: ${delErr.message}`)
  }

  const { count } = await sb.from("termini").select("id", { count: "exact", head: true })
  console.log(`✅ Gotovo. Obrisano ${zaBrisanje.length}; preostalo termina: ${count}`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
