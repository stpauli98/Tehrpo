import { describe, it, expect } from "vitest"
import { kursorOd, parsirajKursor } from "./kursor"

describe("kursorOd", () => {
  it("vraća null za praznu listu", () => {
    expect(kursorOd([])).toBeNull()
  })

  it("uzima posljednji red, ne prvi", () => {
    expect(kursorOd([
      { vrijeme: "2026-07-28T10:00:00Z", id: 900 },
      { vrijeme: "2026-07-28T09:00:00Z", id: 800 },
    ])).toEqual({ vrijeme: "2026-07-28T09:00:00Z", id: 800 })
  })
})

describe("parsirajKursor", () => {
  it("vraća null kad nedostaje bilo koji dio", () => {
    expect(parsirajKursor(undefined, "5")).toBeNull()
    expect(parsirajKursor("2026-07-28T09:00:00Z", undefined)).toBeNull()
  })

  it("vraća null za neispravan id", () => {
    expect(parsirajKursor("2026-07-28T09:00:00Z", "abc")).toBeNull()
    expect(parsirajKursor("2026-07-28T09:00:00Z", "1.5")).toBeNull()
  })

  it("vraća null za neispravan datum", () => {
    expect(parsirajKursor("juce", "5")).toBeNull()
  })

  it("parsira ispravan kursor", () => {
    expect(parsirajKursor("2026-07-28T09:00:00Z", "800"))
      .toEqual({ vrijeme: "2026-07-28T09:00:00Z", id: 800 })
  })
})
