import { describe, it, expect } from "vitest"
import { reminderSubject, reminderHtml, escapeHtml } from "./templates"

describe("escapeHtml", () => {
  it("escape-uje HTML meta znakove", () => {
    expect(escapeHtml('<b>"&\'')).toBe("&lt;b&gt;&quot;&amp;&#39;")
  })
})

describe("reminderSubject", () => {
  it("jednina za 1 dan", () => {
    expect(reminderSubject({ vrsta: "Servis PP aparata", klijent: "AS", danaPrije: 1 }))
      .toBe("Podsjetnik: Servis PP aparata — AS (rok za 1 dan)")
  })
  it("množina za 7 dana", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaPrije: 7 }))
      .toContain("za 7 dana")
  })
  it("danas za 0", () => {
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaPrije: 0 }))
      .toContain("rok danas")
  })
})

describe("reminderHtml", () => {
  it("sadrži klijenta, vrstu i formatiran rok; escape-uje vrijednosti", () => {
    const html = reminderHtml({
      klijent: "AS & co",
      vrsta: "Hidranti",
      rok: "2026-09-15",
      danaPrije: 7,
      lokacija: null,
    })
    expect(html).toContain("AS &amp; co")
    expect(html).toContain("Hidranti")
    expect(html).toContain("15.09.2026.")
  })
  it("izostavlja lokaciju kad je null", () => {
    const html = reminderHtml({ klijent: "AS", vrsta: "Hidranti", rok: "2026-09-15", danaPrije: 7, lokacija: null })
    expect(html).not.toContain("Lokacija:")
  })
})
