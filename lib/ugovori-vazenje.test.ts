import { describe, it, expect } from "vitest"
import { VAZENJE_PRESETI, normalizujVazenje } from "./ugovori-vazenje"

describe("VAZENJE_PRESETI", () => {
  it("nudi uobičajena trajanja ugovora", () => {
    expect(VAZENJE_PRESETI).toEqual([6, 12, 24, 36, 60])
  })
})

describe("normalizujVazenje", () => {
  it("preset vrijednost prolazi kao broj", () => {
    expect(normalizujVazenje("12", "")).toEqual({ vazenje: 12, greska: null })
  })

  it("prazan izbor daje null (polje nije popunjeno)", () => {
    expect(normalizujVazenje("", "")).toEqual({ vazenje: null, greska: null })
  })

  it("custom izbor uzima broj iz custom polja", () => {
    expect(normalizujVazenje("custom", "18")).toEqual({ vazenje: 18, greska: null })
  })

  it("custom izvan opsega 1-600 je greska", () => {
    expect(normalizujVazenje("custom", "0")).toEqual({ vazenje: null, greska: "opseg" })
    expect(normalizujVazenje("custom", "601")).toEqual({ vazenje: null, greska: "opseg" })
  })

  it("custom koji nije cijeli broj je greska", () => {
    expect(normalizujVazenje("custom", "12.5")).toEqual({ vazenje: null, greska: "opseg" })
    expect(normalizujVazenje("custom", "abc")).toEqual({ vazenje: null, greska: "opseg" })
  })

  it("custom sa praznim poljem daje null bez greske", () => {
    expect(normalizujVazenje("custom", "")).toEqual({ vazenje: null, greska: null })
  })

  it("na neodredjeno nema vazenje u mjesecima", () => {
    expect(normalizujVazenje("neodredjeno", "")).toEqual({ vazenje: null, greska: null })
  })
})
