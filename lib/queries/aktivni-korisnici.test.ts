import { describe, it, expect } from "vitest"
import { grupisiPrijedlogeByFirma } from "./aktivni-korisnici"

describe("grupisiPrijedlogeByFirma", () => {
  it("prazan/nedostajući ulaz → prazan objekat", () => {
    expect(grupisiPrijedlogeByFirma(null)).toEqual({})
    expect(grupisiPrijedlogeByFirma(undefined)).toEqual({})
    expect(grupisiPrijedlogeByFirma([])).toEqual({})
  })

  it("grupiše po klijent_id, izbacuje redove bez firme ili imena", () => {
    expect(
      grupisiPrijedlogeByFirma([
        { klijent_id: "k1", ime: "Ana" },
        { klijent_id: "k1", ime: "Marko" },
        { klijent_id: "k2", ime: "Ana" },
        { klijent_id: null, ime: "Bez firme" },
        { klijent_id: "k1", ime: "" },
      ]),
    ).toEqual({
      k1: ["Ana", "Marko"],
      k2: ["Ana"],
    })
  })

  it("dedup unutar iste firme (trim), sortira po lokalnom poretku", () => {
    expect(
      grupisiPrijedlogeByFirma([
        { klijent_id: "k1", ime: "Marko" },
        { klijent_id: "k1", ime: " Marko " },
        { klijent_id: "k1", ime: "Ana" },
        { klijent_id: "k1", ime: "Čedo" },
      ]),
    ).toEqual({ k1: ["Ana", "Čedo", "Marko"] })
  })
})
