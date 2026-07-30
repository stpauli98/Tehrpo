import { describe, it, expect } from "vitest"
import { jePonedjeljak, trebaDigest } from "./digestCadence"

const PON = "2026-07-20" // ponedjeljak
const UTO = "2026-07-21"
const NED = "2026-07-26"

describe("jePonedjeljak", () => {
  it("prepoznaje ponedjeljak", () => {
    expect(jePonedjeljak(PON)).toBe(true)
  })

  it("odbija ostale dane, uključujući nedjelju", () => {
    for (const d of ["2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", NED]) {
      expect(jePonedjeljak(d)).toBe(false)
    }
  })

  it("ne oslanja se na lokalnu zonu procesa — radi nad ISO datumom", () => {
    // Beogradski datum (Europe/Belgrade) je već izračunat prije poziva; funkcija ga samo tumači.
    expect(jePonedjeljak("2026-01-05")).toBe(true) // ponedjeljak, zimi
    expect(jePonedjeljak("2026-01-04")).toBe(false)
  })
})

describe("trebaDigest", () => {
  const now = new Date("2026-07-20T08:00:00Z")

  it("ponedjeljak, nikad slato → šalje", () => {
    expect(trebaDigest({ danas: PON, zadnjiPoslat: null, danasnji: null, now })).toBe(true)
  })

  it("utorak, nikad slato → NE šalje (čeka ponedjeljak)", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: null, danasnji: null, now })).toBe(false)
  })

  it("utorak, zadnji digest bio juče → NE šalje", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: PON, danasnji: null, now })).toBe(false)
  })

  it("utorak, zadnji digest stariji od 7 dana → šalje (oporavak)", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: "2026-07-13", danasnji: null, now })).toBe(true)
  })

  it("granica: tačno 7 dana → šalje", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: "2026-07-14", danasnji: null, now })).toBe(true)
  })

  it("granica: 6 dana → NE šalje", () => {
    expect(trebaDigest({ danas: UTO, zadnjiPoslat: "2026-07-15", danasnji: null, now })).toBe(false)
  })

  it("ponedjeljak, ali danas već poslato → NE šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: "2026-07-13",
      danasnji: { stanje: "poslato", claimedAt: "2026-07-20T07:00:00Z" }, now,
    })).toBe(false)
  })

  it("ponedjeljak, danas svjež u_toku (mlađi od 15 min) → NE šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: null,
      danasnji: { stanje: "u_toku", claimedAt: "2026-07-20T07:50:00Z" }, now,
    })).toBe(false)
  })

  it("ponedjeljak, danas ZAGLAVLJEN u_toku (stariji od 15 min) → šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: null,
      danasnji: { stanje: "u_toku", claimedAt: "2026-07-20T07:30:00Z" }, now,
    })).toBe(true)
  })

  it("granica: ponedjeljak, u_toku tačno 14:59 minuta (ispod granice) → NE šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: null,
      danasnji: { stanje: "u_toku", claimedAt: "2026-07-20T07:45:01Z" }, now,
    })).toBe(false)
  })

  it("granica: ponedjeljak, u_toku tačno 15:00 minuta (na granici) → šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: null,
      danasnji: { stanje: "u_toku", claimedAt: "2026-07-20T07:45:00Z" }, now,
    })).toBe(true)
  })

  it("granica: ponedjeljak, u_toku tačno 15:01 minuta (iznad granice) → šalje", () => {
    expect(trebaDigest({
      danas: PON, zadnjiPoslat: null,
      danasnji: { stanje: "u_toku", claimedAt: "2026-07-20T07:44:59Z" }, now,
    })).toBe(true)
  })

  it("utorak, nikad uspješno slato ALI zaglavljen jučerašnji pokušaj u prozoru → šalje (oporavak prvog puta)", () => {
    // Prvi ponedjeljak poslije deploya: claim uzet, slanje/upis pao → red ostaje 'u_toku'
    // i sutradan više nije 'današnji'. zadnjiPoslat je i dalje null jer nikad nije uspio.
    expect(trebaDigest({
      danas: UTO, zadnjiPoslat: null, danasnji: null,
      neuspjeliPokusaj: PON, now,
    })).toBe(true)
  })

  it("utorak, nikad ništa u ledgeru (bez neuspjelog pokušaja) → i dalje NE šalje (čeka ponedjeljak)", () => {
    // Ne smije se narušiti postojeće ponašanje: primalac koji nikad ništa nije imao
    // u ledgeru i dalje čeka ponedjeljak.
    expect(trebaDigest({
      danas: UTO, zadnjiPoslat: null, danasnji: null,
      neuspjeliPokusaj: null, now,
    })).toBe(false)
  })

  it("utorak, zadnji digest bio juče USPJEŠNO, uz stariji neuspjeli pokušaj u prozoru → NE šalje", () => {
    // zadnjiPoslat postoji → odluka ide isključivo po 7-dnevnoj kadenci, neuspjeliPokusaj
    // se ignoriše kad postoji uspješan zapis.
    expect(trebaDigest({
      danas: UTO, zadnjiPoslat: PON, danasnji: null,
      neuspjeliPokusaj: "2026-07-06", now,
    })).toBe(false)
  })
})
