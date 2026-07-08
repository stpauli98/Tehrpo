import { describe, it, expect } from "vitest"
import { firmBrand } from "./firmBrand"

describe("firmBrand", () => {
  it("vraća name i tagline (default TEHPRO ako env ne override-uje)", () => {
    const b = firmBrand()
    expect(b.name.length).toBeGreaterThan(0)
    expect(b.tagline.length).toBeGreaterThan(0)
  })
})
