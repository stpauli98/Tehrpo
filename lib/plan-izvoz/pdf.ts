import { PDFDocument, StandardFonts } from "pdf-lib"
import { createTranslator } from "next-intl"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import type { PlanRed, IzvozMeta } from "./types"
import { PLAN_KOLONE_KEYS, planRedCelije } from "./types"

// WinAnsi (standard PDF fonts) cannot encode Bosnian-specific chars — transliterate them.
// Sve ostalo van WinAnsi/CP1252 (ćirilica, emoji, CJK…) → "?" da pdf-lib NIKAD ne baci
// PDFCodingError pri generisanju (npr. ako se u Excel zalijepi egzotičan znak).
const ascii = (s: string) =>
  s
    .replace(/[ćĆ]/g, (c) => (c === "ć" ? "c" : "C"))
    .replace(/[čČ]/g, (c) => (c === "č" ? "c" : "C"))
    .replace(/[šŠ]/g, (c) => (c === "š" ? "s" : "S"))
    .replace(/[žŽ]/g, (c) => (c === "ž" ? "z" : "Z"))
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .replace(/[^\x20-\x7E\xA0-\xFF–—…‚„‘’“”•€™]/g, "?")

// klijent, lokacija, usluga, rok, preneseno, status, periodika, odgovorna, nacin
// Zbir 780 ≤ 782 (A4 landscape 842 − 2×30 margine).
export const PDF_SIRINA = 842
export const PDF_MARGINA = 30
export const KOLONE_SIRINE = [120, 88, 112, 66, 62, 84, 62, 112, 74] as const

export async function planToPdf(rows: PlanRed[], meta: IzvozMeta, locale: Locale = APP_LOCALE): Promise<Buffer> {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "izvoz.plan" })
  const KOLONE = PLAN_KOLONE_KEYS.map((k, i) => ({ label: t(`kolonePdf.${k}`), w: KOLONE_SIRINE[i]! }))
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const W = PDF_SIRINA, H = 595, margin = PDF_MARGINA, rowH = 18, size = 9
  let page = pdf.addPage([W, H])
  let y = H - margin

  const skratiti = (s: string, w: number, f = font) => {
    const a = ascii(s)
    let cur = a
    while (cur.length > 1 && f.widthOfTextAtSize(cur, size) > w - 6) cur = cur.slice(0, -1)
    return cur.length < a.length ? `${cur.slice(0, -1)}…` : cur
  }
  const zaglavlje = () => {
    page.drawText(ascii(meta.naslov), { x: margin, y: y - 12, size: 14, font: bold })
    page.drawText(ascii(t("podnaslov", { period: meta.period })), { x: margin, y: y - 28, size: 10, font })
    y -= 44
    if (meta.napomena) {
      page.drawText(ascii(meta.napomena), { x: margin, y: y - 10, size: 8, font })
      y -= 14
    }
    let x = margin
    for (const c of KOLONE) { page.drawText(ascii(c.label), { x: x + 2, y: y - 12, size, font: bold }); x += c.w }
    y -= rowH
  }
  zaglavlje()
  const prenesenoLabel = (p: boolean) => (p ? t("prenesenoDa") : t("prenesenoNe"))
  for (const r of rows) {
    if (y < margin + rowH) { page = pdf.addPage([W, H]); y = H - margin; zaglavlje() }
    const vals = planRedCelije(r, prenesenoLabel, "-")
    // Prenesena obaveza je podebljana — na štampi se odmah razlikuje od plana za period.
    const f = r.preneseno ? bold : font
    let x = margin
    vals.forEach((v, i) => { page.drawText(skratiti(String(v ?? "-"), KOLONE[i]!.w, f), { x: x + 2, y: y - 12, size, font: f }); x += KOLONE[i]!.w })
    y -= rowH
  }
  if (rows.length === 0) page.drawText(ascii(t("nemaAktivnosti")), { x: margin, y: y - 12, size: 10, font })
  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
