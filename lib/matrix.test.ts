import { describe, it, expect } from "vitest"
import { buildMatrix, type MatrixInput } from "./matrix"

const base = (over: Partial<MatrixInput>): MatrixInput => ({
  id: "t1", vrstaId: "v1", vrstaNaziv: "Hidranti", columnKey: "1", dan: 5, status: "planirano", ...over,
})

describe("buildMatrix", () => {
  it("grupiše po vrsti u redove", () => {
    const rows = buildMatrix([
      base({ id: "a", vrstaId: "v1", vrstaNaziv: "Hidranti", columnKey: "1" }),
      base({ id: "b", vrstaId: "v2", vrstaNaziv: "Lift", columnKey: "2" }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.rowLabel).sort()).toEqual(["Hidranti", "Lift"])
  })

  it("u istoj ćeliji bira najurgentniji status (kasni > planirano)", () => {
    const rows = buildMatrix([
      base({ id: "a", columnKey: "1", status: "planirano", dan: 5 }),
      base({ id: "b", columnKey: "1", status: "kasni", dan: 9 }),
    ])
    const row = rows[0]
    expect(row).toBeDefined()
    const cell = row!.cells["1"]
    expect(cell).toBeDefined()
    expect(cell!.status).toBe("kasni")
    expect(cell!.dan).toBe(9)
    expect(cell!.brojUCeliji).toBe(2)
  })

  it("različiti columnKey daju različite ćelije", () => {
    const rows = buildMatrix([
      base({ columnKey: "1" }),
      base({ columnKey: "klijent-xyz" }),
    ])
    const row = rows[0]
    expect(row).toBeDefined()
    expect(Object.keys(row!.cells).sort()).toEqual(["1", "klijent-xyz"])
  })
})
