import { describe, it, expect, afterEach, vi } from "vitest"
import { SISTEM_PROMPT, datumNapomena } from "./prompts"

describe("SISTEM_PROMPT (sr — default, mora ostati byte-identičan)", () => {
  it("sadrži bosansku jezičku instrukciju u osnovnoj rečenici", () => {
    expect(SISTEM_PROMPT).toContain(
      "Pričaj kao kolega iz tima: prirodno, toplo i konkretno, na bosanskom jeziku.",
    )
  })

  it("sadrži nazive alata i pravila nepromijenjeno", () => {
    expect(SISTEM_PROMPT).toContain("searchTermini")
    expect(SISTEM_PROMPT).toContain("listFirme")
    expect(SISTEM_PROMPT).toContain("suggestGrupisanje")
    expect(SISTEM_PROMPT).toContain("predloziZapisnik")
    expect(SISTEM_PROMPT).toContain("PRAVILA:")
  })

  it("ne dodaje trailing en/de jezičku instrukciju za sr", () => {
    expect(SISTEM_PROMPT).not.toContain("IMPORTANT:")
    expect(SISTEM_PROMPT).not.toContain("WICHTIG:")
    expect(SISTEM_PROMPT.endsWith("reci to jednostavno i predloži drugačiju pretragu.")).toBe(true)
  })
})

describe("SISTEM_PROMPT (en/de — parametrizacija po APP_LOCALE)", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_LOCALE

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_LOCALE
    else process.env.NEXT_PUBLIC_APP_LOCALE = ORIGINAL
    vi.resetModules()
  })

  it("en: zamjenjuje jezičku frazu i dodaje IMPORTANT instrukciju na kraju", async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = "en"
    vi.resetModules()
    const { SISTEM_PROMPT: enPrompt } = await import("./prompts")
    expect(enPrompt).toContain(
      "Pričaj kao kolega iz tima: prirodno, toplo i konkretno, in English.",
    )
    expect(enPrompt).not.toContain("na bosanskom jeziku")
    expect(enPrompt).toContain(
      "IMPORTANT: Always respond in English, regardless of the language of the underlying data.",
    )
    expect(enPrompt).toContain("searchTermini") // tool ugovori/nazivi ostaju netaknuti
  })

  it("de: zamjenjuje jezičku frazu i dodaje WICHTIG instrukciju na kraju", async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = "de"
    vi.resetModules()
    const { SISTEM_PROMPT: dePrompt } = await import("./prompts")
    expect(dePrompt).toContain(
      "Pričaj kao kolega iz tima: prirodno, toplo i konkretno, auf Deutsch.",
    )
    expect(dePrompt).not.toContain("na bosanskom jeziku")
    expect(dePrompt).toContain(
      "WICHTIG: Antworte immer auf Deutsch, unabhängig von der Sprache der zugrunde liegenden Daten.",
    )
    expect(dePrompt).toContain("predloziZapisnik")
  })
})

describe("datumNapomena (call-time datum, ne dira SISTEM_PROMPT const)", () => {
  it("sr: 'Danas je <dd.MM.yyyy>.' sa vodećim praznim redovima + pravilo prikaza datuma", () => {
    const n = datumNapomena("2026-07-12", "sr")
    expect(n.startsWith("\n\nDanas je 12.07.2026.")).toBe(true)
    expect(n).toContain("dd.MM.yyyy")
    expect(n).toContain("dd.MM.yyyy HH:mm")
    expect(n).toContain("ISO formatu (YYYY-MM-DD)")
    expect(n).not.toContain("2026-07-12") // ISO ulaz se modelu prikazuje formatiran
  })
  it("en/de fraze — formatiran datum i pravilo prikaza", () => {
    const en = datumNapomena("2026-07-12", "en")
    expect(en.startsWith("\n\nToday is 12.07.2026.")).toBe(true)
    expect(en).toContain("dd.MM.yyyy HH:mm")
    expect(en).toContain("ISO format (YYYY-MM-DD)")
    const de = datumNapomena("2026-07-12", "de")
    expect(de.startsWith("\n\nHeute ist 12.07.2026.")).toBe(true)
    expect(de).toContain("dd.MM.yyyy HH:mm")
    expect(de).toContain("ISO-Format (YYYY-MM-DD)")
  })
  it("SISTEM_PROMPT const ostaje bez datuma (byte-identičan)", () => {
    expect(SISTEM_PROMPT).not.toContain("Danas je")
  })
})
