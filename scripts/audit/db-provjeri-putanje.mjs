// Provjera da li postojeći redovi krše planirano ograničenje putanje. SAMO SELECT.
import pg from "pg"
const client = new pg.Client({ connectionString: process.env.PGURL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const dup = await client.query(`
    select storage_path, count(*) as broj from dokumenti
    group by storage_path having count(*) > 1`)
  console.log(`Duplikati storage_path: ${dup.rows.length}`)
  dup.rows.forEach((r) => console.log("  " + r.storage_path + " ×" + r.broj))

  const krse = await client.query(`
    select id, klijent_id, termin_id, storage_path from dokumenti
    where not (
         storage_path like 'klijenti/' || klijent_id::text || '/%'
      or (termin_id is not null and storage_path like 'termini/' || termin_id::text || '/%')
    )`)
  console.log(`\nRedovi koji KRŠE planirani CHECK: ${krse.rows.length}`)
  krse.rows.forEach((r) => console.log(`  ${r.storage_path}  (klijent=${r.klijent_id} termin=${r.termin_id})`))

  const uk = await client.query(`select count(*) as n from dokumenti`)
  console.log(`\nUkupno redova: ${uk.rows[0].n}`)

  const oblici = await client.query(`
    select split_part(storage_path, '/', 1) as prefiks, count(*) as broj
    from dokumenti group by 1 order by 2 desc`)
  console.log("Prefiksi:")
  oblici.rows.forEach((r) => console.log(`  ${r.prefiks}: ${r.broj}`))
} finally { await client.end() }
