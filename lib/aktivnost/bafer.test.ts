import { describe, it, expect } from "vitest"
import { noviBafer, dodaj, isprazni } from "./bafer"
import type { DogadjajUnos } from "./tipovi"

const nav = (e: string): DogadjajUnos => ({
  akcija: "NAVIGATE",
  entitet: e,
  entitet_id: null,
  detalji: { ekran: e },
})

describe("bafer", () => {
  it("dodaje različite događaje", () => {
    const b = noviBafer()
    expect(dodaj(b, nav("klijenti"))).toBe(true)
    expect(dodaj(b, nav("termini"))).toBe(true)
    expect(b.redovi).toHaveLength(2)
  })
  it("dedup uzastopnog istog", () => {
    const b = noviBafer()
    expect(dodaj(b, nav("klijenti"))).toBe(true)
    expect(dodaj(b, nav("klijenti"))).toBe(false)
    expect(b.redovi).toHaveLength(1)
  })
  it("isprazni vraća i čisti, ali dedup preživi flush", () => {
    const b = noviBafer()
    dodaj(b, nav("klijenti"))
    expect(isprazni(b)).toHaveLength(1)
    expect(b.redovi).toHaveLength(0)
    expect(dodaj(b, nav("klijenti"))).toBe(false) // isti kao prije flush-a
    expect(dodaj(b, nav("termini"))).toBe(true)
  })
})
