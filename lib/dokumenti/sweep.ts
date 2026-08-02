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
 *
 * ── N07 ──────────────────────────────────────────────────────────────────────────────────
 * Od migracije 20260801093000 baza SAMA bilježi svako brisanje reda `dokumenti` (uključujući
 * kaskadu iz `termini`/`klijenti`, koju aplikacija nikad ne vidi) u red čekanja
 * `za_brisanje_iz_storagea`. Te putanje ulaze ovdje kao `zabiljezenaBrisanja` i imaju
 * drugačiji STATUS DOKAZA od ostalih kandidata — v. ogradu 2 niže.
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
      /**
       * Kandidati zadržani za NEKI SLJEDEĆI prolaz (ograda po udjelu ili limit po prolazu).
       * Odsutno kad nema nijednog — polje je dodato naknadno i postojeći potrošači ga ne
       * očekuju, pa se prazna lista ne serijalizuje kao `[]`.
       */
      odgodjeni?: string[]
      /**
       * Zabilježena brisanja čijeg fajla VIŠE NEMA u bucketu (npr. `removeDokument` ga je već
       * uklonio pri pojedinačnom brisanju). Nema šta da se briše — red u `za_brisanje_iz_storagea`
       * se može zatvoriti. Samo prijava; brisanje reda radi potrošač.
       */
      zatvoriZapise?: string[]
    }

/**
 * Najveći udio bucketa koji jedan prolaz smije obrisati na osnovu IZVEDENOG zaključka
 * (fajl nije nađen u popisu iz baze). Iznad ovoga se izvedenim kandidatima ne vjeruje.
 * Zdrav sistem ima šačicu takvih fajlova; „pola bucketa je osirotjelo" je signal da je ulaz
 * pogrešan (nepotpun popis iz baze, pogrešan projekat), ne da je pola bucketa zaista smeće.
 */
export const MAX_UDIO_BRISANJA = 0.5

/**
 * Najviše objekata koje jedan prolaz smije obrisati, bez obzira na dokaz. Apsolutni plafon
 * postoji zbog zabilježenih brisanja: ona ZAOBILAZE ogradu po udjelu (v. niže), pa bi jedan
 * pogrešan `delete from klijenti` bez ovog plafona odnio cijeli bucket u jednoj noći.
 * Ovako se isti posao razlije na više noći i ostane prozor da neko primijeti.
 * Ostatak nije izgubljen — vraća se u `odgodjeni` i čeka sljedeći prolaz.
 */
export const MAX_PO_PROLAZU = 200

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
 *    Ova ograda je iznad svega ostalog: prazna baza obara i zabilježena brisanja, jer popis
 *    koji nije stigao ne kaže ništa ni o tome koja su brisanja stvarno zabilježena.
 * 2. Udio: IZVEDENI kandidati > `MAX_UDIO_BRISANJA` bucketa → izvedenim kandidatima se ne
 *    vjeruje. Ograda 1 je sve-ili-ništa i zato slijepa za DJELIMIČNO pročitan popis iz baze
 *    (tiho odsjecanje paginacije) — tada `putanjeUBazi` NIJE prazan, pa ograda 1 ćuti, a svi
 *    redovi iza reza izgledaju osirotjelo. Ograda po udjelu hvata upravo taj oblik kvara.
 *
 *    Ograda se namjerno mjeri SAMO na izvedenim kandidatima. Zabilježeno brisanje nije
 *    zaključak nego činjenica: red `za_brisanje_iz_storagea` postoji jer je triger u bazi
 *    VIDIO `delete` nad tim redom `dokumenti`, u istoj transakciji. Nepotpuno pročitan popis
 *    putanja ne može izmisliti takav red — dakle oblik kvara koji ova ograda čuva ne dodiruje
 *    zabilježena brisanja i nema razloga da ih blokira.
 *
 *    ZAŠTO JE TO VAŽNO (nalaz N07): ranije je ograda vraćala `prekid` za CIJELI prolaz i time
 *    bila jednosmjerna zamka — kad udio jednom pređe prag, metenje odustane, ništa se ne
 *    počisti, udio ostane iznad praga i svaki sljedeći prolaz odustane iz istog razloga.
 *    Sad se odustaje samo od nedokazanog dijela: zabilježena brisanja se i dalje čiste, bucket
 *    se smanjuje i sistem izlazi iz zamke sam. Kad izvedenih kandidata ima previše a
 *    zabilježenih nema NIJEDNO, i dalje je `prekid` — nema šta da se sigurno uradi, a tišina
 *    bi sakrila kvar.
 * 3. Limit po prolazu: `MAX_PO_PROLAZU` (v. gore). Ostatak ide u `odgodjeni`.
 *
 * Grace period (fajl mlađi od `graceMs` se ne dira ni ako trenutno izgleda osirotjelo — upload
 * prvo piše fajl pa tek onda red u `dokumenti`) i tretman neparsibilnog timestampa su u
 * `analizirajOrphan`; ovdje se ne dupliraju. Grace važi i za zabilježena brisanja: `potvrdjeni`
 * je PODSKUP `orphanFajlovi`, pa fajl mlađi od grace perioda ne prolazi ni ovim putem.
 * Isto tako, putanja koja je u međuvremenu opet dobila red u `dokumenti` (ponovni upload na
 * istu putanju) nije u `orphanFajlovi` i zato je nikad ne briše ni zabilježeno brisanje.
 *
 * @param zabiljezenaBrisanja `storage_path` iz `za_brisanje_iz_storagea`. Prazno = ponašanje
 *   kao prije N07 (sve je izvedeno), pa stariji pozivaoci s 4 argumenta rade nepromijenjeno.
 */
export function odluciSta(
  objekti: StorageObjekat[],
  putanjeUBazi: string[],
  sada: number,
  graceMs: number,
  zabiljezenaBrisanja: string[] = [],
): Odluka {
  if (putanjeUBazi.length === 0 && objekti.length > 0) {
    return { akcija: "prekid", razlog: "dokumenti je prazan a bucket nije — prekid" }
  }

  const r = analizirajOrphan({ bucketObjekti: objekti, dbPutanje: putanjeUBazi, sada, graceMs })

  const zapisi = new Set(zabiljezenaBrisanja)
  const izvedeni = r.orphanFajlovi.filter((p) => !zapisi.has(p))
  const potvrdjeniBroj = r.orphanFajlovi.length - izvedeni.length

  const odgodjeni: string[] = []
  let dozvoljeni: (p: string) => boolean = () => true

  if (izvedeni.length > objekti.length * MAX_UDIO_BRISANJA) {
    if (potvrdjeniBroj === 0) {
      // Nijedan kandidat nije dokazan — nema sigurnog djelimičnog posla, samo glasan prekid.
      return {
        akcija: "prekid",
        razlog:
          `previše kandidata: ${izvedeni.length}/${objekti.length} objekata ` +
          `(prag ${MAX_UDIO_BRISANJA * 100}%) — prekid`,
      }
    }
    // Ima i dokazanih: radi se samo dokazani dio, izvedeni se odgađaju (ne gube).
    odgodjeni.push(...izvedeni)
    const sumnjivi = new Set(izvedeni)
    dozvoljeni = (p) => !sumnjivi.has(p)
  }

  // Filtriranje ide preko `orphanFajlovi` da se sačuva izvorni redoslijed bucketa.
  const prihvaceni = r.orphanFajlovi.filter(dozvoljeni)
  const putanje = prihvaceni.slice(0, MAX_PO_PROLAZU)
  odgodjeni.push(...prihvaceni.slice(MAX_PO_PROLAZU))

  // Zabilježena brisanja kojih više nema u bucketu: posao je već obavljen, red se zatvara.
  const uBucketu = new Set(objekti.map((o) => o.path))
  const zatvoriZapise = zabiljezenaBrisanja.filter((p) => !uBucketu.has(p))

  return {
    akcija: "brisi",
    putanje,
    presvjezi: r.presvjeziOrphani,
    slomljeniRedovi: r.slomljeniRedovi,
    ...(odgodjeni.length ? { odgodjeni } : {}),
    ...(zatvoriZapise.length ? { zatvoriZapise } : {}),
  }
}
