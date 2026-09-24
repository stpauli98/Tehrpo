import { describe, it, expect } from "vitest"
import { PLAN_KOLONE_KEYS, planRedCelije, type PlanRed } from "./types"
import { KOLONE_SIRINE, PDF_SIRINA, PDF_MARGINA } from "./pdf"

const ROW: PlanRed = {
  klijent: "AS", lokacija: "BL", usluga: "Hidranti", rok: "15.07.2026",
  preneseno: false, status: "Kasni", periodikaMj: 12, odgovorna: "Pero", nacin: "Izvršava",
}

describe("plan kolone", () => {
  it("„preneseno“ je dio ugovora kolona (bez nje godišnji plan ćuti o zaostacima)", () => {
    expect(PLAN_KOLONE_KEYS).toContain("preneseno")
  })

  it("broj ćelija reda odgovara broju kolona — zaglavlje i vrijednosti se ne mogu razići", () => {
    expect(planRedCelije(ROW, (p) => (p ? "Da" : "—"), "").length).toBe(PLAN_KOLONE_KEYS.length)
  })

  it("PDF širine kolona pokrivaju sve kolone i staju na stranu", () => {
    expect(KOLONE_SIRINE.length).toBe(PLAN_KOLONE_KEYS.length)
    const zbir = KOLONE_SIRINE.reduce((a, b) => a + b, 0)
    expect(zbir).toBeLessThanOrEqual(PDF_SIRINA - 2 * PDF_MARGINA)
  })

  it("oznaka prenesenog je na poziciji kolone „preneseno“", () => {
    const i = PLAN_KOLONE_KEYS.indexOf("preneseno")
    expect(planRedCelije({ ...ROW, preneseno: true }, (p) => (p ? "Da" : "—"), "")[i]).toBe("Da")
    expect(planRedCelije(ROW, (p) => (p ? "Da" : "—"), "")[i]).toBe("—")
  })
})
