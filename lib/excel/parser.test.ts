import { describe, it, expect } from "vitest"
import { parseTehproExcel } from "./parser"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FIXTURE = path.join(__dirname, "../../tests/fixtures/tehpro-mini.xlsx")

describe("parseTehproExcel", () => {
  it("parsira fixture sa 2 klijenta i 3 vrste pregleda", async () => {
    const result = await parseTehproExcel(FIXTURE)

    // 2 klijenta detektovana
    expect(result.klijenti).toEqual(["KLIJENT A", "KLIJENT B"])

    // 3 vrste (4. je prazna, 6. nema datuma ali se računa u vrstama)
    expect(result.vrste).toContain("Vrsta jedan")
    expect(result.vrste).toContain("Vrsta dva (podkategorija)")
    expect(result.vrste).toContain("Vrsta tri")
  })

  it("ekstrahuje 3 termina iz fixture-a", async () => {
    const result = await parseTehproExcel(FIXTURE)
    expect(result.termini).toHaveLength(3)
  })

  it("mapira izvrseno vs planirano kolonu pravilno", async () => {
    const result = await parseTehproExcel(FIXTURE)

    const a = result.termini.find(
      (t) => t.klijent_naziv === "KLIJENT A" && t.vrsta_naziv === "Vrsta jedan"
    )
    expect(a).toEqual({
      klijent_naziv: "KLIJENT A",
      vrsta_naziv: "Vrsta jedan",
      sheet_naziv: "TestMjesec",
      datum: "2026-01-15",
      izvor: "izvrseno",
    })

    const b = result.termini.find(
      (t) => t.klijent_naziv === "KLIJENT B" && t.vrsta_naziv === "Vrsta jedan"
    )
    expect(b?.izvor).toBe("planirano")
    expect(b?.datum).toBe("2026-02-20")
  })

  it("normalizuje multiline vrsta naziv u jednu liniju", async () => {
    const result = await parseTehproExcel(FIXTURE)
    const vrstaDva = result.termini.find(
      (t) => t.klijent_naziv === "KLIJENT A" && t.vrsta_naziv.startsWith("Vrsta dva")
    )
    expect(vrstaDva?.vrsta_naziv).toBe("Vrsta dva (podkategorija)")
    expect(vrstaDva?.izvor).toBe("planirano")
    expect(vrstaDva?.datum).toBe("2026-03-10")
  })

  it("ne emit-uje termin za prazne ćelije", async () => {
    const result = await parseTehproExcel(FIXTURE)
    // Vrsta tri nema datuma u fixture-u → 0 termina
    const tri = result.termini.filter((t) => t.vrsta_naziv === "Vrsta tri")
    expect(tri).toHaveLength(0)
  })
})
