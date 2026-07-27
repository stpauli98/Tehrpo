import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  DOKUMENT_TIPOVI,
  jeValidanTip,
  dokumentStoragePath,
  ALLOWED_MIME,
  ACCEPT_ATTR,
  MAX_BYTES,
  MAX_MB,
  safeName,
  validirajFajl,
} from "./dokumenti"

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
  it("sanitizuje ime fajla (razmak preživljava, specijalni znakovi ne)", () => {
    const p = dokumentStoragePath({ klijentId: "k1" }, "ime sa /razmakom!.pdf")
    expect(p).toContain("ime sa _razmakom_.pdf")
    expect(p).not.toContain("!")
    // kosa crta ne smije proizvesti dodatni nivo putanje
    expect(p.split("/")).toHaveLength(3)
  })
})

describe("safeName", () => {
  it("čuva razmake", () => {
    expect(safeName("moj nalaz 2026.pdf")).toBe("moj nalaz 2026.pdf")
  })
  it("specijalne znakove svodi na _", () => {
    expect(safeName("a/b*c?.pdf")).toBe("a_b_c_.pdf")
  })
  it("prazno ime → dokument", () => {
    expect(safeName("")).toBe("dokument")
    expect(safeName("///")).toBe("_")
  })
  it("ograničava dužinu na 120 znakova", () => {
    expect(safeName("a".repeat(300))).toHaveLength(120)
  })
})

describe("validirajFajl", () => {
  it("prihvata dozvoljen tip u granici veličine", () => {
    expect(validirajFajl({ type: "application/pdf", size: MAX_BYTES })).toEqual({ ok: true })
  })
  it("odbija nedozvoljen tip", () => {
    expect(validirajFajl({ type: "application/x-msdownload", size: 10 })).toEqual({
      ok: false,
      razlog: "tip",
    })
  })
  it("odbija fajl preko granice", () => {
    expect(validirajFajl({ type: "image/png", size: MAX_BYTES + 1 })).toEqual({
      ok: false,
      razlog: "velicina",
    })
  })
  it("tip se provjerava prije veličine", () => {
    expect(validirajFajl({ type: "text/plain", size: MAX_BYTES + 1 })).toEqual({
      ok: false,
      razlog: "tip",
    })
  })
})

describe("upload limiti", () => {
  it("MAX_BYTES odgovara MAX_MB", () => {
    expect(MAX_BYTES).toBe(MAX_MB * 1024 * 1024)
  })
  it("ACCEPT_ATTR ima stavku za svaki ALLOWED_MIME član", () => {
    const stavke = ACCEPT_ATTR.split(",")
    expect(stavke).toHaveLength(ALLOWED_MIME.length)
    for (const stavka of stavke) expect(stavka).not.toBe("")
  })
  it("ACCEPT_ATTR mapira docx/pdf na ekstenzije, slike ostavlja kao MIME", () => {
    expect(ACCEPT_ATTR).toBe(".docx,.pdf,image/png,image/jpeg,image/webp")
  })
})

// DOKUMENT_TIPOVI ↔ SQL CHECK paritet (S8.5).
// Promjena liste tipova ide ISKLJUČIVO kroz lockstep DB PR (nova migracija koja
// redefiniše constraint `chk_dokumenti_tip`) + izmjenu DOKUMENT_TIPOVI u lib/dokumenti.ts
// u ISTOM ciklusu. Ovaj test puca čim se jedan izvor promijeni bez drugog.
describe("DOKUMENT_TIPOVI ↔ chk_dokumenti_tip paritet", () => {
  /** Iz SQL-a migracije izvuci vrijednosti CHECK-a vezanog za IME `chk_dokumenti_tip`
   *  (vezivanje za ime constrainta automatski isključuje npr. klijenti.tip_odnosa CHECK). */
  function parsirajTipove(sql: string): string[] | null {
    const m = sql.match(
      /add\s+constraint\s+chk_dokumenti_tip\s+check\s*\(\s*tip\s+in\s*\(([^)]*)\)/i,
    )
    const grupa = m?.[1]
    if (grupa === undefined) return null
    return [...grupa.matchAll(/'([^']*)'/g)].map((v) => v[1] ?? "")
  }

  it("skup tipova u kodu === skup tipova u posljednjoj migraciji koja definiše chk_dokumenti_tip", () => {
    const dir = join(process.cwd(), "supabase", "migrations")
    const kandidati = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort() // alfabetski = hronološki (timestamp prefiks)
      .filter((f) => parsirajTipove(readFileSync(join(dir, f), "utf8")) !== null)

    expect(kandidati.length).toBeGreaterThan(0)

    // Ako više migracija redefiniše constraint, mjerodavna je POSLJEDNJA.
    const posljednja = kandidati[kandidati.length - 1]!
    const sqlTipovi = parsirajTipove(readFileSync(join(dir, posljednja), "utf8"))!

    // Poređenje skupova, ne redoslijeda.
    expect(new Set(sqlTipovi)).toEqual(new Set(DOKUMENT_TIPOVI))
  })
})
