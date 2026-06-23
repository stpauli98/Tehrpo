/**
 * Backfill lokacije.grad iz naziva lokacije (izvediGrad).
 * Ne dira termine; termini_view već izlaže lokacija_grad.
 * Pokretanje: pnpm backfill:grad
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { izvediGrad } from "../lib/obilasci"

async function main() {
  const sb = createAdminSupabaseClient()
  const { data, error } = await sb.from("lokacije").select("id, naziv, grad")
  if (error) throw new Error(`select lokacije failed: ${error.message}`)
  const lokacije = data ?? []

  let azurirano = 0
  let bezGrada = 0
  const dist: Record<string, number> = {}

  for (const l of lokacije) {
    const noviGrad = izvediGrad(l.naziv as string | null, l.grad as string | null)
    const trenutni = (l.grad as string | null) ?? null
    if (noviGrad !== trenutni) {
      // eslint-disable-next-line no-await-in-loop
      const { error: upErr } = await sb
        .from("lokacije")
        .update({ grad: noviGrad })
        .eq("id", l.id)
      if (upErr) throw new Error(`update ${l.id} failed: ${upErr.message}`)
      azurirano++
    }
    if (noviGrad) dist[noviGrad] = (dist[noviGrad] ?? 0) + 1
    else bezGrada++
  }

  console.log(`✅ Backfill gotov: ${azurirano} ažurirano, ${lokacije.length} ukupno`)
  console.log(`   Bez grada: ${bezGrada}`)
  console.log(`   Distribucija:`, dist)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
