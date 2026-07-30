/**
 * Odluka noćnog metenja osirotjelih objekata iz bucketa `tehpro-dokumenti`.
 *
 * Osirotjeli objekat = fajl u bucketu kojem ne odgovara nijedan red u `dokumenti`.
 * Nastaju kad se red obriše mimo aplikacije (direktan PostgREST DELETE): `dokumenti_del`
 * je po prekidaču od 20260730151000, a `storage_dok_del` je namjerno ostao admin-only —
 * širenje te politike bi dalo operateru brisanje proizvoljnih objekata u bucketu.
 * Zato se osirotjeli fajlovi skupljaju periodično umjesto da se politika olabavi.
 * Vidi docs/adr/2026-07-30-pregled-bez-preuzimanja.md.
 *
 * Samo uparivanje (grace filter + set-difference + slomljeni redovi) radi `analizirajOrphan`
 * iz `lib/dokumenti-gc.ts` — jedna implementacija koju dijele i ova ruta i
 * `scripts/gc-orphan-dokumenti.ts`. Ovdje ostaju SAMO sigurnosne ograde.
 */
import { analizirajOrphan, type StorageObjekat } from "@/lib/dokumenti-gc"

export type { StorageObjekat }

export type Odluka =
  | { akcija: "prekid"; razlog: string }
  | {
      akcija: "brisi"
      putanje: string[]
      presvjezi: string[] // orphan ali mlađi od grace — preskočeni, prijavljuju se
      slomljeniRedovi: string[] // red u bazi bez fajla — SAMO prijava, nikad brisanje
    }

/**
 * Najveći udio bucketa koji jedan prolaz smije obrisati. Iznad ovoga se prekida.
 * Zdrav sistem ima šačicu osirotjelih fajlova; „pola bucketa je osirotjelo" je signal
 * da je ulaz pogrešan (nepotpun popis iz baze, pogrešan projekat), ne da je pola bucketa
 * zaista smeće.
 */
export const MAX_UDIO_BRISANJA = 0.5

/**
 * Šta sweep treba da uradi — čista funkcija, sve I/O (storage list, DB select, storage remove)
 * ostaje u ruti. Ovdje su sažete sigurnosne ograde, da se svaka može testirati bez
 * dodirivanja storage-a/baze:
 *
 * 1. Prazna baza uz pun bucket → prekid. Provjerava se na PUNOM `objekti` (prije grace filtera),
 *    ne na broju kandidata poslije njega: prazna `dokumenti` je uvijek signal kvara (pogrešan
 *    projekat, pogrešan ključ, polomljen upit), bez obzira na starost fajlova u bucketu. Da se
 *    provjera radila na post-grace broju, noć kad je baza prazna a SVI fajlovi su mlađi od 24h
 *    bi prošla nečujno (post-grace kandidata = 0 → nema šta da se prekine) umjesto da glasno
 *    prijavi kvar odmah — grace period svejedno štiti same fajlove od brisanja, ali prekid
 *    postoji da neko odmah primijeti da nešto ne valja, ne da čeka da prođe 24h.
 *    Prazna baza I prazan bucket → NIJE prekid (svjež install, nema šta da se očisti).
 * 2. Udio: kandidati > `MAX_UDIO_BRISANJA` bucketa → prekid. Ograda 1 je sve-ili-ništa i zato
 *    slijepa za DJELIMIČNO pročitan popis iz baze (tiho odsjecanje paginacije) — tada
 *    `putanjeUBazi` NIJE prazan, pa ograda 1 ćuti, a svi redovi iza reza izgledaju osirotjelo.
 *    Ograda po udjelu hvata upravo taj oblik kvara.
 *
 * Grace period (fajl mlađi od `graceMs` se ne dira ni ako trenutno izgleda osirotjelo — upload
 * prvo piše fajl pa tek onda red u `dokumenti`) i tretman neparsibilnog timestampa su u
 * `analizirajOrphan`; ovdje se ne dupliraju.
 */
export function odluciSta(
  objekti: StorageObjekat[],
  putanjeUBazi: string[],
  sada: number,
  graceMs: number,
): Odluka {
  if (putanjeUBazi.length === 0 && objekti.length > 0) {
    return { akcija: "prekid", razlog: "dokumenti je prazan a bucket nije — prekid" }
  }

  const r = analizirajOrphan({ bucketObjekti: objekti, dbPutanje: putanjeUBazi, sada, graceMs })

  if (r.orphanFajlovi.length > objekti.length * MAX_UDIO_BRISANJA) {
    return {
      akcija: "prekid",
      razlog:
        `previše kandidata: ${r.orphanFajlovi.length}/${objekti.length} objekata ` +
        `(prag ${MAX_UDIO_BRISANJA * 100}%) — prekid`,
    }
  }

  return {
    akcija: "brisi",
    putanje: r.orphanFajlovi,
    presvjezi: r.presvjeziOrphani,
    slomljeniRedovi: r.slomljeniRedovi,
  }
}
