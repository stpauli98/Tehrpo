import { describe, it, expect } from "vitest"
import { friendlyDbError } from "./db-errors"

describe("friendlyDbError", () => {
  it("23505 → duplikat", () => expect(friendlyDbError({ code: "23505" })).toMatch(/već postoji/i))
  it("23503 → u upotrebi", () => expect(friendlyDbError({ code: "23503" })).toMatch(/u upotrebi|povezan/i))
  it("23514 → nevažeći podaci", () => expect(friendlyDbError({ code: "23514" })).toMatch(/nevažeć/i))
  it("nepoznat kod → generička poruka (ne curi raw)", () => {
    const msg = friendlyDbError({ code: "XX999", message: "permission denied for table korisnici" })
    expect(msg).not.toMatch(/permission denied/)
  })
  it("null → generička poruka", () => expect(friendlyDbError(null)).toBeTruthy())
})
