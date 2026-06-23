import { describe, it, expect } from "vitest"
import { odaberiCuvara, type TerminRed } from "./dedup"

const r = (over: Partial<TerminRed>): TerminRed => ({
  id: "a", klijent_id: "k", vrsta_provjere_id: "v", lokacija_id: null,
  rok_dospijeca: "2026-06-21", status: "planirano", ...over,
})

describe("odaberiCuvara", () => {
  it("zadrži izvrseno nad planirano/kasni", () => {
    const { keep, drop } = odaberiCuvara(
      [r({ id: "a", status: "planirano" }), r({ id: "b", status: "izvrseno" })],
      new Set()
    )
    expect(keep.id).toBe("b")
    expect(drop.map((d) => d.id)).toEqual(["a"])
  })
  it("dokument-bearing red pobjeđuje status prioritet", () => {
    const { keep } = odaberiCuvara(
      [r({ id: "a", status: "izvrseno" }), r({ id: "b", status: "planirano" })],
      new Set(["b"])
    )
    expect(keep.id).toBe("b")
  })
  it("status prioritet: zakazano > planirano > otkazano", () => {
    const { keep } = odaberiCuvara(
      [r({ id: "a", status: "otkazano" }), r({ id: "b", status: "zakazano" }), r({ id: "c", status: "planirano" })],
      new Set()
    )
    expect(keep.id).toBe("b")
  })
  it("stabilno po id kad je sve izjednačeno", () => {
    const { keep } = odaberiCuvara([r({ id: "z" }), r({ id: "a" })], new Set())
    expect(keep.id).toBe("a")
  })
})
