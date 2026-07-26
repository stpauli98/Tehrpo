import { describe, it, expect } from "vitest"
import { STATUS_FILTER_OPTIONS, STATUS_ORDER, toDerivedStatus } from "@/lib/termini"
import sr from "@/messages/sr.json"

describe("STATUS_ORDER", () => {
  it("sadrži svih 5 statusa", () => {
    expect(STATUS_ORDER).toHaveLength(5)
  })

  it("redoslijed je ispravan", () => {
    expect(STATUS_ORDER).toEqual(["izvrseno", "planirano", "zakazano", "kasni", "otkazano"])
  })
})

describe("STATUS_FILTER_OPTIONS", () => {
  it("skup value-a je {svi} ∪ DerivedStatus", () => {
    const values = new Set(STATUS_FILTER_OPTIONS.map((o) => o.value))
    expect(values).toEqual(new Set(["svi", ...STATUS_ORDER]))
  })

  it("svaki labelKey postoji u messages/sr.json pod status", () => {
    const statusKljucevi = Object.keys(sr.status)
    for (const o of STATUS_FILTER_OPTIONS) {
      expect(statusKljucevi).toContain(o.labelKey)
    }
  })
})

describe("toDerivedStatus", () => {
  it("vraća validan status", () => {
    expect(toDerivedStatus("kasni")).toBe("kasni")
  })

  it("fallback na planirano za nepoznate vrijednosti", () => {
    expect(toDerivedStatus(null)).toBe("planirano")
    expect(toDerivedStatus("nepostoji")).toBe("planirano")
  })
})
