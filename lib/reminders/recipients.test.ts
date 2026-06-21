import { describe, it, expect } from "vitest"
import { parseEmailList, assembleRecipients } from "./recipients"

describe("parseEmailList", () => {
  it("razdvaja po zarezu i trim-uje", () => {
    expect(parseEmailList(" a@x.com , b@y.com ")).toEqual(["a@x.com", "b@y.com"])
  })
  it("prazno/undefined → []", () => {
    expect(parseEmailList("")).toEqual([])
    expect(parseEmailList(undefined)).toEqual([])
  })
})

describe("assembleRecipients", () => {
  it("spaja bazu + klijent + lokaciju, dedupe (case-insensitive), filtrira nevalidne", () => {
    const out = assembleRecipients({
      base: ["tehpro@x.com"],
      klijentEmails: ["TEHPRO@x.com", "sef@k.com", "nevalidno"],
      lokacijaEmail: "lok@l.com",
    })
    expect(out).toEqual(["tehpro@x.com", "sef@k.com", "lok@l.com"])
  })
  it("lokacija null se ignoriše", () => {
    expect(assembleRecipients({ base: ["a@x.com"], klijentEmails: [], lokacijaEmail: null }))
      .toEqual(["a@x.com"])
  })
  it("prazno kad nema validnih", () => {
    expect(assembleRecipients({ base: [], klijentEmails: ["x"], lokacijaEmail: null })).toEqual([])
  })
})
