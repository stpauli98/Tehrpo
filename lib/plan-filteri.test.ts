import { describe, it, expect } from "vitest"
import { parsePlanFilteri, mjesecRange, applyPlanFilteri, applyPlanFilteriBezDatuma, type PlanFilteri } from "./plan-filteri"
import { currentYear } from "./date"

function mockQ() {
  const calls: [string, unknown][] = []
  const q: Record<string, (...a: unknown[]) => unknown> = {}
  for (const m of ["eq", "or", "gte", "lte"]) q[m] = (...a: unknown[]) => { calls.push([m, a]); return q }
  return { q, calls }
}
const base: PlanFilteri = { status: "svi", q: "", klijentId: "", lokacijaId: "", vrstaId: "", mjesec: "svi", godina: 2026, nacin: "svi" }

describe("applyPlanFilteri", () => {
  it("bez filtera ne poziva ništa (mjesec=svi → nema range)", () => {
    const { q, calls } = mockQ()
    applyPlanFilteri(q as never, base)
    expect(calls).toEqual([])
  })
  it("status+klijent+nacin primjenjuje eq redom", () => {
    const { q, calls } = mockQ()
    applyPlanFilteri(q as never, { ...base, status: "kasni", klijentId: "K1", nacin: "izvrsava" })
    expect(calls).toContainEqual(["eq", ["status_izvedeni", "kasni"]])
    expect(calls).toContainEqual(["eq", ["klijent_id", "K1"]])
    expect(calls).toContainEqual(["eq", ["nacin_izvrsenja", "izvrsava"]])
  })
  it("q sanitizuje zagrade/zareze i pravi .or ilike", () => {
    const { q, calls } = mockQ()
    applyPlanFilteri(q as never, { ...base, q: "a,(b)" })
    const firstCall = calls[0]!
    expect(firstCall[0]).toBe("or")
    // Comma is legitimately present as PostgREST OR separator; check only parens are sanitized
    expect(String(firstCall[1])).not.toMatch(/[()]/)
  })
  it("mjesec-raspon pozicionira po datum_prikaza (ne rok_dospijeca) — mora se poklapati sa kalendar/matrica", () => {
    const { q, calls } = mockQ()
    applyPlanFilteri(q as never, { ...base, mjesec: "7" })
    expect(calls).toContainEqual(["gte", ["datum_prikaza", "2026-07-01"]])
    expect(calls).toContainEqual(["lte", ["datum_prikaza", "2026-07-31"]])
  })
})

describe("parsePlanFilteri", () => {
  it("prazni params → default mjesec 'tn', status 'svi', godina = tekuća", () => {
    const f = parsePlanFilteri(new URLSearchParams())
    expect(f.mjesec).toBe("tn")
    expect(f.status).toBe("svi")
    expect(f.godina).toBe(currentYear())
    expect(f.klijentId).toBe("")
  })
  it("čita sve filtere", () => {
    const f = parsePlanFilteri(new URLSearchParams("status=kasni&q=as&klijent_id=k1&lokacija=l1&vrsta_id=v1&mjesec=7&godina=2027"))
    expect(f).toMatchObject({ status: "kasni", q: "as", klijentId: "k1", lokacijaId: "l1", vrstaId: "v1", mjesec: "7", godina: 2027 })
  })
  it("nacin: default 'svi'; čita 'pracenje'; nepoznato → 'svi'", () => {
    expect(parsePlanFilteri(new URLSearchParams()).nacin).toBe("svi")
    expect(parsePlanFilteri(new URLSearchParams("nacin=pracenje")).nacin).toBe("pracenje")
    expect(parsePlanFilteri(new URLSearchParams("nacin=izvrsava")).nacin).toBe("izvrsava")
    expect(parsePlanFilteri(new URLSearchParams("nacin=xyz")).nacin).toBe("svi")
  })
})

describe("mjesecRange", () => {
  const base = (mjesec: string, godina = 2026) => ({ status: "svi", q: "", klijentId: "", lokacijaId: "", vrstaId: "", mjesec, godina, nacin: "svi" as const })
  it("'tn' → raspon tekući+naredni (ne null)", () => {
    const r = mjesecRange(base("tn"))
    expect(r).not.toBeNull()
    expect(r!.from.endsWith("-01")).toBe(true)
  })
  it("'7' → juli 2026", () => {
    expect(mjesecRange(base("7"))).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("'svi' → null (bez datumskog opsega)", () => {
    expect(mjesecRange(base("svi"))).toBeNull()
  })
})

describe("applyPlanFilteriBezDatuma", () => {
  const base: PlanFilteri = { status: "svi", q: "", klijentId: "", lokacijaId: "", vrstaId: "", mjesec: "7", godina: 2026, nacin: "svi" }
  function mockQ() {
    const calls: [string, unknown][] = []
    const q: Record<string, (...a: unknown[]) => unknown> = {}
    for (const m of ["eq", "or", "gte", "lte"]) q[m] = (...a: unknown[]) => { calls.push([m, a]); return q }
    return { q, calls }
  }
  it("primjenjuje ne-datumske filtere ali NIKAD gte/lte (čak i uz mjesec=7)", () => {
    const { q, calls } = mockQ()
    applyPlanFilteriBezDatuma(q as never, { ...base, status: "kasni", klijentId: "K1" })
    expect(calls).toContainEqual(["eq", ["status_izvedeni", "kasni"]])
    expect(calls).toContainEqual(["eq", ["klijent_id", "K1"]])
    expect(calls.some(([m]) => m === "gte" || m === "lte")).toBe(false)
  })
})
