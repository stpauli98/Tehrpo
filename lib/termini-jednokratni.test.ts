import { describe, it, expect } from "vitest"
import { spojiJednokratne, type TerminZaSpajanje } from "./termini-jednokratni"

const profil = [
  {
    id: "p1", vrsta_provjere_id: "v1", lokacija_id: "l1",
    vrsta_naziv: "PP aparati", lokacija_naziv: "Glavna baza",
    interval_mjeseci: 6, zadnji_datum: "2026-01-15",
    sljedeci_rok: "2026-07-15", termin_status: "planirano",
  },
]

const T = (o: Partial<TerminZaSpajanje>): TerminZaSpajanje => ({
  id: "t1", vrsta_provjere_id: "v1", lokacija_id: "l1",
  vrsta_naziv: "PP aparati", lokacija_naziv: "Glavna baza",
  rok_dospijeca: "2026-07-15", status: "planirano", status_izvedeni: "planirano",
  datum_izvrsenja: null, ...o,
})

describe("spojiJednokratne", () => {
  it("termin koji ima profil-stavku se ne duplira", () => {
    const r = spojiJednokratne(profil, [T({})])
    expect(r).toHaveLength(1)
    expect(r[0]!.jednokratna).toBe(false)
  })

  it("termin bez profil-stavke se dodaje kao jednokratna usluga", () => {
    const r = spojiJednokratne(profil, [T({}), T({ id: "t2", vrsta_provjere_id: "v2", vrsta_naziv: "Test" })])
    expect(r).toHaveLength(2)
    const jed = r.find((s) => s.vrsta_naziv === "Test")
    expect(jed?.jednokratna).toBe(true)
    expect(jed?.interval_mjeseci).toBeNull()
    expect(jed?.sljedeci_rok).toBe("2026-07-15")
  })

  it("razlicita lokacija znaci razlicita stavka", () => {
    const r = spojiJednokratne(profil, [T({ id: "t3", lokacija_id: "l2", lokacija_naziv: "Pogon" })])
    expect(r).toHaveLength(2)
    expect(r.find((s) => s.lokacija_naziv === "Pogon")?.jednokratna).toBe(true)
  })

  it("NULL lokacija se poklapa samo sa NULL lokacijom", () => {
    const r = spojiJednokratne(profil, [T({ id: "t4", lokacija_id: null, lokacija_naziv: null })])
    expect(r).toHaveLength(2)
  })

  it("vise jednokratnih termina istog para daje jednu stavku sa najranijim rokom", () => {
    const r = spojiJednokratne([], [
      T({ id: "t5", vrsta_provjere_id: "v9", rok_dospijeca: "2026-09-01" }),
      T({ id: "t6", vrsta_provjere_id: "v9", rok_dospijeca: "2026-08-01" }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0]!.sljedeci_rok).toBe("2026-08-01")
  })

  it("otkazan termin se ne prikazuje kao usluga", () => {
    const r = spojiJednokratne([], [T({ id: "t7", vrsta_provjere_id: "v9", status: "otkazano", status_izvedeni: "otkazano" })])
    expect(r).toEqual([])
  })

  it("izvrsen jednokratni termin ostaje vidljiv sa datumom izvrsenja", () => {
    const r = spojiJednokratne([], [
      T({ id: "t8", vrsta_provjere_id: "v9", status: "izvrseno", status_izvedeni: "izvrseno", datum_izvrsenja: "2026-06-01" }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0]!.zadnji_datum).toBe("2026-06-01")
  })
})
