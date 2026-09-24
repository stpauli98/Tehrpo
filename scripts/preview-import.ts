/**
 * Kontrolni pregled Excel importa (ništa ne piše u bazu).
 *
 * Upotreba:
 *   pnpm preview:import                 → podrazumijevani Excel (isti kao `pnpm seed`)
 *   pnpm preview:import <putanja.xlsx>  → proizvoljan fajl
 */
import fs from "node:fs"
import path from "node:path"
import { parseTehproExcel } from "@/lib/excel/parser"

// Isti podrazumijevani fajl koji koristi scripts/seed-from-excel.ts
const DEFAULT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx"
)

function razrijesiPutanju(): string {
  const arg = process.argv[2]
  const p = arg ? path.resolve(process.cwd(), arg) : DEFAULT_PATH
  if (!fs.existsSync(p)) {
    console.error(`Excel fajl ne postoji: ${p}`)
    console.error("Proslijedi putanju kao argument: pnpm preview:import <putanja.xlsx>")
    process.exit(1)
  }
  return p
}

async function main() {
  const PATH = razrijesiPutanju()
  console.log("Excel:", PATH)
  const r = await parseTehproExcel(PATH)
  console.log("FIRME (" + r.firme.length + "):", r.firme.sort().join(" | "))
  console.log("\nLOKACIJE (" + r.lokacije.length + "):")
  for (const f of r.firme.sort()) {
    const ls = r.lokacije.filter(l => l.firma_naziv === f).map(l => l.lokacija_naziv)
    if (ls.length) console.log("  " + f + ": " + ls.join(", "))
  }
  console.log("\nVRSTE (" + r.vrste.length + "):", r.vrste.sort().join(" | "))
  console.log("\nTERMINI:", r.termini.length, "| skipped:", r.skipped.length)
  console.log(
    "  izvrseno:", r.termini.filter(t => t.izvor === "izvrseno").length,
    "| planirano:", r.termini.filter(t => t.izvor === "planirano").length,
  )
  console.log("Obilazak termina:", r.termini.filter(t => t.vrsta_naziv === "Obilazak").length)
  // skipped po sheet-u (da čovjek vidi koliko se gubi prije reseed-a)
  const bySheet: Record<string, number> = {}
  for (const s of r.skipped) bySheet[s.sheet] = (bySheet[s.sheet] ?? 0) + 1
  console.log("\nSKIPPED po sheet-u:", JSON.stringify(bySheet))
}

main().catch(e => { console.error(e); process.exit(1) })
