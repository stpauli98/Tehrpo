/**
 * Tekstualna pravila nad izvornim fajlovima — klase kvarova koje daju
 * čist merge i pokvaren sistem:
 *
 *  - admin (service-role) klijent u zahtjevnoj putanji zaobilazi RLS
 *  - SQL VIEW bez security_invoker=on zaobilazi RLS
 *  - nova tabela bez politike tiho vraća nula redova (cloud event trigger
 *    automatski uključi RLS na svaku novu public tabelu)
 *  - PROD ref u tests/ znači da E2E prolaz piše u produkciju
 *
 * Namjerno tekstualno, ne AST — cilj je jeftina i predvidiva mreža, ne
 * potpuna analiza. Lažno pozitivan nalaz se rješava tačkom u IZUZECI.
 *
 * "Slijepilo za DROP" — dvije uske korekcije za slučaj kad je isti fajl i UKLJUČIO i
 * ISKLJUČIO pokrivenost, jer to je tačno ono što provjera po fajlu treba da vidi:
 *  - `tabela-bez-politike`: politika za tabelu se NE računa kao pokriće ako je u ISTOM
 *    fajlu, kasnije, obrisana (`DROP POLICY <ime> ON <tabela>`) bez ponovnog kreiranja.
 *  - `view-bez-invokera`: `ALTER VIEW <ime> SET (security_invoker = off)` u ISTOM fajlu
 *    poništava raniji `on` (bilo inline na CREATE, bilo iz ranije ALTER naredbe).
 *
 * POZNATO OGRANIČENJE (namjerno van obuhvata): migracija koja radi SAMO
 * `DROP POLICY ... ON tabela` bez ijedne `CREATE TABLE`/`CREATE POLICY` u ISTOM fajlu
 * (tabela je kreirana u nekom RANIJEM, drugom fajlu) i dalje prolazi neprimijećeno —
 * to bi tražilo praćenje stanja KROZ ISTORIJU (preko fajlova), što je izvan onoga što
 * provjera po fajlu može vidjeti bez agregacije (a agregacija je odbačena — probijena
 * je recenzijom, v. scripts/provjeri-integraciju.ts).
 *
 * Čisto nad podacima: bez dodira s diskom, mrežom i process.env.
 */
import { PROD_REF } from "@/lib/supabase/refs"

export type Izvor = {
  /** Putanja relativna na korijen repozitorija, s kosom crtom naprijed. */
  putanja: string
  sadrzaj: string
}

export type Nalaz = {
  putanja: string
  /** 1-indeksirano. */
  linija: number
  pravilo: string
  poruka: string
}

/** Putanje u kojima admin klijent NIJE greška. Obje su pod app/ ili components/
 *  (vanjski uslov u provjeriTs) — stavke van tog stabla ovdje nikad ne bi bile
 *  dosegnute pa nemaju šta da traže u listi. */
const IZUZECI_ADMIN = ["scripts/", "app/api/cron/"]

/** Izuzetak od pravila admin-klijent: komentar neposredno iznad pogotka (uz
 *  zanemarivanje praznih redova) oblika `// integracija-dozvoli: admin-klijent — <razlog>`.
 *  Razdvajač prije razloga može biti em crta (—), en crta (–) ili obična crtica (-) —
 *  sve tri se prihvataju. Razlog iza crte je obavezan — bez njega marker ne vrijedi. */
const MARKER_ADMIN_DOZVOLI = /^\s*\/\/\s*integracija-dozvoli:\s*admin-klijent\s*[—–-]\s*(.+?)\s*$/

const ADMIN = /createAdminSupabaseClient|@\/lib\/supabase\/admin/
/**
 * Karakteri od kojih se sastoji SQL identifikator (ime tabele/viewa), sa šemom i
 * navodnicima. Unicode slova (`\p{L}`) su OBAVEZNA — repo čiji je domenski jezik BCS
 * latinica normalno ima imena poput `zaduženja`; sa uskim `[A-Za-z0-9_."]` takvo ime bi
 * bilo odsječeno na prvom dijakritiku, pa bi:
 *  - `zaduženja` i `zaduživanja` obje postale `zadu` (politika za jednu bi "pokrila" i
 *    drugu, i DROP bi skinuo pokriće sa POGREŠNE tabele), i
 *  - nalaz bi prijavljivao nepostojeće ime (`tabela zadu nema RLS politiku`).
 * Za ASCII sadržaj je ovo doslovno ekvivalentno starom razredu (\p{L} sadrži A-Za-z,
 * \p{N} sadrži 0-9), pa se ponašanje nad postojećim migracijama ne mijenja.
 */
const IDENT_RAZRED = String.raw`[\p{L}\p{N}_."]`
const IDENT = `${IDENT_RAZRED}+`
/** Karakteri koji NASTAVLJAJU identifikator — za granicu riječi bez `\b`, v.
 *  `alterViewZaIme`. Isto kao IDENT_RAZRED, bez `.`/`"` (razdvajači, ne nastavak imena). */
const IDENT_KARAKTER = String.raw`[\p{L}\p{N}_]`
const VIEW = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(${IDENT})`, "iu")
const TABELA = new RegExp(
  String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`,
  "giu",
)
const SECURITY_INVOKER_ON = /security_invoker\s*=\s*on/i
const SECURITY_INVOKER_OFF = /security_invoker\s*=\s*off/i
// Ime politike: navodnicima ograničeno (BILO KOJI karakter osim navodnika, uključujući
// razmak — npr. "moja politika") ILI goli identifikator (unicode slova — dijakritika
// poput č/š/ć/ž/đ NIJE egzotična u BCS domenu — cifre, donja crta). Bez \p{L} (samo
// [A-Za-z0-9_]) bi ime poput `zaduženja_sel` bilo odsječeno na prvom dijakritiku, pa bi
// se politika "izgubila" i tabela lažno prijavila kao bez politike (v. recenzija).
const CREATE_POLICY = new RegExp(
  String.raw`CREATE\s+POLICY\s+(?:"([^"]+)"|(${IDENT_KARAKTER}+))\s+ON\s+(${IDENT})`,
  "iu",
)
const DROP_POLICY = new RegExp(
  String.raw`DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(${IDENT_KARAKTER}+))\s+ON\s+(${IDENT})`,
  "iu",
)

function brojLinije(sadrzaj: string, indeks: number): number {
  let linija = 1
  for (let i = 0; i < indeks && i < sadrzaj.length; i++) {
    if (sadrzaj[i] === "\n") linija++
  }
  return linija
}

/** Kratko ime tabele bez šeme i navodnika — za poređenje s politikom. */
function kratkoIme(ime: string): string {
  return ime.replace(/"/g, "").split(".").pop() ?? ime
}

/**
 * Da li je pogodak na `linije[i]` pokriven markerom `integracija-dozvoli: admin-klijent`
 * na najbližem NEpraznom redu iznad (prazni redovi između se preskaču). Marker bez
 * razloga poslije crte ne vrijedi — namjerno, izuzetak mora nositi obrazloženje.
 */
function jeIzuzetMarkerom(linije: string[], i: number): boolean {
  let j = i - 1
  while (j >= 0 && (linije[j] ?? "").trim() === "") j--
  if (j < 0) return false
  const pogodak = MARKER_ADMIN_DOZVOLI.exec(linije[j] ?? "")
  if (!pogodak) return false
  const razlog = pogodak[1]?.trim()
  return !!razlog
}

/** Zajednički obrazac za oba provjeriTs pravila: test po redu → Nalaz, uz opcioni
 *  izuzetak (koristi ga isključivo admin-klijent, ne i prod-ref-u-testovima). */
function linijskiNalazi(
  linije: string[],
  test: (linija: string) => boolean,
  putanja: string,
  pravilo: string,
  poruka: string,
  preskoci?: (linije: string[], i: number) => boolean,
): Nalaz[] {
  const nalazi: Nalaz[] = []
  linije.forEach((linija, i) => {
    if (test(linija) && !(preskoci?.(linije, i) ?? false)) {
      nalazi.push({ putanja, linija: i + 1, pravilo, poruka })
    }
  })
  return nalazi
}

export function provjeriTs(izvor: Izvor): Nalaz[] {
  const { putanja, sadrzaj } = izvor
  const linije = sadrzaj.split("\n")
  const nalazi: Nalaz[] = []

  const uZahtjevnoj = putanja.startsWith("app/") || putanja.startsWith("components/")
  const izuzet = IZUZECI_ADMIN.some((p) => putanja.startsWith(p))

  if (uZahtjevnoj && !izuzet) {
    nalazi.push(
      ...linijskiNalazi(
        linije,
        (linija) => ADMIN.test(linija),
        putanja,
        "admin-klijent",
        "service-role klijent u zahtjevnoj putanji zaobilazi RLS — koristi createServerSupabaseClient",
        jeIzuzetMarkerom,
      ),
    )
  }

  if (putanja.startsWith("tests/")) {
    nalazi.push(
      ...linijskiNalazi(
        linije,
        (linija) => linija.includes(PROD_REF),
        putanja,
        "prod-ref-u-testovima",
        "PROD ref u testu — E2E prolaz bi pisao u produkciju; cilj mora biti DEMO",
      ),
    )
  }

  return nalazi
}

/**
 * Regex koji prepoznaje `ALTER VIEW <ime> ...` kao POČETAK naredbe (dozvoljeni su
 * vodeći whitespace i `-- ...` SQL komentari, npr. "Re-apply security_invoker"
 * napomena iznad stvarne ALTER VIEW linije). Granica identifikatora oko imena sprječava
 * da `termini` pokrije `termini_view` i obrnuto (i `grad` da pokrije `gradovi`).
 *
 * NAMJERNO se NE koristi `\b`: granica riječi je definisana preko `\w` = `[A-Za-z0-9_]`
 * i NE poznaje dijakritiku ni pod `u` zastavicom. Za view `pregled_č`, `\b` iza `č`
 * (koje je za `\b` NEriječni karakter) traži da SLJEDEĆI karakter bude riječni — a
 * poslije imena dolazi razmak, pa poklapanje otkazuje i `ALTER VIEW pregled_č SET
 * (security_invoker = on)` tiho ne bi bio viđen. Umjesto toga se koriste eksplicitni
 * lookaround-i nad IDENT_KARAKTER (unicode-svjesni), koji se na ASCII imenima ponašaju
 * identično kao `\b`.
 */
function alterViewZaIme(ime: string): RegExp {
  return new RegExp(
    String.raw`^(?:\s|--[^\n]*)*ALTER\s+VIEW\s+${IDENT_RAZRED}*(?<!${IDENT_KARAKTER})${ime}(?!${IDENT_KARAKTER})`,
    "iu",
  )
}

/**
 * Efektivno stanje invokera za `ime` NA KRAJU fajla: počinje od `inlineStanje`
 * (invoker inline na CREATE (OR REPLACE) VIEW naredbi), pa se SEKVENCIJALNO
 * (redoslijed naredbi u fajlu, ne redoslijed pojavljivanja u regexu) ažurira svakom
 * `ALTER VIEW <ime> ...` naredbom koja EKSPLICITNO pominje `security_invoker` — zadnja
 * takva naredba odlučuje. `ALTER VIEW` koja ne dodiruje `security_invoker` (mijenja
 * neku drugu opciju) ne mijenja stanje — to je "slijepilo za DROP" fix: ranije se
 * gledalo SAMO da li ijedna ALTER-naredba ikad postavi `on`, pa je naknadni `off` u
 * istom fajlu prolazio neprimijećen.
 */
function efektivniInvokerZaView(sadrzaj: string, ime: string, inlineStanje: boolean): boolean {
  let stanje = inlineStanje
  const regex = alterViewZaIme(ime)
  for (const naredba of sadrzaj.split(";")) {
    if (!regex.test(naredba)) continue
    if (SECURITY_INVOKER_ON.test(naredba)) stanje = true
    else if (SECURITY_INVOKER_OFF.test(naredba)) stanje = false
  }
  return stanje
}

/**
 * Žive (nedropovane) politike po tabeli, na kraju fajla — sekvencijalno: `CREATE
 * POLICY <p> ON <t>` dodaje `p` u živi skup za `t`; `DROP POLICY [IF EXISTS] <p> ON
 * <t>` ga uklanja. Ponovno kreiranje iste politike poslije drop-a je ponovo živo (to
 * je kontrolni slučaj — drop pa ponovni create NE smije biti prijavljen). Bez ovoga
 * (stari kod je samo tražio "postoji li IJEDNA CREATE POLICY za ovu tabelu bilo gdje
 * u fajlu") `CREATE POLICY p ON t; DROP POLICY p ON t;` u ISTOM fajlu je prolazilo kao
 * pokriveno iako tabela na kraju fajla nema nijednu politiku — "slijepilo za DROP".
 */
function zivePolitikePoTabeli(sadrzaj: string): Map<string, Set<string>> {
  const zive = new Map<string, Set<string>>()
  for (const naredba of sadrzaj.split(";")) {
    const create = CREATE_POLICY.exec(naredba)
    if (create) {
      const imePolitike = create[1] ?? create[2]
      const imeTabele = create[3]
      if (imePolitike !== undefined && imeTabele !== undefined) {
        const tabela = kratkoIme(imeTabele)
        const skup = zive.get(tabela) ?? new Set<string>()
        skup.add(imePolitike.toLowerCase())
        zive.set(tabela, skup)
        continue
      }
    }
    const drop = DROP_POLICY.exec(naredba)
    if (drop) {
      const imePolitike = drop[1] ?? drop[2]
      const imeTabele = drop[3]
      if (imePolitike !== undefined && imeTabele !== undefined) {
        zive.get(kratkoIme(imeTabele))?.delete(imePolitike.toLowerCase())
      }
    }
  }
  return zive
}

export function provjeriSql(izvor: Izvor): Nalaz[] {
  const { putanja, sadrzaj } = izvor
  const nalazi: Nalaz[] = []

  // VIEW: gleda se svaka naredba zasebno za inline invoker (WITH (security_invoker=on)),
  // da invoker iz jedne naredbe ne pokrije drugu. Ali repo ima i obrazac gdje se invoker
  // naknadno mijenja preko ALTER VIEW <ime> ... u ISTOM fajlu (npr. nakon DROP+CREATE
  // koji ga izgubi, ILI namjerno/greškom isključen) — efektivniInvokerZaView gleda SVE
  // takve ALTER naredbe REDOM (zadnja odlučuje), s granicom riječi da <ime> ne pokrije
  // ime koje ga sadrži kao prefiks (ili obrnuto).
  let pomak = 0
  for (const naredba of sadrzaj.split(";")) {
    const pogodak = VIEW.exec(naredba)
    if (pogodak && pogodak[1] !== undefined) {
      const ime = kratkoIme(pogodak[1])
      const inlineStanje = SECURITY_INVOKER_ON.test(naredba)
      const imaInvoker = efektivniInvokerZaView(sadrzaj, ime, inlineStanje)
      if (!imaInvoker) {
        nalazi.push({
          putanja,
          linija: brojLinije(sadrzaj, pomak + pogodak.index),
          pravilo: "view-bez-invokera",
          poruka: `VIEW ${ime} bez security_invoker=on — zaobilazi RLS`,
        })
      }
    }
    pomak += naredba.length + 1
  }

  // Tabela bez ijedne ŽIVE politike (kreirana pa NIJE naknadno obrisana bez ponovnog
  // kreiranja) u istom fajlu — v. zivePolitikePoTabeli.
  const zivePoTabeli = zivePolitikePoTabeli(sadrzaj)
  for (const pogodak of sadrzaj.matchAll(TABELA)) {
    const sirovoIme = pogodak[1]
    if (sirovoIme === undefined) continue
    const ime = kratkoIme(sirovoIme)
    const imaZivuPolitiku = (zivePoTabeli.get(ime)?.size ?? 0) > 0
    if (imaZivuPolitiku) continue
    nalazi.push({
      putanja,
      linija: brojLinije(sadrzaj, pogodak.index),
      pravilo: "tabela-bez-politike",
      poruka: `tabela ${ime} nema RLS politiku — cloud trigger uključi RLS, pa upit tiho vraća nula redova`,
    })
  }

  return nalazi
}

export function provjeriIzvore(izvori: Izvor[]): Nalaz[] {
  return izvori
    .flatMap((izvor) => {
      if (izvor.putanja.endsWith(".sql")) return provjeriSql(izvor)
      if (/\.tsx?$/.test(izvor.putanja)) return provjeriTs(izvor)
      return []
    })
    .sort((a, b) => a.putanja.localeCompare(b.putanja) || a.linija - b.linija)
}
