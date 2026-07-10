import { describe, it, expect } from "vitest"
import { jeZakazanoPoslijeRoka, danaPoslijeRoka } from "./plan-datum"

describe("jeZakazanoPoslijeRoka", () => {
  it("true kad je zakazan strogo poslije roka", () => {
    expect(jeZakazanoPoslijeRoka("2026-07-13", "2026-07-15")).toBe(true)
  })
  it("false kad je zakazan na rok", () => {
    expect(jeZakazanoPoslijeRoka("2026-07-13", "2026-07-13")).toBe(false)
  })
  it("false kad je zakazan prije roka", () => {
    expect(jeZakazanoPoslijeRoka("2026-07-13", "2026-07-10")).toBe(false)
  })
  it("false kad zakazan nije postavljen", () => {
    expect(jeZakazanoPoslijeRoka("2026-07-13", null)).toBe(false)
    expect(jeZakazanoPoslijeRoka("2026-07-13", "")).toBe(false)
  })
  it("false kad rok nedostaje", () => {
    expect(jeZakazanoPoslijeRoka(null, "2026-07-15")).toBe(false)
  })
})

describe("danaPoslijeRoka", () => {
  it("broji kalendarske dane između roka i zakazanog", () => {
    expect(danaPoslijeRoka("2026-07-13", "2026-07-15")).toBe(2)
  })
  it("radi preko granice mjeseca", () => {
    expect(danaPoslijeRoka("2026-07-31", "2026-08-02")).toBe(2)
  })
  it("0 kad su isti", () => {
    expect(danaPoslijeRoka("2026-07-13", "2026-07-13")).toBe(0)
  })
})
