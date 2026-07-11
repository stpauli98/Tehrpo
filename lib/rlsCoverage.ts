// Provjera RLS pokrivenosti: svaka `public` tabela mora imati RLS uključen I bar jednu politiku.
// Zamjenjuje oslanjanje na cloud-only `ensure_rls` event-trigger (traži supabase_admin, ne ide kroz
// migraciju) — ovdje je deterministična, reproducibilna provjera koja hvata dva footgun-a:
//   (1) RLS isključen na public tabeli (curi svima),
//   (2) RLS uključen bez ijedne politike (tiho vraća 0 redova — "RLS-enabled-but-policyless").
// Koristi je i integracijski test (lib/rlsCoverage.integration.test.ts) i skripta (scripts/check-rls-coverage.ts).

export type TableRow = { schema: string; table: string; rlsEnabled: boolean }
export type PolicyRow = { schema: string; table: string }
export type RlsViolation = { table: string; kind: "rls_disabled" | "no_policy" }

// Tabele koje NAMJERNO imaju RLS uključen bez politike (deny-all; pristup samo preko service-role
// ili SECURITY DEFINER RPC-a). Novu takvu tabelu treba SVJESNO dodati ovdje — inače je provjera obara.
export const RLS_INTENTIONAL_POLICYLESS: readonly string[] = ["termin_zakazano_obavijest"]

export function rlsCoverageViolations(
  tables: TableRow[],
  policies: PolicyRow[],
  allowlist: readonly string[] = RLS_INTENTIONAL_POLICYLESS,
): RlsViolation[] {
  const allow = new Set(allowlist)
  const withPolicy = new Set(policies.filter((p) => p.schema === "public").map((p) => p.table))
  const violations: RlsViolation[] = []
  for (const t of tables) {
    if (t.schema !== "public") continue
    if (!t.rlsEnabled) {
      violations.push({ table: t.table, kind: "rls_disabled" })
      continue
    }
    if (!withPolicy.has(t.table) && !allow.has(t.table)) {
      violations.push({ table: t.table, kind: "no_policy" })
    }
  }
  return violations
}

/** SQL koji vraća redove kompatibilne sa TableRow (relrowsecurity za public tabele). */
export const RLS_TABLES_SQL = `
  select n.nspname as schema, c.relname as "table", c.relrowsecurity as "rlsEnabled"
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname = 'public'
  order by c.relname`

/** SQL koji vraća redove kompatibilne sa PolicyRow (sve politike u public). */
export const RLS_POLICIES_SQL = `
  select schemaname as schema, tablename as "table"
  from pg_policies where schemaname = 'public'`
