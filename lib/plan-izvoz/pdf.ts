import { PDFDocument, StandardFonts } from "pdf-lib"
import { createTranslator } from "next-intl"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import type { PlanRed, IzvozMeta } from "./types"
import { PLAN_KOLONE_KEYS } from "./types"

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

const KOLONE_SIRINE = [138, 100, 128, 66, 84, 62, 130, 74] as const

export async function planToPdf(rows: PlanRed[], meta: IzvozMeta, locale: Locale = APP_LOCALE): Promise<Buffer> {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "izvoz.plan" })
  const KOLONE = PLAN_KOLONE_KEYS.map((k, i) => ({ label: t(`kolonePdf.${k}`), w: KOLONE_SIRINE[i]! }))
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const W = 842, H = 595, margin = 30, rowH = 18, size = 9
  let page = pdf.addPage([W, H])
  let y = H - margin

  const skratiti = (s: string, w: number) => {
    const a = ascii(s)
    let cur = a
    while (cur.length > 1 && font.widthOfTextAtSize(cur, size) > w - 6) cur = cur.slice(0, -1)
    return cur.length < a.length ? `${cur.slice(0, -1)}…` : cur
  }
  const zaglavlje = () => {
    page.drawText(ascii(meta.naslov), { x: margin, y: y - 12, size: 14, font: bold })
    page.drawText(ascii(t("podnaslov", { period: meta.period })), { x: margin, y: y - 28, size: 10, font })
    y -= 44
    let x = margin
    for (const c of KOLONE) { page.drawText(ascii(c.label), { x: x + 2, y: y - 12, size, font: bold }); x += c.w }
    y -= rowH
  }
  zaglavlje()
  for (const r of rows) {
    if (y < margin + rowH) { page = pdf.addPage([W, H]); y = H - margin; zaglavlje() }
    const vals = [r.klijent, r.lokacija, r.usluga, r.rok, r.status, r.periodikaMj == null ? "-" : String(r.periodikaMj), r.odgovorna, r.nacin]
    let x = margin
    vals.forEach((v, i) => { page.drawText(skratiti(String(v ?? "-"), KOLONE[i]!.w), { x: x + 2, y: y - 12, size, font }); x += KOLONE[i]!.w })
    y -= rowH
  }
  if (rows.length === 0) page.drawText(ascii(t("nemaAktivnosti")), { x: margin, y: y - 12, size: 10, font })
  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
