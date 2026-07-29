import { describe, it, expect } from "vitest"
import { buildZapisnikDocx } from "./template"

describe("buildZapisnikDocx", () => {
  it("vraća validan .docx Buffer (OOXML/ZIP 'PK' magic)", async () => {
    const buf = await buildZapisnikDocx({
      klijent: "WAIKIKI",
      lokacija: "Banja Luka - Delta",
      vrstaProvjere: "Servis PP aparata",
      datum: "2026-06-22",
      zaduzeni: "Marija K.",
      nalaz: "Prva linija nalaza.\nDruga linija nalaza.",
      zakljucak: "Stanje zadovoljava.",
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK")
  })

  it("mammoth pročita generisani .docx (round-trip — pravi OOXML, ne samo ZIP)", async () => {
    const mammoth = (await import("mammoth")).default
    const buf = await buildZapisnikDocx({
      klijent: "WAIKIKI",
      lokacija: null,
      vrstaProvjere: "Hidranti",
      datum: "2026-06-22",
      zaduzeni: null,
      nalaz: "Provjera izvršena bez nedostataka.",
      zakljucak: "Stanje zadovoljava.",
    })
    const { value: html } = await mammoth.convertToHtml({ buffer: buf })
    expect(html).toContain("ZAPISNIK")
    expect(html).toContain("Provjera izvršena")
    // polje "Datum izvršenja" po standardu prikaza (dd.MM.yyyy), ne interni ISO
    expect(html).toContain("22.06.2026")
    expect(html).not.toContain("2026-06-22")
  })

  it("na engleskom: naslov i labele su prevedeni, sadržaj (nalaz/zaključak) je netaknut", async () => {
    const mammoth = (await import("mammoth")).default
    const buf = await buildZapisnikDocx({
      klijent: "WAIKIKI",
      lokacija: null,
      vrstaProvjere: "Hidranti",
      datum: "2026-06-22",
      zaduzeni: null,
      nalaz: "Provjera izvršena bez nedostataka.",
      zakljucak: "Stanje zadovoljava.",
    }, "en")
    const { value: html } = await mammoth.convertToHtml({ buffer: buf })
    expect(html).toContain("RECORD OF COMPLETED INSPECTION")
    expect(html).toContain("Client")
    expect(html).toContain("Findings")
    expect(html).toContain("Conclusion")
    // Ovdje su nalaz/zaključak direktno proslijeđeni pozivu (literal test string), ne
    // generisani preko content.ts — buildZapisnikDocx prevodi samo šablon (naslov/
    // labele), sadržaj proslijeđen pozivaocu ostavlja netaknut, bez obzira na lokal.
    // Napomena: kad sadržaj generiše AI/mock (content.ts buildPrompt/dryGenerateZapisnik),
    // on OD commit-a 838d893 JESTE lokalizovan (en/de dobijaju jezičku instrukciju) —
    // ovaj test ne pokriva taj slučaj, vidi content.test.ts.
    expect(html).toContain("Provjera izvršena")
  })
})
