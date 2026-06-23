/**
 * Jednokratno čišćenje e2e test-artefakata iz cloud baze.
 * - briše junk klijente (E2E Test Klijent / Kontakt Klijent / Brisivi Klijent / E2E-TMP) — cascade lokacije
 * - resetuje napomenu koja je test-vrijednost (E2E napomena ...)
 * Pokretanje: pnpm cleanup:test-data
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"

const JUNK_KLIJENT = /^(E2E Test Klijent|Kontakt Klijent|Brisivi Klijent|E2E-TMP) /
const JUNK_NAPOMENA = /^E2E napomena /

async function main() {
  const sb = createAdminSupabaseClient()

  // 1) junk klijenti → delete (cascade lokacije)
  const { data: kl, error: kErr } = await sb.from("klijenti").select("id, naziv")
  if (kErr) throw new Error(`select klijenti: ${kErr.message}`)
  const junkIds = (kl ?? []).filter((k) => JUNK_KLIJENT.test(k.naziv as string)).map((k) => k.id)

  const BATCH = 100
  for (let i = 0; i < junkIds.length; i += BATCH) {
    const slice = junkIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("klijenti").delete().in("id", slice)
    if (error) throw new Error(`delete klijenti: ${error.message}`)
  }

  // 2) test-napomene → null
  const { data: kn, error: nErr } = await sb.from("klijenti").select("id, napomena")
  if (nErr) throw new Error(`select napomene: ${nErr.message}`)
  const napIds = (kn ?? [])
    .filter((k) => typeof k.napomena === "string" && JUNK_NAPOMENA.test(k.napomena))
    .map((k) => k.id)
  for (let i = 0; i < napIds.length; i += BATCH) {
    const slice = napIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("klijenti").update({ napomena: null }).in("id", slice)
    if (error) throw new Error(`update napomene: ${error.message}`)
  }

  const { count } = await sb.from("klijenti").select("id", { count: "exact", head: true })
  console.log(`✅ Obrisano ${junkIds.length} junk klijenata; resetovano ${napIds.length} napomena; preostalo klijenata: ${count}`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
