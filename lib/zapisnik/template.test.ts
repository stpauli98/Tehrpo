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
    // domenski sadržaj (AI/DB) se ne prevodi — ostaje na bosanskom bez obzira na lokal
    expect(html).toContain("Provjera izvršena")
  })
})
