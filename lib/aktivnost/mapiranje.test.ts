import fs from "node:fs"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { dogadjajZaRutu, dogadjajZaFilter, EKRAN_LABELE, FILTER_KLJUCEVI } from "./mapiranje"

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

describe("mapa vs rute", () => {
  // Čisti redirecti na /plan-aktivnosti — usePathname poslije redirecta nikad
  // ne vidi te segmente. ("odjava" nema page.tsx — samo actions.ts — pa ne
  // ulazi u skup; "termini"/"dokumenti" u mapi su dozvoljen superset.)
  const IZUZECI = ["plan", "prikaz"]

  it("svaki (dashboard) segment sa page.tsx je u EKRAN_LABELE ili u IZUZECI", () => {
    const dir = path.join(process.cwd(), "app/(dashboard)")
    const segmentiSaPage = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "page.tsx")))
      .map((e) => e.name)
    expect(segmentiSaPage.length).toBeGreaterThan(0)
    for (const seg of segmentiSaPage) {
      const pokriven = seg in EKRAN_LABELE || IZUZECI.includes(seg)
      expect(pokriven, `segment "${seg}" nije ni u EKRAN_LABELE ni u IZUZECI`).toBe(true)
    }
  })

  it("Object.keys(FILTER_KLJUCEVI) ⊆ Object.keys(EKRAN_LABELE)", () => {
    for (const k of Object.keys(FILTER_KLJUCEVI)) {
      expect(k in EKRAN_LABELE, `FILTER_KLJUCEVI ključ "${k}" nije u EKRAN_LABELE`).toBe(true)
    }
  })
})
