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

  // junk klijenti mogu nositi termine (throwaway iz 03-termini nakon crash-a) → prvo termini (FK restrict)
  if (junkIds.length) {
    const { error: jtErr } = await sb.from("termini").delete().in("klijent_id", junkIds)
    if (jtErr) throw new Error(`delete junk-klijent termini: ${jtErr.message}`)
  }

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

  // 3) junk termini (rok >= 2030 — test-kreirani; pravi su 2026)
  const { data: far, error: fErr } = await sb.from("termini").select("id").gte("rok_dospijeca", "2030-01-01")
  if (fErr) throw new Error(`select far termini: ${fErr.message}`)
  const farIds = (far ?? []).map((t) => t.id)
  for (let i = 0; i < farIds.length; i += BATCH) {
    const slice = farIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("termini").delete().in("id", slice)
    if (error) throw new Error(`delete termini: ${error.message}`)
  }

  // 4) test-napomene na terminima → null
  const { data: tn, error: tErr } = await sb.from("termini").select("id, napomena").not("napomena", "is", null)
  if (tErr) throw new Error(`select termin napomene: ${tErr.message}`)
  const tnIds = (tn ?? []).filter((t) => /E2E/i.test(t.napomena as string)).map((t) => t.id)
  for (let i = 0; i < tnIds.length; i += BATCH) {
    const slice = tnIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("termini").update({ napomena: null }).in("id", slice)
    if (error) throw new Error(`update termin napomene: ${error.message}`)
  }

  const { count } = await sb.from("klijenti").select("id", { count: "exact", head: true })
  console.log(`✅ Klijenti: obrisano ${junkIds.length} junk, resetovano ${napIds.length} napomena (preostalo ${count}). Termini: obrisano ${farIds.length} junk (rok>=2030), resetovano ${tnIds.length} napomena.`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
