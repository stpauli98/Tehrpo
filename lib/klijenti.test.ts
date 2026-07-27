import { describe, it, expect } from "vitest"
import { normalizujNaziv } from "./klijenti"

describe("normalizujNaziv", () => {
  it("uklanja vodeće i prateće razmake", () => {
    expect(normalizujNaziv("  Skladište  ")).toBe("skladište")
  })

  it("kolapsira višestruke razmake u jedan", () => {
    expect(normalizujNaziv("Glavni   magacin")).toBe("glavni magacin")
  })

  it("tretira tab i novi red kao razmak", () => {
    expect(normalizujNaziv("Glavni\t\nmagacin")).toBe("glavni magacin")
  })

  it("ne razlikuje velika i mala slova", () => {
    expect(normalizujNaziv("SKLADIŠTE")).toBe(normalizujNaziv("skladište"))
  })

  it("izjednačava kombinaciju razmaka i veličine slova", () => {
    expect(normalizujNaziv("  Skladište  ")).toBe(normalizujNaziv("skladište"))
  })

  it("razlikuje stvarno različite nazive", () => {
    expect(normalizujNaziv("Skladište 1")).not.toBe(normalizujNaziv("Skladište 2"))
  })

  it("prazan i samo-razmak ulaz daju prazan string", () => {
    expect(normalizujNaziv("")).toBe("")
    expect(normalizujNaziv("   ")).toBe("")
  })
})
