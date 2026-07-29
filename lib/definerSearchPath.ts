// Provjera da nijedna `security definer` funkcija u `public` nema search_path bez `pg_temp`.
//
// ZAŠTO: PostgreSQL pretražuje `pg_temp` PRVI, prije svega ostalog, osim ako je
// pg_temp eksplicitno naveden u search_path-u — tada važi navedena pozicija.
// Funkcija sa `set search_path = public` dakle i dalje prvo gleda pg_temp. Kako
// prijavljen korisnik smije praviti temp tabele, može podmetnuti `pg_temp.korisnici`
// i preusmjeriti definer funkciju na svoje podatke. Reprodukovano na DEMO 2026-07-29:
// `je_admin()` je prešao iz false u true, a direktan select iz `audit_log` je operateru
// vratio redove. Popravka je navesti `public, pg_temp` — pg_temp POSLJEDNJI.
//
// Zašto samo `security definer`: invoker funkcije se izvršavaju s pravima pozivaoca,
// pa podmetanje ne donosi eskalaciju privilegija — samo štetu samom sebi.
//
// Koristi je i integracijski test (lib/definerSearchPath.integration.test.ts) i
// skripta (scripts/check-rls-coverage.ts), isti obrazac kao rlsCoverage.

export type FunctionRow = {
  schema: string
  name: string
  args: string
  /** `proconfig` kakav vraća Postgres, npr. ["search_path=public"]. null ako nije postavljen. */
  config: string[] | null
}

export type SearchPathViolation = {
  fn: string
  kind: "nema_search_path" | "pg_temp_nije_naveden"
}

/**
 * Funkcije koje NAMJERNO izostaju iz provjere. Novu treba SVJESNO dodati ovdje,
 * uz obrazloženje — inače provjera pada.
 * - rls_auto_enable: platformski event trigger; ne postoji ni u jednoj migraciji u
 *   ovom repou i dira ga Supabase. Ne mijenjamo ga bez zasebne odluke.
 */
export const DEFINER_SEARCH_PATH_ALLOWLIST: readonly string[] = ["rls_auto_enable"]

function imaPgTemp(config: string[] | null): boolean {
  const sp = (config ?? []).find((c) => c.startsWith("search_path="))
  if (!sp) return false
  // Vrijednosti su zarezom razdvojene; tražimo tačan element `pg_temp`, ne podstring
  // (da `pg_temp_3` ili ime šeme koje sadrži "pg_temp" ne prođe kao pogodak).
  return sp
    .slice("search_path=".length)
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .includes("pg_temp")
}

export function definerSearchPathViolations(
  functions: FunctionRow[],
  allowlist: readonly string[] = DEFINER_SEARCH_PATH_ALLOWLIST,
): SearchPathViolation[] {
  const allow = new Set(allowlist)
  const violations: SearchPathViolation[] = []
  for (const f of functions) {
    if (f.schema !== "public") continue
    if (allow.has(f.name)) continue
    const sp = (f.config ?? []).find((c) => c.startsWith("search_path="))
    if (!sp) {
      violations.push({ fn: `${f.name}(${f.args})`, kind: "nema_search_path" })
      continue
    }
    if (!imaPgTemp(f.config)) {
      violations.push({ fn: `${f.name}(${f.args})`, kind: "pg_temp_nije_naveden" })
    }
  }
  return violations
}

/** SQL koji vraća SAMO `security definer` funkcije u public, kompatibilno sa FunctionRow. */
export const DEFINER_FUNCTIONS_SQL = `
  select n.nspname as schema,
         p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args,
         p.proconfig as config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  order by p.proname`
