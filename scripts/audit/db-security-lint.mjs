// Read-only reprodukcija Supabase "security advisor" lintova + dodatne RLS provjere.
// Pokretanje:  PGURL="postgres://..." node db-security-lint.mjs
// SAMO SELECT upiti. Nikakvih izmjena.
import pg from "pg"

const url = process.env.PGURL
if (!url) throw new Error("PGURL nije postavljen")

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

const Q = {
  ref: `select current_database() as db, current_user as usr, version() as ver`,

  // 1. Tabele u public: RLS status + broj politika
  tables: `
    select c.relname as tabela,
           c.relrowsecurity as rls_ukljucen,
           c.relforcerowsecurity as rls_forsiran,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as broj_politika
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relrowsecurity, c.relname`,

  // 2. Politike: komanda, role, izraz
  policies: `
    select c.relname as tabela,
           p.polname as politika,
           case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                         when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as komanda,
           coalesce((select string_agg(r.rolname, ',') from pg_roles r where r.oid = any(p.polroles)), 'PUBLIC') as role,
           pg_get_expr(p.polqual, p.polrelid) as using_izraz,
           pg_get_expr(p.polwithcheck, p.polrelid) as with_check_izraz
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by c.relname, p.polname`,

  // 3. View-ovi: security_invoker / security_barrier
  views: `
    select c.relname as view_ime,
           c.relkind as vrsta,
           pg_get_userbyid(c.relowner) as vlasnik,
           coalesce(array_to_string(c.reloptions, ', '), '(nema opcija)') as opcije
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v','m')
    order by c.relkind, c.relname`,

  // 4. SECURITY DEFINER funkcije + search_path
  definers: `
    select p.proname as funkcija,
           pg_get_function_identity_arguments(p.oid) as argumenti,
           p.prosecdef as security_definer,
           coalesce(array_to_string(p.proconfig, ', '), '(NEMA search_path)') as config,
           pg_get_userbyid(p.proowner) as vlasnik
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
    order by p.proname`,

  // 5. Grantovi tabela/viewova ka anon i public
  grants: `
    select table_name, grantee, string_agg(distinct privilege_type, ',' order by privilege_type) as privilegije
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','PUBLIC','authenticated')
    group by table_name, grantee
    order by grantee, table_name`,

  // 6. Ekstenzije u public shemi
  extensions: `
    select e.extname, n.nspname as shema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where n.nspname = 'public'`,

  // 7. Funkcije koje anon smije izvršiti (a SECURITY DEFINER su)
  anonExec: `
    select p.proname as funkcija,
           pg_get_function_identity_arguments(p.oid) as argumenti,
           p.prosecdef as security_definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
    order by p.prosecdef desc, p.proname`,

  // 8. Storage bucketi
  buckets: `select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id`,

  // 9. Storage politike
  storagePolicies: `
    select p.polname as politika,
           case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                         when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as komanda,
           coalesce((select string_agg(r.rolname, ',') from pg_roles r where r.oid = any(p.polroles)), 'PUBLIC') as role,
           pg_get_expr(p.polqual, p.polrelid) as using_izraz
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
    order by p.polname`,
}

function ispis(naslov, rows) {
  console.log(`\n=== ${naslov} (${rows.length}) ===`)
  if (!rows.length) { console.log("  (prazno)"); return }
  for (const r of rows) {
    console.log("  " + Object.entries(r).map(([k, v]) => `${k}=${v === null ? "NULL" : v}`).join(" | "))
  }
}

await client.connect()
try {
  const ref = (await client.query(Q.ref)).rows[0]
  console.log(`BAZA: ${ref.db} | user: ${ref.usr}`)
  console.log(`HOST: ${new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname}`)

  const tables = (await client.query(Q.tables)).rows
  ispis("TABELE u public (RLS status)", tables)

  const bezRls = tables.filter((t) => !t.rls_ukljucen)
  const rlsBezPolitika = tables.filter((t) => t.rls_ukljucen && Number(t.broj_politika) === 0)

  const views = (await client.query(Q.views)).rows
  ispis("VIEW-ovi u public", views)
  const bezInvoker = views.filter((v) => !String(v.opcije).includes("security_invoker=on") && !String(v.opcije).includes("security_invoker=true"))

  const definers = (await client.query(Q.definers)).rows
  ispis("SECURITY DEFINER funkcije", definers)
  const bezSearchPath = definers.filter((d) => !String(d.config).includes("search_path"))

  ispis("POLITIKE", (await client.query(Q.policies)).rows)
  ispis("GRANTOVI (anon/PUBLIC/authenticated)", (await client.query(Q.grants)).rows)
  const anonGrants = (await client.query(Q.grants)).rows.filter((g) => g.grantee === "anon" || g.grantee === "PUBLIC")
  ispis("EKSTENZIJE u public", (await client.query(Q.extensions)).rows)
  ispis("FUNKCIJE izvršive od anon", (await client.query(Q.anonExec)).rows)

  let buckets = []
  let storagePolicies = []
  try { buckets = (await client.query(Q.buckets)).rows } catch (e) { console.log("\n(storage.buckets nedostupan: " + e.message + ")") }
  try { storagePolicies = (await client.query(Q.storagePolicies)).rows } catch (e) { console.log("(storage politike nedostupne: " + e.message + ")") }
  ispis("STORAGE BUCKETI", buckets)
  ispis("STORAGE POLITIKE (storage.objects)", storagePolicies)

  console.log("\n########## SAŽETAK NALAZA ##########")
  console.log(`[rls_disabled_in_public]      tabela bez RLS: ${bezRls.length} -> ${bezRls.map((t) => t.tabela).join(", ") || "-"}`)
  console.log(`[rls_enabled_no_policy]       RLS bez ijedne politike: ${rlsBezPolitika.length} -> ${rlsBezPolitika.map((t) => t.tabela).join(", ") || "-"}`)
  console.log(`[security_definer_view]       view bez security_invoker=on: ${bezInvoker.length} -> ${bezInvoker.map((v) => v.view_ime).join(", ") || "-"}`)
  console.log(`[function_search_path_mutable] DEFINER bez search_path: ${bezSearchPath.length} -> ${bezSearchPath.map((d) => d.funkcija).join(", ") || "-"}`)
  console.log(`[anon_grants]                 grantovi ka anon/PUBLIC: ${anonGrants.length} -> ${anonGrants.map((g) => g.table_name + ":" + g.grantee).join(", ") || "-"}`)
  console.log(`[public_bucket]               javni bucketi: ${buckets.filter((b) => b.public).map((b) => b.id).join(", ") || "-"}`)
} finally {
  await client.end()
}
