import { describe, it, expect } from "vitest"
import { parseIzvozParams } from "./params"
import { currentYear } from "@/lib/date"

describe("parseIzvozParams", () => {
  it("bez 'period' → legacy grana, format default xlsx", () => {
    const r = parseIzvozParams(new URLSearchParams(""))
    expect(r).toEqual({ ok: true, legacy: true, format: "xlsx", count: false })
  })
  it("legacy zadrži format=pdf i count", () => {
    const r = parseIzvozParams(new URLSearchParams("format=pdf&count=1"))
    expect(r).toEqual({ ok: true, legacy: true, format: "pdf", count: true })
  })
  it("period=om → default opseg 'sve'", () => {
    const r = parseIzvozParams(new URLSearchParams("period=om"))
    expect(r).toMatchObject({ ok: true, legacy: false, opseg: "sve", period: { mod: "om" } })
  })
  it("period=god čita godinu; default godina = tekuća", () => {
    expect(parseIzvozParams(new URLSearchParams("period=god&godina=2025"))).toMatchObject({ period: { mod: "god", godina: 2025 } })
    expect(parseIzvozParams(new URLSearchParams("period=god"))).toMatchObject({ period: { mod: "god", godina: currentYear() } })
  })
  it("period=mj čita mjesec+godinu; nevažeći mjesec → 1", () => {
    expect(parseIzvozParams(new URLSearchParams("period=mj&mjesec=3&godina=2026"))).toMatchObject({ period: { mod: "mj", mjesec: 3, godina: 2026 } })
    expect(parseIzvozParams(new URLSearchParams("period=mj&mjesec=99"))).toMatchObject({ period: { mod: "mj", mjesec: 1 } })
  })
  it("period=raspon validan → period raspon; opseg=filtrirano se poštuje", () => {
    const r = parseIzvozParams(new URLSearchParams("period=raspon&od=2026-07-01&do=2026-07-31&opseg=filtrirano"))
    expect(r).toMatchObject({ ok: true, legacy: false, opseg: "filtrirano", period: { mod: "raspon", od: "2026-07-01", do: "2026-07-31" } })
  })
  it("period=raspon nevažeći (od>do ili prazan) → greška", () => {
    expect(parseIzvozParams(new URLSearchParams("period=raspon&od=2026-07-31&do=2026-07-01"))).toEqual({ ok: false, greska: "raspon" })
    expect(parseIzvozParams(new URLSearchParams("period=raspon&od=2026-07-01"))).toEqual({ ok: false, greska: "raspon" })
  })
  it("period=svi → mod svi", () => {
    expect(parseIzvozParams(new URLSearchParams("period=svi"))).toMatchObject({ period: { mod: "svi" } })
  })
  it("nepoznat period → fallback om", () => {
    expect(parseIzvozParams(new URLSearchParams("period=xyz"))).toMatchObject({ period: { mod: "om" } })
  })
})
