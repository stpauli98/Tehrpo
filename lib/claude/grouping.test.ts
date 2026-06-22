import { describe, it, expect } from "vitest"
import { grupisiPoKlijentu } from "./grouping"

describe("grupisiPoKlijentu", () => {
  it("grupiše po klijentu i broji ukupno + kasni", () => {
    const out = grupisiPoKlijentu([
      { klijent_naziv: "WAIKIKI", status_izvedeni: "kasni" },
      { klijent_naziv: "WAIKIKI", status_izvedeni: "planirano" },
      { klijent_naziv: "CARMEUSE", status_izvedeni: "kasni" },
      { klijent_naziv: null, status_izvedeni: "planirano" },
    ])
    const w = out.find((g) => g.klijent === "WAIKIKI")
    expect(w).toEqual({ klijent: "WAIKIKI", ukupno: 2, kasni: 1 })
    expect(out.find((g) => g.klijent === "CARMEUSE")).toEqual({ klijent: "CARMEUSE", ukupno: 1, kasni: 1 })
    expect(out.some((g) => g.klijent === "—")).toBe(true) // null → "—"
  })

  it("sortira po broju kasni opadajuće", () => {
    const out = grupisiPoKlijentu([
      { klijent_naziv: "A", status_izvedeni: "planirano" },
      { klijent_naziv: "B", status_izvedeni: "kasni" },
    ])
    expect(out[0]?.klijent).toBe("B")
  })
})
