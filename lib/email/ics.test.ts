import { describe, it, expect } from "vitest"
import { buildTerminIcs } from "./ics"

const FIXED = new Date("2026-06-30T10:00:00.000Z")
const baza = { vrsta: "Hidranti", klijent: "AS", rok: "2026-09-01", terminId: "t1", now: FIXED }

describe("buildTerminIcs", () => {
  it("cjelodnevni event: DTSTART = rok, DTEND = rok+1; VCALENDAR omotač, CRLF", () => {
    const ics = buildTerminIcs(baza)
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true)
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true)
    expect(ics).toContain("DTSTART;VALUE=DATE:20260901")
    expect(ics).toContain("DTEND;VALUE=DATE:20260902")
    expect(ics).toContain("\r\n") // CRLF
    expect(ics).toContain("METHOD:PUBLISH")
  })
  it("SUMMARY 'Vrsta — Klijent', stabilan UID s terminId, DTSTAMP iz now", () => {
    const ics = buildTerminIcs(baza)
    expect(ics).toContain("SUMMARY:Hidranti — AS")
    expect(ics).toContain("UID:t1@")
    expect(ics).toContain("DTSTAMP:20260630T100000Z")
  })
  it("iCal escaping na SUMMARY (zarez/tačka-zarez)", () => {
    const ics = buildTerminIcs({ ...baza, klijent: "AS, d.o.o.; BL" })
    expect(ics).toContain("SUMMARY:Hidranti — AS\\, d.o.o.\\; BL")
  })
  it("VALARM dan ranije", () => {
    const ics = buildTerminIcs(baza)
    expect(ics).toContain("BEGIN:VALARM")
    expect(ics).toContain("TRIGGER:-P1D")
  })
  it("LOCATION kad ima lokacije; izostaje kad je null", () => {
    expect(buildTerminIcs({ ...baza, lokacija: "Gradilište Sjever" })).toContain("LOCATION:Gradilište Sjever")
    expect(buildTerminIcs({ ...baza, lokacija: null })).not.toContain("LOCATION:")
  })
  it("DESCRIPTION nosi deep-link kad ima baseUrl; UID host iz baseUrl", () => {
    const ics = buildTerminIcs({ ...baza, baseUrl: "https://app.test" })
    expect(ics).toContain("plan-aktivnosti?selected=t1")
    expect(ics).toContain("UID:t1@app.test")
  })
  it("bez baseUrl: nema linka u DESCRIPTION", () => {
    expect(buildTerminIcs(baza)).not.toContain("http")
  })
})

describe("buildTerminIcs — en", () => {
  it("DESCRIPTION na engleskom (bez baseUrl)", () => {
    expect(buildTerminIcs(baza, "en")).toContain("DESCRIPTION:Deadline reminder.")
  })
  it("DESCRIPTION na engleskom (s baseUrl) — 'Details:' prefiks i link", () => {
    const ics = buildTerminIcs({ ...baza, baseUrl: "https://app.test" }, "en")
    expect(ics).toContain("Details:")
    expect(ics).toContain("activity-plan?selected=t1")
  })
})
