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
import { analizirajOrphan, type StorageObjekat } from "../lib/dokumenti-gc"

const DOKUMENTI_BUCKET = "tehpro-dokumenti"
const apply = process.argv.includes("--apply")
const graceArg = process.argv.find((a) => a.startsWith("--grace-hours="))
const graceHours = graceArg ? Number(graceArg.split("=")[1]) : 24
const graceMs = graceHours * 60 * 60 * 1000

type Sb = ReturnType<typeof createAdminSupabaseClient>
const PAGE = 100

// Rekurzivno izlistaj sve FAJLOVE ispod prefiksa. Folderi imaju id === null.
async function listajFajlove(sb: Sb, prefix: string): Promise<StorageObjekat[]> {
  const rezultat: StorageObjekat[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await sb.storage
      .from(DOKUMENTI_BUCKET)
      .list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`list "${prefix}": ${error.message}`)
    const stavke = data ?? []
    for (const s of stavke) {
      const puniPut = prefix ? `${prefix}/${s.name}` : s.name
      if (s.id === null) {
        const ugnijezdeni = await listajFajlove(sb, puniPut) // folder → rekurzija
        rezultat.push(...ugnijezdeni)
      } else {
        rezultat.push({
          path: puniPut,
          updatedAt: s.updated_at ?? s.created_at ?? new Date(0).toISOString(),
        })
      }
    }
    if (stavke.length < PAGE) break
    offset += PAGE
  }
  return rezultat
}

async function main() {
  const sb = createAdminSupabaseClient()

  // 1) svi fajlovi u bucketu (rekurzivno kroz klijenti/ ugovori/ termini/)
  const bucketObjekti = await listajFajlove(sb, "")

  // 2) sve putanje iz baze
  const { data: dok, error } = await sb.from("dokumenti").select("storage_path")
  if (error) throw new Error(`select dokumenti: ${error.message}`)
  const dbPutanje = (dok ?? []).map((d) => d.storage_path as string)

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
