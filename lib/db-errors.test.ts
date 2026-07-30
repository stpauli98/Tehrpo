import { describe, it, expect } from "vitest"
import { friendlyDbError } from "./db-errors"

describe("friendlyDbError", () => {
  it("23505 → duplikat", () => expect(friendlyDbError({ code: "23505" })).toMatch(/već postoji/i))
  it("23503 → u upotrebi", () => expect(friendlyDbError({ code: "23503" })).toMatch(/u upotrebi|povezan/i))
  it("23514 → nevažeći podaci", () => expect(friendlyDbError({ code: "23514" })).toMatch(/nevažeć/i))
  it("chk_termini_datumi → specifična poruka o datumu izvršenja", () => {
    const msg = friendlyDbError({
      code: "23514",
      message: 'new row for relation "termini" violates check constraint "chk_termini_datumi"',
    })
    expect(msg).toMatch(/budućnosti/i)
    expect(msg).not.toMatch(/check constraint/)
  })
  it("nalaz_obavezan → specifična poruka o zatvaranju bez nalaza", () => {
    const msg = friendlyDbError({ code: "23514", message: "nalaz_obavezan" })
    expect(msg).toMatch(/nalaza/i)
    expect(msg).not.toMatch(/nalaz_obavezan/)
  })
  it("nepoznat kod → generička poruka (ne curi raw)", () => {
    const msg = friendlyDbError({ code: "XX999", message: "permission denied for table korisnici" })
    expect(msg).not.toMatch(/permission denied/)
  })
  it("null → generička poruka", () => expect(friendlyDbError(null)).toBeTruthy())
})
