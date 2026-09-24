// EXECUTE privilegije po roli za sve public funkcije. SAMO SELECT.
import pg from "pg"
const url = process.env.PGURL
if (!url) throw new Error("PGURL nije postavljen")
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const r = await client.query(`
    select p.proname as funkcija,
           p.prosecdef as definer,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
           coalesce(array_to_string(p.proacl::text[], ' '), '(default: PUBLIC)') as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname not like 'g%trgm%' and p.proname not like '%similarity%'
      and p.proname not in ('set_limit','show_limit','show_trgm')
    order by p.prosecdef desc, p.proname`)
  console.log("=== EXECUTE privilegije (bez pg_trgm funkcija) ===")
  console.log("funkcija | definer | anon | authenticated | service_role")
  r.rows.forEach((x) => console.log(`  ${x.funkcija} | def=${x.definer} | anon=${x.anon} | auth=${x.authenticated} | svc=${x.service_role}`))
  console.log("\n--- DEFINER funkcije koje 'authenticated' SMIJE izvršiti ---")
  r.rows.filter((x) => x.definer && x.authenticated).forEach((x) => console.log("  " + x.funkcija + "   acl: " + x.acl))
} finally { await client.end() }
