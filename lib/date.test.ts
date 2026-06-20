import { describe, it, expect } from "vitest"
import { formatDatum, monthRange, MONTHS_BS, todayIso } from "./date"

describe("formatDatum", () => {
  it("ISO datum → DD.MM.YYYY.", () => {
    expect(formatDatum("2026-07-28")).toBe("28.07.2026.")
  })
  it("ISO timestamp → uzima samo datum dio", () => {
    expect(formatDatum("2026-02-05T12:30:00Z")).toBe("05.02.2026.")
  })
  it("null → em-dash", () => {
    expect(formatDatum(null)).toBe("—")
    expect(formatDatum(undefined)).toBe("—")
    expect(formatDatum("")).toBe("—")
  })
  it("nevažeći format → em-dash", () => {
    expect(formatDatum("28/07/2026")).toBe("—")
    expect(formatDatum("garbage")).toBe("—")
  })
})

describe("monthRange", () => {
  it("Februar 2026 (28 dana)", () => {
    expect(monthRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
  it("Juli 2026 (31 dan)", () => {
    expect(monthRange(2026, 7)).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("Februar 2028 (prestupna, 29 dana)", () => {
    expect(monthRange(2028, 2)).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })
})

describe("MONTHS_BS", () => {
  it("ima 12 mjeseci, Januar prvi", () => {
    expect(MONTHS_BS).toHaveLength(12)
    expect(MONTHS_BS[0]).toBe("Januar")
    expect(MONTHS_BS[11]).toBe("Decembar")
  })
})

describe("todayIso", () => {
  it("vraća YYYY-MM-DD string koji odgovara trenutnom UTC datumu", () => {
    const result = todayIso()
    // format check
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // value check: build expected from UTC components
    const now = new Date()
    const y = now.getUTCFullYear()
    const m = String(now.getUTCMonth() + 1).padStart(2, "0")
    const d = String(now.getUTCDate()).padStart(2, "0")
    expect(result).toBe(`${y}-${m}-${d}`)
  })
})
