import { describe, it, expect } from "vitest"
import { reminderSubject, reminderHtml, escapeHtml } from "./templates"

describe("escapeHtml", () => {
  it("escape-uje HTML meta znakove", () => {
    expect(escapeHtml('<b>"&\'')).toBe("&lt;b&gt;&quot;&amp;&#39;")
  })
})

describe("reminderSubject", () => {
  it("jednina za 1 dan", () => {
    expect(reminderSubject({ vrsta: "Servis PP aparata", klijent: "AS", danaDoRoka: 1 }))
      .toBe("Podsjetnik: Servis PP aparata — AS (rok za 1 dan)")
  })
  it("množina za 7 dana", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: 7 })).toContain("za 7 dana")
  })
  it("danas za 0", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: 0 })).toContain("rok danas")
  })
  it("kašnjenje (množina) za -3", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: -3 }))
      .toBe("Podsjetnik: Hidranti — AS (kasni 3 dana)")
  })
  it("kašnjenje (jednina) za -1", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: -1 })).toContain("kasni 1 dan")
  })
})

describe("reminderHtml", () => {
  it("sadrži klijenta, vrstu i formatiran rok; escape-uje vrijednosti", () => {
    const html = reminderHtml({ klijent: "AS & co", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null })
    expect(html).toContain("AS &amp; co")
    expect(html).toContain("Hidranti")
    expect(html).toContain("15.09.2026.")
  })
  it("izostavlja lokaciju kad je null", () => {
    const html = reminderHtml({ klijent: "AS", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null })
    expect(html).not.toContain("Lokacija:")
  })
  it("kašnjenje: naslov i tekst za istekao rok", () => {
    const html = reminderHtml({ klijent: "AS", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: -3, lokacija: null })
    expect(html).toContain("kašnjenju")
    expect(html).toContain("kasni 3 dana")
  })
})
