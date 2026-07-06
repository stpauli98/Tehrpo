import { describe, it, expect } from "vitest"
import { reminderSubject, reminderHtml, escapeHtml, testEmailSubject, testEmailHtml } from "./templates"

describe("escapeHtml", () => {
  it("escape-uje HTML meta znakove", () => {
    expect(escapeHtml('<b>"&\'')).toBe("&lt;b&gt;&quot;&amp;&#39;")
  })
})

describe("testEmail", () => {
  it("subject sadrži naziv aplikacije", () => {
    expect(testEmailSubject()).toContain("Testni email")
  })
  it("html ima pozdrav s imenom i escape-uje ga", () => {
    const html = testEmailHtml({ ime: "Marko <i>" })
    expect(html).toContain("Zdravo Marko &lt;i&gt;,")
    expect(html).toContain("TESTNI EMAIL")
  })
  it("html bez imena koristi generički pozdrav", () => {
    expect(testEmailHtml({ ime: null })).toContain("Zdravo,")
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
  const baza = { klijent: "AS & co", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null }

  it("sadrži klijenta, vrstu i formatiran rok; escape-uje vrijednosti", () => {
    const html = reminderHtml(baza)
    expect(html).toContain("AS &amp; co")
    expect(html).toContain("Hidranti")
    expect(html).toContain("15.09.2026.")
  })
  it("izostavlja lokaciju kad je null", () => {
    expect(reminderHtml(baza)).not.toContain("Lokacija")
  })
  it("status badge: USKORO za budući rok, KASNI za istekao", () => {
    expect(reminderHtml({ ...baza, danaDoRoka: 7 })).toContain("USKORO")
    const kasni = reminderHtml({ ...baza, danaDoRoka: -3 })
    expect(kasni).toContain("KASNI")
    expect(kasni).toContain("kasni 3 dana")
  })
  it("s baseUrl + id-jevima: oba dugmeta i tačni dashboard URL-ovi", () => {
    const html = reminderHtml({ ...baza, terminId: "t-123", klijentId: "k-456", baseUrl: "https://app.test" })
    expect(html).toContain("https://app.test/plan-aktivnosti?selected=t-123")
    expect(html).toContain("https://app.test/klijenti/k-456")
    expect(html).toContain("Otvori termin")
    expect(html).toContain("Otvori klijenta")
  })
  it("bez baseUrl: nema dugmadi ni linkova", () => {
    const html = reminderHtml({ ...baza, terminId: "t-123", klijentId: "k-456" })
    expect(html).not.toContain("Otvori termin")
    expect(html).not.toContain("/plan-aktivnosti?selected")
  })
})

describe("en lokal", () => {
  const baza = { klijent: "AS & co", vrsta: "Hidranti", rok: "2026-09-15", danaDoRoka: 7, lokacija: null }

  it("testEmailSubject na engleskom", () => {
    expect(testEmailSubject("en")).toContain("Test email")
  })
  it("testEmailHtml na engleskom: pozdrav, oznaka, html lang", () => {
    const html = testEmailHtml({ ime: "Marko" }, "en")
    expect(html).toContain("Hello Marko,")
    expect(html).toContain("TEST EMAIL")
    expect(html).toContain('<html lang="en">')
  })
  it("reminderSubject na engleskom: bez sr 'rok' prefiksa jer je već ugrađen u 'due'", () => {
    expect(reminderSubject({ vrsta: "Servis PP aparata", klijent: "AS", danaDoRoka: 1 }, "en"))
      .toBe("Reminder: Servis PP aparata — AS (due in 1 day)")
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: -3 }, "en"))
      .toBe("Reminder: Hidranti — AS (3 days overdue)")
    expect(reminderSubject({ vrsta: "Hidranti", klijent: "AS", danaDoRoka: 0 }, "en"))
      .toBe("Reminder: Hidranti — AS (due today)")
  })
  it("reminderHtml na engleskom: labele i dugmad", () => {
    const html = reminderHtml({ ...baza, terminId: "t-123", klijentId: "k-456", baseUrl: "https://app.test" }, "en")
    expect(html).toContain("Due date:")
    expect(html).toContain("Open appointment")
    expect(html).toContain("Open client")
    expect(html).toContain("UPCOMING")
    expect(html).toContain('<html lang="en">')
  })
})
