/**
 * Seed lokalne baze sa Tehpro Excel podacima.
 *
 * Pokretanje:
 *   pnpm seed
 *
 * Idempotentno — pokretanje 2× ne pravi duplikate (.upsert na naziv).
 *
 * Strategija:
 * 1. Parse Excel → ParseResult
 * 2. Upsert sve jedinstvene klijente (po naziv, UNIQUE constraint)
 * 3. Upsert sve jedinstvene vrste_provjera (po naziv, UNIQUE constraint)
 * 4. Delete existing termini + Insert svaki put (clean state)
 *    - izvrseno: datum_zadnjeg + datum_izvrsenja = datum; trigger compute_rok računa rok
 *    - planirano: datum_zakazan = datum; rok_dospijeca = datum (nema triggera bez datum_zadnjeg)
 */

import path from "node:path"
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { parseTehproExcel } from "../lib/excel/parser"

// Excel je u parent direktoriju projekta (sibling od tehpro-mvp/)
const EXCEL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx"
)

async function main() {
  console.log("📁 Excel:", EXCEL_PATH)
  console.log("🔄 Parsing Excel...")

  const parsed = await parseTehproExcel(EXCEL_PATH)

  console.log(`   ${parsed.firme.length} firmi`)
  console.log(`   ${parsed.vrste.length} vrsta provjera`)
  console.log(`   ${parsed.termini.length} termina`)
  console.log(`   ${parsed.skipped.length} skipped rows`)

  if (parsed.skipped.length > 0) {
    console.log("⚠️  Skipped rows (first 5 od ukupno " + parsed.skipped.length + "):")
    parsed.skipped.slice(0, 5).forEach(s =>
      console.log(`   Sheet=${s.sheet} R${s.row} C${s.col}: ${s.reason}`)
    )
  }

  const supabase = createAdminSupabaseClient()

  // ── 1) Upsert klijenti ────────────────────────────────────────────────────
  // NOTE: Task 3 (seed rewrite) will handle firma→klijent mapping properly.
  // This is a temporary stub that compiles until Task 3 rewrites this script.
  console.log("\n💾 Upserting klijenti (stub — see Task 3 for full firma/lokacija seed)...")
  const klijentiRows = parsed.firme.map((naziv: string) => ({ naziv }))
  const { data: klijenti, error: kErr } = await supabase
    .from("klijenti")
    .upsert(klijentiRows, { onConflict: "naziv", ignoreDuplicates: false })
    .select("id, naziv")
  if (kErr) throw new Error(`klijenti upsert failed: ${kErr.message}`)
  const klijentiMap = new Map((klijenti ?? []).map(k => [k.naziv, k.id]))
  console.log(`   ✅ ${klijentiMap.size} klijenata u bazi`)

  // ── 2) Upsert vrste_provjera ──────────────────────────────────────────────
  console.log("\n💾 Upserting vrste_provjera...")
  const vrsteRows = parsed.vrste.map(naziv => ({ naziv }))
  const { data: vrste, error: vErr } = await supabase
    .from("vrste_provjera")
    .upsert(vrsteRows, { onConflict: "naziv", ignoreDuplicates: false })
    .select("id, naziv")
  if (vErr) throw new Error(`vrste upsert failed: ${vErr.message}`)
  const vrsteMap = new Map((vrste ?? []).map(v => [v.naziv, v.id]))
  console.log(`   ✅ ${vrsteMap.size} vrsta u bazi`)

  // ── 3) Delete existing termini za clean seed ──────────────────────────────
  console.log("\n🗑️  Brisanje postojećih termina za clean seed...")
  const { error: delErr } = await supabase
    .from("termini")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (delErr) throw new Error(`termini delete failed: ${delErr.message}`)

  // ── 4) Build termini rows ─────────────────────────────────────────────────
  console.log("\n💾 Inserting termini...")
  const todayStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const skippedFK: string[] = []
  type TerminRow =
    | { klijent_id: string; vrsta_provjere_id: string; datum_zadnjeg: string; datum_izvrsenja: string; rok_dospijeca: string; status: "izvrseno" }
    | { klijent_id: string; vrsta_provjere_id: string; datum_zakazan: string; rok_dospijeca: string; status: "planirano" }

  const terminiRows = parsed.termini.flatMap<TerminRow>(t => {
    const klijentId = klijentiMap.get(t.firma_naziv)
    const vrstaId = vrsteMap.get(t.vrsta_naziv)
    if (!klijentId || !vrstaId) {
      skippedFK.push(`${t.firma_naziv} / ${t.vrsta_naziv}`)
      return []
    }

    const isPast = t.datum <= todayStr

    if (t.izvor === "izvrseno" && isPast) {
      // Past izvrseno — record the completion. Trigger compute_rok calculates next due date.
      return [{
        klijent_id: klijentId,
        vrsta_provjere_id: vrstaId,
        datum_zadnjeg: t.datum,
        datum_izvrsenja: t.datum,
        // rok_dospijeca fallback (trigger prepiše BEFORE insert if interval exists)
        rok_dospijeca: t.datum,
        status: "izvrseno" as const,
      }]
    } else {
      // planirano (both explicit "planirano" and future "izvrseno" that can't be marked done)
      // datum_zakazan = plan datum, rok_dospijeca = isti datum
      // (trigger compute_rok ne pali jer datum_zadnjeg = null)
      return [{
        klijent_id: klijentId,
        vrsta_provjere_id: vrstaId,
        datum_zakazan: t.datum,
        rok_dospijeca: t.datum,
        status: "planirano" as const,
      }]
    }
  })

  if (skippedFK.length > 0) {
    console.warn(`   ⚠️ ${skippedFK.length} termina preskočeno zbog missing FK (first 5):`)
    skippedFK.slice(0, 5).forEach(s => console.warn(`      ${s}`))
  }

  // Bulk insert u batch-ovima od 500
  let inserted = 0
  for (let i = 0; i < terminiRows.length; i += 500) {
    const batch = terminiRows.slice(i, i + 500)
    const { error: tErr, count } = await supabase
      .from("termini")
      .insert(batch, { count: "exact" })
    if (tErr) throw new Error(`termini insert failed at batch ${i / 500 + 1}: ${tErr.message}`)
    inserted += count ?? batch.length
  }
  console.log(`   ✅ ${inserted} termina insertovano`)

  console.log("\n✅ Seed gotov.")
  console.log(`   Firme: ${klijentiMap.size} | Vrste: ${vrsteMap.size} | Termini: ${inserted} | Skipped Excel: ${parsed.skipped.length}`)
}

main().catch(err => {
  console.error("❌ Seed failed:", err)
  process.exit(1)
})
