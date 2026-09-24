// Da li bi kompozitni FK dokumenti(termin_id,klijent_id) -> termini(id,klijent_id) prošao? SAMO SELECT.
import pg from "pg"
const client = new pg.Client({ connectionString: process.env.PGURL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const nesklad = await client.query(`
    select d.id, d.klijent_id as dok_klijent, t.klijent_id as termin_klijent, d.storage_path
    from dokumenti d join termini t on t.id = d.termin_id
    where d.klijent_id is distinct from t.klijent_id`)
  console.log(`Dokumenti čiji termin pripada DRUGOJ firmi: ${nesklad.rows.length}`)
  nesklad.rows.forEach((r) => console.log("  " + JSON.stringify(r)))

  const nullKlijent = await client.query(
    `select count(*) as n from dokumenti where klijent_id is null`)
  console.log(`Dokumenti sa klijent_id = NULL: ${nullKlijent.rows[0].n}`)

  const sTerminom = await client.query(
    `select count(*) as n from dokumenti where termin_id is not null`)
  console.log(`Dokumenti sa termin_id: ${sTerminom.rows[0].n}`)

  const uq = await client.query(`
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid='public.termini'::regclass and contype in ('u','p')`)
  console.log("Postojeći unique/PK na termini:")
  uq.rows.forEach((r) => console.log(`  ${r.conname}: ${r.def}`))

  const kolone = await client.query(`
    select column_name, is_nullable from information_schema.columns
    where table_schema='public' and table_name='dokumenti'
      and column_name in ('klijent_id','termin_id','ugovor_id','storage_path')`)
  console.log("Kolone dokumenti:")
  kolone.rows.forEach((r) => console.log(`  ${r.column_name} nullable=${r.is_nullable}`))
} finally { await client.end() }
