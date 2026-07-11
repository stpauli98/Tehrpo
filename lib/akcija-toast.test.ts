import { describe, it, expect } from "vitest"
import { odlukaToast } from "./akcija-toast"

describe("odlukaToast", () => {
  it("ok:true → success sa uspjeh porukom", () => {
    expect(odlukaToast({ ok: true }, "Sačuvano", "Greška")).toEqual({
      tip: "success",
      poruka: "Sačuvano",
    })
  })

  it("ok:false + message → error sa tom porukom", () => {
    expect(odlukaToast({ ok: false, message: "Naziv postoji" }, "Sačuvano", "Greška")).toEqual({
      tip: "error",
      poruka: "Naziv postoji",
    })
  })

  it("ok:false samo errors (polja) → null (inline prikaz, bez toasta)", () => {
    expect(
      odlukaToast({ ok: false, errors: { naziv: ["Obavezno"] } }, "Sačuvano", "Greška"),
    ).toBeNull()
  })

  it("ok:false bez message ni errors → error fallback", () => {
    expect(odlukaToast({ ok: false }, "Sačuvano", "Greška")).toEqual({
      tip: "error",
      poruka: "Greška",
    })
  })

  it("ok:false sa message I errors → message pobjeđuje (toast)", () => {
    expect(
      odlukaToast({ ok: false, message: "RLS blokada", errors: { x: ["y"] } }, "Sačuvano", "Greška"),
    ).toEqual({ tip: "error", poruka: "RLS blokada" })
  })
})
