import { describe, it, expect } from "vitest"
import { porukaIzOdgovora, porukaGreske } from "./plan-aktivnosti"

function odgovor(body: string, ct = "application/json"): Response {
  return new Response(body, { status: 400, headers: { "Content-Type": ct } })
}

describe("porukaIzOdgovora", () => {
  it("vraća serversku i18n poruku iz `{ error }` envelope-a", async () => {
    expect(await porukaIzOdgovora(odgovor(JSON.stringify({ error: "Nema pristupa." })))).toBe(
      "Nema pristupa.",
    )
  })

  it("prazan/whitespace `error` se tretira kao da ga nema", async () => {
    expect(await porukaIzOdgovora(odgovor(JSON.stringify({ error: "" })))).toBe("")
    expect(await porukaIzOdgovora(odgovor(JSON.stringify({ error: "   " })))).toBe("")
  })

  it("ne-string `error` (npr. stari sirovi PostgrestError objekat) se ignoriše", async () => {
    const body = JSON.stringify({ error: { message: "x", code: "42501" } })
    expect(await porukaIzOdgovora(odgovor(body))).toBe("")
  })

  it("ne-JSON odgovor ne baca, vraća prazno", async () => {
    expect(await porukaIzOdgovora(odgovor("<html>500</html>", "text/html"))).toBe("")
  })

  it("JSON bez `error` ključa vraća prazno", async () => {
    expect(await porukaIzOdgovora(odgovor(JSON.stringify({ broj: 3 })))).toBe("")
  })
})

describe("porukaGreske", () => {
  it("Error sa porukom → ta poruka", () => {
    expect(porukaGreske(new Error("Greška iz baze"))).toBe("Greška iz baze")
  })

  it("Error bez poruke → undefined (komponenta koristi common fallback)", () => {
    expect(porukaGreske(new Error(""))).toBeUndefined()
  })

  it("ne-Error vrijednosti → undefined", () => {
    expect(porukaGreske(null)).toBeUndefined()
    expect(porukaGreske("string greška")).toBeUndefined()
    expect(porukaGreske(undefined)).toBeUndefined()
  })
})
