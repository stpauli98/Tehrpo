import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { planToXlsx } from "./xlsx"
import type { PlanRed } from "./types"

const ROW: PlanRed = { klijent: "AS", lokacija: "BL", usluga: "Hidranti", rok: "15.07.2026.", status: "Kasni", periodikaMj: 12, odgovorna: "Pero" }

describe("planToXlsx", () => {
  it("vraća validan .xlsx s headerom i redom", async () => {
    const buf = await planToXlsx([ROW], { naslov: "Tehpro", period: "tekući + naredni mjesec" })
    expect(buf.length).toBeGreaterThan(100)
    const wb = new ExcelJS.Workbook()
    // cast: @types/node verzijski sukob (20 vs transitivni 25) čini Buffer tipove
    // nekompatibilnim na .load() — runtime je ispravan (Buffer ulazi).
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0])
    const ws = wb.getWorksheet("Plan aktivnosti")!
    expect(ws.getCell("A4").value).toBe("Klijent")
    expect(ws.getCell("A5").value).toBe("AS")
    expect(ws.getCell("D5").value).toBe("15.07.2026.")
  })
})
