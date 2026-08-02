import { describe, it, expect } from "vitest"
import { planToPdf } from "./pdf"
import type { PlanRed } from "./types"

const ROW: PlanRed = { klijent: "AS", lokacija: "BL", usluga: "Hidranti", rok: "15.07.2026", preneseno: false, status: "Kasni", periodikaMj: 12, odgovorna: "Pero", nacin: "Izvršava" }

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

  it("na engleskom: i dalje validan PDF (zaglavlje prevedeno)", async () => {
    const buf = await planToPdf([ROW], { naslov: "Tehpro", period: "all months" }, "en")
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("na engleskom: prazna lista koristi prevedenu poruku bez rušenja", async () => {
    const buf = await planToPdf([], { naslov: "Tehpro", period: "all months" }, "en")
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  // ── Prelazak godine (B2) ──
  it("prenesena obaveza i napomena ne ruše generisanje (sve tri lokalizacije)", async () => {
    const prenesen: PlanRed = { ...ROW, preneseno: true }
    const meta = {
      naslov: "Tehpro",
      period: "2027",
      napomena: "Plan uključuje i 3 prenesene obaveze iz perioda prije 01.01.2027.",
    }
    const bufferi = await Promise.all(
      (["sr", "en", "de"] as const).map((loc) => planToPdf([prenesen, ROW], meta, loc)),
    )
    for (const buf of bufferi) {
      expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
      expect(buf.length).toBeGreaterThan(500)
    }
  })
})
