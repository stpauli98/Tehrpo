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
  it("21 dana kasni ostaje 'dan' (sr n%10 pravilo) — sr izbjegava ICU =1 zamku", () => {
    expect(rokRelativnaOznaka("2026-05-01", "2026-05-22").text).toBe("kasni 21 dan")
  })
  it("sr eksplicitno → identično defaultu (byte-identical)", () => {
    expect(rokRelativnaOznaka("2026-06-20", "2026-06-22", "sr")).toEqual({ text: "kasni 2 dana", tone: "danger" })
  })
})

describe("rokRelativnaOznaka — en", () => {
  it("prošli rok → '# days overdue'", () => {
    expect(rokRelativnaOznaka("2026-06-20", "2026-06-22", "en")).toEqual({ text: "2 days overdue", tone: "danger" })
  })
  it("kasni 1 dan (singular)", () => {
    expect(rokRelativnaOznaka("2026-06-21", "2026-06-22", "en")).toEqual({ text: "1 day overdue", tone: "danger" })
  })
  it("rok danas → 'due today'", () => {
    expect(rokRelativnaOznaka("2026-06-22", "2026-06-22", "en")).toEqual({ text: "due today", tone: "danger" })
  })
  it("budući 1 dan → 'due in 1 day'", () => {
    expect(rokRelativnaOznaka("2026-06-23", "2026-06-22", "en")).toEqual({ text: "due in 1 day", tone: "warning" })
  })
  it("budući 5 dana → 'due in 5 days'", () => {
    expect(rokRelativnaOznaka("2026-06-27", "2026-06-22", "en")).toEqual({ text: "due in 5 days", tone: "warning" })
  })
})

describe("rokRelativnaOznaka — de", () => {
  it("prošli rok → '# Tage überfällig'", () => {
    expect(rokRelativnaOznaka("2026-06-20", "2026-06-22", "de")).toEqual({ text: "2 Tage überfällig", tone: "danger" })
  })
  it("kasni 1 dan (singular)", () => {
    expect(rokRelativnaOznaka("2026-06-21", "2026-06-22", "de")).toEqual({ text: "1 Tag überfällig", tone: "danger" })
  })
  it("rok danas → 'heute fällig'", () => {
    expect(rokRelativnaOznaka("2026-06-22", "2026-06-22", "de")).toEqual({ text: "heute fällig", tone: "danger" })
  })
  it("budući 1 dan → 'fällig in 1 Tag'", () => {
    expect(rokRelativnaOznaka("2026-06-23", "2026-06-22", "de")).toEqual({ text: "fällig in 1 Tag", tone: "warning" })
  })
  it("budući 5 dana → 'fällig in 5 Tagen'", () => {
    expect(rokRelativnaOznaka("2026-06-27", "2026-06-22", "de")).toEqual({ text: "fällig in 5 Tagen", tone: "warning" })
  })
})
