/**
 * Čišćenje e2e test-artefakata iz cloud baze.
 * - briše junk klijente (E2E Test Klijent / Kontakt Klijent / Brisivi Klijent /
 *   E2E-TMP / E2E Firma / E2E Kontakt / E2E Lokacija / E2E BezLok / …) — cascade lokacije
 * - briše sirotane E2E kontakte i lokacije zakačene na PRAVE klijente
 * - briše throwaway vrste provjera (E2E Vrsta …)
 * - resetuje napomenu koja je test-vrijednost (E2E napomena ...)
 *
 * CILJ JE DEMO. E2E prolaz piše isključivo u DEMO (v. tests/e2e/global-setup.ts
 * guard), pa i čišćenje mora tamo. Do 2026-07-27 je npm skripta učitavala samo
 * `.env.local` (PROD), pa je skripta tiho skenirala produkciju dok se DEMO
 * zatrpavao — 15 zaostalih `E2E-TMP` klijenata je i oborilo ~10 e2e testova
 * koji zavise od seed podataka. Sada `package.json` učitava oba env fajla, s
 * `.env.development.local` POSLIJE (Node: kasniji --env-file pobjeđuje), a
 * ograda ispod odbija da radi ako meta ipak nije DEMO.
 *
 * Pokretanje: pnpm cleanup:test-data
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { zahtijevajCilj } from "../lib/supabase/refs"

// Prefiksi koje e2e specovi zaista koriste za throwaway firme. `finally` blokovi
// su prva odbrana; ovo hvata ostatke kad prolaz bude ubijen (timeout/crash).
// `E2E Firma …` je poseban rizik: /klijenti je sortiran po nazivu, pa nakupljene
// prazne firme istisnu prave iz prvih kartica koje neki specovi skeniraju.
const JUNK_KLIJENT =
  /^(E2E Test Klijent|Kontakt Klijent|Brisivi Klijent|E2E-TMP|E2E Firma|E2E Kontakt|E2E Lokacija|E2E BezLok|E2E Ponavlja|E2E Jednokratno|E2E Bez Intervala|E2E Zakljucan|E2E IDKARTA) /
// Throwaway vrste provjera (spec pravi vlastitu umjesto da mutira pravu).
const JUNK_VRSTA = /^E2E Vrsta /
const JUNK_NAPOMENA = /^E2E napomena /
const JUNK_MEJL = /^\[E2E\] /

async function main() {
  // Ograda prije ijednog upisa: skripta briše redove, pa pogrešna meta nije
  // samo beskorisna nego opasna. Isti obrazac kao scripts/apply-cloud-migration.ts.
  zahtijevajCilj(process.env.NEXT_PUBLIC_SUPABASE_URL, "demo", "cleanup:test-data")
  console.log("✔ cleanup guard: cilj je DEMO")

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
    const { error } = await sb.from("mejl_log").delete().in("id", slice)
    if (error) throw new Error(`delete mejl_log: ${error.message}`)
  }

  // 6) test-kontakti i test-lokacije PRIKAČENI NA PRAVE klijente. Junk klijenti su
  // već obrisani (cascade nosi njihove kontakte/lokacije), pa ovdje ostaju samo
  // redovi koje je neki spec zakačio na stvarnu demo firmu i nije počistio.
  // Lokacija može biti vezana terminima/uslugama (FK restrict) — takav red se
  // preskače uz upozorenje umjesto da obori skriptu.
  const { data: ko, error: koErr } = await sb.from("kontakt_osobe").select("id, ime")
  if (koErr) throw new Error(`select kontakt_osobe: ${koErr.message}`)
  const koIds = (ko ?? []).filter((k) => /^E2E Kontakt /.test(k.ime as string)).map((k) => k.id)
  for (let i = 0; i < koIds.length; i += BATCH) {
    const slice = koIds.slice(i, i + BATCH)
    const { error } = await sb.from("kontakt_osobe").delete().in("id", slice)
    if (error) throw new Error(`delete kontakt_osobe: ${error.message}`)
  }

  const { data: lok, error: lokErr } = await sb.from("lokacije").select("id, naziv")
  if (lokErr) throw new Error(`select lokacije: ${lokErr.message}`)
  const lokIds = (lok ?? []).filter((l) => /^E2E Lokacija /.test(l.naziv as string)).map((l) => l.id)
  let lokObrisano = 0
  for (let i = 0; i < lokIds.length; i += BATCH) {
    const slice = lokIds.slice(i, i + BATCH)
    const { data: del, error } = await sb.from("lokacije").delete().in("id", slice).select("id")
    if (error) console.warn(`⚠️  lokacije: dio redova je vezan (FK) — preskačem (${error.message})`)
    else lokObrisano += del?.length ?? 0
  }

  // 7) throwaway vrste provjera (spec pravi vlastitu umjesto da mutira pravu)
  const { data: vp, error: vpErr } = await sb.from("vrste_provjera").select("id, naziv")
  if (vpErr) throw new Error(`select vrste_provjera: ${vpErr.message}`)
  const vpIds = (vp ?? []).filter((v) => JUNK_VRSTA.test(v.naziv as string)).map((v) => v.id)
  let vpObrisano = 0
  for (let i = 0; i < vpIds.length; i += BATCH) {
    const slice = vpIds.slice(i, i + BATCH)
    const { data: del, error } = await sb.from("vrste_provjera").delete().in("id", slice).select("id")
    if (error) console.warn(`⚠️  vrste_provjera: dio redova je vezan (FK) — preskačem (${error.message})`)
    else vpObrisano += del?.length ?? 0
  }
  console.log(`✔ Sirotani: obrisano ${koIds.length} kontakata, ${lokObrisano} lokacija, ${vpObrisano} vrsta (E2E prefiksi).`)

  const { count } = await sb.from("klijenti").select("id", { count: "exact", head: true })
  console.log(`✅ Klijenti: obrisano ${junkIds.length} junk, resetovano ${napIds.length} napomena (preostalo ${count}). Termini: obrisano ${farIds.length} junk (rok>=2030), resetovano ${tnIds.length} napomena. Mejl log: obrisano ${mejlIds.length} junk ("[E2E] " subject).`)
}

main().catch((e) => {
  console.error("❌", e)
  process.exit(1)
})
