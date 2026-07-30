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
    // datum u tekstu po standardu prikaza (dd.MM.yyyy), ne interni ISO
    expect(c.nalaz).toContain("dana 22.06.2026.")
    expect(c.nalaz).not.toContain("2026-06-22")
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
    expect(p).toContain("na bosanskom jeziku")
    // datum modelu ide formatiran + eksplicitno pravilo formata u prompt-u
    expect(p).toContain("Datum izvršenja: 22.06.2026")
    expect(p).toContain("dd.MM.yyyy")
    expect(p).not.toContain("2026-06-22")
  })

  it("en: buildPrompt traži JSON odgovor na engleskom, ne na bosanskom", () => {
    const p = buildPrompt({
      klijent: "WAIKIKI", lokacija: null, vrstaProvjere: "Hidranti",
      datum: "2026-06-22", zaduzeni: "Marija K.",
    }, "en")
    expect(p).toContain("Hidranti")
    expect(p).toContain("JSON")
    expect(p).toContain("in English")
    expect(p).not.toContain("na bosanskom jeziku")
  })

  it("en: dryGenerateZapisnik vraća engleski mock sadržaj", () => {
    const c = dryGenerateZapisnik({
      klijent: "WAIKIKI",
      lokacija: "Banja Luka - Delta",
      vrstaProvjere: "Servis PP aparata",
      datum: "2026-06-22",
      zaduzeni: null,
    }, "en")
    expect(c.dryRun).toBe(true)
    expect(c.nalaz).toContain("WAIKIKI")
    expect(c.nalaz).toContain("Servis PP aparata")
    expect(c.nalaz).toContain("location Banja Luka - Delta")
    // isti standard prikaza datuma za sve lokale (dd.MM.yyyy)
    expect(c.nalaz).toContain("on 22.06.2026.")
    expect(c.nalaz).not.toContain("2026-06-22")
    expect(c.zakljucak.length).toBeGreaterThan(10)
    expect(c.nalaz).not.toContain("Izvršena je provjera")
  })
})
