/**
 * Regresija: spojene (merged) ćelije u redu 2 NE SMIJU pomjeriti parove kolona.
 *
 * Stvarni Tehpro Excel drži naziv klijenta u ćeliji spojenoj preko para kolona
 * (B2:C2 = Izvršeno+Planirano jedne firme). ExcelJS `row.eachCell` obilazi i
 * SLAVE ćeliju spoja i vraća joj vrijednost mastera; bez guarda parser registruje
 * i neparnu (Planirano) kolonu kao "izvr" kolonu novog para pa se sve pomjeri za 1:
 *   - planirani datum se upiše kao izvor="izvrseno" (dedupe daje prednost izvršenom),
 *   - izvršeni datum sljedeće firme postane fantomski planirani termin prethodne.
 *
 * Fixture se generiše u temp direktoriju jer tests/fixtures/tehpro-mini.xlsx
 * (scripts/gen-fixture.ts) namjerno NEMA spojenih ćelija.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import ExcelJS from "exceljs"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseTehproExcel } from "./parser"
import type { ParsedTermin } from "./parser.types"

let tmpDir: string
let FIXTURE: string
let res: Awaited<ReturnType<typeof parseTehproExcel>>

/**
 * Layout (vjeran stvarnom Excelu):
 *   Row1: FIRME
 *   Row2: B2:C2 = "TRANSFERA RS"  |  D2:E2 = "CARMEUSE"  |  F2:G2 = "po ugovoru" (stub)
 *   Row3: Izvršeno:/Planirano: po paru
 *   Row4: "Servis PP aparata"  C4 = 20.01.2026. (TRANSFERA PLANIRANO)
 *                              D4 = 22.01.2026. (CARMEUSE IZVRŠENO)
 *   Row5: OBILASCI separator
 *   Row6: OBILASCI header — B6:C6 = "Planirano", D6:E6 = "Izvršeno" (spojeno)
 *   Row7: "NEW YORKER - Doboj"  B7 = 05.02.2026. (plan)  D7 = 15.01.2026. (izvr)
 */
async function napraviFixture(file: string) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Januar")

  ws.getRow(1).getCell(1).value = "FIRME"

  ws.getRow(2).getCell(2).value = "TRANSFERA RS"
  ws.getRow(2).getCell(4).value = "CARMEUSE"
  ws.getRow(2).getCell(6).value = "po ugovoru"
  ws.mergeCells(2, 2, 2, 3) // B2:C2
  ws.mergeCells(2, 4, 2, 5) // D2:E2
  ws.mergeCells(2, 6, 2, 7) // F2:G2 (stub)

  for (const c of [2, 4, 6]) {
    ws.getRow(3).getCell(c).value = "Izvršeno:"
    ws.getRow(3).getCell(c + 1).value = "Planirano:"
  }

  ws.getRow(4).getCell(1).value = "Servis PP aparata"
  ws.getRow(4).getCell(3).value = "20.01.2026." // TRANSFERA — PLANIRANO
  ws.getRow(4).getCell(4).value = "22.01.2026." // CARMEUSE — IZVRŠENO

  ws.getRow(5).getCell(1).value = "OBILASCI"

  ws.getRow(6).getCell(2).value = "Planirano"
  ws.getRow(6).getCell(4).value = "Izvršeno"
  ws.mergeCells(6, 2, 6, 3)
  ws.mergeCells(6, 4, 6, 5)

  ws.getRow(7).getCell(1).value = "NEW YORKER - Doboj"
  ws.getRow(7).getCell(2).value = "05.02.2026."
  ws.getRow(7).getCell(4).value = "15.01.2026."

  await wb.xlsx.writeFile(file)
}

const nadji = (t: ParsedTermin[], firma: string, datum: string) =>
  t.filter(x => x.firma_naziv === firma && x.datum === datum)

describe("parseTehproExcel — spojene ćelije u redu 2", () => {
  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tehpro-merged-"))
    FIXTURE = path.join(tmpDir, "merged.xlsx")
    await napraviFixture(FIXTURE)
    res = await parseTehproExcel(FIXTURE)
  })
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("planirani datum u slave koloni spoja ostaje 'planirano' (ne flipuje u 'izvrseno')", () => {
    const t = nadji(res.termini, "TRANSFERA", "2026-01-20")
    expect(t).toHaveLength(1)
    expect(t[0]!.izvor).toBe("planirano")
    expect(t[0]!.lokacija_naziv).toBe("RS")
    expect(t[0]!.vrsta_naziv).toBe("Servis PP aparata")
  })

  it("izvršeni datum sljedeće firme ostaje njen (nema fantoma kod prethodne)", () => {
    const carmeuse = nadji(res.termini, "CARMEUSE", "2026-01-22")
    expect(carmeuse).toHaveLength(1)
    expect(carmeuse[0]!.izvor).toBe("izvrseno")
    // fantom: TRANSFERA sa CARMEUSE-ovim datumom
    expect(nadji(res.termini, "TRANSFERA", "2026-01-22")).toHaveLength(0)
  })

  it("stub kolona u spoju ('po ugovoru') se i dalje preskače", () => {
    expect(res.firme).not.toContain("PO UGOVORU")
    expect(res.firme.sort()).toEqual(["CARMEUSE", "NEW YORKER", "TRANSFERA"])
  })

  it("Block2 (OBILASCI) sa spojenim header labelama i dalje radi", () => {
    const obs = res.termini.filter(t => t.vrsta_naziv === "Obilazak")
    expect(obs.map(t => `${t.izvor}:${t.datum}`).sort()).toEqual([
      "izvrseno:2026-01-15",
      "planirano:2026-02-05",
    ])
  })

  it("nema neočekivanih dodatnih termina (ukupno tačno 4)", () => {
    expect(res.termini).toHaveLength(4)
  })
})
