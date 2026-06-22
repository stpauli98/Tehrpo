import { describe, it, expect } from "vitest"
import { dryGenerateZapisnik, buildPrompt } from "./content"

describe("dryGenerateZapisnik", () => {
  it("deterministični sadržaj uključuje klijenta i vrstu provjere", () => {
    const c = dryGenerateZapisnik({
      klijent: "WAIKIKI",
      lokacija: "Banja Luka - Delta",
      vrstaProvjere: "Servis PP aparata",
      datum: "2026-06-22",
      zaduzeni: null,
    })
    expect(c.dryRun).toBe(true)
    expect(c.nalaz).toContain("WAIKIKI")
    expect(c.nalaz).toContain("Servis PP aparata")
    expect(c.zakljucak.length).toBeGreaterThan(10)
  })

  it("buildPrompt traži čist JSON odgovor na bosanskom", () => {
    const p = buildPrompt({
      klijent: "WAIKIKI", lokacija: null, vrstaProvjere: "Hidranti",
      datum: "2026-06-22", zaduzeni: "Marija K.",
    })
    expect(p).toContain("Hidranti")
    expect(p).toContain("JSON")
    expect(p).toContain("nalaz")
    expect(p).toContain("zakljucak")
  })
})
