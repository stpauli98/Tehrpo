import { describe, it, expect } from "vitest"
import { rokRelativnaOznaka } from "./hitno"

describe("rokRelativnaOznaka", () => {
  it("prošli rok → 'kasni X dana', danger", () => {
    expect(rokRelativnaOznaka("2026-06-20", "2026-06-22")).toEqual({ text: "kasni 2 dana", tone: "danger" })
  })
  it("kasni 1 dan (singular)", () => {
    expect(rokRelativnaOznaka("2026-06-21", "2026-06-22")).toEqual({ text: "kasni 1 dan", tone: "danger" })
  })
  it("rok danas → 'danas', danger", () => {
    expect(rokRelativnaOznaka("2026-06-22", "2026-06-22")).toEqual({ text: "danas", tone: "danger" })
  })
  it("budući 1 dan → 'za 1 dan', warning", () => {
    expect(rokRelativnaOznaka("2026-06-23", "2026-06-22")).toEqual({ text: "za 1 dan", tone: "warning" })
  })
  it("budući 5 dana → 'za 5 dana', warning", () => {
    expect(rokRelativnaOznaka("2026-06-27", "2026-06-22")).toEqual({ text: "za 5 dana", tone: "warning" })
  })
  it("11 ostaje 'dana' (n%100===11 izuzetak)", () => {
    expect(rokRelativnaOznaka("2026-07-03", "2026-06-22").text).toBe("za 11 dana")
  })
  it("prelazak mjeseca računa cijele dane", () => {
    expect(rokRelativnaOznaka("2026-01-20", "2026-02-01")).toEqual({ text: "kasni 12 dana", tone: "danger" })
  })
})
