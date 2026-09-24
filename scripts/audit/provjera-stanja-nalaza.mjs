// Pokretanje:  PGURL="postgres://..." node scripts/audit/provjera-stanja-nalaza.mjs
// SAMO SELECT. Javlja koji su nalazi audita od 31.07. jos otvoreni na zivoj bazi.
import pg from "pg"
const url = process.env.PGURL
if (!url) throw new Error("PGURL nije postavljen")
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (s, p = []) => (await c.query(s, p)).rows

console.log("baza:", (await q(`select current_database() db`))[0].db)

// NALAZ 1 — storage_path vezan za klijenta?
const idx = await q(`select indexname from pg_indexes where tablename='dokumenti' and indexdef ilike '%unique%storage_path%'`)
const trg = await q(`select tgname from pg_trigger where tgrelid='public.dokumenti'::regclass and not tgisinternal and tgname='provjeri_storage_path'`)
console.log("\nNALAZ 1 (unakrsni pristup dokumentima):")
console.log("  unique indeks na storage_path:", idx.length ? "DA -> " + idx.map(r=>r.indexname).join(",") : "NE")
console.log("  triger provjeri_storage_path :", trg.length ? "DA" : "NE")
console.log("  => ", idx.length && trg.length ? "ZATVOREN" : "OTVOREN")

// NALAZ 2/3 — definer RPC-ovi: ko smije izvrsiti + ima li internu provjeru
console.log("\nNALAZ 2/3 (DEFINER RPC-ovi):")
for (const fn of ["get_admini","get_aktivni_korisnici","get_zaduzeni_dodjele"]) {
  const r = await q(`
    select p.proname, p.prosecdef,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
           pg_get_functiondef(p.oid) def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=$1`, [fn])
  if (!r.length) { console.log(`  ${fn}: NE POSTOJI`); continue }
  const f = r[0]
  const guard = /je_admin|ima_pristup|auth\.uid\(\)\s*(is not null|=)|raise exception|aktivan/i.test(f.def)
  console.log(`  ${fn}: definer=${f.prosecdef} anon=${f.anon_x} authenticated=${f.auth_x} interna_provjera=${guard ? "DA" : "NE"}`)
}

// NALAZ 8 — preseroki grantovi na tabelama
console.log("\nNALAZ 8 (grantovi anon/authenticated na tabelama):")
const g = await q(`
  select grantee, privilege_type, count(*) n
  from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','authenticated')
  group by grantee, privilege_type order by grantee, privilege_type`)
for (const r of g) console.log(`  ${r.grantee.padEnd(14)} ${r.privilege_type.padEnd(10)} na ${r.n} tabela`)
const opasni = g.filter(r => ["INSERT","UPDATE","DELETE","TRUNCATE"].includes(r.privilege_type))
console.log("  => ", opasni.length ? "JOS SIROKO (ima DML/TRUNCATE)" : "SUZENO")

// NALAZ 6 — traze li politike aktivan nalog
console.log("\nNALAZ 6 (politike traze aktivan nalog):")
const pol = await q(`
  select c.relname tabela, p.polname politika, pg_get_expr(p.polqual, p.polrelid) izraz
  from pg_policy p join pg_class c on c.oid=p.polrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'`)
const bezAktivan = pol.filter(r => r.izraz && /auth\.uid\(\)\s*is not null/i.test(r.izraz) && !/aktivan|je_aktivan/i.test(r.izraz))
console.log(`  ukupno politika: ${pol.length}, sa golim 'auth.uid() is not null' bez provjere aktivnosti: ${bezAktivan.length}`)
for (const r of bezAktivan.slice(0,8)) console.log(`    - ${r.tabela}.${r.politika}`)

await c.end()
