import { describe, it, expect } from "vitest"
import { mozeUrediti, jeAdmin, smijePreuzeti } from "./roles"

describe("roles", () => {
  it("mozeUrediti: admin i operater true, pregled false", () => {
    expect(mozeUrediti("admin")).toBe(true)
    expect(mozeUrediti("operater")).toBe(true)
    expect(mozeUrediti("pregled")).toBe(false)
  })
  it("jeAdmin: samo admin", () => {
    expect(jeAdmin("admin")).toBe(true)
    expect(jeAdmin("operater")).toBe(false)
    expect(jeAdmin("pregled")).toBe(false)
  })
})

describe("smijePreuzeti", () => {
  it("admin i operater smiju preuzimati i izvoziti", () => {
    expect(smijePreuzeti("admin")).toBe(true)
    expect(smijePreuzeti("operater")).toBe(true)
  })

  it("pregled ne smije — uloga je čisto čitanje na ekranu", () => {
    expect(smijePreuzeti("pregled")).toBe(false)
  })
})
