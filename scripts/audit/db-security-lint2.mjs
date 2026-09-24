// Dopuna lintu: storage WITH CHECK izrazi + tijela ključnih sigurnosnih funkcija. SAMO SELECT.
import pg from "pg"
const url = process.env.PGURL
if (!url) throw new Error("PGURL nije postavljen")
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const sp = await client.query(`
    select p.polname,
           case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                         when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as komanda,
           coalesce((select string_agg(r.rolname,',') from pg_roles r where r.oid = any(p.polroles)),'PUBLIC') as role,
           pg_get_expr(p.polqual,p.polrelid) as using_izraz,
           pg_get_expr(p.polwithcheck,p.polrelid) as with_check_izraz
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='storage' order by c.relname, p.polname`)
  console.log("=== STORAGE POLITIKE (pun prikaz) ===")
  sp.rows.forEach((r) => console.log("  " + JSON.stringify(r)))

  const fns = ["ima_pristup_klijentu", "ima_pristup_dokumentu", "je_admin", "je_pregled",
    "smije_brisati_klijente", "smije_brisati_zapis", "smije_zatvoriti_bez_nalaza",
    "get_due_podsjetnici", "get_termini_stats", "get_opterecenje", "get_poslati_mejlovi",
    "get_aktivnost_strana", "azuriraj_mejl_dostavu", "zabiljezi_mejl_log", "oznaci_mejl_pregledan",
    "dodaj_podsjetnik_email", "ukloni_podsjetnik_email", "get_admini", "get_aktivni_korisnici",
    "get_zaduzeni_dodjele", "tekst_u_uuid", "obrisi_stare_dogadjaje", "zabiljezi_dogadjaje"]
  const src = await client.query(
    `select p.proname, p.prosecdef, pg_get_functiondef(p.oid) as def
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname = any($1) order by p.proname`, [fns])
  console.log("\n=== TIJELA SIGURNOSNIH FUNKCIJA ===")
  src.rows.forEach((r) => console.log(`\n----- ${r.proname} (definer=${r.prosecdef}) -----\n${r.def}`))

  const roleSettings = await client.query(
    `select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles
     where rolname in ('anon','authenticated','service_role','authenticator') order by rolname`)
  console.log("\n=== ROLE ===")
  roleSettings.rows.forEach((r) => console.log("  " + JSON.stringify(r)))
} finally { await client.end() }
