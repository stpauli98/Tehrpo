import { describe, it, expect } from "vitest"
import { analizirajOrphan } from "./dokumenti-gc"

const SADA = Date.parse("2026-06-30T12:00:00.000Z")
const GRACE = 24 * 60 * 60 * 1000 // 24h

describe("analizirajOrphan", () => {
  it("stari orphan fajl (nema red, ≥ grace) → kandidat za brisanje", () => {
    const r = analizirajOrphan({
      bucketObjekti: [{ path: "klijenti/k1/a.pdf", updatedAt: "2026-06-28T12:00:00.000Z" }],
      dbPutanje: [],
      sada: SADA,
      graceMs: GRACE,
    })
    expect(r.orphanFajlovi).toEqual(["klijenti/k1/a.pdf"])
    expect(r.presvjeziOrphani).toEqual([])
    expect(r.slomljeniRedovi).toEqual([])
  })

  it("svjež orphan (< grace) → preskočen", () => {
    const r = analizirajOrphan({
      bucketObjekti: [{ path: "klijenti/k1/b.pdf", updatedAt: "2026-06-30T11:30:00.000Z" }],
      dbPutanje: [],
      sada: SADA,
      graceMs: GRACE,
    })
    expect(r.orphanFajlovi).toEqual([])
    expect(r.presvjeziOrphani).toEqual(["klijenti/k1/b.pdf"])
  })

  it("fajl koji ima red u bazi → ignorisan", () => {
    const r = analizirajOrphan({
      bucketObjekti: [{ path: "klijenti/k1/c.pdf", updatedAt: "2026-06-01T00:00:00.000Z" }],
      dbPutanje: ["klijenti/k1/c.pdf"],
      sada: SADA,
      graceMs: GRACE,
    })
    expect(r.orphanFajlovi).toEqual([])
    expect(r.presvjeziOrphani).toEqual([])
    expect(r.slomljeniRedovi).toEqual([])
  })

  it("red u bazi bez fajla → slomljeni red (samo prijava)", () => {
    const r = analizirajOrphan({
      bucketObjekti: [],
      dbPutanje: ["klijenti/k1/d.pdf"],
      sada: SADA,
      graceMs: GRACE,
    })
    expect(r.slomljeniRedovi).toEqual(["klijenti/k1/d.pdf"])
    expect(r.orphanFajlovi).toEqual([])
  })

  it("prazni ulazi → prazan rezultat", () => {
    const r = analizirajOrphan({ bucketObjekti: [], dbPutanje: [], sada: SADA, graceMs: GRACE })
    expect(r).toEqual({ orphanFajlovi: [], presvjeziOrphani: [], slomljeniRedovi: [] })
  })
})
