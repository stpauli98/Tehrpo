import { describe, it, expect } from "vitest"
import { osirotjeliObjekti, odluciSta, type StorageStavka } from "./sweep"

describe("osirotjeliObjekti", () => {
  it("vraća objekte kojima nema reda u bazi", () => {
    expect(
      osirotjeliObjekti(["termini/a/x.pdf", "termini/b/y.pdf"], ["termini/a/x.pdf"]),
    ).toEqual(["termini/b/y.pdf"])
  })

  it("prazan storage → prazan rezultat", () => {
    expect(osirotjeliObjekti([], ["termini/a/x.pdf"])).toEqual([])
  })

  it("sve povezano → ništa za brisanje", () => {
    const p = ["termini/a/x.pdf", "termini/b/y.pdf"]
    expect(osirotjeliObjekti(p, p)).toEqual([])
  })

  it("red u bazi bez fajla se ignoriše (nije naš posao)", () => {
    expect(osirotjeliObjekti(["termini/a/x.pdf"], ["termini/a/x.pdf", "termini/c/z.pdf"])).toEqual([])
  })

  it("prazna baza uz pun storage → SVI objekti izgledaju osirotjelo (opasan smjer — čisto matematički tačno)", () => {
    // Ovo je namjerno pinovano ovdje: sama funkcija ne smije da nagađa je li prazna baza
    // legitimna ili je znak polomljenog upita/pogrešnog projekta — to je posao pozivaoca
    // (vidi odluciSta ispod, koji odbija da obriše kad je baza prazna a bucket nije).
    expect(osirotjeliObjekti(["termini/a/x.pdf", "termini/b/y.pdf"], [])).toEqual([
      "termini/a/x.pdf",
      "termini/b/y.pdf",
    ])
  })
})

describe("odluciSta", () => {
  const GRACE_MS = 24 * 60 * 60 * 1000
  const SADA = Date.parse("2026-07-30T12:00:00.000Z")

  const stavka = (path: string, kreiran: string): StorageStavka => ({ path, kreiran })
  const stara = new Date(SADA - GRACE_MS * 2).toISOString() // dovoljno starije od grace
  const svjeza = new Date(SADA - GRACE_MS / 2).toISOString() // mlađe od grace
  // Nevezan red u bazi — drži putanjeUBazi neprazan da se guard 1 ne umiješa
  // dok se izolovano testira grace filter/set-difference na drugom fajlu.
  const nevezanRed = "klijenti/nekidrugi/ugovor.pdf"

  it("prazna baza + pun bucket → prekid (guard 1)", () => {
    const odluka = odluciSta([stavka("termini/a/x.pdf", stara)], [], SADA, GRACE_MS)
    expect(odluka.akcija).toBe("prekid")
  })

  it("prazna baza + prazan bucket → NIJE prekid (svjež install, nema šta da se briše)", () => {
    expect(odluciSta([], [], SADA, GRACE_MS)).toEqual({ akcija: "brisi", putanje: [] })
  })

  it("osirotjeli fajl mlađi od grace → NE ulazi u putanje za brisanje", () => {
    const odluka = odluciSta([stavka("termini/a/x.pdf", svjeza)], [nevezanRed], SADA, GRACE_MS)
    expect(odluka).toEqual({ akcija: "brisi", putanje: [] })
  })

  it("osirotjeli fajl stariji od grace → ULAZI u putanje za brisanje", () => {
    const odluka = odluciSta([stavka("termini/a/x.pdf", stara)], [nevezanRed], SADA, GRACE_MS)
    expect(odluka).toEqual({ akcija: "brisi", putanje: ["termini/a/x.pdf"] })
  })

  it("mlad fajl SA redom u bazi → ne briše se (grace i set-difference se ne miješaju pogrešno)", () => {
    const odluka = odluciSta(
      [stavka("termini/a/x.pdf", svjeza)],
      ["termini/a/x.pdf"],
      SADA,
      GRACE_MS,
    )
    expect(odluka).toEqual({ akcija: "brisi", putanje: [] })
  })

  it("kreiran nedostaje/neparsibilan → fajl je zaštićen, ne briše se", () => {
    const odluka = odluciSta(
      [stavka("termini/a/x.pdf", "nije-datum")],
      [nevezanRed],
      SADA,
      GRACE_MS,
    )
    expect(odluka).toEqual({ akcija: "brisi", putanje: [] })
  })
})
