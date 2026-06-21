import { parseTehproExcel } from "@/lib/excel/parser"

const PATH = "/Users/nmil/Desktop/Ai Forward/2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx"

async function main() {
  const r = await parseTehproExcel(PATH)
  console.log("FIRME (" + r.firme.length + "):", r.firme.sort().join(" | "))
  console.log("\nLOKACIJE (" + r.lokacije.length + "):")
  for (const f of r.firme.sort()) {
    const ls = r.lokacije.filter(l => l.firma_naziv === f).map(l => l.lokacija_naziv)
    if (ls.length) console.log("  " + f + ": " + ls.join(", "))
  }
  console.log("\nVRSTE (" + r.vrste.length + "):", r.vrste.sort().join(" | "))
  console.log("\nTERMINI:", r.termini.length, "| skipped:", r.skipped.length)
  console.log("Obilazak termina:", r.termini.filter(t => t.vrsta_naziv === "Obilazak").length)
  // skipped po sheet-u (da čovjek vidi koliko se gubi prije reseed-a)
  const bySheet: Record<string, number> = {}
  for (const s of r.skipped) bySheet[s.sheet] = (bySheet[s.sheet] ?? 0) + 1
  console.log("\nSKIPPED po sheet-u:", JSON.stringify(bySheet))
}

main().catch(e => { console.error(e); process.exit(1) })
