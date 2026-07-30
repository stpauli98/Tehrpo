/**
 * GC: čišćenje ORPHAN fajlova iz Storage bucketa (tehpro-dokumenti).
 * Orphan = fajl u bucketu bez reda u tabeli `dokumenti`.
 *
 * Default = DRY-RUN (samo izvještaj; ništa se ne briše).
 * Stvarno brisanje:        pnpm gc:dokumenti -- --apply
 * Grace (ne diraj svjež):  pnpm gc:dokumenti -- --grace-hours=24   (default 24)
 *
 * Slomljeni redovi (red u bazi, fajl fali) se SAMO prijavljuju — nikad ne brišu.
 */
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { analizirajOrphan } from "../lib/dokumenti-gc"
import { listajFajlove, svePutanjeUBazi, DOKUMENTI_BUCKET } from "../lib/dokumenti/popis"

const apply = process.argv.includes("--apply")
const graceArg = process.argv.find((a) => a.startsWith("--grace-hours="))
const graceHours = graceArg ? Number(graceArg.split("=")[1]) : 24
const graceMs = graceHours * 60 * 60 * 1000

if (!Number.isFinite(graceHours) || graceHours <= 0) {
  console.error(`Neispravan --grace-hours: "${graceArg?.split("=")[1] ?? ""}". Mora biti pozitivan broj (npr. --grace-hours=24).`)
  process.exit(1)
}

const PAGE = 100

async function main() {
  const sb = createAdminSupabaseClient()

  // 1) svi fajlovi u bucketu (rekurzivno kroz klijenti/ ugovori/ termini/)
  //    2) sve putanje iz baze (paginirano + provjera potpunosti)
  //    Oba popisa dolaze iz lib/dokumenti/popis.ts — istu kopiju koristi i noćni cron.
  const bucketObjekti = await listajFajlove(sb)

  const { putanje: dbPutanje, error: popisGreska } = await svePutanjeUBazi(sb)
  if (popisGreska) throw new Error(`select dokumenti: ${popisGreska}`)

  // 3) analiza
  const r = analizirajOrphan({ bucketObjekti, dbPutanje, sada: Date.now(), graceMs })

  console.log(`Bucket fajlova: ${bucketObjekti.length} · DB redova: ${dbPutanje.length}`)
  console.log(`Orphan za brisanje (≥ ${graceHours}h): ${r.orphanFajlovi.length}`)
  console.log(`Svjež orphan, preskočen (< ${graceHours}h): ${r.presvjeziOrphani.length}`)
  console.log(`Slomljeni redovi (fajl fali — SAMO PRIJAVA): ${r.slomljeniRedovi.length}`)
  for (const p of r.slomljeniRedovi) console.warn(`  ⚠ slomljen red → ${p}`)

  if (!apply) {
    console.log("\nDRY-RUN — ništa nije obrisano. Za stvarno brisanje: pnpm gc:dokumenti -- --apply")
    for (const p of r.orphanFajlovi) console.log(`  bi obrisao → ${p}`)
    return
  }

  // 4) stvarno brisanje u batch-evima od 100
  let obrisano = 0
  for (let i = 0; i < r.orphanFajlovi.length; i += PAGE) {
    const grupa = r.orphanFajlovi.slice(i, i + PAGE)
    const { error: delErr } = await sb.storage.from(DOKUMENTI_BUCKET).remove(grupa)
    if (delErr) throw new Error(`remove batch: ${delErr.message}`)
    obrisano += grupa.length
  }
  console.log(`\nObrisano orphan fajlova: ${obrisano}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
