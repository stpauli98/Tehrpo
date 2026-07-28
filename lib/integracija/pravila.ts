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
const VIEW = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([A-Za-z0-9_."]+)/i
const TABELA = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi
const POLITIKA = /CREATE\s+POLICY/i
const SECURITY_INVOKER = /security_invoker\s*=\s*on/i

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
 * Da li se negdje u cijelom `sadrzaj`-u view `ime` naknadno postavlja na
 * security_invoker=on preko `ALTER VIEW <ime> ... security_invoker = on`.
 *
 * Pretraga je ograničena na JEDNU `;`-razdvojenu naredbu (isti pristup kao za
 * CREATE VIEW niže) — naredba mora i početi sa `ALTER VIEW <ime>` (dozvoljeni
 * su vodeći whitespace i `-- ...` SQL komentari, npr. "Re-apply security_invoker"
 * napomena iznad stvarne ALTER VIEW linije) i sadržati `security_invoker=on`
 * unutar SEBE. Bez granice na jednu naredbu, lijeni `[\s\S]*?` bi mogao
 * preskočiti preko granice naredbe i pokupiti invoker koji pripada SLJEDEĆOJ
 * `ALTER VIEW` naredbi za neki drugi view (lažni negativ).
 *
 * Granica riječi (`\b`) uz ime sprječava da `termini` pokrije `termini_view`
 * i obrnuto (isti obrazac kao `politikaZaOvu` za tabele — `_` je karakter
 * riječi, pa `\b` ne prelazi granicu prefiksa).
 */
function imaAlterInvokerZaView(sadrzaj: string, ime: string): boolean {
  const alterZaIme = new RegExp(
    `^(?:\\s|--[^\\n]*)*ALTER\\s+VIEW\\s+[A-Za-z0-9_."]*\\b${ime}\\b`,
    "i",
  )
  return sadrzaj
    .split(";")
    .some((naredba) => alterZaIme.test(naredba) && SECURITY_INVOKER.test(naredba))
}

export function provjeriSql(izvor: Izvor): Nalaz[] {
  const { putanja, sadrzaj } = izvor
  const nalazi: Nalaz[] = []

  // VIEW: gleda se svaka naredba zasebno za inline invoker (WITH (security_invoker=on)),
  // da invoker iz jedne naredbe ne pokrije drugu. Ali repo ima i obrazac gdje se invoker
  // vraća naknadnom `ALTER VIEW <ime> ... security_invoker=on` naredbom u istom fajlu
  // (npr. nakon DROP+CREATE koji ga izgubi) — to se traži preko cijelog sadržaja, s
  // granicom riječi da <ime> ne pokrije ime koje ga sadrži kao prefiks (ili obrnuto).
  let pomak = 0
  for (const naredba of sadrzaj.split(";")) {
    const pogodak = VIEW.exec(naredba)
    if (pogodak && pogodak[1] !== undefined) {
      const ime = kratkoIme(pogodak[1])
      const imaInvoker = SECURITY_INVOKER.test(naredba) || imaAlterInvokerZaView(sadrzaj, ime)
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

  // Tabela bez ijedne politike u istom fajlu.
  const imaPolitiku = POLITIKA.test(sadrzaj)
  for (const pogodak of sadrzaj.matchAll(TABELA)) {
    const sirovoIme = pogodak[1]
    if (sirovoIme === undefined) continue
    const ime = kratkoIme(sirovoIme)
    const politikaZaOvu = new RegExp(`CREATE\\s+POLICY[\\s\\S]*?ON\\s+[A-Za-z0-9_."]*\\b${ime}\\b`, "i")
    if (imaPolitiku && politikaZaOvu.test(sadrzaj)) continue
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
