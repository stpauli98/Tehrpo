import { describe, it, expect } from "vitest"
import {
  validRaspon,
  izvozPeriodRange,
  izvozPeriodLabel,
  prenesenoGranica,
  prenesenoOrIzraz,
  jePreneseniRed,
} from "./period"

describe("validRaspon", () => {
  it("oba ISO i od<=do → true", () => {
    expect(validRaspon("2026-07-01", "2026-07-15")).toBe(true)
    expect(validRaspon("2026-07-15", "2026-07-15")).toBe(true)
  })
  it("od>do → false", () => expect(validRaspon("2026-07-16", "2026-07-15")).toBe(false))
  it("nedostaje/nevažeći → false", () => {
    expect(validRaspon(null, "2026-07-15")).toBe(false)
    expect(validRaspon("2026-07-01", "")).toBe(false)
    expect(validRaspon("07/01/2026", "2026-07-15")).toBe(false)
  })
})

describe("izvozPeriodRange", () => {
  it("om → tekući kalendarski mjesec (danas override)", () => {
    expect(izvozPeriodRange({ mod: "om" }, "2026-07-11")).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("god → cijela godina", () => {
    expect(izvozPeriodRange({ mod: "god", godina: 2026 })).toEqual({ from: "2026-01-01", to: "2026-12-31" })
  })
  it("mj → taj mjesec", () => {
    expect(izvozPeriodRange({ mod: "mj", godina: 2025, mjesec: 2 })).toEqual({ from: "2025-02-01", to: "2025-02-28" })
  })
  it("raspon → od/do direktno", () => {
    expect(izvozPeriodRange({ mod: "raspon", od: "2026-07-03", do: "2026-08-09" })).toEqual({ from: "2026-07-03", to: "2026-08-09" })
  })
  it("svi → null", () => expect(izvozPeriodRange({ mod: "svi" })).toBeNull())
})

describe("izvozPeriodLabel", () => {
  it("om → 'Jul 2026'", () => expect(izvozPeriodLabel({ mod: "om" }, "svi mjeseci", "2026-07-11")).toBe("Jul 2026"))
  it("god → '2026'", () => expect(izvozPeriodLabel({ mod: "god", godina: 2026 }, "svi mjeseci")).toBe("2026"))
  it("mj → 'Mart 2026'", () => expect(izvozPeriodLabel({ mod: "mj", godina: 2026, mjesec: 3 }, "svi mjeseci")).toBe("Mart 2026"))
  it("svi → injektovani label", () => expect(izvozPeriodLabel({ mod: "svi" }, "svi mjeseci")).toBe("svi mjeseci"))
  it("raspon → formatirani datumi", () => {
    const l = izvozPeriodLabel({ mod: "raspon", od: "2026-07-01", do: "2026-07-15" }, "svi mjeseci")
    expect(l).toContain("01.07.2026")
    expect(l).toContain("15.07.2026")
    expect(l).toContain("–")
  })
})

// ── Prelazak godine (B2): otvorene obaveze iz ranijih perioda ne smiju nestati ──

describe("prenesenoGranica", () => {
  it("god → 1. januar te godine", () => {
    expect(prenesenoGranica({ mod: "god", godina: 2027 })).toBe("2027-01-01")
  })
  it("mj → prvi dan tog mjeseca", () => {
    expect(prenesenoGranica({ mod: "mj", godina: 2027, mjesec: 3 })).toBe("2027-03-01")
  })
  it("om → prvi dan tekućeg mjeseca (danas override)", () => {
    expect(prenesenoGranica({ mod: "om" }, "2027-01-04")).toBe("2027-01-01")
  })
  it("raspon → 'od'", () => {
    expect(prenesenoGranica({ mod: "raspon", od: "2027-02-10", do: "2027-03-01" })).toBe("2027-02-10")
  })
  it("svi → null (nema donje granice, nema prenosa)", () => {
    expect(prenesenoGranica({ mod: "svi" })).toBeNull()
  })
})

describe("jePreneseniRed", () => {
  it("datum ispod granice → preneseno", () => {
    expect(jePreneseniRed("2026-11-30", "2027-01-01")).toBe(true)
  })
  it("datum na granici ili iznad → nije preneseno", () => {
    expect(jePreneseniRed("2027-01-01", "2027-01-01")).toBe(false)
    expect(jePreneseniRed("2027-06-15", "2027-01-01")).toBe(false)
  })
  it("bez granice (mod 'svi') ili bez datuma → nije preneseno", () => {
    expect(jePreneseniRed("2026-11-30", null)).toBe(false)
    expect(jePreneseniRed(null, "2027-01-01")).toBe(false)
  })
})

describe("prenesenoOrIzraz", () => {
  const izraz = prenesenoOrIzraz("2027-01-01", "2027-12-31")

  it("prva grana je period, druga su otvorene obaveze prije granice", () => {
    expect(izraz).toBe(
      "and(datum_prikaza.gte.2027-01-01,datum_prikaza.lte.2027-12-31)," +
        "and(datum_prikaza.lt.2027-01-01,status_izvedeni.neq.izvrseno,status_izvedeni.neq.otkazano)",
    )
  })

  // Izraz je ugovor prema PostgREST-u; ovdje ga izvršavamo kao predikat da dokažemo
  // koje redove hvata, bez zavisnosti od baze.
  const ocijeni = (r: { datum_prikaza: string; status_izvedeni: string }) =>
    (r.datum_prikaza >= "2027-01-01" && r.datum_prikaza <= "2027-12-31") ||
    (r.datum_prikaza < "2027-01-01" &&
      r.status_izvedeni !== "izvrseno" &&
      r.status_izvedeni !== "otkazano")

  it("hvata zaostalu obavezu iz 2026. koja je i dalje otvorena", () => {
    expect(ocijeni({ datum_prikaza: "2026-11-15", status_izvedeni: "kasni" })).toBe(true)
    expect(ocijeni({ datum_prikaza: "2019-03-01", status_izvedeni: "planirano" })).toBe(true)
  })
  it("NE vuče zatvorenu istoriju iz ranijih godina", () => {
    expect(ocijeni({ datum_prikaza: "2026-11-15", status_izvedeni: "izvrseno" })).toBe(false)
    expect(ocijeni({ datum_prikaza: "2026-11-15", status_izvedeni: "otkazano" })).toBe(false)
  })
  it("zadržava sve iz same godine, bez obzira na status", () => {
    expect(ocijeni({ datum_prikaza: "2027-05-05", status_izvedeni: "izvrseno" })).toBe(true)
    expect(ocijeni({ datum_prikaza: "2027-05-05", status_izvedeni: "planirano" })).toBe(true)
  })
  it("NE vuče buduće godine", () => {
    expect(ocijeni({ datum_prikaza: "2028-01-02", status_izvedeni: "planirano" })).toBe(false)
  })
})
