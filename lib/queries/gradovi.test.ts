import { describe, expect, it } from "vitest"
import { distinctGradovi } from "./gradovi"

describe("distinctGradovi", () => {
  it("prazan/null ulaz → prazan niz", () => {
    expect(distinctGradovi(null)).toEqual([])
    expect(distinctGradovi(undefined)).toEqual([])
    expect(distinctGradovi([])).toEqual([])
  })

  it("dedup + sort (localeCompare), whitespace se trimuje", () => {
    const redovi = [
      { grad: "Prijedor" },
      { grad: "Banja Luka" },
      { grad: "  Banja Luka  " },
      { grad: "Prijedor" },
      { grad: "Brčko" },
    ]
    expect(distinctGradovi(redovi)).toEqual(["Banja Luka", "Brčko", "Prijedor"])
  })

  it("null i prazni gradovi se preskaču (ne prave prazan unos)", () => {
    const redovi = [{ grad: null }, { grad: "" }, { grad: "   " }, { grad: "Doboj" }]
    expect(distinctGradovi(redovi)).toEqual(["Doboj"])
  })
})
