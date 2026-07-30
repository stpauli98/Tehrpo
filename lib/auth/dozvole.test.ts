import { describe, it, expect } from "vitest"
import { efektivneDozvole, PRAZNE_DOZVOLE, type Dozvole } from "./dozvole"

const SVE: Dozvole = {
  smije_brisati_svoje: true,
  smije_brisati_tudje: true,
  smije_brisati_klijente: true,
  smije_zatvoriti_bez_nalaza: true,
}

describe("efektivneDozvole", () => {
  it("admin ima sve bez obzira na kolone", () => {
    expect(efektivneDozvole("admin", PRAZNE_DOZVOLE)).toEqual(SVE)
  })

  it("pregled nema nijednu bez obzira na kolone", () => {
    expect(efektivneDozvole("pregled", SVE)).toEqual(PRAZNE_DOZVOLE)
  })

  it("operater dobija tačno ono što je upisano", () => {
    const d: Dozvole = { ...PRAZNE_DOZVOLE, smije_brisati_svoje: true }
    expect(efektivneDozvole("operater", d)).toEqual(d)
  })
})
