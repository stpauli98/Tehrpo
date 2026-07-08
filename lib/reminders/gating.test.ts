import { describe, it, expect } from "vitest"
import { podsjetniciAktivni, lokalniSatIDatum, trebaSlatiSada } from "./gating"

// 2026-07-08T04:00:00Z — ljeti CEST (UTC+2) → lokalno 06:00, datum 2026-07-08
const LJETO_04Z = new Date("2026-07-08T04:00:00Z")
// 2026-07-08T07:00:00Z → lokalno 09:00 ljeti
const LJETO_07Z = new Date("2026-07-08T07:00:00Z")
// 2026-01-08T07:00:00Z — zimi CET (UTC+1) → lokalno 08:00, datum 2026-01-08
const ZIMA_07Z = new Date("2026-01-08T07:00:00Z")
// Spring-forward: 2026-03-29 02:00→03:00 lokalno. 01:30Z = 02:30 CET? Ne — 00:30Z=01:30 CET, 01:00Z=03:00 CEST.
const SPRING_01Z = new Date("2026-03-29T01:00:00Z") // preskočeni lokalni sat 02 → ovo je 03:00 lokalno

describe("podsjetniciAktivni", () => {
  it("true kad je flag true", () => {
    expect(podsjetniciAktivni({ podsjetnici_aktivni: true })).toBe(true)
  })
  it("false kad je flag false", () => {
    expect(podsjetniciAktivni({ podsjetnici_aktivni: false })).toBe(false)
  })
  it("default true kad reda nema (tolerantno na fazu prije migracije)", () => {
    expect(podsjetniciAktivni(null)).toBe(true)
    expect(podsjetniciAktivni(undefined)).toBe(true)
  })
})

describe("lokalniSatIDatum (Europe/Vienna)", () => {
  it("ljeti CEST: 04:00Z → sat 6, datum 2026-07-08", () => {
    expect(lokalniSatIDatum(LJETO_04Z)).toEqual({ sat: 6, datum: "2026-07-08" })
  })
  it("zimi CET: 07:00Z → sat 8, datum 2026-01-08", () => {
    expect(lokalniSatIDatum(ZIMA_07Z)).toEqual({ sat: 8, datum: "2026-01-08" })
  })
  it("spring-forward: 01:00Z (29.03) → lokalni sat 3 (02 ne postoji)", () => {
    expect(lokalniSatIDatum(SPRING_01Z).sat).toBe(3)
  })
})

describe("trebaSlatiSada", () => {
  it("sat < izabrani → false", () => {
    // LJETO_04Z = 06:00 lokalno; izabrani 8 → 6 < 8
    expect(trebaSlatiSada(8, null, LJETO_04Z)).toBe(false)
  })
  it("sat >= izabrani i danas nije slato → true", () => {
    // LJETO_07Z = 09:00 lokalno; izabrani 8 → 9 >= 8, zadnje null
    expect(trebaSlatiSada(8, null, LJETO_07Z)).toBe(true)
  })
  it("vec slato danas (isti lokalni datum) → false", () => {
    expect(trebaSlatiSada(8, "2026-07-08", LJETO_07Z)).toBe(false)
  })
  it("slato jučer → true (novi dan)", () => {
    expect(trebaSlatiSada(8, "2026-07-07", LJETO_07Z)).toBe(true)
  })
  it("spring-forward: izabran preskočeni sat 2, tik u 03 lokalno → true (šalje isti dan)", () => {
    expect(trebaSlatiSada(2, null, SPRING_01Z)).toBe(true)
  })
})
