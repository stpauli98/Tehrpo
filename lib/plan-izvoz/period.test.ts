import { describe, it, expect } from "vitest"
import { validRaspon, izvozPeriodRange, izvozPeriodLabel } from "./period"

describe("validRaspon", () => {
  it("oba ISO i od<=do → true", () => {
    expect(validRaspon("2026-07-01", "2026-07-15")).toBe(true)
    expect(validRaspon("2026-07-15", "2026-07-15")).toBe(true)
  })
  it("od>do → false", () => expect(validRaspon("2026-07-16", "2026-07-15")).toBe(false))
  it("nedostaje/nevažeći → false", () => {
    expect(validRaspon(null, "2026-07-15")).toBe(false)
    expect(validRaspon("2026-07-01", "")).toBe(false)
    expect(validRaspon("07/01/2026", "2026-07-15")).toBe(false)
  })
})

describe("izvozPeriodRange", () => {
  it("om → tekući kalendarski mjesec (danas override)", () => {
    expect(izvozPeriodRange({ mod: "om" }, "2026-07-11")).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("god → cijela godina", () => {
    expect(izvozPeriodRange({ mod: "god", godina: 2026 })).toEqual({ from: "2026-01-01", to: "2026-12-31" })
  })
  it("mj → taj mjesec", () => {
    expect(izvozPeriodRange({ mod: "mj", godina: 2025, mjesec: 2 })).toEqual({ from: "2025-02-01", to: "2025-02-28" })
  })
  it("raspon → od/do direktno", () => {
    expect(izvozPeriodRange({ mod: "raspon", od: "2026-07-03", do: "2026-08-09" })).toEqual({ from: "2026-07-03", to: "2026-08-09" })
  })
  it("svi → null", () => expect(izvozPeriodRange({ mod: "svi" })).toBeNull())
})

describe("izvozPeriodLabel", () => {
  it("om → 'Jul 2026'", () => expect(izvozPeriodLabel({ mod: "om" }, "svi mjeseci", "2026-07-11")).toBe("Jul 2026"))
  it("god → '2026'", () => expect(izvozPeriodLabel({ mod: "god", godina: 2026 }, "svi mjeseci")).toBe("2026"))
  it("mj → 'Mart 2026'", () => expect(izvozPeriodLabel({ mod: "mj", godina: 2026, mjesec: 3 }, "svi mjeseci")).toBe("Mart 2026"))
  it("svi → injektovani label", () => expect(izvozPeriodLabel({ mod: "svi" }, "svi mjeseci")).toBe("svi mjeseci"))
  it("raspon → formatirani datumi", () => {
    const l = izvozPeriodLabel({ mod: "raspon", od: "2026-07-01", do: "2026-07-15" }, "svi mjeseci")
    expect(l).toContain("01.07.2026")
    expect(l).toContain("15.07.2026")
    expect(l).toContain("–")
  })
})
