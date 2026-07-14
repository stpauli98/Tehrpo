/**
 * Jednokratno čišćenje e2e test-artefakata iz cloud baze.
 * - briše junk klijente (E2E Test Klijent / Kontakt Klijent / Brisivi Klijent / E2E-TMP) — cascade lokacije
 * - resetuje napomenu koja je test-vrijednost (E2E napomena ...)
 * Pokretanje: pnpm cleanup:test-data
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"

const JUNK_KLIJENT = /^(E2E Test Klijent|Kontakt Klijent|Brisivi Klijent|E2E-TMP) /
const JUNK_NAPOMENA = /^E2E napomena /
const JUNK_MEJL = /^\[E2E\] /

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

  // 5) junk mejl_log (E2E test-redovi, subject "[E2E] " prefiks — Task 12 dnevnik mejlova)
  // 42P01 = "relation does not exist": migracija 20260713120000_mejl_log.sql još nije
  // primijenjena na DEMO/PROD (cloud korak je gejtovan, van obima Task 12) — u tom
  // slučaju granu tiho preskoči umjesto da obori cijeli skript (klijenti/termini
  // čišćenje iznad ovog bloka je već izvršeno i ne smije se izgubiti zbog ovoga).
  const { data: mj, error: mjErr } = await sb.from("mejl_log").select("id, subject")
  if (mjErr && mjErr.code !== "42P01") throw new Error(`select mejl_log: ${mjErr.message}`)
  const mejlIds = mjErr
    ? []
    : (mj ?? []).filter((m) => JUNK_MEJL.test(m.subject as string)).map((m) => m.id)
  if (mjErr) {
    console.warn(`⚠️  mejl_log: tabela još ne postoji na ovoj bazi (${mjErr.message}) — preskačem granu.`)
  }
  for (let i = 0; i < mejlIds.length; i += BATCH) {
    const slice = mejlIds.slice(i, i + BATCH)
    // eslint-disable-next-line no-await-in-loop
    const { error } = await sb.from("mejl_log").delete().in("id", slice)
    if (error) throw new Error(`delete mejl_log: ${error.message}`)
  }

  const { count } = await sb.from("klijenti").select("id", { count: "exact", head: true })
  console.log(`✅ Klijenti: obrisano ${junkIds.length} junk, resetovano ${napIds.length} napomena (preostalo ${count}). Termini: obrisano ${farIds.length} junk (rok>=2030), resetovano ${tnIds.length} napomena. Mejl log: obrisano ${mejlIds.length} junk ("[E2E] " subject).`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
