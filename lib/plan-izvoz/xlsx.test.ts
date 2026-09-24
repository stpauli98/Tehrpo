import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { planToXlsx } from "./xlsx"
import type { PlanRed } from "./types"

const ROW: PlanRed = { klijent: "AS", lokacija: "BL", usluga: "Hidranti", rok: "15.07.2026", preneseno: false, status: "Kasni", periodikaMj: 12, odgovorna: "Pero", nacin: "Praćenje" }

// cast: @types/node verzijski sukob (20 vs transitivni 25) čini Buffer tipove
// nekompatibilnim na .load() — runtime je ispravan (Buffer ulazi).
async function ucitaj(buf: Buffer, list: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb.getWorksheet(list)!
}

describe("planToXlsx", () => {
  it("vraća validan .xlsx s headerom i redom", async () => {
    const buf = await planToXlsx([ROW], { naslov: "Tehpro", period: "tekući + naredni mjesec" })
    expect(buf.length).toBeGreaterThan(100)
    const ws = await ucitaj(buf, "Plan aktivnosti")
    expect(ws.getCell("A4").value).toBe("Klijent")
    expect(ws.getCell("A5").value).toBe("AS")
    expect(ws.getCell("D5").value).toBe("15.07.2026")
    expect(ws.getCell("I4").value).toBe("Način")
    expect(ws.getCell("I5").value).toBe("Praćenje")
  })

  it("na engleskom: naslov lista i zaglavlje kolona su prevedeni", async () => {
    const buf = await planToXlsx([ROW], { naslov: "Tehpro", period: "current + next month" }, "en")
    const ws = await ucitaj(buf, "Activity plan")
    expect(ws.getCell("A2").value).toBe("Activity plan — current + next month")
    expect(ws.getCell("A4").value).toBe("Client")
    expect(ws.getCell("I4").value).toBe("Mode")
  })

  // ── Prelazak godine (B2) ──
  it("kolona „Preneseno“ postoji i razlikuje prenesenu od redovne obaveze", async () => {
    const preneseno: PlanRed = { ...ROW, klijent: "Zaostatak 2026", rok: "10.11.2026", preneseno: true }
    const buf = await planToXlsx([preneseno, ROW], { naslov: "Tehpro", period: "2027" })
    const ws = await ucitaj(buf, "Plan aktivnosti")
    expect(ws.getCell("E4").value).toBe("Preneseno")
    expect(ws.getCell("E5").value).toBe("Da")
    expect(ws.getCell("E6").value).toBe("—")
    // prenesen red je podebljan da se vidi na štampi
    expect(ws.getRow(5).font?.bold).toBe(true)
    expect(ws.getRow(6).font?.bold).toBeFalsy()
  })

  it("napomena se ispisuje iznad zaglavlja, a zaglavlje ostaje u redu 4", async () => {
    const buf = await planToXlsx([ROW], {
      naslov: "Tehpro",
      period: "2027",
      napomena: "Plan uključuje i 3 prenesene obaveze.",
    })
    const ws = await ucitaj(buf, "Plan aktivnosti")
    expect(ws.getCell("A3").value).toBe("Plan uključuje i 3 prenesene obaveze.")
    expect(ws.getCell("A4").value).toBe("Klijent")
  })

  it("kolona „Preneseno“ je prevedena na en i de", async () => {
    const slucajevi = [
      { loc: "en", list: "Activity plan", ocekivano: "Carried over" },
      { loc: "de", list: "Aktivitätsplan", ocekivano: "Übertragen" },
    ] as const
    const listovi = await Promise.all(
      slucajevi.map(async (s) => ucitaj(await planToXlsx([ROW], { naslov: "Tehpro", period: "2027" }, s.loc), s.list)),
    )
    listovi.forEach((ws, i) => expect(ws.getCell("E4").value).toBe(slucajevi[i]!.ocekivano))
  })
})
