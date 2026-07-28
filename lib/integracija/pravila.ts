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

/** Putanje u kojima admin klijent NIJE greška. */
const IZUZECI_ADMIN = [
  "scripts/",
  "app/api/cron/",
  "lib/supabase/admin.ts",
  "lib/supabase/storage.ts",
  "lib/cache.ts",
]

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

export function provjeriTs(izvor: Izvor): Nalaz[] {
  const { putanja, sadrzaj } = izvor
  const nalazi: Nalaz[] = []

  const uZahtjevnoj = putanja.startsWith("app/") || putanja.startsWith("components/")
  const izuzet = IZUZECI_ADMIN.some((p) => putanja.startsWith(p))

  if (uZahtjevnoj && !izuzet) {
    sadrzaj.split("\n").forEach((linija, i) => {
      if (ADMIN.test(linija)) {
        nalazi.push({
          putanja,
          linija: i + 1,
          pravilo: "admin-klijent",
          poruka:
            "service-role klijent u zahtjevnoj putanji zaobilazi RLS — koristi createServerSupabaseClient",
        })
      }
    })
  }

  if (putanja.startsWith("tests/")) {
    sadrzaj.split("\n").forEach((linija, i) => {
      if (linija.includes(PROD_REF)) {
        nalazi.push({
          putanja,
          linija: i + 1,
          pravilo: "prod-ref-u-testovima",
          poruka: "PROD ref u testu — E2E prolaz bi pisao u produkciju; cilj mora biti DEMO",
        })
      }
    })
  }

  return nalazi
}

export function provjeriSql(izvor: Izvor): Nalaz[] {
  const { putanja, sadrzaj } = izvor
  const nalazi: Nalaz[] = []

  // VIEW: gleda se svaka naredba zasebno, da invoker iz jedne ne pokrije drugu.
  let pomak = 0
  for (const naredba of sadrzaj.split(";")) {
    const pogodak = VIEW.exec(naredba)
    if (pogodak && pogodak[1] !== undefined && !SECURITY_INVOKER.test(naredba)) {
      nalazi.push({
        putanja,
        linija: brojLinije(sadrzaj, pomak + pogodak.index),
        pravilo: "view-bez-invokera",
        poruka: `VIEW ${kratkoIme(pogodak[1])} bez security_invoker=on — zaobilazi RLS`,
      })
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
