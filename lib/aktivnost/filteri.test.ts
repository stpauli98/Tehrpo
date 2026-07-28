import { describe, it, expect } from "vitest"
import { parsirajAktivnostFiltere, kljucFiltera, upitFiltera } from "./filteri"

const izMape = (m: Record<string, string>) => (k: string) => m[k]

describe("parsirajAktivnostFiltere", () => {
  it("prazan ulaz daje prazne filtere i nema kursora", () => {
    expect(parsirajAktivnostFiltere(izMape({}))).toEqual({ kursor: null })
  })

  it("ignoriše neispravan datum umjesto da baci", () => {
    expect(parsirajAktivnostFiltere(izMape({ od: "xyz" }))).toEqual({ kursor: null })
  })

  it("pretvara `do` u ekskluzivnu granicu sljedećeg dana", () => {
    const f = parsirajAktivnostFiltere(izMape({ od: "2026-07-01", do: "2026-07-31" }))
    expect(f.od).toBe("2026-06-30T22:00:00.000Z")
    expect(f.do).toBe("2026-07-31T22:00:00.000Z")
  })

  it("prenosi akciju, korisnika i pretragu", () => {
    const f = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE", korisnik: "u-1", q: "diorit" }))
    expect(f.akcija).toBe("UPDATE")
    expect(f.korisnik).toBe("u-1")
    expect(f.pretraga).toBe("diorit")
  })

  it("čita kursor iz prijeVrijeme/prijeId", () => {
    const f = parsirajAktivnostFiltere(izMape({ prijeVrijeme: "2026-07-28T09:00:00Z", prijeId: "800" }))
    expect(f.kursor).toEqual({ vrijeme: "2026-07-28T09:00:00Z", id: 800 })
  })
})

describe("kljucFiltera", () => {
  it("ne zavisi od kursora — kursor ne smije resetovati listu", () => {
    const a = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE" }))
    const b = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE", prijeId: "800", prijeVrijeme: "2026-07-28T09:00:00Z" }))
    expect(kljucFiltera(a)).toBe(kljucFiltera(b))
  })

  it("mijenja se kad se filter promijeni", () => {
    const a = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE" }))
    const b = parsirajAktivnostFiltere(izMape({ akcija: "INSERT" }))
    expect(kljucFiltera(a)).not.toBe(kljucFiltera(b))
  })
})

describe("upitFiltera", () => {
  it("ne uključuje kursor — njega dodaje pozivalac", () => {
    const f = parsirajAktivnostFiltere(izMape({ akcija: "UPDATE", q: "a b", prijeId: "800", prijeVrijeme: "2026-07-28T09:00:00Z" }))
    const qs = upitFiltera(f)
    expect(qs).toContain("akcija=UPDATE")
    expect(qs).toContain("q=a+b")
    expect(qs).not.toContain("prijeId")
  })

  it("izostavlja prazne filtere", () => {
    expect(upitFiltera(parsirajAktivnostFiltere(izMape({})))).toBe("")
  })
})
