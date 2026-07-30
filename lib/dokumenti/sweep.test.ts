import { describe, it, expect } from "vitest"
import { osirotjeliObjekti } from "./sweep"

describe("osirotjeliObjekti", () => {
  it("vraća objekte kojima nema reda u bazi", () => {
    expect(
      osirotjeliObjekti(["termini/a/x.pdf", "termini/b/y.pdf"], ["termini/a/x.pdf"]),
    ).toEqual(["termini/b/y.pdf"])
  })

  it("prazan storage → prazan rezultat", () => {
    expect(osirotjeliObjekti([], ["termini/a/x.pdf"])).toEqual([])
  })

  it("sve povezano → ništa za brisanje", () => {
    const p = ["termini/a/x.pdf", "termini/b/y.pdf"]
    expect(osirotjeliObjekti(p, p)).toEqual([])
  })

  it("red u bazi bez fajla se ignoriše (nije naš posao)", () => {
    expect(osirotjeliObjekti(["termini/a/x.pdf"], ["termini/a/x.pdf", "termini/c/z.pdf"])).toEqual([])
  })
})
