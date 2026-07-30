/**
 * Putanje objekata u bucketu kojima ne odgovara nijedan red u `dokumenti`.
 *
 * Nastaju kad se red obriše mimo aplikacije (direktan PostgREST DELETE): `dokumenti_del`
 * je po prekidaču od 20260730151000, a `storage_dok_del` je namjerno ostao admin-only —
 * širenje te politike bi dalo operateru brisanje proizvoljnih objekata u bucketu.
 * Zato se osirotjeli fajlovi skupljaju periodično umjesto da se politika olabavi.
 * Vidi docs/adr/2026-07-30-pregled-bez-preuzimanja.md.
 */
export function osirotjeliObjekti(objekti: string[], putanjeUBazi: string[]): string[] {
  const uBazi = new Set(putanjeUBazi)
  return objekti.filter((p) => !uBazi.has(p))
}
