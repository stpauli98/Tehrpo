/**
 * Seed lokalne baze sa Tehpro Excel podacima.
 *
 * Pokretanje:
 *   pnpm seed
 *
 * Idempotentno — pokretanje 2× ne pravi duplikate (upsert onConflict).
 *
 * Redoslijed (FK-safe):
 * 1. delete termini          (CASCADE: podsjetnici/dokumenti)
 * 2. delete klijent_provjere (lokacija_id je NOT NULL + ON DELETE RESTRICT od
 *    migracije 20260703102000 — bez ovoga brisanje lokacija pada; preživjeli
 *    redovi bi ionako pokazivali na obrisane lokacije)
 * 3. delete lokacije         (termini.lokacija_id je SET NULL — ali termini su već obrisani)
 * 4. upsert klijenti       from ParseResult.firme, onConflict naziv
 * 5. upsert vrste_provjera from ParseResult.vrste (includes "Obilazak"),
 *    onConflict naziv; NE postavljati podrazumevani_interval_mjeseci (ostaje NULL)
 * 6. upsert lokacije       from ParseResult.lokacije: {klijent_id, naziv},
 *    onConflict (klijent_id, naziv) [uq_lokacije_klijent_naziv]
 * 7. insert termini        batch ~500:
 *    - klijent_id  = firmaId(firma_naziv)
 *    - lokacija_id = lokId(firmaId + "|" + lokacija_naziv) | null
 *    - izvrseno: datum_zadnjeg + datum_izvrsenja + rok_dospijeca = datum
 *    - planirano:  datum_zakazan + rok_dospijeca = datum
 *    Skip ako firma/vrsta id missing.
 */

import path from "node:path"
import { todayIso } from "../lib/date"
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { parseTehproExcel } from "../lib/excel/parser"

const EXCEL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx"
)

const BATCH = 500

async function main() {
  console.log("📁 Excel:", EXCEL_PATH)
  console.log("🔄 Parsing Excel...")

  const parsed = await parseTehproExcel(EXCEL_PATH)

  console.log(`   Firme:   ${parsed.firme.length}`)
  console.log(`   Lokacije: ${parsed.lokacije.length}`)
  console.log(`   Vrste:   ${parsed.vrste.length}`)
  console.log(`   Termini: ${parsed.termini.length}`)
  console.log(`   Skipped: ${parsed.skipped.length}`)

  if (parsed.skipped.length > 0) {
    console.log(`⚠️  Skipped rows (first 5 od ${parsed.skipped.length}):`)
    parsed.skipped.slice(0, 5).forEach(s =>
      console.log(`   Sheet=${s.sheet} R${s.row} C${s.col}: ${s.reason}`)
    )
  }

  const supabase = createAdminSupabaseClient()

  // ── 1) Delete termini ──────────────────────────────────────────────────────
  console.log("\n🗑️  Brisanje termini...")
  const { error: delTErr } = await supabase
    .from("termini")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (delTErr) throw new Error(`termini delete failed: ${delTErr.message}`)
  console.log("   ✅ termini obrisani")

  // ── 2) Delete klijent_provjere ─────────────────────────────────────────────
  // lokacija_id je NOT NULL + ON DELETE RESTRICT (20260703102000) → mora prije lokacija.
  console.log("\n🗑️  Brisanje klijent_provjere...")
  const { error: delKPErr } = await supabase
    .from("klijent_provjere")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (delKPErr) throw new Error(`klijent_provjere delete failed: ${delKPErr.message}`)
  console.log("   ✅ klijent_provjere obrisane")

  // ── 3) Delete lokacije ─────────────────────────────────────────────────────
  console.log("\n🗑️  Brisanje lokacije...")
  const { error: delLErr } = await supabase
    .from("lokacije")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (delLErr) throw new Error(`lokacije delete failed: ${delLErr.message}`)
  console.log("   ✅ lokacije obrisane")

  // ── 4) Upsert klijenti ─────────────────────────────────────────────────────
  console.log("\n💾 Upsert klijenti...")
  const klijentiRows = parsed.firme.map((naziv: string) => ({ naziv }))
  const { data: klijenti, error: kErr } = await supabase
    .from("klijenti")
    .upsert(klijentiRows, { onConflict: "naziv", ignoreDuplicates: false })
    .select("id, naziv")
  if (kErr) throw new Error(`klijenti upsert failed: ${kErr.message}`)
  const firmaMap = new Map<string, string>((klijenti ?? []).map(k => [k.naziv, k.id]))
  console.log(`   ✅ ${firmaMap.size} klijenata (firmi) u bazi`)

  // ── 5) Upsert vrste_provjera ───────────────────────────────────────────────
  console.log("\n💾 Upsert vrste_provjera...")
  // NOTE: podrazumevani_interval_mjeseci se NE postavlja — ostaje NULL.
  // Korisnik ga unosi u /postavke.
  const vrsteRows = parsed.vrste.map((naziv: string) => ({ naziv }))
  const { data: vrste, error: vErr } = await supabase
    .from("vrste_provjera")
    .upsert(vrsteRows, { onConflict: "naziv", ignoreDuplicates: false })
    .select("id, naziv")
  if (vErr) throw new Error(`vrste_provjera upsert failed: ${vErr.message}`)
  const vrstaMap = new Map<string, string>((vrste ?? []).map(v => [v.naziv, v.id]))
  console.log(`   ✅ ${vrstaMap.size} vrsta provjera u bazi`)

  // ── 6) Upsert lokacije ─────────────────────────────────────────────────────
  console.log("\n💾 Upsert lokacije...")
  type LokacijaRow = { klijent_id: string; naziv: string; grad: string | null }
  const lokacijeRows: LokacijaRow[] = []
  const lokSkipped: string[] = []

  for (const lok of parsed.lokacije) {
    const klijentId = firmaMap.get(lok.firma_naziv)
    if (!klijentId) {
      lokSkipped.push(`${lok.firma_naziv} / ${lok.lokacija_naziv}`)
      continue
    }
    lokacijeRows.push({ klijent_id: klijentId, naziv: lok.lokacija_naziv, grad: lok.grad })
  }

  if (lokSkipped.length > 0) {
    console.warn(`   ⚠️ ${lokSkipped.length} lokacija preskočeno (firma not in DB):`)
    lokSkipped.slice(0, 5).forEach(s => console.warn(`      ${s}`))
  }

  // Upsert in batches (onConflict = uq_lokacije_klijent_naziv unique index)
  const lokMap = new Map<string, string>() // "firmaId|lokNaziv" -> lokacijaId
  for (let i = 0; i < lokacijeRows.length; i += BATCH) {
    const batch = lokacijeRows.slice(i, i + BATCH)
    const { data: upsertedLok, error: lErr } = await supabase
      .from("lokacije")
      .upsert(batch, { onConflict: "klijent_id,naziv", ignoreDuplicates: false })
      .select("id, klijent_id, naziv")
    if (lErr) throw new Error(`lokacije upsert failed: ${lErr.message}`)
    for (const l of upsertedLok ?? []) {
      lokMap.set(`${l.klijent_id}|${l.naziv}`, l.id)
    }
  }
  console.log(`   ✅ ${lokMap.size} lokacija u bazi`)

  // ── 7) Insert termini ──────────────────────────────────────────────────────
  console.log("\n💾 Inserting termini...")

  type TerminIzvrseno = {
    klijent_id: string
    lokacija_id: string | null
    vrsta_provjere_id: string
    datum_zadnjeg: string
    datum_izvrsenja: string
    rok_dospijeca: string
    status: "izvrseno"
  }
  type TerminPlanirano = {
    klijent_id: string
    lokacija_id: string | null
    vrsta_provjere_id: string
    datum_zakazan: string
    rok_dospijeca: string
    status: "planirano"
  }
  type TerminRow = TerminIzvrseno | TerminPlanirano

  const terminiRows: TerminRow[] = []
  const terminiSkippedFK: string[] = []
  const todayStr = todayIso() // "YYYY-MM-DD", zidni datum u APP_TIME_ZONE (Europe/Belgrade)

  for (const t of parsed.termini) {
    const klijentId = firmaMap.get(t.firma_naziv)
    const vrstaId = vrstaMap.get(t.vrsta_naziv)

    if (!klijentId || !vrstaId) {
      terminiSkippedFK.push(`${t.firma_naziv} / ${t.vrsta_naziv}`)
      continue
    }

    // Resolve lokacija_id (nullable)
    let lokacijaId: string | null = null
    if (t.lokacija_naziv != null) {
      lokacijaId = lokMap.get(`${klijentId}|${t.lokacija_naziv}`) ?? null
    }

    // chk_termini_datumi: datum_izvrsenja <= CURRENT_DATE
    // Future "izvrseno" dates in Excel are treated as planirano to satisfy the constraint.
    const isReallyIzvrseno = t.izvor === "izvrseno" && t.datum <= todayStr

    if (isReallyIzvrseno) {
      // PAŽNJA (od 2026-07-30): auto-ciklus se okida i na INSERT-u termina sa
      // `status: "izvrseno"`, ne samo na prelazu u izvršeno. Na djevičanskom importu je
      // bezopasno — vrste provjere još nemaju `interval_mjeseci`, pa trigger nema šta da
      // izračuna. Ali ponovni seed NAKON što admin podesi podrazumijevane intervale
      // generiše naredne termine koji dupliraju planirane redove iz samog Excela.
      // Lijek poslije takvog re-importa: `pnpm dedup:termini`.
      terminiRows.push({
        klijent_id: klijentId,
        lokacija_id: lokacijaId,
        vrsta_provjere_id: vrstaId,
        datum_zadnjeg: t.datum,
        datum_izvrsenja: t.datum,
        // rok_dospijeca NOT NULL — use same date (trigger tg_termini_compute_rok
        // may overwrite if interval is set, but seed leaves interval NULL)
        rok_dospijeca: t.datum,
        status: "izvrseno",
      })
    } else {
      terminiRows.push({
        klijent_id: klijentId,
        lokacija_id: lokacijaId,
        vrsta_provjere_id: vrstaId,
        datum_zakazan: t.datum,
        rok_dospijeca: t.datum,
        status: "planirano",
      })
    }
  }

  if (terminiSkippedFK.length > 0) {
    console.warn(`   ⚠️ ${terminiSkippedFK.length} termina preskočeno (missing FK — first 5):`)
    terminiSkippedFK.slice(0, 5).forEach(s => console.warn(`      ${s}`))
  }

  let inserted = 0
  for (let i = 0; i < terminiRows.length; i += BATCH) {
    const batch = terminiRows.slice(i, i + BATCH)
    const { error: tErr, count } = await supabase
      .from("termini")
      .insert(batch, { count: "exact" })
    if (tErr) throw new Error(`termini insert failed at batch ${Math.floor(i / BATCH) + 1}: ${tErr.message}`)
    inserted += count ?? batch.length
  }
  console.log(`   ✅ ${inserted} termina insertovano`)

  console.log("\n✅ Seed gotov.")
  console.log(
    `   Firme: ${firmaMap.size} | Lokacije: ${lokMap.size} | Vrste: ${vrstaMap.size} | Termini: ${inserted} | Skipped Excel: ${parsed.skipped.length}`
  )
}

main().catch(err => {
  console.error("❌ Seed failed:", err)
  process.exit(1)
})
