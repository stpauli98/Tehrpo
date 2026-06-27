import { describe, it, expect } from "vitest"
import { DOKUMENT_TIPOVI, jeValidanTip, dokumentStoragePath } from "./dokumenti"

describe("jeValidanTip", () => {
  it("prihvata poznate tipove", () => {
    for (const t of DOKUMENT_TIPOVI) expect(jeValidanTip(t)).toBe(true)
  })
  it("odbija nepoznat tip", () => {
    expect(jeValidanTip("virus")).toBe(false)
  })
})

describe("dokumentStoragePath", () => {
  it("klijent scope → klijenti/<id>/<file>", () => {
    expect(dokumentStoragePath({ klijentId: "k1" }, "ugovor.pdf")).toMatch(/^klijenti\/k1\/[\w.-]+$/)
  })
  it("ugovor scope → ugovori/<id>/<file>", () => {
    expect(dokumentStoragePath({ ugovorId: "u1" }, "anex.pdf")).toMatch(/^ugovori\/u1\/[\w.-]+$/)
  })
  it("termin scope → termini/<id>/<file>", () => {
    expect(dokumentStoragePath({ terminId: "t1" }, "nalaz.pdf")).toMatch(/^termini\/t1\/[\w.-]+$/)
  })
  it("sanitizuje ime fajla", () => {
    const p = dokumentStoragePath({ klijentId: "k1" }, "ime sa /razmakom!.pdf")
    expect(p).not.toContain(" ")
    expect(p).not.toContain("!")
  })
})
