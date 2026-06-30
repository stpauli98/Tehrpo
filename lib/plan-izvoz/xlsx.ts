import ExcelJS from "exceljs"
import type { PlanRed, IzvozMeta } from "./types"
import { PLAN_KOLONE } from "./types"

export async function planToXlsx(rows: PlanRed[], meta: IzvozMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Plan aktivnosti")
  ws.addRow([meta.naslov])
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.addRow([`Plan aktivnosti — ${meta.period}`])
  ws.addRow([])
  const header = ws.addRow([...PLAN_KOLONE])
  header.font = { bold: true }
  for (const r of rows) {
    ws.addRow([r.klijent, r.lokacija, r.usluga, r.rok, r.status, r.periodikaMj ?? "", r.odgovorna])
  }
  const sirine = [28, 20, 24, 14, 16, 14, 22]
  sirine.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const raw = await wb.xlsx.writeBuffer()
  return Buffer.from(raw as ArrayBuffer)
}
