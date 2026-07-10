import { describe, it, expect } from "vitest"
import { validirajNovuLozinku } from "./lozinka"

describe("validirajNovuLozinku", () => {
  it("ok kad je >=8 i poklapa se", () => {
    expect(validirajNovuLozinku("tajna123", "tajna123")).toEqual({ ok: true })
  })
  it("min kad je kraća od 8", () => {
    expect(validirajNovuLozinku("kratko7", "kratko7")).toEqual({ ok: false, razlog: "min" })
  })
  it("nePoklapaju kad se ne slažu (i kad je dužina ok)", () => {
    expect(validirajNovuLozinku("tajna123", "tajna124")).toEqual({ ok: false, razlog: "nePoklapaju" })
  })
})
