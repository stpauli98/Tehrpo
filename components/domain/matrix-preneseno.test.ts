import { describe, it, expect } from "vitest"
import { prenesenoUlazi, godisnjeKolone, PRENESENO_COL, type PrenesenTermin } from "./matrix-preneseno"
import { buildMatrix, type MatrixColumn, type MatrixInput } from "@/lib/matrix"

const MJESECI: MatrixColumn[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: `M${i + 1}` }))

// Stanje na prelazu u 2027: dvije otvorene obaveze iz 2026, jedna nova u 2027.
const ZAOSTALI: PrenesenTermin[] = [
  { id: "t1", vrsta_provjere_id: "v-hidranti", vrsta_naziv: "Hidranti", datum_prikaza: "2026-06-14", status_izvedeni: "kasni" },
  { id: "t2", vrsta_provjere_id: "v-rizik", vrsta_naziv: "Procjena rizika", datum_prikaza: "2026-11-10", status_izvedeni: "planirano" },
]
const U_2027: MatrixInput[] = [
  { id: "t3", vrstaId: "v-hidranti", vrstaNaziv: "Hidranti", columnKey: "5", dan: 20, status: "planirano" },
]

describe("prenesenoUlazi", () => {
  it("sve prenesene stavlja u kolonu 'preneseno', ne u mjesec", () => {
    const { inputs } = prenesenoUlazi(ZAOSTALI)
    expect(inputs.map((i) => i.columnKey)).toEqual([PRENESENO_COL, PRENESENO_COL])
  })

  it("čuva puni datum za prikaz — dan bez godine bi bio besmislen", () => {
    const { datumi } = prenesenoUlazi(ZAOSTALI)
    expect(datumi).toEqual({ t1: "14.06.2026", t2: "10.11.2026" })
  })

  it("preskače redove bez id/vrste/datuma umjesto da padne", () => {
    const { inputs, datumi } = prenesenoUlazi([
      ...ZAOSTALI,
      { id: "x", vrsta_provjere_id: null, datum_prikaza: "2026-01-01" },
      { id: null, vrsta_provjere_id: "v", datum_prikaza: "2026-01-01" },
      { id: "y", vrsta_provjere_id: "v", datum_prikaza: null },
    ])
    expect(inputs).toHaveLength(2)
    expect(Object.keys(datumi)).toEqual(["t1", "t2"])
  })

  it("nepoznat status pada na 'planirano', ne ruši matricu", () => {
    const { inputs } = prenesenoUlazi([{ ...ZAOSTALI[0]!, status_izvedeni: "nesto-novo" }])
    expect(inputs[0]!.status).toBe("planirano")
  })
})

describe("godisnjeKolone", () => {
  it("bez zaostataka → samo 12 mjeseci (nema prazne kolone)", () => {
    expect(godisnjeKolone(MJESECI, false, "Preneseno")).toHaveLength(12)
  })
  it("sa zaostacima → 'Preneseno' je PRVA kolona", () => {
    const k = godisnjeKolone(MJESECI, true, "Preneseno")
    expect(k).toHaveLength(13)
    expect(k[0]).toEqual({ id: PRENESENO_COL, label: "Preneseno" })
    expect(k[1]!.id).toBe("1")
  })
})

describe("godišnja matrica na prelazu godine (B2)", () => {
  it("PRIJE: matrica 2027. sadrži samo jedan red, zaostaci iz 2026. su nevidljivi", () => {
    const redovi = buildMatrix(U_2027)
    expect(redovi).toHaveLength(1)
    expect(redovi.map((r) => r.rowLabel)).toEqual(["Hidranti"])
    // Procjena rizika (zaostatak iz 2026.) ne postoji nigdje u matrici.
    expect(redovi.some((r) => r.rowLabel === "Procjena rizika")).toBe(false)
  })

  it("POSLIJE: zaostaci iz 2026. dobijaju red i ćeliju u koloni 'preneseno'", () => {
    const { inputs, datumi } = prenesenoUlazi(ZAOSTALI)
    const redovi = buildMatrix([...inputs, ...U_2027])

    expect(redovi.map((r) => r.rowLabel)).toEqual(["Hidranti", "Procjena rizika"])

    const hidranti = redovi[0]!
    expect(hidranti.cells[PRENESENO_COL]).toMatchObject({ terminId: "t1", status: "kasni" })
    expect(hidranti.cells["5"]).toMatchObject({ terminId: "t3", status: "planirano" })

    // Vrsta koja u 2027. nema nijedan termin ipak dobija red — samo zbog zaostatka.
    const rizik = redovi[1]!
    expect(rizik.cells[PRENESENO_COL]).toMatchObject({ terminId: "t2" })
    expect(Object.keys(rizik.cells)).toEqual([PRENESENO_COL])

    // Ćelija prikazuje datum s godinom, ne goli dan.
    expect(datumi[hidranti.cells[PRENESENO_COL]!.terminId]).toBe("14.06.2026")
  })

  it("više zaostataka iste vrste → jedna ćelija sa brojačem, prioritet 'kasni'", () => {
    const { inputs } = prenesenoUlazi([
      { id: "a", vrsta_provjere_id: "v", vrsta_naziv: "V", datum_prikaza: "2025-03-01", status_izvedeni: "planirano" },
      { id: "b", vrsta_provjere_id: "v", vrsta_naziv: "V", datum_prikaza: "2026-03-01", status_izvedeni: "kasni" },
    ])
    const celija = buildMatrix(inputs)[0]!.cells[PRENESENO_COL]!
    expect(celija.brojUCeliji).toBe(2)
    expect(celija.status).toBe("kasni")
    expect(celija.terminId).toBe("b")
  })
})
