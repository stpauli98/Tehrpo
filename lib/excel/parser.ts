import ExcelJS from "exceljs"
import type { ParsedTermin, ParseResult, SkippedRow } from "./parser.types"

/**
 * Parsira Tehpro Excel ("2026- obilasci, pregledi i ispitivanja, obuke,
 * dokumentacija.xlsx") u flat listu termina.
 *
 * Struktura sheet-a (svaki mjesec ima isti format):
 * - Row 1: header "FIRME" (ignoriše se)
 * - Row 2: nazivi klijenata u parnim kolonama (B, D, F, ...)
 * - Row 3: alternating "Izvršeno:" / "Planirano:" (B=izvr, C=plan, D=izvr, ...)
 * - Row 4+: vrste pregleda u koloni A, datumi u koloni klijenta
 */
export async function parseTehproExcel(filePath: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)

  const termini: ParsedTermin[] = []
  const klijentiSet = new Set<string>()
  const vrsteSet = new Set<string>()
  const skipped: SkippedRow[] = []

  for (const sheet of wb.worksheets) {
    const sheetNaziv = sheet.name.trim()

    // Row 2 — parovi (klijent name na col 2, 4, 6, ...)
    const row2 = sheet.getRow(2)
    const klijentiByCol: Record<number, string> = {}
    row2.eachCell((cell, colNumber) => {
      if (colNumber === 1) return // skip "FIRME" header
      const val = String(cell.value ?? "").trim()
      if (val && val !== " ") {
        klijentiByCol[colNumber] = val
        klijentiSet.add(val)
      }
    })

    // Row 4+ — vrste u col A, datumi u svakoj klijent-koloni (izvrseno + planirano)
    // rowCount (not actualRowCount) ensures we get all rows incl. trailing ones with only col A filled
    const lastRow = sheet.rowCount
    for (let r = 4; r <= lastRow; r++) {
      const row = sheet.getRow(r)
      const vrstaRaw = row.getCell(1).value
      const vrstaNaziv = normalizeVrsta(String(vrstaRaw ?? "").trim())
      if (!vrstaNaziv) continue
      vrsteSet.add(vrstaNaziv)

      // Za svaki klijent par (col_izvr, col_plan)
      for (const [colStr, klijentNaziv] of Object.entries(klijentiByCol)) {
        const colIzvr = Number(colStr)
        const colPlan = colIzvr + 1

        const datumIzvr = extractDate(row.getCell(colIzvr).value)
        const datumPlan = extractDate(row.getCell(colPlan).value)

        if (datumIzvr) {
          termini.push({
            klijent_naziv: klijentNaziv,
            vrsta_naziv: vrstaNaziv,
            sheet_naziv: sheetNaziv,
            datum: datumIzvr,
            izvor: "izvrseno",
          })
        } else if (rawIsNonEmpty(row.getCell(colIzvr).value) && !datumIzvr) {
          skipped.push({ sheet: sheetNaziv, row: r, col: colIzvr, reason: `Izvrseno cell not parseable: ${String(row.getCell(colIzvr).value)}` })
        }

        if (datumPlan) {
          termini.push({
            klijent_naziv: klijentNaziv,
            vrsta_naziv: vrstaNaziv,
            sheet_naziv: sheetNaziv,
            datum: datumPlan,
            izvor: "planirano",
          })
        } else if (rawIsNonEmpty(row.getCell(colPlan).value) && !datumPlan) {
          skipped.push({ sheet: sheetNaziv, row: r, col: colPlan, reason: `Planirano cell not parseable: ${String(row.getCell(colPlan).value)}` })
        }
      }
    }
  }

  return {
    termini,
    klijenti: Array.from(klijentiSet).sort(),
    vrste: Array.from(vrsteSet).sort(),
    skipped,
  }
}

/**
 * Normalizuje višelinijski naziv vrste pregleda (Excel često ima newline-ove
 * i parentezirane potkategorije). Svodi multiline u jednu liniju.
 */
function normalizeVrsta(raw: string): string {
  if (!raw) return ""
  // Sve newline-ove → razmak; višestruke razmake → jedan
  return raw.replace(/\s+/g, " ").trim()
}

/**
 * Excel ćelija može biti: Date objekat (ExcelJS auto-parsing), broj
 * (Excel serial date), string "20.01.2026.", string sa whitespace,
 * ili null. Vraća "YYYY-MM-DD" ili null.
 */
function extractDate(raw: ExcelJS.CellValue): string | null {
  if (raw == null) return null
  if (raw instanceof Date) {
    return toIsoDate(raw)
  }
  if (typeof raw === "number") {
    // Excel serial (days since 1900-01-01 sa Lotus bug)
    const date = excelSerialToDate(raw)
    return date ? toIsoDate(date) : null
  }
  if (typeof raw === "string") {
    return parseStringDate(raw.trim())
  }
  // ExcelJS rich text / formula result
  if (typeof raw === "object" && raw !== null && "text" in raw && typeof (raw as { text: unknown }).text === "string") {
    return parseStringDate((raw as { text: string }).text.trim())
  }
  if (typeof raw === "object" && raw !== null && "result" in raw) {
    return extractDate((raw as { result: ExcelJS.CellValue }).result)
  }
  return null
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function excelSerialToDate(serial: number): Date | null {
  if (!isFinite(serial) || serial < 1) return null
  // Excel epoch: 1899-12-30 (uračunava 1900 leap year bug)
  const epoch = Date.UTC(1899, 11, 30)
  return new Date(epoch + serial * 86400_000)
}

function parseStringDate(s: string): string | null {
  if (!s) return null
  // "20.01.2026." ili "20.01.2026" ili "20.1.2026"
  const matched = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/)
  if (matched && matched[1] && matched[2] && matched[3]) {
    const d = matched[1]
    const mo = matched[2]
    const y = matched[3]
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  // Već ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10)
  }
  return null
}

function rawIsNonEmpty(v: ExcelJS.CellValue): boolean {
  if (v == null) return false
  if (typeof v === "string") return v.trim().length > 0
  return true
}
