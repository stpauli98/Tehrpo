import { describe, it, expect, afterEach, vi } from "vitest"
import { toolLabel } from "./tools"

describe("toolLabel (sr — default, mora ostati byte-identičan)", () => {
  it("vraća postojeće bosanske labele za sve poznate alate", () => {
    expect(toolLabel("searchTermini")).toBe("Pretražujem termine…")
    expect(toolLabel("listFirme")).toBe("Pregledam firme…")
    expect(toolLabel("suggestGrupisanje")).toBe("Grupišem termine po klijentu…")
    expect(toolLabel("predloziZapisnik")).toBe("Pripremam prijedlog zapisnika…")
  })

  it("vraća sr fallback 'Radim…' za nepoznat alat", () => {
    expect(toolLabel("nepoznatAlat")).toBe("Radim…")
  })

  it("eksplicitni locale=\"sr\" daje isti rezultat kao default", () => {
    expect(toolLabel("searchTermini", "sr")).toBe("Pretražujem termine…")
  })
})

describe("toolLabel (en/de — parametrizacija po locale argumentu)", () => {
  it("en: labele za sve poznate alate", () => {
    expect(toolLabel("searchTermini", "en")).toBe("Searching appointments…")
    expect(toolLabel("listFirme", "en")).toBe("Reviewing companies…")
    expect(toolLabel("suggestGrupisanje", "en")).toBe("Grouping appointments by client…")
    expect(toolLabel("predloziZapisnik", "en")).toBe("Preparing the minutes proposal…")
  })

  it("en: fallback 'Working…' za nepoznat alat", () => {
    expect(toolLabel("nepoznatAlat", "en")).toBe("Working…")
  })

  it("de: labele za sve poznate alate", () => {
    expect(toolLabel("searchTermini", "de")).toBe("Termine werden durchsucht…")
    expect(toolLabel("listFirme", "de")).toBe("Firmen werden überprüft…")
    expect(toolLabel("suggestGrupisanje", "de")).toBe("Termine werden nach Klient gruppiert…")
    expect(toolLabel("predloziZapisnik", "de")).toBe("Protokollentwurf wird vorbereitet…")
  })

  it("de: fallback 'Arbeite…' za nepoznat alat", () => {
    expect(toolLabel("nepoznatAlat", "de")).toBe("Arbeite…")
  })
})

describe("toolLabel (default parametar prati APP_LOCALE)", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_LOCALE

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_LOCALE
    else process.env.NEXT_PUBLIC_APP_LOCALE = ORIGINAL
    vi.resetModules()
  })

  it("kad je NEXT_PUBLIC_APP_LOCALE=en, default poziv (bez drugog argumenta) vraća en labelu", async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = "en"
    vi.resetModules()
    const { toolLabel: enToolLabel } = await import("./tools")
    expect(enToolLabel("searchTermini")).toBe("Searching appointments…")
    expect(enToolLabel("nepoznatAlat")).toBe("Working…")
  })

  it("kad je NEXT_PUBLIC_APP_LOCALE=de, default poziv (bez drugog argumenta) vraća de labelu", async () => {
    process.env.NEXT_PUBLIC_APP_LOCALE = "de"
    vi.resetModules()
    const { toolLabel: deToolLabel } = await import("./tools")
    expect(deToolLabel("predloziZapisnik")).toBe("Protokollentwurf wird vorbereitet…")
    expect(deToolLabel("nepoznatAlat")).toBe("Arbeite…")
  })
})
