import { describe, it, expect } from "vitest"
import { dogadjajZaRutu, dogadjajZaFilter } from "./mapiranje"

describe("dogadjajZaRutu", () => {
  it("NAVIGATE za ekran bez id-a", () => {
    expect(dogadjajZaRutu("/klijenti")).toEqual({
      akcija: "NAVIGATE", entitet: "klijenti", entitet_id: null,
      detalji: { ekran: "Klijenti" },
    })
  })
  it("VIEW za rutu sa id-om zapisa", () => {
    expect(dogadjajZaRutu("/klijenti/abc-123")).toEqual({
      akcija: "VIEW", entitet: "klijenti", entitet_id: "abc-123", detalji: null,
    })
  })
  it("null za prazan pathname", () => {
    expect(dogadjajZaRutu("/")).toBeNull()
  })
  it("NAVIGATE fallback labela za nepoznat segment", () => {
    expect(dogadjajZaRutu("/nepoznato")).toEqual({
      akcija: "NAVIGATE", entitet: "nepoznato", entitet_id: null,
      detalji: { ekran: "nepoznato" },
    })
  })
})

describe("dogadjajZaFilter", () => {
  it("FILTER samo za dozvoljene ključeve", () => {
    expect(dogadjajZaFilter("/termini", { status: "kasni", tajni: "x" })).toEqual({
      akcija: "FILTER", entitet: "termini", entitet_id: null,
      detalji: { filteri: { status: "kasni" } },
    })
  })
  it("null kad nema aktivnih filtera", () => {
    expect(dogadjajZaFilter("/termini", {})).toBeNull()
  })
  it("null za ekran bez filter allowliste", () => {
    expect(dogadjajZaFilter("/pregled", { q: "x" })).toBeNull()
  })
})
