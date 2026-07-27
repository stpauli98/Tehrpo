import { describe, it, expect } from "vitest"
import { imenaZaPrijedloge } from "./aktivni-korisnici"

describe("imenaZaPrijedloge", () => {
  it("prazan/nedostajući ulaz → prazan niz", () => {
    expect(imenaZaPrijedloge(null)).toEqual([])
    expect(imenaZaPrijedloge(undefined)).toEqual([])
    expect(imenaZaPrijedloge([])).toEqual([])
  })

  it("izbacuje prazna i whitespace imena", () => {
    expect(imenaZaPrijedloge([{ ime: "" }, { ime: "   " }, { ime: null }, { ime: "Ana" }])).toEqual([
      "Ana",
    ])
  })

  it("trimuje i uklanja duplikate", () => {
    expect(imenaZaPrijedloge([{ ime: "Ana" }, { ime: " Ana " }, { ime: "Ana" }])).toEqual(["Ana"])
  })

  it("sortira po lokalnom poretku", () => {
    expect(imenaZaPrijedloge([{ ime: "Marko" }, { ime: "Ana" }, { ime: "Čedo" }])).toEqual([
      "Ana",
      "Čedo",
      "Marko",
    ])
  })
})
