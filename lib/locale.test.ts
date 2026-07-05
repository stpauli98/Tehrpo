import { describe, it, expect } from "vitest"
import { parseLocale } from "./locale"

describe("parseLocale", () => {
  it("prihvata podržane jezike", () => {
    expect(parseLocale("sr")).toBe("sr")
    expect(parseLocale("en")).toBe("en")
    expect(parseLocale("de")).toBe("de")
  })
  it("fallback na sr za nepoznato/prazno", () => {
    expect(parseLocale("fr")).toBe("sr")
    expect(parseLocale(undefined)).toBe("sr")
    expect(parseLocale("  ")).toBe("sr")
  })
  it("trimuje i normalizuje velika slova", () => {
    expect(parseLocale(" EN ")).toBe("en")
  })
})
