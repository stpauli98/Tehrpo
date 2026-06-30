import { describe, it, expect } from "vitest"
import { parsePlanFilteri, mjesecRange } from "./plan-filteri"
import { currentYear } from "./date"

describe("parsePlanFilteri", () => {
  it("prazni params → default mjesec 'tn', status 'svi', godina = tekuća", () => {
    const f = parsePlanFilteri(new URLSearchParams())
    expect(f.mjesec).toBe("tn")
    expect(f.status).toBe("svi")
    expect(f.godina).toBe(currentYear())
    expect(f.klijentId).toBe("")
  })
  it("čita sve filtere", () => {
    const f = parsePlanFilteri(new URLSearchParams("status=kasni&q=as&klijent_id=k1&lokacija=l1&vrsta_id=v1&mjesec=7&godina=2027"))
    expect(f).toMatchObject({ status: "kasni", q: "as", klijentId: "k1", lokacijaId: "l1", vrstaId: "v1", mjesec: "7", godina: 2027 })
  })
})

describe("mjesecRange", () => {
  const base = (mjesec: string, godina = 2026) => ({ status: "svi", q: "", klijentId: "", lokacijaId: "", vrstaId: "", mjesec, godina })
  it("'tn' → raspon tekući+naredni (ne null)", () => {
    const r = mjesecRange(base("tn"))
    expect(r).not.toBeNull()
    expect(r!.from.endsWith("-01")).toBe(true)
  })
  it("'7' → juli 2026", () => {
    expect(mjesecRange(base("7"))).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("'svi' → null (bez datumskog opsega)", () => {
    expect(mjesecRange(base("svi"))).toBeNull()
  })
})
