import { describe, it, expect } from "vitest"
import { STATUS_ORDER, toDerivedStatus } from "@/lib/termini"

describe("STATUS_ORDER", () => {
  it("sadrži svih 5 statusa", () => {
    expect(STATUS_ORDER).toHaveLength(5)
  })

  it("redoslijed je ispravan", () => {
    expect(STATUS_ORDER).toEqual(["izvrseno", "planirano", "zakazano", "kasni", "otkazano"])
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
