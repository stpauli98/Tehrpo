import { describe, it, expect } from "vitest"
import { planToPdf } from "./pdf"
import type { PlanRed } from "./types"

const ROW: PlanRed = { klijent: "AS", lokacija: "BL", usluga: "Hidranti", rok: "15.07.2026.", status: "Kasni", periodikaMj: 12, odgovorna: "Pero" }

describe("planToPdf", () => {
  it("vraća ne-prazan PDF buffer (%PDF magic)", async () => {
    const buf = await planToPdf([ROW], { naslov: "Tehpro", period: "tekući + naredni mjesec" })
    expect(buf.length).toBeGreaterThan(500)
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })
  it("radi i s praznim redovima", async () => {
    const buf = await planToPdf([], { naslov: "Tehpro", period: "svi mjeseci" })
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })
  it("ne baca na egzotične znakove (ćirilica/emoji) — zamijeni s '?'", async () => {
    const r: PlanRed = { ...ROW, klijent: "Фирма 🙂", lokacija: "Бања Лука", usluga: "č test" }
    const buf = await planToPdf([r], { naslov: "Tehpro", period: "tekući" })
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })
})
