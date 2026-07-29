import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx"
import { createTranslator } from "next-intl"
import type { ZapisnikInput } from "./content"
import { APP_NAME } from "../brand"
import { APP_LOCALE, type Locale } from "../locale"
import { formatDatum } from "../date"
import { getMessages } from "@/i18n/messages"

export type ZapisnikData = ZapisnikInput & { nalaz: string; zakljucak: string }

function polje(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)],
  })
}

function odlomci(tekst: string): Paragraph[] {
  return tekst.split("\n").map((linija) => new Paragraph({ children: [new TextRun(linija)] }))
}

export async function buildZapisnikDocx(data: ZapisnikData, locale: Locale = APP_LOCALE): Promise<Buffer> {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "izvoz.zapisnik" })
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: t("naslov"), bold: true })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: t("podnaslov", { appName: APP_NAME }), italics: true })],
          }),
          new Paragraph({ text: "" }),
          polje(t("poljeKlijent"), data.klijent),
          polje(t("poljeLokacija"), data.lokacija ?? "—"),
          polje(t("poljeVrstaProvjere"), data.vrstaProvjere),
          // data.datum je interno ISO ("YYYY-MM-DD"); u dokumentu standard prikaza dd.MM.yyyy
          polje(t("poljeDatumIzvrsenja"), formatDatum(data.datum)),
          polje(t("poljeZaduzeni"), data.zaduzeni ?? "—"),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t("nalaz"), bold: true })] }),
          ...odlomci(data.nalaz),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t("zakljucak"), bold: true })] }),
          ...odlomci(data.zakljucak),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "" }),
          new Paragraph({ children: [new TextRun(t("potpis"))] }),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc)
}
