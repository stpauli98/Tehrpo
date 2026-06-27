import { describe, it, expect } from "vitest"
import { validUgovorDatumi } from "./ugovori"

describe("validUgovorDatumi", () => {
  it("dozvoljava istek nakon potpisa", () => {
    expect(validUgovorDatumi("2026-01-01", "2027-01-01")).toBe(true)
  })
  it("odbija istek prije potpisa", () => {
    expect(validUgovorDatumi("2027-01-01", "2026-01-01")).toBe(false)
  })
  it("dozvoljava jednake datume", () => {
    expect(validUgovorDatumi("2026-01-01", "2026-01-01")).toBe(true)
  })
  it("dozvoljava null vrijednosti", () => {
    expect(validUgovorDatumi(null, "2026-01-01")).toBe(true)
    expect(validUgovorDatumi("2026-01-01", null)).toBe(true)
    expect(validUgovorDatumi(null, null)).toBe(true)
  })
})
