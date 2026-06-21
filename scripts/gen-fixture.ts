/**
 * Generates tests/fixtures/tehpro-mini.xlsx with the two-block layout:
 *
 * Row1: FIRME header
 * Row2: client names in pairs (col2-3 WAIKIKI ZVORNIK, col4-5 CARMEUSE, col6-7 po ugovoru stub)
 * Row3: Izvršeno: / Planirano: labels
 * Block1:
 *   Row4: "Servis PP aparata"  col2=15.01.2026. (WAIKIKI izvrseno)
 *   Row5: "Ispitivanje hidranata"
 * Row6: OBILASCI (separator)
 * Row7: OBILASCI header (col2=Planirano, col4=Izvršeno)
 * Block2:
 *   Row8: NEW YORKER - Doboj  col2=21.-22.01.2026. (planirano)  col4=15.01.2026. (izvrseno)
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

  // Row 7: OBILASCI block header
  ws.getRow(7).getCell(2).value = "Planirano"
  ws.getRow(7).getCell(4).value = "Izvršeno"

  // Block2: Row 8 - NEW YORKER - Doboj
  ws.getRow(8).getCell(1).value = "NEW YORKER - Doboj"
  ws.getRow(8).getCell(2).value = "21.-22.01.2026." // planirano (range date)
  ws.getRow(8).getCell(4).value = "15.01.2026."    // izvrseno

  await wb.xlsx.writeFile(FIXTURE_PATH)
  console.log("Fixture generated:", FIXTURE_PATH)
}

main().catch(e => { console.error(e); process.exit(1) })
