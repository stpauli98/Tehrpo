/**
 * Pomoćne funkcije za scripts/provjeri-integraciju.ts koje moraju biti pod vitest-om
 * (vitest.config.ts obuhvata lib/**, ne scripts/) — SQL sanitizacija prije tekstualne
 * provjere iz pravila.ts i filtriranje poznatih namjernih izuzetaka. Ljuska smije samo
 * pozvati ove funkcije; logika ovdje ostaje čista (bez diska, mreže, process.env).
 */
import type { Nalaz } from "./pravila"

/** Maskira poklapanje razmacima, karakter po karakter, čuvajući nove redove — tako
 *  brojevi linija ostaju tačni i poslije maskiranja. */
export function maskiraj(poklapanje: string): string {
  return poklapanje.replace(/[^\n]/g, " ")
}

/** Kraj (ekskluzivno) blok komentara koji počinje na `pocetak` (na OTVARANJU, dvoznaku
 *  kosa-crta-zvjezdica). PostgreSQL blok komentari se UGNJEŽĐUJU — unutrašnje otvaranje
 *  traži i svoje zatvaranje, za razliku od C-a — zato brojač dubine, a ne prvi zatvarač.
 *  Neterminisan komentar se maskira do kraja fajla (PostgreSQL bi ga prijavio kao
 *  grešku; svakako nije izvršni DDL). */
function krajBlokKomentara(sadrzaj: string, pocetak: number): number {
  let dubina = 0
  let i = pocetak
  while (i < sadrzaj.length) {
    const par = sadrzaj.slice(i, i + 2)
    if (par === "/*") {
      dubina++
      i += 2
      continue
    }
    if (par === "*/") {
      dubina--
      i += 2
      if (dubina === 0) return i
      continue
    }
    i++
  }
  return sadrzaj.length
}

/** Kraj (ekskluzivno) string literala koji počinje na `pocetak`. Apostrof UNUTAR
 *  stringa se u PostgreSQL-u (standard_conforming_strings=on, podrazumijevano od PG9)
 *  bježi UDVAJANJEM (`''`), NE obrnutom kosom crtom — `\` je običan karakter. */
function krajStringa(sadrzaj: string, pocetak: number): number {
  let i = pocetak + 1
  while (i < sadrzaj.length) {
    if (sadrzaj[i] === "'") {
      if (sadrzaj[i + 1] === "'") {
        i += 2
        continue
      }
      return i + 1
    }
    i++
  }
  return sadrzaj.length
}

/**
 * SQL-specifično čišćenje prije tekstualne provjere iz pravila.ts: linijski komentari
 * (`-- ...`), blok komentari (kosa-crta-zvjezdica ... zvjezdica-kosa-crta) i sadržaj
 * jednostrukih navodnika se maskiraju razmacima (linije se ne pomjeraju, samo se
 * prazne — brojevi linija u nalazima ostaju tačni). Bez ovoga podniz poput
 * 'CREATE TABLE AS' unutar string literala (stvaran izvršni SQL u rls_auto_enable() —
 * kopija cloud event trigger funkcije koja citira PostgreSQL command_tag vrijednosti kao
 * stringove) ili "create table if not exists" unutar komentara lažno pogodi TABELA/VIEW
 * obrasce iz pravila.ts — pravila su namjerno tekstualna, ne AST, pa sama ne razlikuju
 * izvršni kod od komentara/stringova.
 *
 * JEDAN PROLAZ, ne lanac `.replace()`: koja god od tri konstrukcije počne PRVA, guta
 * ostale do svog kraja. Lanac replace-ova to ne može — `--` unutar blok komentara bi
 * "pojeo" ostatak reda uključujući zatvarač bloka, a otvarač bloka unutar `'...'` bi
 * otvorio lažan komentar do prvog zatvarača u fajlu. Posljedice su u OBA smjera:
 * zakomentarisana `create policy` koja prolazi kao stvarna politika (lažno negativno —
 * tabela bez politike se ne prijavi), i zakomentarisana `create table`/`create view`
 * koja se prijavi kao stvarna (lažno pozitivno).
 *
 * NAPOMENA: ovo NE preskače dollar-quoted ($$...$$) tijela funkcija kao cjelinu —
 * string literali UNUTAR takvog tijela (npr. gore pomenuti 'CREATE TABLE AS') se i
 * dalje maskiraju, i to je poenta (baš taj literal je izvor lažnog pogotka). Stvaran
 * izvršni SQL izvan navodnika unutar $$...$$ tijela (npr. prava CREATE POLICY u DO
 * bloku) ostaje netaknut i vidljiv provjeri.
 */
export function sanitizujSql(sadrzaj: string): string {
  const dijelovi: string[] = []
  /** Početak tekućeg NEmaskiranog isječka — prepisuje se doslovno kad naiđe maskiranje
   *  ili kraj fajla (jeftinije i bez indeksiranja pojedinačnih karaktera). */
  let obicanOd = 0
  let i = 0
  while (i < sadrzaj.length) {
    const par = sadrzaj.slice(i, i + 2)
    let kraj: number | null = null
    if (par === "--") {
      const novired = sadrzaj.indexOf("\n", i)
      kraj = novired === -1 ? sadrzaj.length : novired
    } else if (par === "/*") {
      kraj = krajBlokKomentara(sadrzaj, i)
    } else if (sadrzaj[i] === "'") {
      kraj = krajStringa(sadrzaj, i)
    }
    if (kraj === null) {
      i++
      continue
    }
    dijelovi.push(sadrzaj.slice(obicanOd, i), maskiraj(sadrzaj.slice(i, kraj)))
    i = kraj
    obicanOd = kraj
  }
  dijelovi.push(sadrzaj.slice(obicanOd))
  return dijelovi.join("")
}

/** Ime tabele iz poruke pravila "tabela-bez-politike" (v. pravila.ts `provjeriSql`). */
const IME_IZ_PORUKE = /^tabela (\S+) nema RLS politiku/

/**
 * Izbaci nalaze pravila "tabela-bez-politike" za tabele iz `allowlist` — tabele koje
 * su POZNATO, namjerno policyless (RLS uključen, pristup isključivo preko service-role
 * klijenta; v. lib/rlsCoverage.ts `RLS_INTENTIONAL_POLICYLESS`, koju već koristi
 * `pnpm rls:check`). pravila.ts nema mehanizam izuzetka za ovo pravilo (za razliku od
 * `integracija-dozvoli` markera kod admin-klijenta), pa se ljuska oslanja na ovaj
 * filter umjesto da izmišlja novi mehanizam ili gasi pravilo. Svi ostali nalazi
 * (uključujući "tabela-bez-politike" za tabele van allowlist-e) prolaze nepromijenjeni.
 *
 * Ime tabele se parsira regexom iz teksta `Nalaz.poruka` — krhko (zavisi od tačnog
 * teksta poruke u pravila.ts `provjeriSql`), ali prihvaćeno: dodavanje strukturiranog
 * polja u `Nalaz` bi značilo mijenjanje pravila.ts, što je van dozvoljenog obuhvata
 * ovog zadatka. Ako se tekst poruke ikad promijeni, ova funkcija prestaje prepoznavati
 * izuzetke — ALI to NIJE garantovano vidljivo u praksi: sve tri tabele iz
 * RLS_INTENTIONAL_POLICYLESS su u ISTORIJSKIM migracijama, van dometa podrazumijevanog
 * (git-diff suženog) režima. Regresija bi se pojavila TEK pod `--sve` (ili ako neka od
 * te tri migracije ikad uđe u obuhvat git diff-a), ne u podrazumijevanom CI toku.
 */
export function filtrirajNamjernePolicyless(
  nalazi: readonly Nalaz[],
  allowlist: readonly string[],
): Nalaz[] {
  return nalazi.filter((n) => {
    if (n.pravilo !== "tabela-bez-politike") return true
    const ime = IME_IZ_PORUKE.exec(n.poruka)?.[1]
    return ime === undefined || !allowlist.includes(ime)
  })
}
