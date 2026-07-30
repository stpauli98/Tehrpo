import { describe, it, expect } from "vitest"
import { hitnoKasniOrFilter, SELECT_HITNO } from "./pregled"

describe("SELECT_HITNO", () => {
  it("nosi datum_zakazan — bez njega red ne može pokazati da je termin prezakazan", () => {
    // Kolona koju komponenta traži, a upit ne izabere, stiže kao undefined i tiho se
    // izgubi u prikazu: red bi opet govorio samo o roku.
    expect(SELECT_HITNO.split(",").map((s) => s.trim())).toContain("datum_zakazan")
  })
})

describe("hitnoKasniOrFilter", () => {
  const granica = "2026-08-25"

  it("prvi ogranak hvata sve što je već `kasni`", () => {
    expect(hitnoKasniOrFilter(granica)).toContain("status_izvedeni.eq.kasni")
  })

  it("drugi ogranak nosi granicu roka", () => {
    expect(hitnoKasniOrFilter(granica)).toContain(`rok_dospijeca.lte.${granica}`)
  })

  it("otkazani su isječeni zajedno sa izvršenima (N2)", () => {
    expect(hitnoKasniOrFilter(granica)).toContain(
      'status_izvedeni.not.in.("izvrseno","otkazano")',
    )
  })

  it("stari `neq.izvrseno` (koji je propuštao otkazane) više ne postoji", () => {
    expect(hitnoKasniOrFilter(granica)).not.toContain("neq.izvrseno")
  })

  it("oba ogranka su u jednom `or` izrazu, drugi umotan u and()", () => {
    expect(hitnoKasniOrFilter(granica)).toBe(
      'status_izvedeni.eq.kasni,and(rok_dospijeca.lte.2026-08-25,status_izvedeni.not.in.("izvrseno","otkazano"))',
    )
  })

  it("granica se ugrađuje doslovno (bez zaostajanja između poziva)", () => {
    expect(hitnoKasniOrFilter("2027-01-01")).toContain("rok_dospijeca.lte.2027-01-01")
    expect(hitnoKasniOrFilter("2027-01-01")).not.toContain(granica)
  })
})
