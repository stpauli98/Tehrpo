import { describe, it, expect } from "vitest"
import {
  izdvojiPrefiks,
  nadjiSudarenePrefikse,
  nadjiNeispravnaImena,
  odaberiFajlZaPrijavu,
} from "./migracije"

// Stvarni sudar zatečen 2026-07-28: dvije grane, isti timestamp, različita imena.
// Git ih spaja bez konflikta jer se imena fajlova razlikuju.
const STVARNI_SUDAR = [
  "20260728120000_audit_pretraga_kolone.sql",
  "20260728120000_mejl_status_demo.sql",
]

describe("izdvojiPrefiks", () => {
  it("vraća 14-cifreni timestamp", () => {
    expect(izdvojiPrefiks("20260726120000_get_termini_godine_rpc.sql")).toBe("20260726120000")
  })

  it("vraća null kad prefiksa nema", () => {
    expect(izdvojiPrefiks("dodaj_kolonu.sql")).toBeNull()
  })

  it("vraća null za kraći broj — 13 cifara nije timestamp", () => {
    expect(izdvojiPrefiks("2026072612000_nesto.sql")).toBeNull()
  })
})

describe("nadjiSudarenePrefikse", () => {
  it("prijavljuje stvarni sudar iz dvije grane", () => {
    const nalazi = nadjiSudarenePrefikse(STVARNI_SUDAR)
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.prefiks).toBe("20260728120000")
    expect(nalazi[0]!.fajlovi).toEqual([
      "20260728120000_audit_pretraga_kolone.sql",
      "20260728120000_mejl_status_demo.sql",
    ])
  })

  it("ne prijavlja ništa kad su svi prefiksi različiti", () => {
    expect(
      nadjiSudarenePrefikse([
        "20260726120000_a.sql",
        "20260726121000_b.sql",
        "20260728120000_c.sql",
      ]),
    ).toEqual([])
  })

  it("prijavlja i sudar troje", () => {
    const nalazi = nadjiSudarenePrefikse([
      "20260728120000_a.sql",
      "20260728120000_b.sql",
      "20260728120000_c.sql",
    ])
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.fajlovi).toHaveLength(3)
  })

  it("prijavlja više nezavisnih sudara, sortirano po prefiksu", () => {
    const nalazi = nadjiSudarenePrefikse([
      "20260729130000_x.sql",
      "20260729130000_y.sql",
      "20260728120000_a.sql",
      "20260728120000_b.sql",
    ])
    expect(nalazi.map((n) => n.prefiks)).toEqual(["20260728120000", "20260729130000"])
  })

  it("fajlovi u nalazu su sortirani bez obzira na redoslijed ulaza", () => {
    const nalazi = nadjiSudarenePrefikse([
      "20260728120000_mejl_status_demo.sql",
      "20260728120000_audit_pretraga_kolone.sql",
    ])
    expect(nalazi[0]!.fajlovi[0]).toBe("20260728120000_audit_pretraga_kolone.sql")
  })

  it("prazan ulaz daje prazan rezultat", () => {
    expect(nadjiSudarenePrefikse([])).toEqual([])
  })

  it("ignoriše fajlove bez prefiksa umjesto da ih grupiše zajedno", () => {
    expect(nadjiSudarenePrefikse(["README.md", "biljeska.sql"])).toEqual([])
  })
})

describe("odaberiFajlZaPrijavu", () => {
  // Stvaran sudar 2026-07-28: `audit_pretraga_kolone` je abecedno prvi, ali migraciju
  // koju grana donosi (`mejl_status_demo`) treba preimenovati — nalaz mora pokazati na nju.
  const AUDIT = "20260728120000_audit_pretraga_kolone.sql"
  const MEJL = "20260728120000_mejl_status_demo.sql"

  it("bira fajl iz obuhvata izmijenjenih, čak i kad je abecedno DRUGI", () => {
    expect(odaberiFajlZaPrijavu([AUDIT, MEJL], new Set([MEJL]))).toBe(MEJL)
  })

  it("bira fajl iz obuhvata i kad je abecedno PRVI (nije samo 'uvijek posljednji')", () => {
    expect(odaberiFajlZaPrijavu([AUDIT, MEJL], new Set([AUDIT]))).toBe(AUDIT)
  })

  it("prazan obuhvat (npr. --sve) → abecedno POSLJEDNJI, ne prvi (nedužni)", () => {
    expect(odaberiFajlZaPrijavu([AUDIT, MEJL], new Set())).toBe(MEJL)
  })

  it("obuhvat koji ne sadrži nijedan sudareni fajl se ponaša kao prazan", () => {
    expect(odaberiFajlZaPrijavu([AUDIT, MEJL], new Set(["20260101000000_drugo.sql"]))).toBe(MEJL)
  })

  it("više sudarenih fajlova u obuhvatu → abecedno posljednji OD NJIH, ne od svih", () => {
    const treci = "20260728120000_a_prvi.sql"
    expect(odaberiFajlZaPrijavu([treci, AUDIT, MEJL], new Set([treci, AUDIT]))).toBe(AUDIT)
  })
})

describe("nadjiNeispravnaImena", () => {
  it("prijavlja .sql bez timestamp prefiksa", () => {
    expect(nadjiNeispravnaImena(["20260728120000_ok.sql", "bez_prefiksa.sql"])).toEqual([
      "bez_prefiksa.sql",
    ])
  })

  it("ne dira fajlove koji nisu .sql", () => {
    expect(nadjiNeispravnaImena(["README.md", "20260728120000_ok.sql"])).toEqual([])
  })
})
