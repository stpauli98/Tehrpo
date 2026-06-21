import { describe, it, expect } from "vitest"
import { buildMonthGrid, prevMonth, nextMonth, monthLabel } from "./calendar"

describe("buildMonthGrid", () => {
  it("uvijek vraća 42 ćelije", () => {
    expect(buildMonthGrid(2026, 2)).toHaveLength(42)
    expect(buildMonthGrid(2026, 7)).toHaveLength(42)
  })
  it("Februar 2026 počinje nedjeljom — 6 vodećih dana (Pon-Sub)", () => {
    // 2026-02-01 je nedjelja (UTC getUTCDay=0) → mondayOffset=6
    const g = buildMonthGrid(2026, 2)
    expect(g[0]?.inMonth).toBe(false)
    expect(g[6]).toEqual({ date: "2026-02-01", day: 1, inMonth: true })
  })
  it("tekući mjesec ima tačan broj dana inMonth", () => {
    const feb = buildMonthGrid(2026, 2).filter((c) => c.inMonth)
    expect(feb).toHaveLength(28)
    const jul = buildMonthGrid(2026, 7).filter((c) => c.inMonth)
    expect(jul).toHaveLength(31)
  })
  it("datumi su ISO YYYY-MM-DD", () => {
    const g = buildMonthGrid(2026, 7).find((c) => c.inMonth && c.day === 15)
    expect(g?.date).toBe("2026-07-15")
  })
})

describe("prevMonth / nextMonth", () => {
  it("prelazak godine", () => {
    expect(prevMonth(2026, 1)).toEqual({ year: 2025, month: 12 })
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 })
  })
  it("unutar godine", () => {
    expect(prevMonth(2026, 7)).toEqual({ year: 2026, month: 6 })
    expect(nextMonth(2026, 7)).toEqual({ year: 2026, month: 8 })
  })
})

describe("monthLabel", () => {
  it("1=Januar, 12=Decembar", () => {
    expect(monthLabel(1)).toBe("Januar")
    expect(monthLabel(12)).toBe("Decembar")
  })
})
