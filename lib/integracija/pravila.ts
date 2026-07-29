/**
 * Tekstualna pravila nad izvornim fajlovima — klase kvarova koje daju
 * čist merge i pokvaren sistem:
 *
 *  - admin (service-role) klijent u zahtjevnoj putanji zaobilazi RLS
 *  - SQL VIEW bez security_invoker=on zaobilazi RLS
 *  - nova tabela bez politike tiho vraća nula redova (cloud event trigger
 *    automatski uključi RLS na svaku novu public tabelu)
 *  - zaštita UKLONJENA u migraciji (`DISABLE ROW LEVEL SECURITY`, `DROP POLICY` bez
 *    zamjene, `security_invoker = off`) — v. `zastita-uklonjena` niže
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
 * Pravilo `zastita-uklonjena` pokriva DRUGU stranu istog problema: migraciju koja
 * zaštitu SKIDA sa nečega što je već postojalo. Tri naredbe, sve tri su ranije prolazile
 * kao čiste:
 *  - `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY` — tabela curi svima
 *  - `DROP POLICY <p> ON <t>` bez zamjene — tabela na kraju fajla nema nijednu politiku
 *  - `ALTER VIEW <v> SET (security_invoker = off)` — view ponovo zaobilazi RLS
 * Gleda se NETO EFEKAT NA KRAJU FAJLA (kao i kod „slijepila za DROP"): `disable` pa
 * `enable`, `drop` pa ponovni `create`, `off` pa `on` — nijedno se ne prijavljuje.
 * Za politiku i invoker se nalaz IZOSTAVLJA ako je tabela/view kreiran u ISTOM fajlu —
 * tada `tabela-bez-politike`/`view-bez-invokera` već daju isti signal, pa bi drugi nalaz
 * bio šum na istoj liniji. `DISABLE ROW LEVEL SECURITY` nema takav parnjak (postojeća
 * pravila je uopšte ne poznaju), pa se prijavljuje uvijek.
 *
 * Čisto nad podacima: bez dodira s diskom, mrežom i process.env.
 */
import { PROD_REF } from "@/lib/supabase/refs"

import { jeTsIzvor } from "./opcije"

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
  /**
   * Ime tabele (kratko, bez šeme i navodnika) na koju se nalaz odnosi — popunjeno samo
   * kod pravila nad tabelama (`tabela-bez-politike`, `zastita-uklonjena` za RLS/politike).
   * Postoji da potrošači (v. `filtrirajNamjernePolicyless` u sql.ts) ne moraju parsirati
   * ime iz slobodnog teksta `poruka`.
   */
  tabela?: string
}

/** Putanje u kojima admin klijent NIJE greška. Pravilo se ionako pušta samo nad `app/`
 *  i `components/` (vanjski uslov `uZahtjevnoj` u provjeriTs), pa ovdje smiju stajati
 *  SAMO putanje unutar tog stabla — stavka poput `scripts/` bi bila mrtva. */
const IZUZECI_ADMIN = ["app/api/cron/"]

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
/** `ALTER TABLE [IF EXISTS] [ONLY] <t> DISABLE|ENABLE ROW LEVEL SECURITY` — obje varijante
 *  kroz isti oblik, jer se stanje prati sekvencijalno (zadnja naredba odlučuje). */
function alterTableRls(prekidac: "DISABLE" | "ENABLE"): RegExp {
  return new RegExp(
    String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${IDENT})\s+${prekidac}\s+ROW\s+LEVEL\s+SECURITY`,
    "iu",
  )
}
const DISABLE_RLS = alterTableRls("DISABLE")
const ENABLE_RLS = alterTableRls("ENABLE")
/** `ALTER VIEW <ime> ...` kao POČETAK naredbe, sa imenom kao grupom — pandan
 *  `alterViewZaIme` za slučaj kad ime NIJE unaprijed poznato (v. `uklonjenaZastita`).
 *  Grupa 1 je vodeći whitespace/komentar (potrebna samo za tačan pomak do `ALTER`),
 *  grupa 2 je ime. Anker i tolerancija na `--` komentar su isti kao u `alterViewZaIme`. */
const ALTER_VIEW_IME = new RegExp(
  String.raw`^((?:\s|--[^\n]*)*)ALTER\s+VIEW\s+(?:IF\s+EXISTS\s+)?(${IDENT})`,
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
function efektivniInvokerZaView(
  naredbe: readonly Naredba[],
  ime: string,
  inlineStanje: boolean,
): boolean {
  let stanje = inlineStanje
  const regex = alterViewZaIme(ime)
  for (const { tekst } of naredbe) {
    if (!regex.test(tekst)) continue
    if (SECURITY_INVOKER_ON.test(tekst)) stanje = true
    else if (SECURITY_INVOKER_OFF.test(tekst)) stanje = false
  }
  return stanje
}

type Naredba = {
  tekst: string
  /** Pomak početka naredbe u originalnom `sadrzaj` — za `brojLinije`. */
  pomak: number
}

/**
 * Fajl razbijen na naredbe po `;`, sa pomakom svake. Namjerno naivno razdvajanje: `;`
 * unutar komentara, string literala i dollar-quoted tijela je već maskiran razmakom u
 * `sanitizujSql` (v. sql.ts), pa ovdje ne pravi lažnu granicu. Postoji da se isti split
 * ne radi iznova u svakoj funkciji i da pomak (pa i broj linije) bude izračunat na
 * jednom mjestu.
 */
function razbijNaNaredbe(sadrzaj: string): Naredba[] {
  const naredbe: Naredba[] = []
  let pomak = 0
  for (const tekst of sadrzaj.split(";")) {
    naredbe.push({ tekst, pomak })
    pomak += tekst.length + 1
  }
  return naredbe
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
function zivePolitikePoTabeli(naredbe: readonly Naredba[]): Map<string, Set<string>> {
  const zive = new Map<string, Set<string>>()
  for (const { tekst: naredba } of naredbe) {
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

/** Stanje jedne zaštite na kraju fajla, sa pomakom naredbe koja ga je posljednja
 *  postavila (za broj linije u nalazu). */
type Stanje = { ugasena: boolean; pomak: number }

/**
 * Nalazi pravila `zastita-uklonjena` — naredbe koje zaštitu SKIDAJU, gledano po NETO
 * EFEKTU NA KRAJU FAJLA (v. modul-nivo komentar).
 *
 * `kreiraneTabele`/`kreiraniViewovi` su objekti kreirani u ISTOM fajlu; za njih se
 * nalaz o politici/invokeru izostavlja jer ga `tabela-bez-politike`/`view-bez-invokera`
 * već daju. `DISABLE ROW LEVEL SECURITY` se prijavljuje bez obzira na to — nijedno
 * drugo pravilo tu naredbu ne poznaje.
 */
function nalaziUklonjeneZastite(
  putanja: string,
  sadrzaj: string,
  naredbe: readonly Naredba[],
  zivePoTabeli: ReadonlyMap<string, Set<string>>,
  kreiraneTabele: ReadonlySet<string>,
  kreiraniViewovi: ReadonlySet<string>,
): Nalaz[] {
  const rls = new Map<string, Stanje>()
  const invoker = new Map<string, Stanje>()
  /** Tabele sa DROP POLICY u fajlu → imena obrisanih politika, redom, i pomak prvog dropa. */
  const dropnute = new Map<string, { imena: string[]; pomak: number }>()

  for (const { tekst, pomak } of naredbe) {
    const disable = DISABLE_RLS.exec(tekst)
    if (disable?.[1] !== undefined) {
      rls.set(kratkoIme(disable[1]), { ugasena: true, pomak: pomak + disable.index })
      continue
    }
    const enable = ENABLE_RLS.exec(tekst)
    if (enable?.[1] !== undefined) {
      rls.set(kratkoIme(enable[1]), { ugasena: false, pomak: pomak + enable.index })
      continue
    }
    const drop = DROP_POLICY.exec(tekst)
    if (drop) {
      const imePolitike = drop[1] ?? drop[2]
      const imeTabele = drop[3]
      if (imePolitike !== undefined && imeTabele !== undefined) {
        const tabela = kratkoIme(imeTabele)
        const zapis = dropnute.get(tabela) ?? { imena: [], pomak: pomak + drop.index }
        zapis.imena.push(imePolitike)
        dropnute.set(tabela, zapis)
        continue
      }
    }
    const alterView = ALTER_VIEW_IME.exec(tekst)
    if (alterView?.[2] !== undefined) {
      const ime = kratkoIme(alterView[2])
      const pocetak = pomak + alterView.index + (alterView[1]?.length ?? 0)
      if (SECURITY_INVOKER_OFF.test(tekst)) invoker.set(ime, { ugasena: true, pomak: pocetak })
      else if (SECURITY_INVOKER_ON.test(tekst)) invoker.set(ime, { ugasena: false, pomak: pocetak })
    }
  }

  const nalazi: Nalaz[] = []

  for (const [tabela, stanje] of rls) {
    if (!stanje.ugasena) continue
    nalazi.push({
      putanja,
      linija: brojLinije(sadrzaj, stanje.pomak),
      pravilo: "zastita-uklonjena",
      poruka: `isključen RLS (row level security) na tabeli ${tabela} — tabela postaje čitljiva svakom prijavljenom korisniku`,
      tabela,
    })
  }

  for (const [tabela, zapis] of dropnute) {
    if ((zivePoTabeli.get(tabela)?.size ?? 0) > 0) continue
    if (kreiraneTabele.has(tabela)) continue
    nalazi.push({
      putanja,
      linija: brojLinije(sadrzaj, zapis.pomak),
      pravilo: "zastita-uklonjena",
      poruka: `obrisana RLS politika ${zapis.imena.join(", ")} sa tabele ${tabela} bez zamjene — tabela na kraju fajla nema nijednu politiku`,
      tabela,
    })
  }

  for (const [view, stanje] of invoker) {
    if (!stanje.ugasena) continue
    if (kreiraniViewovi.has(view)) continue
    nalazi.push({
      putanja,
      linija: brojLinije(sadrzaj, stanje.pomak),
      pravilo: "zastita-uklonjena",
      poruka: `isključen security_invoker na VIEW-u ${view} — view ponovo zaobilazi RLS`,
    })
  }

  return nalazi.sort((a, b) => a.linija - b.linija)
}

export function provjeriSql(izvor: Izvor): Nalaz[] {
  const { putanja, sadrzaj } = izvor
  const nalazi: Nalaz[] = []
  const naredbe = razbijNaNaredbe(sadrzaj)

  // VIEW: gleda se svaka naredba zasebno za inline invoker (WITH (security_invoker=on)),
  // da invoker iz jedne naredbe ne pokrije drugu. Ali repo ima i obrazac gdje se invoker
  // naknadno mijenja preko ALTER VIEW <ime> ... u ISTOM fajlu (npr. nakon DROP+CREATE
  // koji ga izgubi, ILI namjerno/greškom isključen) — efektivniInvokerZaView gleda SVE
  // takve ALTER naredbe REDOM (zadnja odlučuje), s granicom riječi da <ime> ne pokrije
  // ime koje ga sadrži kao prefiks (ili obrnuto).
  const kreiraniViewovi = new Set<string>()
  for (const { tekst: naredba, pomak } of naredbe) {
    const pogodak = VIEW.exec(naredba)
    if (pogodak && pogodak[1] !== undefined) {
      const ime = kratkoIme(pogodak[1])
      kreiraniViewovi.add(ime)
      const inlineStanje = SECURITY_INVOKER_ON.test(naredba)
      const imaInvoker = efektivniInvokerZaView(naredbe, ime, inlineStanje)
      if (!imaInvoker) {
        nalazi.push({
          putanja,
          linija: brojLinije(sadrzaj, pomak + pogodak.index),
          pravilo: "view-bez-invokera",
          poruka: `VIEW ${ime} bez security_invoker=on — zaobilazi RLS`,
        })
      }
    }
  }

  // Tabela bez ijedne ŽIVE politike (kreirana pa NIJE naknadno obrisana bez ponovnog
  // kreiranja) u istom fajlu — v. zivePolitikePoTabeli.
  const zivePoTabeli = zivePolitikePoTabeli(naredbe)
  const kreiraneTabele = new Set<string>()
  for (const pogodak of sadrzaj.matchAll(TABELA)) {
    const sirovoIme = pogodak[1]
    if (sirovoIme === undefined) continue
    const ime = kratkoIme(sirovoIme)
    kreiraneTabele.add(ime)
    const imaZivuPolitiku = (zivePoTabeli.get(ime)?.size ?? 0) > 0
    if (imaZivuPolitiku) continue
    nalazi.push({
      putanja,
      linija: brojLinije(sadrzaj, pogodak.index),
      pravilo: "tabela-bez-politike",
      poruka: `tabela ${ime} nema RLS politiku — cloud trigger uključi RLS, pa upit tiho vraća nula redova`,
      tabela: ime,
    })
  }

  nalazi.push(
    ...nalaziUklonjeneZastite(
      putanja,
      sadrzaj,
      naredbe,
      zivePoTabeli,
      kreiraneTabele,
      kreiraniViewovi,
    ),
  )

  return nalazi
}

export function provjeriIzvore(izvori: Izvor[]): Nalaz[] {
  return izvori
    .flatMap((izvor) => {
      if (izvor.putanja.endsWith(".sql")) return provjeriSql(izvor)
      if (jeTsIzvor(izvor.putanja)) return provjeriTs(izvor)
      return []
    })
    .sort((a, b) => a.putanja.localeCompare(b.putanja) || a.linija - b.linija)
}
