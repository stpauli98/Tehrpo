/**
 * Generates tests/fixtures/tehpro-mini.xlsx with the two-block layout.
 *
 * Faithfully replicates the REAL Excel structure:
 *
 * Row1: FIRME header
 * Row2: client names in pairs (col2-3 WAIKIKI ZVORNIK, col4-5 CARMEUSE, col6-7 po ugovoru stub)
 * Row3: Izvršeno: / Planirano: labels
 * Block1:
 *   Row4: "Servis PP aparata"  col2=15.01.2026. (WAIKIKI izvrseno)
 *   Row5: "Ispitivanje hidranata"
 * Row6: OBILASCI (separator)
 * Row7: OBILASCI header — DUPLICATED like real Excel:
 *         col2 AND col3 = "Planirano"  (first occurrence → pCol=2)
 *         col4 AND col5 = "Izvršeno"   (first occurrence → iCol=4)
 * Block2:
 *   Row8: NEW YORKER - Doboj
 *         col2="21.-22.01.2026." (plan slot 1)  col3="05.02.2026." (plan slot 2)
 *         col4="15.01.2026."     (izvr slot 1)  col5="28.01.2026." (izvr slot 2)
 *
 * This exercises: header first-match with duplicated labels, BOTH columns of
 * each pair read and classified correctly (2 planirano + 2 izvrseno = 4 termini).
 */

import ExcelJS from "exceljs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FIXTURE_PATH = path.join(__dirname, "../tests/fixtures/tehpro-mini.xlsx")

async function main() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Januar")

  // Row 1: header
  ws.getRow(1).getCell(1).value = "FIRME"

  // Row 2: client names in pairs
  // col2-3: WAIKIKI ZVORNIK (izvrseno=col2, planirano=col3)
  // col4-5: CARMEUSE (izvrseno=col4, planirano=col5)
  // col6-7: po ugovoru (stub - should be skipped)
  ws.getRow(2).getCell(2).value = "WAIKIKI ZVORNIK"
  ws.getRow(2).getCell(4).value = "CARMEUSE"
  ws.getRow(2).getCell(6).value = "po ugovoru"

  // Row 3: Izvrseno/Planirano labels
  ws.getRow(3).getCell(2).value = "Izvršeno:"
  ws.getRow(3).getCell(3).value = "Planirano:"
  ws.getRow(3).getCell(4).value = "Izvršeno:"
  ws.getRow(3).getCell(5).value = "Planirano:"
  ws.getRow(3).getCell(6).value = "po ponudi"
  ws.getRow(3).getCell(7).value = "Planirano:"

  // Block1: Row 4 - Servis PP aparata with date for WAIKIKI izvrseno
  ws.getRow(4).getCell(1).value = "Servis PP aparata"
  ws.getRow(4).getCell(2).value = "15.01.2026." // WAIKIKI izvrseno

  // Block1: Row 5 - Ispitivanje hidranata (no dates)
  ws.getRow(5).getCell(1).value = "Ispitivanje hidranata"

  // Row 6: OBILASCI separator
  ws.getRow(6).getCell(1).value = "OBILASCI"

  // Row 7: OBILASCI block header — DUPLICATED across both columns of each pair,
  // matching the real Excel layout. First-match fix must yield pCol=2, iCol=4.
  ws.getRow(7).getCell(2).value = "Planirano"  // first "Planirano" → pCol=2
  ws.getRow(7).getCell(3).value = "Planirano"  // duplicate (last-write-wins bug would set pCol=3)
  ws.getRow(7).getCell(4).value = "Izvršeno"   // first "Izvršeno" → iCol=4
  ws.getRow(7).getCell(5).value = "Izvršeno"   // duplicate (last-write-wins bug would set iCol=5)

  // Block2: Row 8 - NEW YORKER - Doboj with DISTINCT dates in ALL 4 slots.
  // This proves both columns of each pair are read and classified correctly.
  ws.getRow(8).getCell(1).value = "NEW YORKER - Doboj"
  ws.getRow(8).getCell(2).value = "21.-22.01.2026." // planirano slot 1 → 2026-01-21
  ws.getRow(8).getCell(3).value = "05.02.2026."     // planirano slot 2 → 2026-02-05
  ws.getRow(8).getCell(4).value = "15.01.2026."     // izvrseno slot 1 → 2026-01-15
  ws.getRow(8).getCell(5).value = "28.01.2026."     // izvrseno slot 2 → 2026-01-28

  await wb.xlsx.writeFile(FIXTURE_PATH)
  console.log("Fixture generated:", FIXTURE_PATH)
}

main().catch(e => { console.error(e); process.exit(1) })
