import { describe, it, expect } from "vitest"
import { MONTHS_BS_OPTION, buildMonthsOption } from "./termini-filters"

describe("MONTHS_BS_OPTION", () => {
  it("sr (default) → 13 opcija, 'tn' prva, mjeseci hardkodirano identični (byte-identical)", () => {
    expect(MONTHS_BS_OPTION).toHaveLength(13)
    expect(MONTHS_BS_OPTION[0]).toEqual({ value: "tn", label: "Tekući + naredni mjesec" })
    expect(MONTHS_BS_OPTION[1]).toEqual({ value: "1", label: "Januar" })
    expect(MONTHS_BS_OPTION[12]).toEqual({ value: "12", label: "Decembar" })
  })
})

describe("buildMonthsOption", () => {
  it("sr eksplicitno → identično MONTHS_BS_OPTION (byte-identical)", () => {
    expect(buildMonthsOption("sr")).toEqual(MONTHS_BS_OPTION)
  })
  it("en → lokalizovano preko monthName + termini.filteri.tekuciNaredni", () => {
    const opts = buildMonthsOption("en")
    expect(opts[0]).toEqual({ value: "tn", label: "Current + next month" })
    expect(opts[1]).toEqual({ value: "1", label: "January" })
    expect(opts[7]).toEqual({ value: "7", label: "July" })
  })
  it("de → lokalizovano preko monthName + termini.filteri.tekuciNaredni", () => {
    const opts = buildMonthsOption("de")
    expect(opts[0]).toEqual({ value: "tn", label: "Aktueller + nächster Monat" })
    expect(opts[1]).toEqual({ value: "1", label: "Januar" })
    expect(opts[7]).toEqual({ value: "7", label: "Juli" })
  })
})
