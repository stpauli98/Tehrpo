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

  it("prazna baza uz pun storage → SVI objekti izgledaju osirotjelo (opasan smjer — čisto matematički tačno)", () => {
    // Ovo je namjerno pinovano ovdje: sama funkcija ne smije da nagađa je li prazna baza
    // legitimna ili je znak polomljenog upita/pogrešnog projekta — to je posao pozivaoca
    // (vidi guard u app/api/cron/ciscenje-storagea/route.ts koji odbija da obriše kad je
    // baza prazna a bucket nije).
    expect(osirotjeliObjekti(["termini/a/x.pdf", "termini/b/y.pdf"], [])).toEqual([
      "termini/a/x.pdf",
      "termini/b/y.pdf",
    ])
  })
})
