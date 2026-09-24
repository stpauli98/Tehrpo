import ExcelJS from "exceljs"
import type { ParsedTermin, ParseResult, SkippedRow } from "./parser.types"
import { izvediGrad } from "../obilasci"

// ---------------------------------------------------------------------------
// Konstante — kanonizacijska osnova
// ---------------------------------------------------------------------------

// Poznate firme (whitelist prefix-match). Sortiraj po dužini DESC u kodu da duži
// prefiks pobijedi (npr. "MARKET AS" prije "AS"). NE oslanjaj se na redoslijed liste.
export const POZNATE_FIRME = [
  "EKONOMSKI INSTITUT", "GRANT THORNTON", "NEW YORKER",
  "MARKET AS", "NTS NETWORK", "CLEAN TRADE", "MIKROELEKTRONIKA",
  "WAIKIKI", "TRANSFERA", "CARMEUSE", "DIORIT", "DEVTECH",
  "MINT", "YIMMOR", "AS",
] as const
// NAPOMENA: "VENETO" i "DOM ZDRAVLJA" NISU lanci — "VENETO SHOES" je puni naziv
// firme, a "Dom zdravlja Dr Mladen Stojanović"/"...Laktaši" su 2 odvojene ustanove
// (vidi FIRMA_ALIAS za dedup varijanti).

const FIRME_SORTED = [...POZNATE_FIRME].sort((a, b) => b.length - a.length)

// Eksplicitni aliasi za "prljave" pune nazive (navodnici/dijakritika variraju kroz
// sheet-ove). Primjenjuje se PRIJE whitelist-a; vraća kanonski display naziv firme.
const FIRMA_ALIAS: { re: RegExp; firma: string }[] = [
  { re: /^DOM ZDRAVLJA.*MLADEN/, firma: "Dom zdravlja Dr Mladen Stojanović" },
  { re: /^DOM ZDRAVLJA.*LAKTA/, firma: "Dom zdravlja Laktaši" },
  // "VENETO" i "VENETO SHOES" su ista firma (Excel ima oba oblika) → spoji
  { re: /^VENETO\b/, firma: "VENETO SHOES" },
]

// Per-firma kanonizacija LOKACIJE.
// Ulaz je već canonicalizeNaziv-ovan ostatak (UPPERCASE). Vrati kanonsku lokaciju.
function canonLokacija(firma: string, lokRaw: string | null): string | null {
  if (lokRaw == null) return null

  // Pravilo 1: Zarez → kombinovana posjeta, vrati nepromijenjeno
  if (lokRaw.includes(",")) return lokRaw

  const u = lokRaw.toUpperCase()

  // Pravilo 1b: pravni sufiks (A.D., d.o.o.) NIJE lokacija (npr. MIKROELEKTRONIKA A.D.)
  if (/^A\.?\s*D\.?$/.test(u) || /^D\.?\s*O\.?\s*O\.?$/.test(u)) return null

  // Pravilo 2: TRANSFERA — 3 kanonske lokacije
  if (firma === "TRANSFERA") {
    if (/SKLADI[SŠ]TE/.test(u)) return "FBiH - skladište"
    if (/KANCELARIJA/.test(u)) return "FBiH - kancelarija"
    if (u === "RS") return "RS"
    // Gola "FBIH" (iz OBILASCI "TRANSFERA FBIH") → skladište (bila "FBiH", sada ispravljeno)
    if (u === "FBIH") return "FBiH - skladište"
  }

  // Pravilo 3: WAIKIKI / NEW YORKER — dedup BL prodavnica (Delta, Emporium, Boska, Kort)
  if (firma === "WAIKIKI" || firma === "NEW YORKER") {
    if (/\bDELTA\b/.test(u))    return "Banja Luka - Delta"
    if (/\bEMPORIUM\b/.test(u)) return "Banja Luka - Emporium"
    if (/\bBOSKA\b/.test(u))    return "Banja Luka - Boska"
    if (/\bKORT\b/.test(u))     return "Banja Luka - Kort"
  }

  // Pravilo 4: sve ostalo — lokacija ostaje kakva jeste
  return lokRaw
}

// ---------------------------------------------------------------------------
// Exports za testove
// ---------------------------------------------------------------------------

/**
 * Kanonizuje naziv: UPPERCASE, kolaps razmaka, skida završnu tačku,
 * normalizuje razmake oko crtice.
 */
export function canonicalizeNaziv(raw: string): string {
  return raw
    .replace(/["'“”„]/g, "") // skini navodnike (npr. Dom zdravlja "Dr Mladen Stojanović")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "")
    .replace(/\s*-\s*/g, " - ")
    .toUpperCase()
}

/**
 * Razdvaja "FIRMA LOKACIJA" u {firma, lokacija} koristeći prefix-match
 * po FIRME_SORTED (dužina DESC). Primjenjuje canonLokacija za per-firma
 * normalizaciju lokacije (npr. TRANSFERA fragmentacija → 3 kanonske lokacije).
 */
export function splitFirmaLokacija(naziv: string): { firma: string; lokacija: string | null } {
  const c = canonicalizeNaziv(naziv)
  // Aliasi za prljave pune nazive (dedup navodnik/dijakritika varijanti) — prije whitelist-a
  for (const a of FIRMA_ALIAS) {
    if (a.re.test(c)) return { firma: a.firma, lokacija: null }
  }
  for (const firma of FIRME_SORTED) {
    if (c === firma) {
      return { firma, lokacija: null }
    }
    if (c.startsWith(firma + " ")) {
      const ostatak = c.slice(firma.length).replace(/^[\s-]+/, "").trim()
      return { firma, lokacija: canonLokacija(firma, ostatak || null) }
    }
  }
  // Nijedna firma ne matchuje — cijeli naziv = firma (zabilježi za T3 gate pregled)
  return { firma: c, lokacija: null }
}

/**
 * Parsira string datum iz Excel ćelije.
 * Podržava: obični datum, range datumi (početni), ISO, datum + tekst.
 */
export function parseStringDate(s: string): string | null {
  s = s.trim()
  if (!s) return null

  // 1) datum + tekst iza ("25.06.2026. servis", "10.04.2026. , 17.04.2026.") → vodeći datum
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?(?:\s|,|$)/)
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`

  // 2) 'D.-D.M.YYYY.' (npr. 21.-22.01.2026.) → početni
  m = s.match(/^(\d{1,2})\.-\d{1,2}\.(\d{1,2})\.(\d{4})\.?$/)
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`

  // 3) 'D.M.-D.M.YYYY.' → početni
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.-\d{1,2}\.\d{1,2}\.(\d{4})\.?$/)
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`

  // 4) 'D-D.M.YYYY.' (crtica bez tačke, npr. 03-04.04.2026.) → početni
  m = s.match(/^(\d{1,2})-\d{1,2}\.(\d{1,2})\.(\d{4})\.?$/)
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`

  // 5) ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)

  return null
}

// ---------------------------------------------------------------------------
// Internalni helperi
// ---------------------------------------------------------------------------

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${mo}-${day}`
}

function excelSerialToDate(serial: number): Date | null {
  if (!isFinite(serial) || serial < 1) return null
  // Excel epoch: 1899-12-30 (uračunava 1900 leap year bug)
  const epoch = Date.UTC(1899, 11, 30)
  return new Date(epoch + serial * 86400_000)
}

/**
 * Excel ćelija može biti: Date objekat (ExcelJS auto-parsing), broj
 * (Excel serial date), string "20.01.2026.", rich text, ili null.
 * Vraća "YYYY-MM-DD" ili null.
 */
function extractDate(raw: ExcelJS.CellValue): string | null {
  if (raw == null) return null
  if (raw instanceof Date) {
    return toIsoDate(raw)
  }
  if (typeof raw === "number") {
    const date = excelSerialToDate(raw)
    return date ? toIsoDate(date) : null
  }
  if (typeof raw === "string") {
    return parseStringDate(raw.trim())
  }
  // ExcelJS rich text
  if (typeof raw === "object" && raw !== null && "text" in raw && typeof (raw as { text: unknown }).text === "string") {
    return parseStringDate((raw as { text: string }).text.trim())
  }
  // Formula result
  if (typeof raw === "object" && raw !== null && "result" in raw) {
    return extractDate((raw as { result: ExcelJS.CellValue }).result)
  }
  return null
}

/**
 * Da li je ćelija SLAVE dio spojenog (merged) raspona?
 *
 * ExcelJS `row.eachCell` obilazi i slave ćelije spoja i vraća im vrijednost
 * mastera (cell.type === ValueType.Merge). Master ćelija ima `master === self`,
 * pa je poređenje adrese pouzdano i za spojene i za obične ćelije.
 */
export function jeSlaveSpoja(cell: ExcelJS.Cell): boolean {
  const master = cell.master
  return master != null && master.address !== cell.address
}

function rawIsNonEmpty(v: ExcelJS.CellValue): boolean {
  if (v == null) return false
  if (typeof v === "string") return v.trim().length > 0
  return true
}

function getCellStr(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  const val = sheet.getRow(row).getCell(col).value
  if (val == null) return ""
  if (typeof val === "string") return val.trim()
  if (typeof val === "object" && val !== null && "text" in val) return String((val as { text: unknown }).text).trim()
  return String(val).trim()
}

// Stub-kolone koje SKIP-amo (ne sadrže klijente)
const STUB_PATTERNS = ["PO UGOVORU", "PO PONUDI"]

function isStubKolona(naziv: string): boolean {
  const c = canonicalizeNaziv(naziv)
  return STUB_PATTERNS.some(p => c === p || c.includes(p))
}

/**
 * Normalizuje višelinijski naziv vrste pregleda.
 */
function normalizeVrsta(raw: string): string {
  if (!raw) return ""
  return raw.replace(/\s+/g, " ").trim()
}

// ---------------------------------------------------------------------------
// Glavni parser
// ---------------------------------------------------------------------------

/**
 * Parsira Tehpro Excel ("2026- obilasci, pregledi i ispitivanja, obuke,
 * dokumentacija.xlsx") u ParseResult sa firma/lokacija splitom i dvoblokovnom
 * strukturom (Block1: vrste pregleda; Block2: OBILASCI).
 *
 * Struktura sheet-a (svaki mjesec isti format):
 * - Row 1: header "FIRME"
 * - Row 2: nazivi klijenata u PAROVIMA (col i = Izvršeno, col i+1 = Planirano);
 *          zadnja stub kolona "po ugovoru"/"po ponudi" → SKIP
 * - Row 3: "Izvršeno:" / "Planirano:" labele
 * - Rows 4..obilasciRow-1: Block1 — vrsta u colA, datumi u klijent-parovima
 * - Row obilasciRow: colA = "OBILASCI" (separator)
 * - Row obilasciRow+1: header Block2 (col2 = Planirano, col4 = Izvršeno)
 * - Rows obilasciRow+2..end: Block2 — klijent u colA, datumi u col2-3 (plan) i col4-5 (izvr)
 */

/** Dedupe termina: jedan po (firma|vrsta|lokacija|datum); izvrseno ima prednost nad planirano. */
export function dedupeTermini(termini: ParsedTermin[]): ParsedTermin[] {
  const map = new Map<string, ParsedTermin>()
  for (const t of termini) {
    const key = `${t.firma_naziv}||${t.vrsta_naziv}||${t.lokacija_naziv ?? "∅"}||${t.datum}`
    const post = map.get(key)
    if (!post) { map.set(key, t); continue }
    if (post.izvor !== "izvrseno" && t.izvor === "izvrseno") map.set(key, t)
  }
  return Array.from(map.values())
}

export async function parseTehproExcel(filePath: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)

  const termini: ParsedTermin[] = []
  const firmeSet = new Set<string>()
  // lokacije: dedup set po "firma|lokacija"
  const lokacijeSet = new Set<string>()
  const lokacijeArr: { firma_naziv: string; lokacija_naziv: string; grad: string | null }[] = []
  const vrsteSet = new Set<string>()
  const skipped: SkippedRow[] = []

  function addFirmaLokacija(naziv: string) {
    const { firma, lokacija } = splitFirmaLokacija(naziv)
    firmeSet.add(firma)
    if (lokacija != null) {
      const key = `${firma}|${lokacija}`
      if (!lokacijeSet.has(key)) {
        lokacijeSet.add(key)
        lokacijeArr.push({ firma_naziv: firma, lokacija_naziv: lokacija, grad: izvediGrad(lokacija) })
      }
    }
    return { firma, lokacija }
  }

  for (const sheet of wb.worksheets) {
    const sheetNaziv = sheet.name.trim()
    const lastRow = sheet.rowCount

    // ── Row 2: klijent-parovi ────────────────────────────────────────────
    // Col i = Izvršeno, col i+1 = Planirano (parovi); skip stub kolone.
    const row2 = sheet.getRow(2)
    // klijentiByCol: col → naziv (samo izvr-kolone; plan = col+1)
    const klijentiByCol: Record<number, string> = {}
    // row3 za stub provjeru ("po ponudi" u izvr-koloni row3)
    row2.eachCell((cell, colNumber) => {
      if (colNumber === 1) return
      // Spojene ćelije (npr. B2:C2 = jedan klijent preko para Izvršeno/Planirano):
      // ExcelJS emituje i SLAVE ćeliju spoja sa vrijednošću mastera. Ako je ne
      // preskočimo, neparna (Planirano) kolona se registruje kao nova "izvr"
      // kolona pa se cijeli par pomjeri za 1 — planirano se čita kao izvršeno,
      // a izvršeno sljedeće firme kao fantomski planirani termin.
      if (jeSlaveSpoja(cell)) return
      const val = String(cell.value ?? "").trim()
      if (!val) return
      // Provjeri i po row2 i po row3 da li je stub
      const row3Val = getCellStr(sheet, 3, colNumber)
      if (isStubKolona(val) || isStubKolona(row3Val)) return
      // Smatramo svaku kolonu s ne-praznim row2 kao "izvr" kolonu para
      klijentiByCol[colNumber] = val
    })

    // ── Nađi obilasciRow ────────────────────────────────────────────────
    let obilasciRow = -1
    for (let r = 4; r <= lastRow; r++) {
      const colA = getCellStr(sheet, r, 1)
      if (canonicalizeNaziv(colA) === "OBILASCI") {
        obilasciRow = r
        break
      }
    }

    const block1End = obilasciRow > 0 ? obilasciRow - 1 : lastRow

    // ── Block 1: vrste pregleda (rows 4..block1End) ──────────────────────
    for (let r = 4; r <= block1End; r++) {
      const row = sheet.getRow(r)
      const vrstaRaw = String(row.getCell(1).value ?? "").trim()
      const vrstaNaziv = normalizeVrsta(vrstaRaw)
      if (!vrstaNaziv) continue
      // Skip OBILASCI row itself (shouldn't happen but safety)
      if (canonicalizeNaziv(vrstaNaziv) === "OBILASCI") continue

      vrsteSet.add(vrstaNaziv)

      for (const [colStr, klijentNaziv] of Object.entries(klijentiByCol)) {
        const colIzvr = Number(colStr)
        const colPlan = colIzvr + 1

        const datumIzvr = extractDate(row.getCell(colIzvr).value)
        const datumPlan = extractDate(row.getCell(colPlan).value)

        const { firma, lokacija } = addFirmaLokacija(klijentNaziv)

        if (datumIzvr) {
          termini.push({
            firma_naziv: firma,
            lokacija_naziv: lokacija,
            vrsta_naziv: vrstaNaziv,
            sheet_naziv: sheetNaziv,
            datum: datumIzvr,
            izvor: "izvrseno",
          })
        } else if (rawIsNonEmpty(row.getCell(colIzvr).value)) {
          skipped.push({
            sheet: sheetNaziv,
            row: r,
            col: colIzvr,
            reason: `Izvrseno cell not parseable: ${String(row.getCell(colIzvr).value)}`,
          })
        }

        if (datumPlan) {
          termini.push({
            firma_naziv: firma,
            lokacija_naziv: lokacija,
            vrsta_naziv: vrstaNaziv,
            sheet_naziv: sheetNaziv,
            datum: datumPlan,
            izvor: "planirano",
          })
        } else if (rawIsNonEmpty(row.getCell(colPlan).value)) {
          skipped.push({
            sheet: sheetNaziv,
            row: r,
            col: colPlan,
            reason: `Planirano cell not parseable: ${String(row.getCell(colPlan).value)}`,
          })
        }
      }
    }

    // ── Block 2: OBILASCI ────────────────────────────────────────────────
    if (obilasciRow < 0) continue // Nema OBILASCI bloka na ovom sheet-u

    // Header red (obilasciRow+1): nađi kolone za Planirano i Izvršeno
    const headerRow = obilasciRow + 1
    let pCol = 2 // default: planirano col
    let iCol = 4 // default: izvrseno col

    // First-match: iterate columns ascending and only set pCol/iCol on first hit.
    // The real Excel duplicates each label across both columns of its pair
    // (c2 AND c3 = "Planirano"; c4 AND c5 = "Izvršeno"). Last-write-wins would
    // resolve pCol=3, iCol=5, silently dropping col2 dates. We want pCol=2, iCol=4.
    let pColFound = false
    let iColFound = false
    const hRow = sheet.getRow(headerRow)
    const colCount = hRow.cellCount || 10
    for (let colNumber = 2; colNumber <= colCount; colNumber++) {
      const cell = hRow.getCell(colNumber)
      if (!cell.value) continue
      const v = canonicalizeNaziv(String(cell.value).trim())
      if (!pColFound && v === "PLANIRANO") { pCol = colNumber; pColFound = true }
      if (!iColFound && (v === "IZVRSENO" || v === "IZVRŠENO")) { iCol = colNumber; iColFound = true }
      if (pColFound && iColFound) break
    }

    // Rows obilasciRow+2..lastRow: klijent u colA, datumi u pCol..pCol+1 (plan) i iCol..iCol+1 (izvr)
    for (let r = obilasciRow + 2; r <= lastRow; r++) {
      const row = sheet.getRow(r)
      const klijentRaw = String(row.getCell(1).value ?? "").trim()
      if (!klijentRaw) continue
      // Skip ako je colA "OBILASCI" ili sličan separator
      if (canonicalizeNaziv(klijentRaw) === "OBILASCI") continue

      const { firma, lokacija } = addFirmaLokacija(klijentRaw)
      const vrstaNaziv = "Obilazak"
      vrsteSet.add(vrstaNaziv)

      // Planirano slots: pCol i pCol+1
      for (const col of [pCol, pCol + 1]) {
        const datum = extractDate(row.getCell(col).value)
        if (datum) {
          termini.push({
            firma_naziv: firma,
            lokacija_naziv: lokacija,
            vrsta_naziv: vrstaNaziv,
            sheet_naziv: sheetNaziv,
            datum,
            izvor: "planirano",
          })
        } else if (rawIsNonEmpty(row.getCell(col).value)) {
          skipped.push({
            sheet: sheetNaziv,
            row: r,
            col,
            reason: `OBILASCI planirano not parseable: ${String(row.getCell(col).value)}`,
          })
        }
      }

      // Izvršeno slots: iCol i iCol+1
      for (const col of [iCol, iCol + 1]) {
        const datum = extractDate(row.getCell(col).value)
        if (datum) {
          termini.push({
            firma_naziv: firma,
            lokacija_naziv: lokacija,
            vrsta_naziv: vrstaNaziv,
            sheet_naziv: sheetNaziv,
            datum,
            izvor: "izvrseno",
          })
        } else if (rawIsNonEmpty(row.getCell(col).value)) {
          skipped.push({
            sheet: sheetNaziv,
            row: r,
            col,
            reason: `OBILASCI izvrseno not parseable: ${String(row.getCell(col).value)}`,
          })
        }
      }
    }
  }

  return {
    firme: Array.from(firmeSet).sort(),
    lokacije: lokacijeArr,
    vrste: Array.from(vrsteSet).sort(),
    termini: dedupeTermini(termini),
    skipped,
  }
}
