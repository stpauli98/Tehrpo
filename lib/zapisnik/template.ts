import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx"
import type { ZapisnikInput } from "./content"

export type ZapisnikData = ZapisnikInput & { nalaz: string; zakljucak: string }

function red(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)],
  })
}

function odlomci(tekst: string): Paragraph[] {
  return tekst.split("\n").map((linija) => new Paragraph({ children: [new TextRun(linija)] }))
}

export async function buildZapisnikDocx(data: ZapisnikData): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "ZAPISNIK O IZVRŠENOJ PROVJERI", bold: true })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Tehpro — zaštita na radu", italics: true })],
          }),
          new Paragraph({ text: "" }),
          red("Klijent", data.klijent),
          red("Lokacija", data.lokacija ?? "—"),
          red("Vrsta provjere", data.vrstaProvjere),
          red("Datum izvršenja", data.datum),
          red("Zaduženi", data.zaduzeni ?? "—"),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Nalaz", bold: true })] }),
          ...odlomci(data.nalaz),
          new Paragraph({ text: "" }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Zaključak", bold: true })] }),
          ...odlomci(data.zakljucak),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "" }),
          new Paragraph({ children: [new TextRun("Potpis ovlaštenog lica: ______________________________")] }),
        ],
      },
    ],
  })
  return Packer.toBuffer(doc)
}
