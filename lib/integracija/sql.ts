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

/**
 * Otvarajući dollar-quote tag (`$$` ili `$tag$`) NA POZICIJI `pocetak`, ili null ako
 * tu ne počinje tag. Sticky (`y`) — poklapa se isključivo od `pocetak`, bez kopiranja
 * ostatka fajla.
 *
 * Tag u PostgreSQL-u prati pravila NEnavodnjenog identifikatora (bez znaka dolara), pa
 * se koristi unicode razred (`\p{L}\p{N}_`) a ne uski `[A-Za-z0-9_]` — u repou čiji je
 * domenski jezik BCS latinica `$tijelo_č$` nije egzotično. Prazan tag (`$$`) je
 * dozvoljen i najčešći.
 */
const DOLLAR_TAG = /\$[\p{L}\p{N}_]*\$/uy

/**
 * Kraj (ekskluzivno) dollar-quoted tijela koje počinje na `pocetak`, ili null ako tu
 * uopšte ne počinje tag (npr. `$1` pozicioni parametar — nema zatvarajući `$`).
 * Zatvarač mora biti ISTI tag: `$a$ ... $b$ ... $b$ ... $a$` se zatvara na spoljnom
 * `$a$`, ne na unutrašnjem `$b$`. Neterminisan tag se maskira do kraja fajla (isto kao
 * neterminisan blok komentar/string — PostgreSQL bi ga odbio kao grešku).
 */
function krajDollarQuote(sadrzaj: string, pocetak: number): number | null {
  DOLLAR_TAG.lastIndex = pocetak
  const tag = DOLLAR_TAG.exec(sadrzaj)?.[0]
  if (tag === undefined) return null
  const zatvarac = sadrzaj.indexOf(tag, pocetak + tag.length)
  return zatvarac === -1 ? sadrzaj.length : zatvarac + tag.length
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
 * (`-- ...`), blok komentari (kosa-crta-zvjezdica ... zvjezdica-kosa-crta), sadržaj
 * jednostrukih navodnika i dollar-quoted tijela (`$$...$$`, `$tag$...$tag$`) se
 * maskiraju razmacima (linije se ne pomjeraju, samo se prazne — brojevi linija u
 * nalazima ostaju tačni). Bez ovoga podniz poput
 * 'CREATE TABLE AS' unutar string literala (stvaran izvršni SQL u rls_auto_enable() —
 * kopija cloud event trigger funkcije koja citira PostgreSQL command_tag vrijednosti kao
 * stringove) ili "create table if not exists" unutar komentara lažno pogodi TABELA/VIEW
 * obrasce iz pravila.ts — pravila su namjerno tekstualna, ne AST, pa sama ne razlikuju
 * izvršni kod od komentara/stringova.
 *
 * JEDAN PROLAZ, ne lanac `.replace()`: koja god od četiri konstrukcije počne PRVA, guta
 * ostale do svog kraja. Lanac replace-ova to ne može — `--` unutar blok komentara bi
 * "pojeo" ostatak reda uključujući zatvarač bloka, a otvarač bloka unutar `'...'` bi
 * otvorio lažan komentar do prvog zatvarača u fajlu. Posljedice su u OBA smjera:
 * zakomentarisana `create policy` koja prolazi kao stvarna politika (lažno negativno —
 * tabela bez politike se ne prijavi), i zakomentarisana `create table`/`create view`
 * koja se prijavi kao stvarna (lažno pozitivno).
 *
 * DOLLAR-QUOTING JE ČETVRTA KONSTRUKCIJA, i to je SVJESTAN KOMPROMIS. Dok se `$$...$$`
 * nije poznavalo, apostrof unutar dollar-quoted tijela (npr.
 * `comment on table klijenti is $$Petrova' tabela$$;` — validan PostgreSQL) je otvarao
 * "string literal" koji nikad ne nalazi zatvarač, pa se maskirao SAV sadržaj DO KRAJA
 * FAJLA: svaka DDL naredba poslije njega je tiho nestajala iz provjere i fajl je
 * prolazio kao čist. Isti kvar je davao `$x$don't$x$` u plpgsql tijelu.
 *
 * Cijena popravke: tijelo se maskira U CJELINI, pa PRAVA `CREATE POLICY` unutar
 * `DO $$ ... $$` bloka (ili `EXECUTE` u plpgsql-u) postaje NEVIDLJIVA — tabela sa takvom
 * politikom se može lažno prijaviti kao „bez politike". To je namjerno prihvaćeno: smjer
 * greške je BUČAN (lažno pozitivan nalaz koji neko pročita i odbaci) umjesto TIHOG
 * (fajl prolazi kao čist iako pola njegovog DDL-a nije ni pogledano). Lažno pozitivan
 * nalaz se rješava tačkom u IZUZECI, tihi propust se ne rješava nikako.
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
    } else if (sadrzaj[i] === "$") {
      kraj = krajDollarQuote(sadrzaj, i)
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

/**
 * Izbaci nalaze pravila "tabela-bez-politike" za tabele iz `allowlist` — tabele koje
 * su POZNATO, namjerno policyless (RLS uključen, pristup isključivo preko service-role
 * klijenta; v. lib/rlsCoverage.ts `RLS_INTENTIONAL_POLICYLESS`, koju već koristi
 * `pnpm rls:check`). pravila.ts nema mehanizam izuzetka za ovo pravilo (za razliku od
 * `integracija-dozvoli` markera kod admin-klijenta), pa se ljuska oslanja na ovaj
 * filter umjesto da izmišlja novi mehanizam ili gasi pravilo. Svi ostali nalazi
 * (uključujući "tabela-bez-politike" za tabele van allowlist-e) prolaze nepromijenjeni.
 *
 * Ime tabele se čita iz STRUKTURIRANOG polja `Nalaz.tabela` koje popunjava pravila.ts.
 * Ranije se parsiralo regexom iz teksta `Nalaz.poruka` — krhka spona koja bi pukla na
 * bilo kakvu preformulaciju poruke, i to TIHO (izuzeci bi prestali da važe, a nijedan
 * test ne bi pao jer je poruka slobodan tekst). Nalaz bez `tabela` polja se ZADRŽAVA
 * (fail-loud: nepoznata tabela se ne izuzima).
 */
/**
 * Marker kojim migracija sama izuzima svoj nalaz `zastita-uklonjena`:
 *
 *     -- integracija-dozvoli: zastita-uklonjena — <razlog>
 *
 * Postoji jer je uklanjanje politike PONEKAD SAMA POPRAVKA: politika koju ne koristi nijedan
 * legitiman tok (sav I/O ide service-role klijentom koji zaobilazi RLS) je čista napadačka
 * površina, a njeno uklanjanje ostavlja tabelu STROŽOM, ne slabijom — bez INSERT/UPDATE
 * politike Postgres podrazumijevano odbija upis. Pravilo to ne može znati jer gleda jedan
 * fajl i broji politike u njemu.
 *
 * Bez ovog izuzetka takva migracija zauvijek obara gate, što gura na gore rješenje: lažnu
 * politiku `with check (false)` koja postoji samo da alat bude zadovoljan.
 *
 * Razlog iza crte je OBAVEZAN — goli marker ne vrijedi, isto kao kod admin-klijenta.
 * Traži se u SIROVOM sadržaju (prije `sanitizujSql`), jer sanitizacija maskira komentare.
 */
const MARKER_SQL_DOZVOLI = /^[^\S\n]*--[^\S\n]*integracija-dozvoli:[^\S\n]*zastita-uklonjena[^\S\n]*[—–-][^\S\n]*(\S.*?)[^\S\n]*$/m

/**
 * Izbaci nalaze pravila "zastita-uklonjena" za one fajlove koji nose marker izuzetka.
 * `sirovoPoPutanji` mora držati sadržaj PRIJE `sanitizujSql` — poslije sanitizacije markera nema.
 *
 * Filtrira PO FAJLU, ne globalno: marker u jednoj migraciji ne izuzima drugu. Ostala pravila
 * (uključujući "tabela-bez-politike" i "rls-iskljucen") prolaze nepromijenjena — marker izuzima
 * isključivo ono što je autor migracije eksplicitno naveo. Nalaz čija putanja nije u mapi se
 * ZADRŽAVA (fail-loud, isto kao kod policyless filtera).
 */
export function filtrirajOznaceneIzuzetke(
  nalazi: readonly Nalaz[],
  sirovoPoPutanji: ReadonlyMap<string, string>,
): Nalaz[] {
  return nalazi.filter((n) => {
    if (n.pravilo !== "zastita-uklonjena") return true
    const sirovo = sirovoPoPutanji.get(n.putanja)
    return sirovo === undefined || !MARKER_SQL_DOZVOLI.test(sirovo)
  })
}

export function filtrirajNamjernePolicyless(
  nalazi: readonly Nalaz[],
  allowlist: readonly string[],
): Nalaz[] {
  return nalazi.filter((n) => {
    if (n.pravilo !== "tabela-bez-politike") return true
    return n.tabela === undefined || !allowlist.includes(n.tabela)
  })
}
