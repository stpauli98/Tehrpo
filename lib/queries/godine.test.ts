import { describe, it, expect } from "vitest"
import { godineRaspon } from "./godine"

describe("godineRaspon", () => {
  it("NULL/NULL (prazna tabela ili pala RPC) → fallback tekuća ± 1", () => {
    expect(godineRaspon(null, null, 2026)).toEqual([2025, 2026, 2027])
  })

  it("djelimično NULL se tretira kao potpuni fallback", () => {
    expect(godineRaspon(2024, null, 2026)).toEqual([2025, 2026, 2027])
    expect(godineRaspon(null, 2030, 2026)).toEqual([2025, 2026, 2027])
  })

  it("min = max = tekuća → jednočlan niz", () => {
    expect(godineRaspon(2026, 2026, 2026)).toEqual([2026])
  })

  it("min = max ≠ tekuća → raspon se proširi do tekuće", () => {
    expect(godineRaspon(2024, 2024, 2026)).toEqual([2024, 2025, 2026])
  })

  it("min < tekuća < max → pun inkluzivni raspon", () => {
    expect(godineRaspon(2023, 2028, 2026)).toEqual([2023, 2024, 2025, 2026, 2027, 2028])
  })

  it("max < tekuća → raspon uključuje tekuću (default filtera mora postojati)", () => {
    expect(godineRaspon(2022, 2024, 2026)).toEqual([2022, 2023, 2024, 2025, 2026])
  })

  it("min > tekuća → raspon počinje od tekuće", () => {
    expect(godineRaspon(2028, 2030, 2026)).toEqual([2026, 2027, 2028, 2029, 2030])
  })

  it("tekuća je UVIJEK u nizu (default vrijednosti `godina` filtera)", () => {
    const parovi: Array<[number, number]> = [
      [2020, 2021],
      [2026, 2026],
      [2030, 2031],
      [2019, 2035],
    ]
    for (const [min, max] of parovi) {
      expect(godineRaspon(min, max, 2026)).toContain(2026)
    }
  })

  it("niz je rastući i bez duplikata", () => {
    const niz = godineRaspon(2023, 2029, 2026)
    expect(niz).toEqual([...niz].sort((a, b) => a - b))
    expect(new Set(niz).size).toBe(niz.length)
  })
})
