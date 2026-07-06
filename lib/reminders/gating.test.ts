import { describe, it, expect } from "vitest"
import { podsjetniciAktivni } from "./gating"

describe("podsjetniciAktivni", () => {
  it("true kad je flag true", () => {
    expect(podsjetniciAktivni({ podsjetnici_aktivni: true })).toBe(true)
  })
  it("false kad je flag false", () => {
    expect(podsjetniciAktivni({ podsjetnici_aktivni: false })).toBe(false)
  })
  it("default true kad reda nema (tolerantno na fazu prije migracije)", () => {
    expect(podsjetniciAktivni(null)).toBe(true)
    expect(podsjetniciAktivni(undefined)).toBe(true)
  })
})
