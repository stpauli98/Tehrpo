import { describe, it, expect } from "vitest"
import { norm, filtrirajKontakte, mozeAdHoc, adHocZaPrikaz } from "./primaociPicker"

const K = (id: string, ime: string, email: string | null) => ({ id, ime, funkcija: null, email })

describe("norm", () => {
  it("normalizuje whitespace i case", () => {
    expect(norm("  MARKO@F.BA  ")).toBe("marko@f.ba")
    expect(norm("Ana")).toBe("ana")
  })
})

describe("filtrirajKontakte", () => {
  const kontakti = [K("1", "Marko", "marko@f.ba"), K("2", "Ana", "ana@f.ba"), K("3", "Bez", null)]
  it("izuzima kontakte bez mejla i već izabrane", () => {
    const r = filtrirajKontakte(kontakti, "", new Set(["2"]))
    expect(r.map((k) => k.id)).toEqual(["1"])
  })
  it("filtrira po imenu/mejlu (case-insensitive)", () => {
    expect(filtrirajKontakte(kontakti, "ana", new Set()).map((k) => k.id)).toEqual(["2"])
    expect(filtrirajKontakte(kontakti, "MARKO@", new Set()).map((k) => k.id)).toEqual(["1"])
  })
})

describe("mozeAdHoc", () => {
  it("true za validan mejl koji nije kontakt ni već ad-hoc", () => {
    expect(mozeAdHoc("novi@f.ba", ["marko@f.ba"], [])).toBe(true)
  })
  it("false za nevalidan, za postojeći kontakt-mejl, za već ad-hoc", () => {
    expect(mozeAdHoc("nijemejl", [], [])).toBe(false)
    expect(mozeAdHoc("MARKO@f.ba", ["marko@f.ba"], [])).toBe(false)
    expect(mozeAdHoc("x@f.ba", [], ["X@f.ba"])).toBe(false)
  })
})

describe("adHocZaPrikaz", () => {
  it("izuzima adrese koje su već mejl flagovanog kontakta; dedup", () => {
    expect(adHocZaPrikaz(["a@f.ba", "A@f.ba", "b@f.ba"], ["b@f.ba"])).toEqual(["a@f.ba"])
  })
})
