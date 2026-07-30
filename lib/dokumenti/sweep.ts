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

export type StorageStavka = { path: string; kreiran: string } // kreiran = created_at objekta, ISO

export type Odluka =
  | { akcija: "prekid"; razlog: string }
  | { akcija: "brisi"; putanje: string[] }

/**
 * Šta sweep treba da uradi — čista funkcija, sve I/O (storage list, DB select, storage remove)
 * ostaje u ruti. Ovdje su sažete SVE tri sigurnosne ograde, da se svaka može testirati bez
 * dodirivanja storage-a/baze:
 *
 * 1. Prazna baza uz pun bucket → prekid. Provjerava se na PUNOM `objekti` (prije grace filtera),
 *    ne na broju kandidata poslije njega: prazna `dokumenti` je uvijek signal kvara (pogrešan
 *    projekat, pogrešan ključ, polomljen upit), bez obzira na starost fajlova u bucketu. Da se
 *    provjera radila na post-grace broju, noć kad je baza prazna a SVI fajlovi su mlađi od 24h
 *    bi prošla nečujno (post-grace kandidata = 0 → nema šta da se prekine) umjesto da glasno
 *    prijavi kvar odmah — grace period svejedno štiti same fajlove od brisanja, ali prekid
 *    postoji da neko odmah primijeti da nešto ne valja, ne da čeka da prođe 24h.
 * 2. Prazna baza I prazan bucket → NIJE prekid (svjež install, nema šta da se očisti).
 * 3. Grace period: fajl mlađi od `graceMs` se ne dira ni ako trenutno izgleda osirotjelo —
 *    upload prvo piše fajl pa tek onda red u `dokumenti`, pa fajl uhvaćen u tom procjepu
 *    izgleda osirotjelo iako je legitiman. `kreiran` koji nedostaje ili se ne parsira
 *    (Date.parse → NaN) čini fajl ZAŠTIĆENIM (NaN >= graceMs je uvijek false), nikad obrnuto.
 */
export function odluciSta(
  objekti: StorageStavka[],
  putanjeUBazi: string[],
  sada: number,
  graceMs: number,
): Odluka {
  if (putanjeUBazi.length === 0 && objekti.length > 0) {
    return { akcija: "prekid", razlog: "dokumenti je prazan a bucket nije — prekid" }
  }

  const zreliPuta = objekti
    .filter((o) => sada - Date.parse(o.kreiran) >= graceMs)
    .map((o) => o.path)

  return { akcija: "brisi", putanje: osirotjeliObjekti(zreliPuta, putanjeUBazi) }
}
