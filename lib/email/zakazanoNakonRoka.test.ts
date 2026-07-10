import { describe, it, expect } from "vitest"
import { zakazanoNakonRokaSubject, zakazanoNakonRokaHtml } from "./templates"

describe("zakazanoNakonRoka email", () => {
  it("subject sadrži vrstu i klijenta", () => {
    const s = zakazanoNakonRokaSubject({ vrsta: "Obilazak", klijent: "CARMEUSE" })
    expect(s).toContain("Obilazak")
    expect(s).toContain("CARMEUSE")
  })
  it("html prikazuje rok i zakazani datum (sr format)", () => {
    const html = zakazanoNakonRokaHtml({
      klijent: "CARMEUSE", vrsta: "Obilazak",
      rok: "2026-07-13", zakazan: "2026-07-15", lokacija: "Doboj",
    })
    expect(html).toContain("13.07.2026.")
    expect(html).toContain("15.07.2026.")
    expect(html).toContain("CARMEUSE")
    expect(html).toContain("Doboj")
  })
  it("html escape-uje HTML u nazivima", () => {
    const html = zakazanoNakonRokaHtml({
      klijent: "<b>x</b>", vrsta: "V", rok: "2026-07-13", zakazan: "2026-07-15",
    })
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).not.toContain("<b>x</b>")
  })
})
