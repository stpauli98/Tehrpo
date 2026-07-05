import { describe, it, expect } from "vitest"
import { formatDatum, monthRange, MONTHS_BS, todayIso, periodRange, addMjeseci, monthName } from "./date"

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
  it("sr eksplicitno → identično defaultu (byte-identical)", () => {
    expect(formatDatum("2026-07-28", "sr")).toBe("28.07.2026.")
  })
  it("en → Intl.DateTimeFormat('en') MM/DD/YYYY", () => {
    expect(formatDatum("2026-07-28", "en")).toBe("07/28/2026")
  })
  it("de → Intl.DateTimeFormat('de') DD.MM.YYYY (bez tačke na kraju)", () => {
    expect(formatDatum("2026-07-28", "de")).toBe("28.07.2026")
  })
  it("en/de null → i dalje em-dash (logika prije locale grananja)", () => {
    expect(formatDatum(null, "en")).toBe("—")
    expect(formatDatum(undefined, "de")).toBe("—")
  })
})

describe("monthName", () => {
  it("sr (default) → identično MONTHS_BS (byte-identical)", () => {
    expect(monthName(1)).toBe("Januar")
    expect(monthName(12)).toBe("Decembar")
    expect(monthName(1, "sr")).toBe("Januar")
  })
  it("en → puno ime mjeseca preko Intl", () => {
    expect(monthName(1, "en")).toBe("January")
    expect(monthName(7, "en")).toBe("July")
    expect(monthName(12, "en")).toBe("December")
  })
  it("de → puno ime mjeseca preko Intl", () => {
    expect(monthName(1, "de")).toBe("Januar")
    expect(monthName(7, "de")).toBe("Juli")
    expect(monthName(12, "de")).toBe("Dezember")
  })
  it("nevažeći broj mjeseca → prazan string", () => {
    expect(monthName(0)).toBe("")
    expect(monthName(13)).toBe("")
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

describe("periodRange", () => {
  it("mjesec → prvi do zadnji dan mjeseca", () => {
    expect(periodRange("mjesec", 2026, 2)).toEqual({ od: "2026-02-01", do: "2026-02-28" })
  })
  it("kvartal Q2 → april–jun", () => {
    expect(periodRange("kvartal", 2026, undefined, 2)).toEqual({ od: "2026-04-01", do: "2026-06-30" })
  })
  it("godina → 01-01 do 12-31", () => {
    expect(periodRange("godina", 2026)).toEqual({ od: "2026-01-01", do: "2026-12-31" })
  })
})

describe("addMjeseci", () => {
  it("dodaje mjesece unutar godine", () => {
    expect(addMjeseci("2026-03-15", 3)).toBe("2026-06-15")
  })
  it("prelazi godinu", () => {
    expect(addMjeseci("2026-11-15", 3)).toBe("2027-02-15")
  })
  it("clamp na zadnji dan kraćeg mjeseca (31 jan +1 → 28 feb)", () => {
    expect(addMjeseci("2026-01-31", 1)).toBe("2026-02-28")
  })
  it("prestupna godina (29 feb)", () => {
    expect(addMjeseci("2024-01-31", 1)).toBe("2024-02-29")
  })
  it("0 i 12 mjeseci", () => {
    expect(addMjeseci("2026-05-10", 0)).toBe("2026-05-10")
    expect(addMjeseci("2026-05-10", 12)).toBe("2027-05-10")
  })
})

import { tekuciNarednomMjesecuRange } from "./date"

describe("tekuciNarednomMjesecuRange", () => {
  it("jun → [01.06, 31.07]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 5, 15)))).toEqual({ from: "2026-06-01", to: "2026-07-31" })
  })
  it("preko granice godine: decembar → [01.12, 31.01 sljedeće]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 11, 3)))).toEqual({ from: "2026-12-01", to: "2027-01-31" })
  })
  it("februar (28 dana naredni? ne — naredni je mart) → [01.02, 31.03]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 1, 10)))).toEqual({ from: "2026-02-01", to: "2026-03-31" })
  })
})
