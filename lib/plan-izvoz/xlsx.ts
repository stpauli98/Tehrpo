import ExcelJS from "exceljs"
import { createTranslator } from "next-intl"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import type { PlanRed, IzvozMeta } from "./types"
import { PLAN_KOLONE_KEYS, planRedCelije } from "./types"

export async function planToXlsx(rows: PlanRed[], meta: IzvozMeta, locale: Locale = APP_LOCALE): Promise<Buffer> {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "izvoz.plan" })
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(t("naslov"))
  ws.addRow([meta.naslov])
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.addRow([t("podnaslov", { period: meta.period })])
  // Napomena zauzima red 3 kad postoji; bez nje red 3 ostaje prazan (zaglavlje uvijek u redu 4).
  ws.addRow(meta.napomena ? [meta.napomena] : [])
  if (meta.napomena) ws.getRow(3).font = { italic: true }
  const header = ws.addRow(PLAN_KOLONE_KEYS.map((k) => t(`kolone.${k}`)))
  header.font = { bold: true }
  const prenesenoLabel = (p: boolean) => (p ? t("prenesenoDa") : t("prenesenoNe"))
  for (const r of rows) {
    const red = ws.addRow(planRedCelije(r, prenesenoLabel, ""))
    // Prenesena obaveza mora da se vidi i letimičnim pogledom na štampan plan.
    if (r.preneseno) red.font = { bold: true }
  }
  const sirine = [28, 20, 24, 14, 13, 16, 14, 22, 14]
  sirine.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const raw = await wb.xlsx.writeBuffer()
  return Buffer.from(raw as ArrayBuffer)
}
