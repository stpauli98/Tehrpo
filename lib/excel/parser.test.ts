import { describe, it, expect } from "vitest"
import { canonicalizeNaziv, splitFirmaLokacija, parseStringDate, parseTehproExcel, POZNATE_FIRME, dedupeTermini } from "./parser"
import type { ParsedTermin } from "./parser.types"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FIXTURE = path.join(__dirname, "../../tests/fixtures/tehpro-mini.xlsx")

// ---------------------------------------------------------------------------
// canonicalizeNaziv
// ---------------------------------------------------------------------------
describe("canonicalizeNaziv", () => {
  it("uppercase, kolaps razmaka, skida završnu tačku", () => {
    expect(canonicalizeNaziv("  Ekonomski   institut. ")).toBe("EKONOMSKI INSTITUT")
  })
  it("normalizuje razmake oko crtice", () => {
    expect(canonicalizeNaziv("NEW YORKER-Doboj")).toBe("NEW YORKER - DOBOJ")
    expect(canonicalizeNaziv("WAIKIKI  -  ZVORNIK")).toBe("WAIKIKI - ZVORNIK")
  })
})

// ---------------------------------------------------------------------------
// splitFirmaLokacija
// ---------------------------------------------------------------------------
describe("splitFirmaLokacija", () => {
  it("WAIKIKI BANJA LUKA - DELTA → firma WAIKIKI, lok 'Banja Luka - Delta'", () => {
    const r = splitFirmaLokacija("WAIKIKI BANJA LUKA - DELTA")
    expect(r.firma).toBe("WAIKIKI")
    expect(r.lokacija).toBe("Banja Luka - Delta")
  })
  it("WAIKIKI DELTA (kratka) → 'Banja Luka - Delta' (dedup)", () => {
    expect(splitFirmaLokacija("WAIKIKI DELTA").lokacija).toBe("Banja Luka - Delta")
  })
  it("NEW YORKER BOSKA → 'Banja Luka - Boska'", () => {
    expect(splitFirmaLokacija("NEW YORKER BOSKA").lokacija).toBe("Banja Luka - Boska")
  })
  it("TRANSFERA FBIH (gola) → 'FBiH - skladište'", () => {
    expect(splitFirmaLokacija("TRANSFERA FBIH").lokacija).toBe("FBiH - skladište")
  })
  it("WAIKIKI ZVORNIK, BRČKO, BIJELJINA → lokacija sadrži zarez (kombinirani obilazak)", () => {
    const lok = splitFirmaLokacija("WAIKIKI ZVORNIK, BRČKO, BIJELJINA").lokacija
    expect(lok).toContain(",")
  })
  it("NEW YORKER - Doboj → firma 'NEW YORKER', lok 'Doboj'", () => {
    const r = splitFirmaLokacija("NEW YORKER - Doboj")
    expect(r.firma).toBe("NEW YORKER")
    expect(r.lokacija?.toUpperCase()).toBe("DOBOJ")
  })
  it("MARKET AS - PJ 20 → firma 'MARKET AS' (NE 'AS'), lok 'PJ 20'", () => {
    expect(splitFirmaLokacija("MARKET AS - PJ 20").firma).toBe("MARKET AS")
  })
  it("AS → firma AS, lok null", () => {
    expect(splitFirmaLokacija("AS")).toEqual({ firma: "AS", lokacija: null })
  })
  it("CARMEUSE → firma CARMEUSE, lok null", () => {
    expect(splitFirmaLokacija("CARMEUSE")).toEqual({ firma: "CARMEUSE", lokacija: null })
  })
  it("TRANSFERA varijante → jedna firma, 3 kanonske lokacije", () => {
    expect(splitFirmaLokacija("TRANSFERA RS")).toEqual({ firma: "TRANSFERA", lokacija: "RS" })
    // skladište: sa i bez crtice/case → ista lokacija
    expect(splitFirmaLokacija("TRANSFERA FBiH - skladište").lokacija).toBe("FBiH - skladište")
    expect(splitFirmaLokacija("TRANSFERA FBIH skladište").lokacija).toBe("FBiH - skladište")
    expect(splitFirmaLokacija("TRANSFERA FBIH SKLADIŠTE").lokacija).toBe("FBiH - skladište")
    // kancelarija: gola i FBIH varijanta → ista lokacija
    expect(splitFirmaLokacija("TRANSFERA FBiH - kancelarija").lokacija).toBe("FBiH - kancelarija")
    expect(splitFirmaLokacija("TRANSFERA kancelarija").lokacija).toBe("FBiH - kancelarija")
  })
  it("invarijanta: nijedan POZNATE_FIRME unos nije ' '-prefiks drugog", () => {
    for (const a of POZNATE_FIRME) for (const b of POZNATE_FIRME) {
      if (a !== b) expect(b.startsWith(a + " ")).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// parseStringDate (range + obični)
// ---------------------------------------------------------------------------
describe("parseStringDate (range)", () => {
  it("'21.-22.01.2026.' → početni 2026-01-21", () => {
    expect(parseStringDate("21.-22.01.2026.")).toBe("2026-01-21")
  })
  it("'21.01.-22.01.2026.' → 2026-01-21", () => {
    expect(parseStringDate("21.01.-22.01.2026.")).toBe("2026-01-21")
  })
  it("obična '20.01.2026.' i dalje radi", () => {
    expect(parseStringDate("20.01.2026.")).toBe("2026-01-20")
  })
  it("datum + tekst iza → vodeći datum", () => {
    expect(parseStringDate("25.06.2026. servis")).toBe("2026-06-25")
  })
  it("'03-04.04.2026.' → 2026-04-03 (crtica bez tačke)", () => {
    expect(parseStringDate("03-04.04.2026.")).toBe("2026-04-03")
  })
  it("ISO se prihvata", () => {
    expect(parseStringDate("2026-03-15")).toBe("2026-03-15")
  })
  it("neprepoznatljiv tekst → null", () => {
    expect(parseStringDate("maj 2026.")).toBeNull()
    expect(parseStringDate("")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseTehproExcel — dvoblokovni fixture test
// ---------------------------------------------------------------------------
describe("parseTehproExcel (dvoblokovni fixture)", () => {
  it("razdvaja Block1 (vrste) i Block2 (OBILASCI: planirano 2-3, izvrseno 4-5), izbacuje 'po ugovoru'", async () => {
    const res = await parseTehproExcel(FIXTURE)

    // firme
    expect(res.firme).toContain("WAIKIKI")
    expect(res.firme).toContain("CARMEUSE")
    expect(res.firme).toContain("NEW YORKER")
    expect(res.firme).not.toContain("PO UGOVORU")

    // vrste: samo tipovi pregleda + Obilazak, NIKAD firma naziv
    expect(res.vrste).toContain("Obilazak")
    expect(res.vrste).toContain("Servis PP aparata")
    expect(res.vrste).not.toContain("NEW YORKER")
    expect(res.vrste).not.toContain("WAIKIKI")

    // OBILASCI termini za NEW YORKER - Doboj
    // Fixture ima DUPLIRANE labele (col2 AND col3 = "Planirano"; col4 AND col5 = "Izvršeno")
    // i DISTINCT datume u sva 4 slota: plan=[2026-01-21, 2026-02-05], izvr=[2026-01-15, 2026-01-28].
    // Provjera garantuje: (a) first-match header daje pCol=2/iCol=4, (b) oba slota svake grupe čitamo.
    const obs = res.termini.filter(t => t.vrsta_naziv === "Obilazak")
    const planObs = obs.filter(t => t.izvor === "planirano" && t.firma_naziv === "NEW YORKER")
    const izvrObs = obs.filter(t => t.izvor === "izvrseno"  && t.firma_naziv === "NEW YORKER")

    // Mora biti točno 2 planirano i 2 izvrseno termina (oba slota svake grupe)
    expect(planObs).toHaveLength(2)
    expect(izvrObs).toHaveLength(2)

    // Ukupno 4 Obilazak termina za NEW YORKER
    expect(planObs.length + izvrObs.length).toBe(4)

    // Planirano datumi (col2 i col3)
    const planDatumi = planObs.map(t => t.datum).sort()
    expect(planDatumi).toContain("2026-01-21")
    expect(planDatumi).toContain("2026-02-05")

    // Izvrseno datumi (col4 i col5)
    const izvrDatumi = izvrObs.map(t => t.datum).sort()
    expect(izvrDatumi).toContain("2026-01-15")
    expect(izvrDatumi).toContain("2026-01-28")

    // Firma i lokacija za sve termine
    for (const t of [...planObs, ...izvrObs]) {
      expect(t.firma_naziv).toBe("NEW YORKER")
      expect(t.lokacija_naziv?.toUpperCase()).toBe("DOBOJ")
    }

    // lokacije: WAIKIKI ZVORNIK
    expect(res.lokacije.some(l => l.firma_naziv === "WAIKIKI" && /ZVORNIK/i.test(l.lokacija_naziv ?? ""))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Edge-case fixevi (gate odluke): VENETO SHOES, A.D. sufiks, Dom zdravlja
// ---------------------------------------------------------------------------
describe("splitFirmaLokacija — edge-case fixevi", () => {
  it("VENETO SHOES je jedna firma; bare 'VENETO' se spaja u 'VENETO SHOES'", () => {
    expect(splitFirmaLokacija("VENETO SHOES")).toEqual({ firma: "VENETO SHOES", lokacija: null })
    expect(splitFirmaLokacija("VENETO")).toEqual({ firma: "VENETO SHOES", lokacija: null })
  })
  it("MIKROELEKTRONIKA A.D. → firma bez lokacije (A.D. je pravni sufiks)", () => {
    expect(splitFirmaLokacija("MIKROELEKTRONIKA A.D.")).toEqual({ firma: "MIKROELEKTRONIKA", lokacija: null })
    expect(splitFirmaLokacija("MIKROELEKTRONIKA")).toEqual({ firma: "MIKROELEKTRONIKA", lokacija: null })
  })
  it("Dom zdravlja Dr Mladen — varijante (navodnici/dijakritika) → jedna firma", () => {
    const a = splitFirmaLokacija('Dom zdravlja "Dr Mladen Stojanović"')
    const b = splitFirmaLokacija("Dom zdravlja Dr Mladen Stojanovic")
    expect(a.firma).toBe("Dom zdravlja Dr Mladen Stojanović")
    expect(b.firma).toBe("Dom zdravlja Dr Mladen Stojanović")
    expect(a.lokacija).toBeNull()
  })
  it("Dom zdravlja Laktaši → zasebna firma", () => {
    expect(splitFirmaLokacija("Dom zdravlja Laktaši").firma).toBe("Dom zdravlja Laktaši")
  })
})

// ---------------------------------------------------------------------------
// dedupeTermini
// ---------------------------------------------------------------------------
const t = (over: Partial<ParsedTermin>): ParsedTermin => ({
  firma_naziv: "AS", lokacija_naziv: null, vrsta_naziv: "Akt o procjeni rizika - revizija",
  sheet_naziv: "Januar", datum: "2026-12-31", izvor: "planirano", ...over,
})

describe("dedupeTermini", () => {
  it("kolabira identične iz više sheetova u jedan", () => {
    const res = dedupeTermini([
      t({ sheet_naziv: "Januar" }), t({ sheet_naziv: "Februar" }), t({ sheet_naziv: "Mart" }),
    ])
    expect(res).toHaveLength(1)
  })
  it("izvrseno pobjeđuje planirano na isti (firma,vrsta,lokacija,datum)", () => {
    const res = dedupeTermini([
      t({ izvor: "planirano" }), t({ izvor: "izvrseno" }),
    ])
    expect(res).toHaveLength(1)
    expect(res[0]!.izvor).toBe("izvrseno")
  })
  it("različit datum / lokacija / vrsta NIJE duplikat", () => {
    const res = dedupeTermini([
      t({ datum: "2026-01-10" }), t({ datum: "2026-02-10" }),
      t({ lokacija_naziv: "BIJELJINA", datum: "2026-01-10" }),
      t({ vrsta_naziv: "Obilazak", datum: "2026-01-10" }),
    ])
    expect(res).toHaveLength(4)
  })
})
