import { describe, it, expect } from "vitest"
import { isCronAuthorized } from "./cronAuth"

describe("isCronAuthorized", () => {
  it("true za tačan Bearer token", () => {
    expect(isCronAuthorized("Bearer tajna", "tajna")).toBe(true)
  })
  it("false za pogrešan token", () => {
    expect(isCronAuthorized("Bearer drugo", "tajna")).toBe(false)
  })
  it("false kad nedostaje header", () => {
    expect(isCronAuthorized(null, "tajna")).toBe(false)
  })
  it("fail-closed kad secret nije postavljen", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false)
    expect(isCronAuthorized(null, undefined)).toBe(false)
  })
})
