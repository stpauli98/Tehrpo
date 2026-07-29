import { describe, it, expect } from "vitest"
import { parovi, spljosti, nadjiNeparitet, nadjiIcuOne } from "./prijevodi"

// messages/*.json su ugniježđeni do 5 nivoa; ključ koji next-intl vidi je
// putanja spojena tačkama.
const SR = {
  common: { sacuvaj: "Sačuvaj", otkazi: "Otkaži" },
  klijenti: { lista: { naslov: "Klijenti" } },
}

describe("parovi", () => {
  it("spljoštava ugniježđeni katalog u putanje s tačkom", () => {
    expect(parovi(SR)).toEqual([
      ["common.otkazi", "Otkaži"],
      ["common.sacuvaj", "Sačuvaj"],
      ["klijenti.lista.naslov", "Klijenti"],
    ])
  })

  it("ide do pete dubine", () => {
    const duboko = { a: { b: { c: { d: { e: "kraj" } } } } }
    expect(parovi(duboko)).toEqual([["a.b.c.d.e", "kraj"]])
  })

  it("niz tretira kao list, ne kao nivo", () => {
    expect(parovi({ a: ["x", "y"] })).toEqual([["a", "x,y"]])
  })

  it("prazan katalog daje prazan niz", () => {
    expect(parovi({})).toEqual([])
  })
})

describe("spljosti", () => {
  it("vraća samo ključeve", () => {
    expect(spljosti(SR)).toEqual([
      "common.otkazi",
      "common.sacuvaj",
      "klijenti.lista.naslov",
    ])
  })
})

describe("nadjiNeparitet", () => {
  it("ne prijavlja ništa kad su sva tri kataloga usklađena", () => {
    expect(nadjiNeparitet({ sr: SR, en: SR, de: SR })).toEqual([])
  })

  it("prijavlja ključ koji postoji samo u sr", () => {
    const nalazi = nadjiNeparitet({
      sr: { common: { sacuvaj: "Sačuvaj", novo: "Novo" } },
      en: { common: { sacuvaj: "Save" } },
      de: { common: { sacuvaj: "Speichern" } },
    })
    expect(nalazi).toEqual([{ kljuc: "common.novo", nedostajeU: ["de", "en"] }])
  })

  it("prijavlja ključ koji nedostaje samo u jednom jeziku", () => {
    const nalazi = nadjiNeparitet({
      sr: { a: "1", b: "2" },
      en: { a: "1", b: "2" },
      de: { a: "1" },
    })
    expect(nalazi).toEqual([{ kljuc: "b", nedostajeU: ["de"] }])
  })

  it("prijavlja i kad se razlikuje dubina, ne samo ime", () => {
    const nalazi = nadjiNeparitet({
      sr: { a: { b: "x" } },
      en: { a: "x" },
    })
    expect(nalazi.map((n) => n.kljuc).sort()).toEqual(["a", "a.b"])
  })

  it("nalazi su sortirani po ključu", () => {
    const nalazi = nadjiNeparitet({
      sr: { z: "1", a: "2" },
      en: {},
    })
    expect(nalazi.map((n) => n.kljuc)).toEqual(["a", "z"])
  })
})

describe("nadjiIcuOne", () => {
  it("prijavlja ICU kategoriju one — u srpskom je zabranjena", () => {
    const kat = {
      termini: { broj: "{n, plural, one {# termin} other {# termina}}" },
    }
    expect(nadjiIcuOne(kat)).toEqual(["termini.broj"])
  })

  it("ne prijavlja poruku koja koristi samo few i other", () => {
    const kat = {
      termini: { broj: "{n, plural, few {# termina} other {# termina}}" },
    }
    expect(nadjiIcuOne(kat)).toEqual([])
  })

  it("ne prijavlja riječ 'one' u običnom tekstu", () => {
    expect(nadjiIcuOne({ a: "Telefone i adrese" })).toEqual([])
  })

  it("ne prijavlja 'one' kao dio duže riječi ispred vitičaste", () => {
    expect(nadjiIcuOne({ a: "{n, plural, none {x} other {y}}" })).toEqual([])
  })
})
