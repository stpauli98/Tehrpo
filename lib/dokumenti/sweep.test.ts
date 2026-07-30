import { describe, it, expect } from "vitest"
import { odluciSta, type StorageObjekat } from "./sweep"

describe("odluciSta", () => {
  const GRACE_MS = 24 * 60 * 60 * 1000
  const SADA = Date.parse("2026-07-30T12:00:00.000Z")

  const stara = new Date(SADA - GRACE_MS * 2).toISOString() // dovoljno starije od grace
  const svjeza = new Date(SADA - GRACE_MS / 2).toISOString() // mlađe od grace
  const stavka = (path: string, updatedAt = stara): StorageObjekat => ({ path, updatedAt })

  /**
   * Punilo za ogradu po udjelu: N fajlova koji SVI imaju red u bazi, pa nisu kandidati.
   * Bez njih bi svaki test sa jednim osirotjelim fajlom udario u prag od 50%.
   */
  const uparenih = (n: number) => {
    const putanje = Array.from({ length: n }, (_, i) => `klijenti/upareni/${i}.pdf`)
    return { objekti: putanje.map((p) => stavka(p)), putanje }
  }

  it("prazna baza + pun bucket → prekid (ograda 1)", () => {
    const odluka = odluciSta([stavka("termini/a/x.pdf")], [], SADA, GRACE_MS)
    expect(odluka).toEqual({
      akcija: "prekid",
      razlog: "dokumenti je prazan a bucket nije — prekid",
    })
  })

  it("prazna baza + prazan bucket → NIJE prekid (svjež install, nema šta da se briše)", () => {
    expect(odluciSta([], [], SADA, GRACE_MS)).toEqual({
      akcija: "brisi",
      putanje: [],
      presvjezi: [],
      slomljeniRedovi: [],
    })
  })

  it("osirotjeli fajl mlađi od grace → NE ulazi u putanje za brisanje", () => {
    const p = uparenih(4)
    const odluka = odluciSta(
      [...p.objekti, stavka("termini/a/x.pdf", svjeza)],
      p.putanje,
      SADA,
      GRACE_MS,
    )
    expect(odluka).toEqual({
      akcija: "brisi",
      putanje: [],
      presvjezi: ["termini/a/x.pdf"],
      slomljeniRedovi: [],
    })
  })

  it("osirotjeli fajl stariji od grace → ULAZI u putanje za brisanje", () => {
    const p = uparenih(4)
    const odluka = odluciSta([...p.objekti, stavka("termini/a/x.pdf")], p.putanje, SADA, GRACE_MS)
    expect(odluka).toEqual({
      akcija: "brisi",
      putanje: ["termini/a/x.pdf"],
      presvjezi: [],
      slomljeniRedovi: [],
    })
  })

  it("mlad fajl SA redom u bazi → ne briše se (grace i set-difference se ne miješaju pogrešno)", () => {
    const odluka = odluciSta(
      [stavka("termini/a/x.pdf", svjeza)],
      ["termini/a/x.pdf"],
      SADA,
      GRACE_MS,
    )
    expect(odluka).toEqual({
      akcija: "brisi",
      putanje: [],
      presvjezi: [],
      slomljeniRedovi: [],
    })
  })

  it("updatedAt nedostaje/neparsibilan → fajl je zaštićen, ne briše se", () => {
    const p = uparenih(4)
    const odluka = odluciSta(
      [...p.objekti, stavka("termini/a/x.pdf", "nije-datum")],
      p.putanje,
      SADA,
      GRACE_MS,
    )
    expect(odluka).toEqual({
      akcija: "brisi",
      putanje: [],
      presvjezi: ["termini/a/x.pdf"],
      slomljeniRedovi: [],
    })
  })

  it("red u bazi bez fajla → prijavljuje se kao slomljen, ne briše se ništa", () => {
    const odluka = odluciSta(
      [stavka("termini/a/x.pdf")],
      ["termini/a/x.pdf", "termini/nestao/y.pdf"],
      SADA,
      GRACE_MS,
    )
    expect(odluka).toEqual({
      akcija: "brisi",
      putanje: [],
      presvjezi: [],
      slomljeniRedovi: ["termini/nestao/y.pdf"],
    })
  })

  describe("ograda 2 — udio bucketa", () => {
    /**
     * Oblik kvara koji ograda 1 NE vidi: popis iz baze je DJELIMIČNO pročitan (tiho odsjecanje
     * paginacije), pa `putanjeUBazi` nije prazan — ograda 1 ćuti — a svi redovi iza reza
     * izgledaju osirotjelo. Ovdje je pročitana 1 od 10 putanja: 9/10 objekata bi bilo obrisano.
     */
    it("djelimično pročitan popis (9/10 objekata kandidati) → prekid, ne brisanje", () => {
      const sviObjekti = Array.from({ length: 10 }, (_, i) => stavka(`termini/a/${i}.pdf`))
      const procitano = ["termini/a/0.pdf"] // ostalih 9 redova odsječeno
      const odluka = odluciSta(sviObjekti, procitano, SADA, GRACE_MS)
      expect(odluka.akcija).toBe("prekid")
      expect(odluka.akcija === "prekid" && odluka.razlog).toBe(
        "previše kandidata: 9/10 objekata (prag 50%) — prekid",
      )
    })

    it("granica: TAČNO 50% bucketa → i dalje briše", () => {
      const sviObjekti = Array.from({ length: 10 }, (_, i) => stavka(`termini/a/${i}.pdf`))
      const uBazi = sviObjekti.slice(0, 5).map((o) => o.path)
      const odluka = odluciSta(sviObjekti, uBazi, SADA, GRACE_MS)
      expect(odluka).toEqual({
        akcija: "brisi",
        putanje: ["termini/a/5.pdf", "termini/a/6.pdf", "termini/a/7.pdf", "termini/a/8.pdf", "termini/a/9.pdf"],
        presvjezi: [],
        slomljeniRedovi: [],
      })
    })

    it("granica: jedan preko 50% (6/10) → prekid", () => {
      const sviObjekti = Array.from({ length: 10 }, (_, i) => stavka(`termini/a/${i}.pdf`))
      const uBazi = sviObjekti.slice(0, 4).map((o) => o.path)
      const odluka = odluciSta(sviObjekti, uBazi, SADA, GRACE_MS)
      expect(odluka).toEqual({
        akcija: "prekid",
        razlog: "previše kandidata: 6/10 objekata (prag 50%) — prekid",
      })
    })

    /**
     * Imenilac je CIJELI bucket (prije grace filtera), ne samo zreli objekti — grace-zaštićeni
     * fajlovi ulaze u kvotu iako sami nisu kandidati. Ulaz je izabran tako da RAZLIKUJE ta dva
     * imenioca, jer ih većina brojeva ne razlikuje:
     *   5 zrelih osirotjelih + 5 svježih osirotjelih + 2 uparena (stara) = 12 objekata.
     *   sadašnji imenilac (svih 12):        5/12 = 41.7% ≤ 50% → briši   ← ovo tvrdi ovaj test
     *   imenilac „samo zreli" (5 + 2 = 7):  5/7  = 71.4% > 50% → prekid
     * Namjerno se zadržava širi imenilac: udio svježih fajlova u ovom bucketu je mali, pa je
     * uži imenilac samo šum, a odluka „koji je imenilac ispravan" ne mijenja se tiho.
     */
    it("imenilac je cijeli bucket — grace-zaštićeni fajlovi ulaze u kvotu", () => {
      const zreli = Array.from({ length: 5 }, (_, i) => stavka(`termini/zreo/${i}.pdf`))
      const svjezi = Array.from({ length: 5 }, (_, i) => stavka(`termini/svjez/${i}.pdf`, svjeza))
      const p = uparenih(2)
      const odluka = odluciSta([...zreli, ...svjezi, ...p.objekti], p.putanje, SADA, GRACE_MS)
      expect(odluka).toEqual({
        akcija: "brisi",
        putanje: zreli.map((o) => o.path),
        presvjezi: svjezi.map((o) => o.path),
        slomljeniRedovi: [],
      })
    })
  })
})
