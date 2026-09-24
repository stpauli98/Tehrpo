// Provjera: da li je dokumenti.storage_path vezan za klijent_id (unique/check). SAMO SELECT.
import pg from "pg"
const client = new pg.Client({ connectionString: process.env.PGURL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const c = await client.query(`
    select conname, contype, pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid = 'public.dokumenti'::regclass order by conname`)
  console.log("=== OGRANIČENJA na dokumenti ===")
  c.rows.forEach((r) => console.log(`  ${r.conname} [${r.contype}] ${r.def}`))
  const i = await client.query(`select indexdef from pg_indexes where schemaname='public' and tablename='dokumenti'`)
  console.log("=== INDEKSI na dokumenti ===")
  i.rows.forEach((r) => console.log("  " + r.indexdef))
  const t = await client.query(`
    select tgname, pg_get_triggerdef(oid) as def from pg_trigger
    where tgrelid='public.dokumenti'::regclass and not tgisinternal`)
  console.log("=== TRIGERI na dokumenti ===")
  t.rows.forEach((r) => console.log("  " + r.def))
  const dup = await client.query(`
    select count(*) as ukupno, count(distinct storage_path) as razlicitih from dokumenti`)
  console.log("=== storage_path jedinstvenost u podacima ===")
  console.log("  " + JSON.stringify(dup.rows[0]))
} finally { await client.end() }
